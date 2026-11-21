"""Basketball foundation model, game level: every player's minutes and stat line on a given night.

Every training example is a real game seen from a prediction date 1-90 days before it: both teams' players (bench
included), each a token made of his player vector (fixed for his career: who he is) + his form vector (a form encoder
shared by all players reads his player vector and his last FORM_WINDOW games: how he's playing now) + his role inputs,
plus a token per team (home, rest, back-to-back, horizon, team form). A transformer across both teams, so teammates
(who's in and out) and opponents shape his night. For every player, assuming he plays:

  minutes      his share of his team's 240, as an adjustment to his recent minutes (the minutes anchor)
  stat line    per minute, as a change from his own recent line shrunk toward the league (the stat-line anchor);
               consistent by construction (attempts x make rates), scored with the league's scoring
  forecast     his minutes and line over his next 5 games (training only: makes form a forecast)

No betting lines, no injury prediction, no simulation. Rookies get player vectors from a trait encoder (college,
preseason, age, size, position, draft slot). No epoch limits: phase 1 finds the best epoch on held-out later games,
phase 2 retrains on everything for that long.

Order: models to test on each held-out season, then the final models (saved); only then every held-out game is
predicted 7/14/30/60 days ahead and compared with season-to-date and last-10 averages; then rest-of-season values.

Outputs: output/report.txt, output/ros_<as-of>.csv, checkpoints/game_models_2027.pt. See README.md.

Usage:
    python run.py                       # test on 2026, then the final models and rest-of-season values
    python run.py --holdouts            # skip the test
    python run.py --ensemble 3          # average 3 models (steadier, ~3x the time)
    python run.py --as-of 2026-12-01    # rest-of-season values as of a date
    python run.py --smoke               # tiny slices, one epoch: checks the pipeline end to end
"""

import argparse
import bisect
import csv
import datetime
import json
import math
import os
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
OUT = HERE / "output"
# FOUNDATION_DEVICE=cpu (or cuda / mps) forces a device; by default the fastest available
DEVICE = os.environ.get("FOUNDATION_DEVICE") or ("cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu"))
if DEVICE == "cpu":
    torch.set_num_threads(min(4, os.cpu_count() or 1))
DIM, LAYERS, HEADS, N_OUTCOMES = 64, 3, 4, 12
ROLE_FEATURES = 14
PRESEASON_WEIGHT = 0.15          # how far preseason per-36 moves projected per-36 (as in the current board)
MIN_PRESEASON_MINUTES = 40
MAX_PLAYERS = 16
FIRST = 2019
SCORING = json.loads((DATA / "scoring.json").read_text())


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------------------------------------------------------------- data

def _int_keys(d):
    return {int(k): v for k, v in d.items()}


SEASONS = {int(s): _int_keys(v) for s, v in json.loads((DATA / "seasons.json").read_text()).items()}
BIOS = _int_keys(json.loads((DATA / "players.json").read_text()))
STARTS = {int(s): v for s, v in json.loads((DATA / "season_starts.json").read_text()).items()}
PRESEASON = {int(s): _int_keys(v) for s, v in json.loads((DATA / "preseason.json").read_text()).items()}
PRE_TEAM_GAMES = {int(s): v for s, v in json.loads((DATA / "preseason_team_games.json").read_text()).items()}
POSITIONS = _int_keys(json.loads((DATA / "positions.json").read_text()))
PLANS = {int(s): _int_keys(v) for s, v in json.loads((DATA / "plans.json").read_text()).items()}   # role model minutes plans
COLLEGE = _int_keys(json.loads((DATA / "college.json").read_text()))
COLLEGE_KEYS = ["college_fp40", "college_mpg", "college_gp", "college_ts", "college_pts40", "college_reb40", "college_ast40",
                "college_stl40", "college_blk40", "college_to40", "college_3pa40", "college_fta40", "college_vs_ranked_fp40"]
ROOKIE_RIDGE = 10.0


def is_rookie(pid, season):
    return (BIOS.get(pid) or {}).get("draft_year") == season - 1 and pid not in SEASONS.get(season - 1, {})


def rookie_traits(pid, season):
    """College per-40 and percentages (or a missing flag), preseason, age, size, draft slot."""
    b = BIOS.get(pid) or {}
    c = COLLEGE.get(pid) or {}
    has_c = bool(c.get("has_college"))
    col = [float(c.get(k) or 0.0) if has_c else 0.0 for k in COLLEGE_KEYS]
    pre = preseason(pid, season)
    pre_part = [pre[0], pre[1], pre[2] or 0.0, 1.0, float(pre[2] is not None)] if pre else [0.0, 0.0, 0.0, 0.0, 0.0]
    age = age_on(pid, season) or 20.5
    pos = (b.get("position") or "").upper()
    position = [float("G" in pos), float("F" in pos), float("C" in pos)]
    return np.array([age, (b.get("draft_pick") or 61), (b.get("height") or 78), (b.get("weight") or 215),
                     float(has_c)] + col + pre_part + position, np.float64)


def preseason(pid, season):
    """(minutes per game, share of his team's preseason games started, per-36) or None."""
    r = PRESEASON.get(season, {}).get(pid)
    if not r or not r.get("GP"):
        return None
    games = PRE_TEAM_GAMES.get(season, {}).get(r.get("team")) or r["GP"]
    return ((r.get("MIN") or 0) / r["GP"], min((r.get("starts") or 0) / max(games, 1), 1.0),
            r.get("FP_per_36") if (r.get("MIN") or 0) >= MIN_PRESEASON_MINUTES else None)


def season_start(season):
    return datetime.date.fromisoformat(STARTS.get(season, f"{season - 1}-10-20"))


def age_on(pid, season):
    b = (BIOS.get(pid) or {}).get("birth_date")
    if not b:
        return None
    return (season_start(season) - datetime.date.fromisoformat(b[:10])).days / 365.25


def role_inputs(pid, season):
    """Last season's role (minutes, starts, games share, per-36), age, draft slot, rookie flag, this season's
    preseason (minutes, start share, per-36, played-in-preseason flag), and the role model's minutes plan for
    this season (with a has-plan flag; the role model exists from 2022-23 on)."""
    r = SEASONS.get(season - 1, {}).get(pid)
    age = age_on(pid, season)
    pick = (BIOS.get(pid) or {}).get("draft_pick") or 61
    pre = preseason(pid, season)
    pre_part = [pre[0] / 36, pre[1], (pre[2] or 0) / 50, 1.0] if pre else [0.0, 0.0, 0.0, 0.0]
    plan = PLANS.get(season, {}).get(pid)
    pre_part = pre_part + ([plan / 36, 1.0] if plan is not None else [0.0, 0.0])
    if r:
        last = [r["MPG"] / 36, r.get("start_rate") or 0.0, min(r["GP"] / 82, 1.0), (r["FP36"] or 0) / 50]
        return np.array(last + [((age or 27) - 27) / 5, pick / 60, 0.0, 1.0] + pre_part, np.float32)
    return np.array([0, 0, 0, 0, ((age or 21) - 27) / 5, pick / 60, 1.0, 1.0] + pre_part, np.float32)



# ---------------------------------------------------------------- games, form, targets

FANTASY_GAMES = {int(k): v for k, v in json.loads((DATA / "team_games_full.json").read_text()).items()}
STATS = ("FGM", "FGA", "3PM", "3PA", "FTM", "FTA", "OREB", "DREB", "AST", "STL", "BLK", "TO", "PF")   # each player's line


def _fantasy_weights():
    """League scoring as weights on the stat line (points = 2 x FGM + 3PM + FTM, rebounds = OREB + DREB)."""
    w = dict.fromkeys(STATS, 0.0)
    pts = SCORING.get("PTS", 0)
    w["FGM"] += SCORING.get("FGM", 0) + 2 * pts
    w["3PM"] += SCORING.get("3PM", 0) + pts
    w["FTM"] += SCORING.get("FTM", 0) + pts
    for k in ("FGA", "FTA", "3PA", "AST", "STL", "BLK", "TO", "PF"):
        w[k] += SCORING.get(k, 0)
    w["OREB"] += SCORING.get("REB", 0)
    w["DREB"] += SCORING.get("REB", 0)
    return torch.tensor([w[k] for k in STATS], dtype=torch.float32)


FANTASY_WEIGHTS = _fantasy_weights()
POINTS_WEIGHTS = torch.tensor([2.0 if k == "FGM" else 1.0 if k in ("3PM", "FTM") else 0.0 for k in STATS])
MINUTES_ADJUST_PENALTY = 0.1    # cost of moving a player's minutes away from his anchor (log scale)
ANCHOR_GAMES = 10               # minutes anchor: his average minutes over his last 10 games before the prediction date...
ANCHOR_MIN_GAMES = 3            # ...with at least this many of them within ANCHOR_MAX_DAYS; otherwise the role model's plan
ANCHOR_MAX_DAYS = 120
SHRINK_MINUTES = 200.0          # stat-line anchor: per-minute rates shrunk toward the league with this many minutes of league
SHRINK_ATTEMPTS = 50.0          # shooting shares and percentages shrunk with this many attempts of league average
SHRINK_FT = 30.0
FORECAST_GAMES = 5
FORECAST_WEIGHT = 0.1
VAL_SHARE = 0.05                # share of game dates held out (early stopping)
PATIENCE = 8                    # epochs without a held-out improvement before stopping (the best epoch is kept)
TEAM_FORM = 4                   # team's last 10 games before the prediction date: points for, against, pace, games
GAME_CONTEXT = 4 + TEAM_FORM    # home, back-to-back, rest, horizon + team form
HORIZON_MAX = 90                # predictions are made 1-90 days before the game (an input to the model)
EVAL_HORIZONS = (7, 14, 30, 60)
PLAYER_DROPOUT = 0.15           # training: share of player vectors switched off (form and role must carry those)
DROPOUT = 0.2                   # inside the transformers
WEIGHT_DECAY = 0.01
HORIZON_VARIANTS = 8            # without on-the-fly horizons: each game built at this many random horizons, cycled by epoch
ON_THE_FLY = True               # a fresh random horizon for every game in every batch (form windows and team form computed live)
VAL_FRACTION = 0.4              # phase 1 holds out the last 40% of the latest training season
WARMUP_STEPS = 300
SMOKE = False                   # --smoke: tiny slices and one epoch per model
FIRST_TRAINING_SEASON = 2019


FORM_WINDOW = 15               # his most recent games the form encoder reads
STYLE_COUNTS = 16              # possession counts per player-game (_style_counts)
REC_FEATURES = 2 + len(STATS) + STYLE_COUNTS + 4   # minutes, started, stat line, possession counts, days since his previous
                                                   # game, team games missed before it, home, back-to-back


def _style_counts():
    """Per player-game possession counts from the play-by-play: possessions on offense, used, shot attempts by zone,
    free-throw trips, turnovers, assists, rebound chances and rebounds at both ends, defensive possessions, steals,
    opponents' misses, blocks. Keyed by (player, 'YYYY-MM-DD')."""
    counts = {}
    for season in range(FIRST, max(FANTASY_GAMES) + 1):
        path = DATA / f"events_{season}.npz"
        if not path.exists():
            continue
        ev = np.load(path)
        P, kind, out, actor = ev["players"].astype(np.int64), ev["kind"], ev["outcome"], ev["actor"].astype(np.int64)
        assister, stealer, blocker = ev["assister"].astype(np.int64), ev["stealer"].astype(np.int64), ev["blocker"].astype(np.int64)
        key = P * 100_000_000 + ev["date"].astype(np.int64)[:, None]
        k0, k1 = kind == 0, kind == 1
        rows = np.arange(len(P))
        cols, keys = [], []

        def add(col, k):
            keys.append(k.ravel()); cols.append(np.full(k.size, col))
        add(0, key[k0, :5])                                                    # offensive possessions
        used = key[rows[k0], actor[k0]]; add(1, used)
        zone = np.where(out < 10, out // 2, -1)
        for col, zones in ((2, (0,)), (3, (1, 2)), (4, (3, 4))):               # rim / short+mid / three attempts
            sel = k0 & np.isin(zone, zones); add(col, key[rows[sel], actor[sel]])
        sel = k0 & (out == 10); add(5, key[rows[sel], actor[sel]])             # free-throw trips
        sel = k0 & (out == 11); add(6, key[rows[sel], actor[sel]])             # turnovers
        sel = k0 & (assister >= 0); add(7, key[rows[sel], assister[sel]])      # assists
        add(8, key[k1, :5])                                                    # offensive rebound chances
        sel = k1 & (actor < 5); add(9, key[rows[sel], actor[sel]])             # offensive rebounds
        add(10, key[k1, 5:])                                                   # defensive rebound chances
        sel = k1 & (actor >= 5); add(11, key[rows[sel], actor[sel]])           # defensive rebounds
        add(12, key[k0, 5:])                                                   # defensive possessions
        sel = k0 & (stealer >= 0); add(13, key[rows[sel], 5 + stealer[sel]])   # steals
        miss = k0 & (out < 10) & (out % 2 == 0); add(14, key[miss, 5:])        # opponents' misses while defending
        sel = miss & (blocker >= 0); add(15, key[rows[sel], 5 + blocker[sel]]) # blocks
        keys, cols = np.concatenate(keys), np.concatenate(cols)
        uniq, inv = np.unique(keys, return_inverse=True)
        mat = np.zeros((len(uniq), 16), np.float32)
        np.add.at(mat, (inv, cols), 1.0)
        for k, row in zip(uniq, mat):
            d = str(int(k % 100_000_000))
            counts[(int(k // 100_000_000), f"{d[:4]}-{d[4:6]}-{d[6:]}")] = row
    return counts


_REC = {}


def records():
    """One raw record per player-game, 2019 on: minutes, started, his stat line, his possession counts, days since his
    previous game, team games his team played that he missed before it, home, back-to-back. Standardized; row 0 = none.
    Also each player's records in date order, and team games missed before each of his games."""
    if _REC:
        return _REC
    style = _style_counts()
    no_style = np.zeros(STYLE_COUNTS, np.float32)
    history, team_dates = {}, {}
    for season in sorted(FANTASY_GAMES):
        for g in FANTASY_GAMES[season]:
            team_dates.setdefault((g["team"], season), []).append(g["date"])
            for row in g["rows"]:
                history.setdefault(row[0], []).append((g["date"], season, g["team"], row[1], row[4], row[3],
                                                       style.get((row[0], g["date"]), no_style), g["home"]))
    for k in team_dates:
        team_dates[k].sort()
    day = datetime.date.fromisoformat
    feats, rows_of, dates_of, missed_of = [], {}, {}, {}
    for pid, h in history.items():
        h.sort(key=lambda e: e[0])
        lst = []
        for k, (date, season, team, mins, line, started, sty, home) in enumerate(h):
            dates = team_dates[(team, season)]
            pos = bisect.bisect_left(dates, date)
            missed = pos - bisect.bisect_right(dates, h[k - 1][0]) if k and h[k - 1][1] == season else pos
            missed = max(missed, 0)                   # traded players: the old team's dates don't line up
            gap = min((day(date) - day(h[k - 1][0])).days, 30) if k else 30
            b2b = float(pos > 0 and (day(date) - day(dates[pos - 1])).days == 1)
            feats.append([mins / 36, float(started), *line, *sty, gap / 10, math.log1p(missed) / 3, float(home), b2b])
            lst.append((date, len(feats)))            # row in the matrix (row 0 is "no record")
            missed_of[(pid, date)] = missed
        rows_of[pid] = lst
        dates_of[pid] = [d for d, _ in lst]
    M = np.array(feats, np.float32)
    mu, sd = M.mean(0), M.std(0) + 1e-6
    matrix = np.vstack([np.zeros((1, M.shape[1]), np.float32), (M - mu) / sd])
    _REC.update(matrix=matrix, rows_of=rows_of, dates_of=dates_of, missed=missed_of, mu=mu, sd=sd,
                minutes=np.concatenate([[0.0], M[:, 0] * 36]).astype(np.float32),
                lines=np.vstack([np.zeros((1, len(STATS)), np.float32), M[:, 2:2 + len(STATS)]]).astype(np.float32))
    log(f"  form records: {len(history)} players, {len(feats):,} player-games, {M.shape[1]} raw numbers each")
    return _REC


def minutes_anchor(w_idx, w_gap, plan_prior):
    """log(1 + minutes) the minutes head starts from: his average over his last ANCHOR_GAMES games in the window (only
    those within ANCHOR_MAX_DAYS of the prediction date), given at least ANCHOR_MIN_GAMES of them; otherwise his plan
    prior (the role model's minutes plan, or last season's minutes)."""
    mins = records()["minutes"][w_idx][..., -ANCHOR_GAMES:]
    ok = (w_idx[..., -ANCHOR_GAMES:] > 0) & (w_gap[..., -ANCHOR_GAMES:] <= ANCHOR_MAX_DAYS / 100)
    n = ok.sum(-1)
    recent = (mins * ok).sum(-1) / np.maximum(n, 1)
    return np.where(n >= ANCHOR_MIN_GAMES, np.log1p(recent), plan_prior).astype(np.float32)


_LEAGUE = {}


def _league_line():
    """League totals per minute and shooting percentages (all records): what anchors shrink toward."""
    if not _LEAGUE:
        rec = records()
        tot, mins = rec["lines"].sum(0), rec["minutes"].sum()
        _LEAGUE.update(tot=tot, mins=mins)
    return _LEAGUE["tot"], _LEAGUE["mins"]


def line_anchor(w_idx, w_gap):
    """The stat head's starting point, in its own parameters: his per-minute line over the recent games in the window
    (those within ANCHOR_MAX_DAYS of the prediction date) as shot-attempt rate, three-point share, 2- and 3-point
    percentages, free-throw-trip rate and percentage, and per-minute rebounds, assists, steals, blocks, turnovers, fouls,
    each shrunk toward the league average by how much evidence there is. Shape [..., STATS]."""
    rec = records()
    i = {k: n for n, k in enumerate(STATS)}
    ok = ((w_idx > 0) & (w_gap <= ANCHOR_MAX_DAYS / 100)).astype(np.float32)
    lines = (rec["lines"][w_idx] * ok[..., None]).sum(-2)
    mins = (rec["minutes"][w_idx] * ok).sum(-1)
    L, Lm = _league_line()
    g = lambda arr, k: arr[..., i[k]]
    rate = lambda k: (g(lines, k) + SHRINK_MINUTES * L[i[k]] / Lm) / (mins + SHRINK_MINUTES)
    def share(num, den, lnum, lden, k):
        return (num + k * lnum / lden) / (den + k)
    fga, a3, fgm, m3, fta, ftm = (g(lines, k) for k in ("FGA", "3PA", "FGM", "3PM", "FTA", "FTM"))
    p = [rate("FGA"), share(a3, fga, L[i["3PA"]], L[i["FGA"]], SHRINK_ATTEMPTS),
         share(fgm - m3, fga - a3, L[i["FGM"]] - L[i["3PM"]], L[i["FGA"]] - L[i["3PA"]], SHRINK_ATTEMPTS),
         share(m3, a3, L[i["3PM"]], L[i["3PA"]], SHRINK_ATTEMPTS), rate("FTA"),
         share(ftm, fta, L[i["FTM"]], L[i["FTA"]], SHRINK_FT)] + [rate(k) for k in STATS[6:]]
    inv_sp = lambda x: np.log(np.expm1(np.maximum(x, 1e-4)))
    logit = lambda x: np.log(np.clip(x, 1e-4, 1 - 1e-4) / (1 - np.clip(x, 1e-4, 1 - 1e-4)))
    kinds = [inv_sp, logit, logit, logit, inv_sp, logit] + [inv_sp] * (len(STATS) - 6)
    return np.stack([f(v) for f, v in zip(kinds, p)], -1).astype(np.float32)


def form_window(pid, date=None, season=None):
    """His last FORM_WINDOW records before a game on `date` (or before the start of `season`), oldest first and
    zero-padded, with how many days before it each one was (/100)."""
    rec = records()
    idx, gaps = np.zeros(FORM_WINDOW, np.int64), np.zeros(FORM_WINDOW, np.float32)
    lst = rec["rows_of"].get(pid)
    if not lst:
        return idx, gaps
    target = date if date is not None else STARTS.get(season, f"{season - 1}-10-20")
    k = bisect.bisect_left(rec["dates_of"][pid], target)
    window = lst[max(0, k - FORM_WINDOW):k]
    t = datetime.date.fromisoformat(target)
    for j, (d, row) in enumerate(window, start=FORM_WINDOW - len(window)):
        idx[j], gaps[j] = row, min((t - datetime.date.fromisoformat(d)).days, 365) / 100
    return idx, gaps


_REC_T = {}


def rec_tensor():
    if "t" not in _REC_T:
        _REC_T["t"] = torch.from_numpy(records()["matrix"]).to(DEVICE)
    return _REC_T["t"]


_FUTURE = {}


def future_targets():
    """For every player-game: his average minutes and per-minute box line over his next FORECAST_GAMES games in the
    same season (the form forecast target), or None with fewer than 3 such games or under 20 minutes in them."""
    if _FUTURE:
        return _FUTURE
    history = {}
    for season in sorted(FANTASY_GAMES):
        for g in FANTASY_GAMES[season]:
            for row in g["rows"]:
                history.setdefault(row[0], []).append((g["date"], season, row[1], np.array(row[4], np.float32)))
    for pid, h in history.items():
        h.sort(key=lambda e: e[0])
        for k, (date, season, *_rest) in enumerate(h):
            nxt = [e for e in h[k + 1:k + 1 + FORECAST_GAMES] if e[1] == season]
            mins = sum(e[2] for e in nxt)
            if len(nxt) >= 3 and mins >= 20:
                _FUTURE[(pid, date)] = (mins / len(nxt), sum(e[3] for e in nxt) / mins)
    return _FUTURE


def minutes_prior(role):
    """log(expected minutes): the role model's plan when there is one, else last season's minutes, else 8."""
    plan, has_plan, last = role[12] * 36, role[13], role[0] * 36
    return math.log(1.0 + (plan if has_plan else last if last > 0 else 8.0))


def _rest_context(dates_by_team):
    """(team, date) -> (home flag filled later, back-to-back, days of rest / 4)."""
    out = {}
    for team, dates in dates_by_team.items():
        dates = sorted(dates)
        for i, d in enumerate(dates):
            rest = 4.0 if i == 0 else min(4.0, (datetime.date.fromisoformat(d) - datetime.date.fromisoformat(dates[i - 1])).days - 1.0)
            out[(team, d)] = (float(rest == 0), rest / 4)
    return out


def last_played(pid, season):
    """The most recent season before `season` (within three) he played in, or None."""
    return next((s for s in (season - 1, season - 2, season - 3) if pid in SEASONS.get(s, {})), None)



# ---------------------------------------------------------------- the game-level model

TOKEN = 2 * DIM
TEAM_POINTS_WEIGHT = 0.1


class FormEncoder(nn.Module):
    """His form, learned: a small transformer reads his last FORM_WINDOW raw game records (and how long ago each was),
    with a query token from his player vector, and returns his form vector. Shared by all players."""

    def __init__(self):
        super().__init__()
        self.rec = nn.Sequential(nn.Linear(REC_FEATURES + 1, TOKEN), nn.GELU(), nn.Linear(TOKEN, TOKEN))
        self.pos = nn.Embedding(FORM_WINDOW, TOKEN)                    # how recent (position in the window)
        self.query = nn.Linear(DIM + 1, TOKEN)                         # his player vector + how far ahead the game is
        layer = nn.TransformerEncoderLayer(TOKEN, 4, 2 * TOKEN, DROPOUT, batch_first=True, norm_first=True)
        self.enc = nn.TransformerEncoder(layer, 2, enable_nested_tensor=False)
        self.out = nn.Linear(TOKEN, TOKEN)

    def forward(self, player_vec, horizon, recs, gaps, valid):
        """player_vec [N, DIM], horizon [N], recs [N, W, F], gaps [N, W], valid [N, W] -> form vectors [N, TOKEN]."""
        x = self.rec(torch.cat([recs, gaps[..., None]], -1)) + self.pos.weight[None]
        h = torch.cat([self.query(torch.cat([player_vec, horizon[:, None]], -1))[:, None], x], 1)
        pad = torch.cat([torch.zeros(len(h), 1, dtype=torch.bool, device=h.device), ~valid], 1)
        return self.out(self.enc(h, src_key_padding_mask=pad)[:, 0])


class GameModel(nn.Module):
    """Both teams' available players (player vector + form vector + role inputs) and a token per team, a transformer
    across all of them; per player: minutes (share of his team's 240, from the role model's plan) and his stat line per
    minute, built so it stays consistent (attempts x make rates; makes never exceed attempts)."""

    def __init__(self, n_players):
        super().__init__()
        self.base = nn.Embedding(n_players, DIM)                       # player vector: fixed for his career
        nn.init.normal_(self.base.weight, std=0.1)
        self.form_enc = FormEncoder()                                  # shared by all players
        self.inp = nn.Sequential(nn.Linear(DIM + ROLE_FEATURES, TOKEN), nn.GELU(), nn.Linear(TOKEN, TOKEN))
        self.team = nn.Parameter(torch.zeros(TOKEN))
        self.ctx = nn.Linear(GAME_CONTEXT, TOKEN)
        self.side = nn.Embedding(2, TOKEN)                             # which team
        layer = nn.TransformerEncoderLayer(TOKEN, 4, 4 * TOKEN, DROPOUT, batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(layer, 3, enable_nested_tensor=False)
        self.minutes = nn.Sequential(nn.Linear(2 * TOKEN, DIM), nn.GELU(), nn.Linear(DIM, 1))
        nn.init.zeros_(self.minutes[-1].weight)
        nn.init.zeros_(self.minutes[-1].bias)                          # starts exactly at the role model's minutes
        self.stats = nn.Sequential(nn.Linear(2 * TOKEN, DIM), nn.GELU(), nn.Linear(DIM, len(STATS)))     # delta from his anchor
        self.f_min = nn.Sequential(nn.Linear(2 * TOKEN, DIM), nn.GELU(), nn.Linear(DIM, 1))
        self.f_stats = nn.Sequential(nn.Linear(2 * TOKEN, DIM), nn.GELU(), nn.Linear(DIM, len(STATS)))
        for head in (self.stats, self.f_stats):                       # start exactly at his own (shrunk) recent line
            nn.init.zeros_(head[-1].weight)
            nn.init.zeros_(head[-1].bias)

    @staticmethod
    def line(raw):
        """Raw outputs -> per-minute stat line in STATS order: shot attempts x three-point share x make rates for 2s and
        3s, free-throw trips x free-throw rate, and per-minute rebounds, assists, steals, blocks, turnovers, fouls."""
        fga, share3, p2, p3 = F.softplus(raw[..., 0]), torch.sigmoid(raw[..., 1]), torch.sigmoid(raw[..., 2]), torch.sigmoid(raw[..., 3])
        fta, pft = F.softplus(raw[..., 4]), torch.sigmoid(raw[..., 5])
        a3 = fga * share3
        m3, m2 = a3 * p3, (fga - a3) * p2
        return torch.stack([m2 + m3, fga, m3, a3, fta * pft, fta, *F.softplus(raw[..., 6:]).unbind(-1)], -1)

    def forward(self, idx, role, w_idx, w_gap, mask, ctx, prior, anchor, use_form=True):
        """idx, prior, mask [B, 2, P]; role [B, 2, P, R]; w_idx, w_gap [B, 2, P, W] (his recent records); ctx [B, 2, C].
        use_form=False switches form off (player vector alone): the basis of his capacity."""
        B, T, Pn = idx.shape
        e = self.base(idx)
        if self.training and PLAYER_DROPOUT > 0:                       # some player vectors off: form and role must carry it
            e = e * (torch.rand(B, T, Pn, 1, device=idx.device) >= PLAYER_DROPOUT).float()
        side = self.side(torch.arange(T, device=idx.device))
        horizon = ctx[..., 3][:, :, None].expand(B, T, Pn)
        form = torch.zeros(B, T, Pn, TOKEN, device=idx.device)
        sel = mask & (w_idx > 0).any(-1)                               # players with at least one earlier game
        if use_form and sel.any():
            form = form.index_put((sel,), self.form_enc(e[sel], horizon[sel], rec_tensor()[w_idx[sel]], w_gap[sel], w_idx[sel] > 0))
        tok = self.inp(torch.cat([e, role], -1)) + form + side[None, :, None]
        team = self.team + self.ctx(ctx) + side[None]
        h = torch.cat([team, tok.reshape(B, T * Pn, TOKEN)], 1)
        valid = torch.cat([torch.ones(B, T, dtype=torch.bool, device=idx.device), mask.reshape(B, T * Pn)], 1)
        h = self.encoder(h, src_key_padding_mask=~valid)
        team_vec, players = h[:, :T], h[:, T:].reshape(B, T, Pn, TOKEN)
        z = torch.cat([players, team_vec[:, :, None].expand(B, T, Pn, TOKEN)], -1)
        adjust = self.minutes(z).squeeze(-1)
        logits = (prior + adjust).masked_fill(~mask, -1e4)
        return (logits, self.line(anchor + self.stats(z)), adjust, F.softplus(self.f_min(z)).squeeze(-1) * 36,
                self.line(anchor + self.f_stats(z)))


def player_index(cutoff):
    """Every player who appears in a game before season `cutoff` -> row in the player-vector table (0 = unknown)."""
    ids = sorted({row[0] for s, games in FANTASY_GAMES.items() if s < cutoff for g in games for row in g["rows"]})
    return {p: i + 1 for i, p in enumerate(ids)}


_TEAM = {}


def _team_tables():
    """Per (team, season): game dates in order, the players who played in each (minutes > 0), the game ids, and team
    results (points for, against, pace = FGA + 0.44 FTA + TO - OREB)."""
    if _TEAM:
        return _TEAM
    i = {k: n for n, k in enumerate(STATS)}
    for season, games in FANTASY_GAMES.items():
        pairs = {}
        for g in games:
            pairs.setdefault(g["game_id"], []).append(g)
        for gid, sides in pairs.items():
            for t in sides:
                opp = next((o for o in sides if o is not t), None)
                line = np.sum([r[4] for r in t["rows"]], 0) if t["rows"] else np.zeros(len(STATS))
                pace = line[i["FGA"]] + 0.44 * line[i["FTA"]] + line[i["TO"]] - line[i["OREB"]]
                _TEAM.setdefault((t["team"], season), []).append(
                    (t["date"], gid, [r[0] for r in t["rows"] if r[1] > 0], float(t.get("score") or 0),
                     float((opp or {}).get("score") or 0), float(pace)))
    for k in _TEAM:
        _TEAM[k].sort(key=lambda e: e[0])
    return _TEAM


def team_form(team, season, pred_date):
    """His team's last 10 games before the prediction date (last season's if none yet): points for, against, pace,
    and how many games that is."""
    tables = _team_tables()
    games = [e for e in tables.get((team, season), []) if e[0] < pred_date][-10:] or tables.get((team, season - 1), [])[-10:]
    if not games:
        return [0.0] * TEAM_FORM
    return [np.mean([e[3] for e in games]) / 115 - 1, np.mean([e[4] for e in games]) / 115 - 1,
            np.mean([e[5] for e in games]) / 100 - 1, len(games) / 10]


_FLY = {}
_KEY = 1 << 20                  # key = slot x 2^20 + day number (day numbers are ordinal dates, < 2^20)


def _day(date):
    return datetime.date.fromisoformat(date).toordinal()


def fly_tables():
    """Indexes for computing form windows and team form at any prediction date: every player's records sorted by date
    (keyed by player slot and day), and every team-season's running totals of points for, against and pace."""
    if _FLY:
        return _FLY
    rec = records()
    pids = sorted(rec["rows_of"])
    pslot = {p: i for i, p in enumerate(pids)}
    keys, rows, days, start = [], [], [], []
    for i, p in enumerate(pids):
        start.append(len(keys))
        for d, row in rec["rows_of"][p]:
            dn = _day(d)
            keys.append(i * _KEY + dn); rows.append(row); days.append(dn)
    tables = _team_tables()
    tslots = sorted(tables)
    tslot = {k: i for i, k in enumerate(tslots)}
    tkeys, tstart, tbase, cum, prev = [], [], [], [], []
    for i, (team, season) in enumerate(tslots):
        games = tables[(team, season)]
        tstart.append(len(tkeys)); tbase.append(len(cum))
        c = np.zeros(3)
        cum.append(c.copy())
        for e in games:
            tkeys.append(i * _KEY + _day(e[0]))
            c = c + np.array([e[3], e[4], e[5]])
            cum.append(c.copy())
        prev.append(team_form(team, season, "0000-00-00"))      # no games yet this season: last season's last 10
    _FLY.update(pslot=pslot, keys=np.array(keys, np.int64), rows=np.array(rows, np.int64), days=np.array(days, np.int64),
                start=np.array(start, np.int64), tslot=tslot, tkeys=np.array(tkeys, np.int64), tstart=np.array(tstart, np.int64),
                tbase=np.array(tbase, np.int64), cum=np.array(cum, np.float64), prev=np.array(prev, np.float32))
    return _FLY


def apply_horizon(b, rng):
    """A batch seen from a fresh random prediction date per game: horizon 1-90 days (log-uniform), each player's last
    FORM_WINDOW records before that date, and his team's last-10 form before it."""
    t = fly_tables()
    B = len(b["day"])
    h = np.rint(np.exp(rng.uniform(0.0, math.log(HORIZON_MAX), B))).astype(np.int64)
    d = b["day"].cpu().numpy() - h                                       # prediction day per game
    ps = b["pslot"].cpu().numpy()                                        # [B, 2, P]
    known = ps >= 0
    pos = np.searchsorted(t["keys"], np.where(known, ps, 0) * _KEY + d[:, None, None])
    at = pos[..., None] + np.arange(-FORM_WINDOW, 0)                      # the FORM_WINDOW records before that date
    valid = (at >= t["start"][np.where(known, ps, 0)][..., None]) & known[..., None]
    at = np.clip(at, 0, len(t["rows"]) - 1)
    w_idx = np.where(valid, t["rows"][at], 0)
    w_gap = np.where(valid, np.minimum(d[:, None, None, None] - t["days"][at], 365) / 100, 0.0).astype(np.float32)
    ts = b["tslot"].cpu().numpy()                                        # [B, 2]
    k = np.searchsorted(t["tkeys"], ts * _KEY + d[:, None]) - t["tstart"][ts]
    n = np.minimum(k, 10)
    tot = t["cum"][t["tbase"][ts] + k] - t["cum"][t["tbase"][ts] + np.maximum(k - 10, 0)]
    mean = tot / np.maximum(n, 1)[..., None]
    form = np.stack([mean[..., 0] / 115 - 1, mean[..., 1] / 115 - 1, mean[..., 2] / 100 - 1, n / 10], -1).astype(np.float32)
    form = np.where((n > 0)[..., None], form, t["prev"][ts])
    ctx = b["ctx"].clone()
    ctx[..., 3] = torch.from_numpy((h / HORIZON_MAX).astype(np.float32))[:, None].to(DEVICE)
    ctx[..., 4:4 + TEAM_FORM] = torch.from_numpy(form).to(DEVICE)
    prior = minutes_anchor(w_idx, w_gap, b["plan"].cpu().numpy())
    anchor = line_anchor(w_idx, w_gap)
    return {**b, "w_idx": torch.from_numpy(w_idx).to(DEVICE), "w_gap": torch.from_numpy(w_gap).to(DEVICE), "ctx": ctx,
            "prior": torch.from_numpy(prior).to(DEVICE), "anchor": torch.from_numpy(anchor).to(DEVICE)}


def _days_before(date, days):
    return (datetime.date.fromisoformat(date) - datetime.timedelta(days=days)).isoformat()


def _sample_horizon(rng):
    """1-90 days, favoring the near term (log-uniform)."""
    return int(round(math.exp(rng.uniform(0.0, math.log(HORIZON_MAX)))))


def game_rows(index, seasons, horizon=None, seed=0):
    """Tensors for every game in `seasons`, both teams: the players who played, each seen from the game's prediction date
    (the game date minus the horizon: fixed, or drawn per game when None): his form reads only games before then, his
    team's form too. Predictions are conditional on playing: injuries and absences aren't predicted."""
    rng = np.random.default_rng(seed)
    future = future_targets()
    missed_of = records()["missed"]
    keys = ("idx", "role", "w_idx", "w_gap", "missed", "pslot", "mask", "ctx", "tslot", "prior", "plan", "anchor", "min", "fp", "line",
            "score", "f_min", "f_line", "f_ok", "season", "date", "pred", "day")
    n_slot = len(keys) - 4
    fly = fly_tables()
    out = {k: [] for k in keys}
    for s in seasons:
        games = FANTASY_GAMES.get(s, [])
        rest = _rest_context({t: {g["date"] for g in games if g["team"] == t} for t in {g["team"] for g in games}})
        pairs = {}
        for g in games:
            pairs.setdefault(g["game_id"], []).append(g)
        role_cache = {}
        for gid, sides in pairs.items():
            if len(sides) != 2 or any(sum(r[1] for r in t["rows"]) < 200 for t in sides):
                continue
            sides = sorted(sides, key=lambda t: not t["home"])          # home team first
            h = horizon if horizon is not None else _sample_horizon(rng)
            pred = _days_before(sides[0]["date"], h)
            arr = {k: [] for k in keys[:n_slot]}
            for t in sides:
                rows = sorted((r for r in t["rows"] if r[1] > 0), key=lambda r: -r[1])[:MAX_PLAYERS]
                for r in rows:
                    if r[0] not in role_cache:
                        role_cache[r[0]] = role_inputs(r[0], s)
                n = len(rows)
                z = lambda *shape, dt=np.float32: np.zeros(shape, dt)
                idx, role, prior = z(MAX_PLAYERS, dt=np.int64), z(MAX_PLAYERS, ROLE_FEATURES), z(MAX_PLAYERS)
                w_idx, w_gap, missed = z(MAX_PLAYERS, FORM_WINDOW, dt=np.int64), z(MAX_PLAYERS, FORM_WINDOW), z(MAX_PLAYERS)
                pslot = np.full(MAX_PLAYERS, -1, np.int64)
                mins, fp, line = z(MAX_PLAYERS), z(MAX_PLAYERS), z(MAX_PLAYERS, len(STATS))
                f_min, f_line, f_ok = z(MAX_PLAYERS), z(MAX_PLAYERS, len(STATS)), z(MAX_PLAYERS, dt=bool)
                for j, r in enumerate(rows):
                    p = r[0]
                    idx[j] = index.get(p, 0)
                    role[j] = role_cache[p]
                    prior[j] = minutes_prior(role[j])
                    w_idx[j], w_gap[j] = form_window(p, date=pred)
                    missed[j] = missed_of.get((p, t["date"]), 0)
                    pslot[j] = fly["pslot"].get(p, -1)
                    mins[j], fp[j], line[j] = r[1], r[2], r[4]
                    fut = future.get((p, t["date"]))
                    if fut:
                        f_min[j], f_line[j], f_ok[j] = fut[0], fut[1], True
                m = z(MAX_PLAYERS, dt=bool); m[:n] = True
                plan = prior.copy()
                prior = minutes_anchor(w_idx, w_gap, plan)
                anchor = line_anchor(w_idx, w_gap)
                b2b, r4 = rest.get((t["team"], t["date"]), (0.0, 1.0))
                ctx = [float(t["home"]), b2b, r4, h / HORIZON_MAX, *team_form(t["team"], s, pred)]
                for k, v in (("idx", idx), ("role", role), ("w_idx", w_idx), ("w_gap", w_gap), ("missed", missed), ("pslot", pslot),
                             ("mask", m), ("ctx", ctx), ("tslot", fly["tslot"][(t["team"], s)]), ("prior", prior), ("plan", plan), ("anchor", anchor), ("min", mins), ("fp", fp), ("line", line),
                             ("score", float(t.get("score") or 0)), ("f_min", f_min), ("f_line", f_line), ("f_ok", f_ok)):
                    arr[k].append(v)
            for k in keys[:n_slot]:
                out[k].append(np.array(arr[k]))
            out["season"].append(s)
            out["date"].append(int(sides[0]["date"].replace("-", "")))
            out["pred"].append(int(pred.replace("-", "")))
            out["day"].append(_day(sides[0]["date"]))
    dtypes = {"idx": np.int64, "w_idx": np.int64, "pslot": np.int64, "tslot": np.int64, "mask": bool, "f_ok": bool,
              "season": np.int64, "date": np.int64, "pred": np.int64, "day": np.int64}
    return {k: torch.from_numpy(np.array(v, dtypes.get(k, np.float32))).to(DEVICE) for k, v in out.items()}


def _batch(rows, b):
    return {k: v[b] for k, v in rows.items()}


def predict(model, r, use_form=True):
    """Minutes and stat counts for the night [B, 2, P(, stats)], given that these players play."""
    logits, rate, *_ = model(r["idx"], r["role"], r["w_idx"], r["w_gap"], r["mask"], r["ctx"], r["prior"], r["anchor"], use_form)
    mins = torch.softmax(logits, -1) * 240
    return mins, rate * mins[..., None]


def _losses(model, r, stat_var):
    logits, rate, adjust, f_min, f_line = model(r["idx"], r["role"], r["w_idx"], r["w_gap"], r["mask"], r["ctx"], r["prior"], r["anchor"])
    W, PW = FANTASY_WEIGHTS.to(rate.device), POINTS_WEIGHTS.to(rate.device)
    mins = torch.softmax(logits, -1) * 240
    share = r["min"] / r["min"].sum(-1, keepdim=True).clamp(min=1.0)
    loss_min = -(share * torch.log_softmax(logits, -1)).sum(-1).mean()
    played = r["mask"] & (r["min"] > 0)
    mean = rate * r["min"][..., None] + 1e-6                            # each stat's count, given his actual minutes
    loss_stats = (mean - r["line"] * torch.log(mean)).sum(-1)[played].mean()
    pred = rate * mins[..., None]                                      # the night: predicted minutes x line
    loss_fp = F.huber_loss((pred @ W)[r["mask"]], r["fp"][r["mask"]], delta=10.0) / 10
    team_pts = ((pred @ PW) * r["mask"]).sum(-1)
    loss_team = F.huber_loss(team_pts, r["score"], delta=10.0) / 10
    loss_adjust = adjust[r["mask"]].pow(2).mean()
    ok = r["f_ok"]
    zero = torch.zeros((), device=rate.device)
    loss_fc = ((((f_min - r["f_min"]) / 36) ** 2)[ok].mean() + (((f_line - r["f_line"]) ** 2 / stat_var).sum(-1))[ok].mean()) if ok.any() else zero
    total = (loss_min + loss_stats + loss_fp + TEAM_POINTS_WEIGHT * loss_team + MINUTES_ADJUST_PENALTY * loss_adjust
             + FORECAST_WEIGHT * loss_fc)
    parts = {"minutes": loss_min, "stats": loss_stats, "fantasy": loss_fp, "team pts": loss_team, "forecast": loss_fc}
    return total, {k: float(v.detach()) for k, v in parts.items()}


def _held_out_baseline(rows, val_idx, index):
    """For the held-out games: roster slots with a season-to-date average as of the prediction date, and that average
    (the baseline every epoch is compared with, on the same players and games)."""
    has, b = _baselines_for(rows, val_idx, index)
    return has, b[0]


def _fit(model, variants, train_idx, val_idx, stat_var, rng, label, epochs=None, lr_plan=None, held_base=None):
    """Train; with val_idx, stop when the held-out fantasy-points error stops improving (returns the best epoch and the
    learning rates used); with `epochs`, train exactly that long following `lr_plan`."""
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=WEIGHT_DECAY)
    rows = variants[0]                              # held-out games are always judged at the same horizons
    best, best_state, best_epoch, stale, lrs = float("inf"), None, 0, 0, []
    base_lr, since_drop, step, epoch = 1e-3, 0, 0, 0
    while True:                                     # no epoch limit when early stopping
        epoch += 1
        if lr_plan:
            base_lr = lr_plan[epoch - 1]
        lrs.append(base_lr)
        model.train()
        totals, steps = {}, 0
        train_rows = variants[(epoch - 1) % len(variants)]   # a fresh horizon for every game each epoch
        order = train_idx[torch.from_numpy(rng.permutation(len(train_idx))).to(DEVICE)]
        for i in range(0, len(order), (8 if SMOKE else 128)):
            step += 1
            for g in opt.param_groups:              # warm-up over the first WARMUP_STEPS steps
                g["lr"] = base_lr * min(1.0, step / WARMUP_STEPS)
            batch = _batch(train_rows, order[i:i + (8 if SMOKE else 128)])
            if ON_THE_FLY:
                batch = apply_horizon(batch, rng)    # a fresh random horizon for every game in this batch
            loss, parts = _losses(model, batch, stat_var)
            opt.zero_grad(set_to_none=True); loss.backward(); opt.step()
            for k, v in parts.items():
                totals[k] = totals.get(k, 0.0) + v
            steps += 1
        train = " ".join(f"{k} {v / max(steps, 1):.3f}" for k, v in totals.items())
        if val_idx is None:
            log(f"    epoch {epoch:2d}/{epochs} (lr {lrs[-1]:.0e}) | train loss {train}   (final fit on all games: no test)")
            if epoch >= epochs or SMOKE:
                return model, epoch, lrs
            continue
        model.eval()
        with torch.no_grad():
            r = _batch(rows, val_idx)
            mins, counts = predict(model, r)
            has, base_fp = held_base
            mae_min = (mins - r["min"]).abs()[has].mean().item()
            fp_pred = counts @ FANTASY_WEIGHTS.to(counts.device)
            mae_fp = (fp_pred - r["fp"]).abs()[has].mean().item()
            mae_base = (base_fp - r["fp"]).abs()[has].mean().item()
        log(f"    epoch {epoch:2d} (lr {lrs[-1]:.0e}) | train loss {train} | TEST on held-out games: fantasy pts error {mae_fp:.2f} "
            f"vs season-avg baseline {mae_base:.2f} ({100 * (1 - mae_fp / mae_base):+.1f}%), minutes error {mae_min:.2f}"
            + ("  * best" if mae_fp < best else ""))
        if mae_fp < best:
            best, best_epoch, stale, since_drop = mae_fp, epoch, 0, 0
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        else:
            stale += 1
            since_drop += 1
            if since_drop >= 3:                     # learning rate halves after 3 epochs without improvement
                base_lr, since_drop = base_lr * 0.5, 0
        if stale >= PATIENCE or SMOKE:
            model.load_state_dict(best_state)
            log(f"  -> phase 1 done: best epoch {best_epoch} (held-out fantasy points error {best:.2f})")
            return model, best_epoch, lrs[:best_epoch]


def train_game_model(cutoff, variants, index, seed=0):
    """Phase 1: hold out the last VAL_FRACTION of the latest training season (time order) and find the best epoch;
    phase 2: retrain on every game for that many epochs, replaying the learning rates. `variants` are the same games
    built at different random horizons; training cycles through them, one per epoch."""
    rows = variants[0]
    played = rows["mask"] & (rows["min"] > 0)
    stat_var = (rows["line"] / rows["min"].clamp(min=1.0)[..., None])[played].var(0).clamp(min=1e-4)
    last = rows["season"] == cutoff - 1
    split = float(np.quantile(rows["date"][last].cpu().numpy(), 1 - VAL_FRACTION))   # on the CPU (the Mac GPU has no float64)
    is_val = last & (rows["date"] >= split)
    tr, val = torch.where(~is_val)[0], torch.where(is_val)[0]
    if SMOKE:
        tr, val = tr[:64], val[:16]
    torch.manual_seed(seed)
    rng = np.random.default_rng(100 + seed)
    model = GameModel(len(index) + 1).to(DEVICE)
    d = lambda x: f"{str(int(x))[:4]}-{str(int(x))[4:6]}-{str(int(x))[6:]}"
    dv = rows["date"][val]
    log(f"  PHASE 1 (model seed {seed}): find how long to train. Train on {len(tr):,} games ({FIRST_TRAINING_SEASON} through {d(split)}); after each "
        f"epoch, TEST on the {len(val):,} later games it never trains on ({d(dv.min())} to {d(dv.max())}). Stop when the test error "
        f"hasn't improved for {PATIENCE} epochs; keep the best.")
    model, best_epoch, lr_plan = _fit(model, variants, tr, val, stat_var, rng, f"game model {cutoff} seed {seed}",
                                      held_base=_held_out_baseline(rows, val, index))
    torch.manual_seed(seed)
    model = GameModel(len(index) + 1).to(DEVICE)
    all_idx = torch.arange(len(rows["idx"]), device=DEVICE)
    if SMOKE: all_idx = all_idx[:64]
    log(f"  PHASE 2 (model seed {seed}): final fit. Retrain from scratch on all {len(all_idx):,} games (including those later "
        f"games) for {best_epoch} epochs, the best length from phase 1. No test here: it's all training data.")
    model, _, _ = _fit(model, variants, all_idx, None, stat_var, rng, f"game model {cutoff} seed {seed} (all games)", epochs=best_epoch, lr_plan=lr_plan)
    model.eval()
    with torch.no_grad():
        model.base.weight[0] = 0.0                  # unknown players: no player vector
    if seed == 0:
        embedding_check(model, index, cutoff)
    return model


CHECK_PLAYERS = ("Nikola Jokic", "Shai Gilgeous-Alexander", "Victor Wembanyama", "Stephen Curry", "Rudy Gobert",
                 "Tyrese Haliburton", "Ryan Rollins")


@torch.no_grad()
def embedding_check(model, index, cutoff):
    """Nearest neighbors by player vector (cosine) for well-known players, among regulars of the last season."""
    last = SEASONS.get(cutoff - 1, {})
    regulars = [p for p in index if (last.get(p) or {}).get("MIN", 0) >= 1000]
    if not regulars:
        return
    V = model.base.weight[[index[p] for p in regulars]].cpu().numpy()
    V = V / (np.linalg.norm(V, axis=1, keepdims=True) + 1e-9)
    names = {p: (BIOS.get(p) or {}).get("name", p) for p in regulars}
    by_name = {n: p for p, n in names.items()}
    log(f"  player vectors {cutoff}: nearest neighbors among {len(regulars)} regulars (cosine similarity)")
    for n in CHECK_PLAYERS:
        p = by_name.get(n)
        if p is not None:
            sims = V @ V[regulars.index(p)]
            top = [i for i in np.argsort(-sims) if regulars[i] != p][:5]
            log(f"    {n:24} -> " + ", ".join(f"{names[regulars[i]]} {sims[i]:.2f}" for i in top))


# ---------------------------------------------------------------- evaluation: every game of a held-out season

REPORT_STATS = ("PTS", "3PM", "REB", "AST", "STL", "BLK", "TO")


def _derived(line):
    """Points and rebounds alongside the line: [..., STATS] -> dict of named stats."""
    i = {k: n for n, k in enumerate(STATS)}
    out = {k: line[..., i[k]] for k in STATS}
    out["PTS"] = 2 * line[..., i["FGM"]] + line[..., i["3PM"]] + line[..., i["FTM"]]
    out["REB"] = line[..., i["OREB"]] + line[..., i["DREB"]]
    return out


_HIST = {}


def _player_history():
    if not _HIST:
        h = {}
        for season in sorted(FANTASY_GAMES):
            for g in FANTASY_GAMES[season]:
                for r in g["rows"]:
                    h.setdefault(r[0], []).append((g["date"], season, r[2], r[4]))
        for pid, lst in h.items():
            lst.sort(key=lambda e: e[0])
            _HIST[pid] = {"dates": [e[0] for e in lst], "season": np.array([e[1] for e in lst]),
                          "fp": np.array([e[2] for e in lst], np.float32), "line": np.array([e[3] for e in lst], np.float32)}
    return _HIST


def baseline_as_of(pid, pred_date, season):
    """What his averages said on the prediction date: (season-to-date fantasy points, line; last-10 fantasy points,
    line), from his games before then (last season's when he hasn't played this season); None without history."""
    h = _player_history().get(pid)
    if h is None:
        return None
    k = bisect.bisect_left(h["dates"], pred_date)
    if k == 0:
        return None
    lo = max(0, k - 200)
    this = np.arange(lo, k)[h["season"][lo:k] == season]
    if len(this) == 0:
        this = np.arange(lo, k)[h["season"][lo:k] == season - 1]
    if len(this) == 0:
        return None
    last10 = np.arange(max(0, k - 10), k)
    return h["fp"][this].mean(), h["line"][this].mean(0), h["fp"][last10].mean(), h["line"][last10].mean(0)


def _baselines_for(rows, sel_idx, index):
    """Season-to-date and last-10 averages as of each game's prediction date, for its roster slots."""
    pid_of = {v: k for k, v in index.items()}
    r = _batch(rows, sel_idx)
    mask = r["mask"].cpu().numpy()
    idx, preds, seasons = r["idx"].cpu().numpy(), r["pred"].cpu().numpy(), r["season"].cpu().numpy()
    has = np.zeros(mask.shape, bool)
    out = [np.zeros(mask.shape, np.float32), np.zeros(mask.shape + (len(STATS),), np.float32),
           np.zeros(mask.shape, np.float32), np.zeros(mask.shape + (len(STATS),), np.float32)]
    for g, t, j in zip(*np.where(mask)):
        d = str(preds[g])
        b = baseline_as_of(pid_of.get(int(idx[g, t, j])), f"{d[:4]}-{d[4:6]}-{d[6:]}", int(seasons[g]))
        if b is not None:
            has[g, t, j] = True
            for arr, v in zip(out, b):
                arr[g, t, j] = v
    return torch.from_numpy(has).to(DEVICE), [torch.from_numpy(a).to(DEVICE) for a in out]


@torch.no_grad()
def evaluate_games(models, index, season):
    """Every game of a held-out season, the players who played, each predicted 7 / 14 / 30 / 60 days before it (form and
    team form from games before then), the ensemble averaged. Per player-game errors for fantasy points, minutes and key
    stats, vs his season-to-date and last-10 averages as of the prediction date, on the same player-games; and (7 days)
    his capacity."""
    W = FANTASY_WEIGHTS.to(DEVICE)
    lines = []
    for h in EVAL_HORIZONS:
        r = game_rows(index, [season], horizon=h)
        n = len(r["idx"])
        mins = counts = 0.0
        for m in models:
            mm, cc = predict(m, r)
            mins, counts = mins + mm / len(models), counts + cc / len(models)
        has, (std_fp, std_line, l10_fp, l10_line) = _baselines_for(r, torch.arange(n, device=DEVICE), index)
        sel = has & r["mask"]
        actual = _derived(r["line"])
        preds = {"game model": (counts @ W, _derived(counts)), "season-to-date avg": (std_fp, _derived(std_line)),
                 "last-10 avg": (l10_fp, _derived(l10_line))}
        header = f"{'':20}{'fantasy pts':>12}" + "".join(f"{k:>7}" for k in REPORT_STATS)
        lines.append(f"{season}, every game predicted {h} days ahead (form as of then; players who played): {int(sel.sum()):,} player-games; "
                     f"mean absolute error per player-game\n{header}")
        for name, (fp, st) in preds.items():
            row = f"{name:20}{(fp - r['fp']).abs()[sel].mean().item():12.2f}"
            row += "".join(f"{(st[k] - actual[k]).abs()[sel].mean().item():7.2f}" for k in REPORT_STATS)
            lines.append(row)
        lines.append(f"{'game model minutes':20}{(mins - r['min']).abs()[sel].mean().item():12.2f}  (minutes error)")
        if h == EVAL_HORIZONS[0]:
            fp_off = sum(predict(m, r, use_form=False)[1] @ W for m in models) / len(models)
            fp_live = counts @ W
            ok = sel & (fp_off > 5)
            cap = (fp_live / fp_off.clamp(min=1e-3))[ok].cpu().numpy()
            back = ok & (r["missed"] >= 5)
            ratio = (r["fp"].clamp(min=0) / fp_off.clamp(min=1e-3))[ok].cpu().numpy()
            corr = float(np.corrcoef(np.argsort(np.argsort(cap)), np.argsort(np.argsort(ratio)))[0, 1])
            q = np.quantile(cap, [0.1, 0.5, 0.9]).tolist()
            lines.append(f"{'no form':20}{(fp_off - r['fp']).abs()[sel].mean().item():12.2f}  (player vector alone)")
            lines.append(f"capacity (with form / without): 10th-50th-90th percentile {q[0]:.2f} / {q[1]:.2f} / {q[2]:.2f}; after missing "
                         f"5+ team games: {(fp_live / fp_off.clamp(min=1e-3))[back].mean().item():.2f} ({int(back.sum())} games) vs "
                         f"{cap.mean():.2f} overall; rank correlation with his actual game / no-form projection {corr:.3f}")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------- rookies

def _fit_ridge(Z, Y):
    W = np.linalg.solve(Z.T @ Z + ROOKIE_RIDGE * np.eye(Z.shape[1]), Z.T @ (Y - Y.mean(0)))
    ymean = Y.mean(0)
    return lambda Zq: Zq @ W + ymean


def _fit_mlp(Z, Y, steps=400):
    ymu, ysd = Y.mean(0), Y.std(0) + 1e-6
    net = nn.Sequential(nn.Linear(Z.shape[1], 128), nn.GELU(), nn.Dropout(0.2), nn.Linear(128, Y.shape[1])).to(DEVICE)
    opt = torch.optim.AdamW(net.parameters(), lr=3e-3, weight_decay=1e-2)
    x = torch.tensor(Z, dtype=torch.float32, device=DEVICE)
    y = torch.tensor((Y - ymu) / ysd, dtype=torch.float32, device=DEVICE)
    for _ in range(steps):
        net.train()
        loss = F.mse_loss(net(x), y)
        opt.zero_grad(); loss.backward(); opt.step()
    net.eval()

    def predict(Zq):
        with torch.no_grad():
            return net(torch.tensor(Zq, dtype=torch.float32, device=DEVICE)).cpu().numpy() * ysd + ymu
    return predict



def rookie_vectors(models, index, season, rosters):
    """Player vectors for incoming rookies: a trait encoder (college, preseason, age, size, position, draft slot ->
    the player vector past rookies ended up with; ridge or small neural net, whichever predicts held-out draft classes
    better), fitted per model; the vectors are added to each model's player table."""
    incoming = [p for p in rosters if is_rookie(p, season)]
    for m in models:
        X, Y, cls = [], [], []
        for s in range(FIRST_TRAINING_SEASON, season):
            for pid, r in SEASONS.get(s, {}).items():
                if (BIOS.get(pid) or {}).get("draft_year") == s - 1 and pid in index and (r.get("MIN") or 0) >= 300:
                    with torch.no_grad():
                        Y.append(m.base.weight[index[pid]].cpu().numpy())
                    X.append(rookie_traits(pid, s)); cls.append(s)
        if len(X) < 30 or not incoming:
            continue
        X, Y, cls = np.array(X), np.array(Y), np.array(cls)
        mu, sd = X.mean(0), X.std(0) + 1e-9
        Z = (X - mu) / sd
        scores = {}
        for name, fit in (("ridge", _fit_ridge), ("neural net", _fit_mlp)):
            err = tot = 0.0
            for c in np.unique(cls):
                trn, te = cls != c, cls == c
                if trn.sum() < 20:
                    continue
                pred = fit(Z[trn], Y[trn])(Z[te])
                err += ((pred - Y[te]) ** 2).sum(); tot += ((Y[te] - Y[trn].mean(0)) ** 2).sum()
            scores[name] = 1 - err / tot if tot else float("-inf")
        choice = max(scores, key=scores.get)
        predict = (_fit_ridge if choice == "ridge" else _fit_mlp)(Z, Y)
        vecs = predict((np.array([rookie_traits(p, season) for p in incoming]) - mu) / sd).astype(np.float32)
        with torch.no_grad():
            m.base.weight = nn.Parameter(torch.cat([m.base.weight, torch.from_numpy(vecs).to(DEVICE)]))
        log(f"  rookies {season}: {len(X)} earlier rookies; out-of-class player-vector variance explained "
            + ", ".join(f"{k} {v:.2f}" for k, v in scores.items()) + f" -> {choice}; vectors for {len(incoming)} incoming")
    n_old = len(index) + 1
    return {p: n_old + j for j, p in enumerate(incoming)}


# ---------------------------------------------------------------- rest of season (trades)

SCHEDULE_2027 = json.loads((DATA / "schedule_2027.json").read_text())
LEAGUE = json.loads((DATA / "league.json").read_text())


@torch.no_grad()
def rest_of_season(models, index, as_of, target):
    """Every player's fantasy points over the rest of the 2026-27 schedule as seen on `as_of`, if he plays: each remaining
    game predicted at its own horizon (capped at HORIZON_MAX), form as of `as_of`. Injuries aren't predicted; players
    already listed out are left out of games before their reported return (a known fact). Totals over his remaining
    games, per game, and the fantasy playoff weeks separately."""
    season = 2027
    playoff_weeks = {w for period in LEAGUE["matchup_periods"][LEAGUE["regular_season_matchups"]:] for w in period}
    rosters = {int(p): t for p, t in target["rosters"].items()}
    out_until = {int(p): d for p, d in (target.get("out_until") or {}).items()}
    teams = {}
    for p, t in rosters.items():
        teams.setdefault(t, []).append(p)
    role = {p: role_inputs(p, season) for p in rosters}
    order = {t: sorted(ps, key=lambda p: -role[p][12]) for t, ps in teams.items()}
    windows = {p: form_window(p, date=as_of) for p in rosters}
    dates_of = {}
    for g in SCHEDULE_2027:
        dates_of.setdefault(g["home"], []).append(g["date"]); dates_of.setdefault(g["away"], []).append(g["date"])
    rest = _rest_context({t: set(d) for t, d in dates_of.items()})
    games = [g for g in SCHEDULE_2027 if g["date"] > as_of and g["home"] in teams and g["away"] in teams]
    totals = {}
    W = FANTASY_WEIGHTS.to(DEVICE)
    for start in range(0, len(games), 256):
        chunk = games[start:start + 256]
        G = len(chunk)
        b = {"idx": np.zeros((G, 2, MAX_PLAYERS), np.int64), "role": np.zeros((G, 2, MAX_PLAYERS, ROLE_FEATURES), np.float32),
             "w_idx": np.zeros((G, 2, MAX_PLAYERS, FORM_WINDOW), np.int64), "w_gap": np.zeros((G, 2, MAX_PLAYERS, FORM_WINDOW), np.float32),
             "mask": np.zeros((G, 2, MAX_PLAYERS), bool), "ctx": np.zeros((G, 2, GAME_CONTEXT), np.float32),
             "prior": np.zeros((G, 2, MAX_PLAYERS), np.float32), "anchor": np.zeros((G, 2, MAX_PLAYERS, len(STATS)), np.float32)}
        who = []
        for i, g in enumerate(chunk):
            days = (datetime.date.fromisoformat(g["date"]) - datetime.date.fromisoformat(as_of)).days
            h = min(max(days, 1), HORIZON_MAX)
            sides = []
            for side, team in ((0, g["home"]), (1, g["away"])):
                players = [p for p in order[team] if not (p in out_until and g["date"] < out_until[p])][:MAX_PLAYERS]
                sides.append(players)
                for j, p in enumerate(players):
                    b["idx"][i, side, j] = index.get(p, 0)
                    b["role"][i, side, j] = role[p]
                    b["w_idx"][i, side, j], b["w_gap"][i, side, j] = windows[p]
                    b["prior"][i, side, j] = minutes_anchor(windows[p][0], windows[p][1], np.float32(minutes_prior(role[p])))
                    b["anchor"][i, side, j] = line_anchor(windows[p][0], windows[p][1])
                    b["mask"][i, side, j] = True
                b2b, r4 = rest.get((team, g["date"]), (0.0, 1.0))
                b["ctx"][i, side] = [float(side == 0), b2b, r4, h / HORIZON_MAX, *team_form(team, season, as_of)]
            who.append((g, sides))
        tb = {k: torch.from_numpy(v).to(DEVICE) for k, v in b.items()}
        fp = 0.0
        for m in models:
            _, cc = predict(m, tb)
            fp = fp + (cc @ W).cpu().numpy() / len(models)
        for i, (g, sides) in enumerate(who):
            playoff = g.get("week") in playoff_weeks
            for side, players in enumerate(sides):
                for j, p in enumerate(players):
                    t = totals.setdefault(p, {"fp": 0.0, "games": 0, "playoff_fp": 0.0, "playoff_games": 0})
                    t["fp"] += fp[i, side, j]; t["games"] += 1
                    if playoff:
                        t["playoff_fp"] += fp[i, side, j]; t["playoff_games"] += 1
    ranked = sorted(totals, key=lambda p: -totals[p]["fp"])
    path = OUT / f"ros_{as_of}.csv"
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["rank", "id", "name", "team", "position", "games_left", "fp_if_he_plays_all", "fp_per_game",
                    "playoff_games", "playoff_fp"])
        for k, p in enumerate(ranked, 1):
            t = totals[p]
            w.writerow([k, p, (BIOS.get(p) or {}).get("name", p), rosters[p], POSITIONS.get(p) or "", t["games"], round(t["fp"]),
                        round(t["fp"] / max(t["games"], 1), 1), t["playoff_games"],
                        round(t["playoff_fp"])])
    log(f"rest of season as of {as_of}: {len(games)} games left; wrote {path}")
    for k, p in enumerate(ranked[:15], 1):
        t = totals[p]
        log(f"  {k:2}. {(BIOS.get(p) or {}).get('name', p):26} {rosters[p]:4} {t['fp'] / max(t['games'], 1):5.1f} pts/game, "
            f"{t['fp']:6.0f} if he plays all {t['games']} games; playoffs {t['playoff_fp']:4.0f} in {t['playoff_games']}")


# ---------------------------------------------------------------- main

HOLDOUTS = (2026,)
CHECKPOINTS = HERE / "checkpoints"


def train_ensemble(cutoff, ensemble, purpose):
    t0 = time.time()
    log("=" * 100)
    log(f"{purpose}")
    log(f"Trains on {FIRST_TRAINING_SEASON}-{cutoff - 1} regular-season games only (never sees {cutoff}). Device: {DEVICE}. "
        f"Models: {ensemble}.")
    log("=" * 100)
    index = player_index(cutoff)
    n_var = 1 if (SMOKE or ON_THE_FLY) else HORIZON_VARIANTS
    variants = [game_rows(index, range(FIRST_TRAINING_SEASON, cutoff), seed=v) for v in range(n_var)]
    rows = variants[0]
    how = ("a fresh random horizon (1-%d days) for every game in every batch" % HORIZON_MAX if ON_THE_FLY
           else f"each game built at {n_var} random horizons (1-{HORIZON_MAX} days), one per epoch")
    log(f"  {len(rows['idx']):,} games, {int(rows['mask'].sum()):,} player-games, {len(index):,} players; {how}")
    models = [train_game_model(cutoff, variants, index, seed=k) for k in range(ensemble)]
    log(f"=== models for {cutoff} done ({time.time() - t0:.0f}s)")
    return models, index


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--ensemble", type=int, default=1, help="game models averaged (1 while developing; 3-5 for nightly predictions)")
    parser.add_argument("--holdouts", type=int, nargs="*", default=list(HOLDOUTS), help="held-out seasons to evaluate (none: skip)")
    parser.add_argument("--as-of", default="2026-10-19", help="date for the rest-of-season values (default: the day before opening night)")
    parser.add_argument("--smoke", action="store_true", help="tiny slices, one epoch per model: check the pipeline runs end to end")
    parser.add_argument("--verify-only", action="store_true", help="fast no-training forward/backward check of ORIGINAL architecture on Kaggle-shaped tensors")
    args = parser.parse_args()
    global SMOKE
    SMOKE = args.smoke
    OUT.mkdir(exist_ok=True)
    CHECKPOINTS.mkdir(exist_ok=True)
    if args.verify_only:
        # A fast architecture check with Kaggle-derived actual game records.
        assert 2019 in FANTASY_GAMES and 2026 in FANTASY_GAMES
        r = records()
        assert r['matrix'].shape[1] == REC_FEATURES
        m = GameModel(8).to(DEVICE).eval()
        valid = torch.zeros((1,2,MAX_PLAYERS), dtype=torch.bool,device=DEVICE)
        valid[:,:,0:2] = True
        idx = torch.zeros_like(valid,dtype=torch.long)
        role = torch.zeros((1,2,MAX_PLAYERS,ROLE_FEATURES),device=DEVICE)
        w_idx = torch.zeros((1,2,MAX_PLAYERS,FORM_WINDOW),device=DEVICE,dtype=torch.long)
        w_gap = torch.zeros_like(w_idx,dtype=torch.float)
        prior = torch.ones((1,2,MAX_PLAYERS),device=DEVICE) * math.log1p(20)
        anchor = torch.zeros((1,2,MAX_PLAYERS,len(STATS)),device=DEVICE)
        ctx = torch.zeros((1,2,GAME_CONTEXT),device=DEVICE)
        for t in range(2):
            w_idx[0,t,0,-1] = min(1,len(r['matrix'])-1)
            idx[0,t,0] = t+1
        with torch.no_grad():
            mins,statline = predict(m,{'idx':idx,'role':role,'w_idx':w_idx,'w_gap':w_gap,
                            'mask':valid,'ctx':ctx,'prior':prior,'anchor':anchor})
        assert mins.shape == (1,2,MAX_PLAYERS) and statline.shape == (1,2,MAX_PLAYERS,len(STATS))
        assert torch.isfinite(mins).all() and torch.isfinite(statline).all()
        assert (statline >= 0).all()
        log('Original GameModel verification passed: 3-layer team Transformer, 2-layer form encoder, full-stat output.')
        return
    # ---- 1. train everything first: each held-out season's models, then the final models (every game through 2026)
    n_steps = len(args.holdouts) + 2
    held = {}
    for k, s in enumerate(args.holdouts, 1):
        held[s] = train_ensemble(s, args.ensemble, f"STEP {k} of {n_steps}: MODELS TO TEST ON {s}. Trained on seasons before "
                                                   f"{s}; after all training, every {s} game is predicted with them (step {n_steps}).")
    final, index = train_ensemble(2027, args.ensemble, f"STEP {len(args.holdouts) + 1} of {n_steps}: FINAL MODELS for 2026-27 "
                                                        f"(nightly predictions). Trained on every game through 2026, then saved.")
    t27 = json.loads((DATA / "target_2027.json").read_text())
    rookie_rows = (rookie_vectors(final, index, 2027, {int(p): t for p, t in t27["rosters"].items()})
                   if COLLEGE and t27.get("rosters") else {})
    full_index = {**index, **rookie_rows}
    torch.save({"models": [m.state_dict() for m in final], "index": full_index, "n_players": len(full_index) + 1,
                "stats": STATS, "form_window": FORM_WINDOW, "role_features": ROLE_FEATURES,
                "record_mu": records()["mu"], "record_sd": records()["sd"]},
               CHECKPOINTS / ("SMOKE_NOT_FOR_PREDICTIONS.pt" if SMOKE else "game_models_2027.pt"))
    log(f"saved {len(final)} game models; SMOKE weights are NOT valid forecasts" if SMOKE else f"saved {len(final)} full models to {CHECKPOINTS / 'game_models_2027.pt'}")
    log("all models trained")
    # ---- 2. only now: every game of each held-out season
    if held:
        log("=" * 100)
        log(f"STEP {n_steps} of {n_steps}: THE TEST. Every game of {', '.join(map(str, held))} predicted by the step "
            f"{'/'.join(str(k) for k in range(1, len(held) + 1))} models, which never saw those seasons. The players who "
            f"played in each game, predicted {', '.join(map(str, EVAL_HORIZONS))} days ahead (only information from before each "
            f"prediction date), compared with their season-to-date and last-10 averages as of that date, on the same player-games.")
        log("=" * 100)
    report = [evaluate_games(models, idx, s) for s, (models, idx) in held.items()]
    if report:
        text = "\n\n".join(report)
        print(text, flush=True)
        (OUT / "report.txt").write_text(text + "\n")
    # ---- 3. rest-of-season values (trades): every player's expected points over the remaining 2026-27 schedule
    if SCHEDULE_2027.get("games") and t27.get("rosters"):
        rest_of_season(final, full_index, args.as_of, t27)
    else:
        log("No verified future season schedule/rosters: skip rest-of-season totals (do not invent games).")


if __name__ == "__main__":
    main()
