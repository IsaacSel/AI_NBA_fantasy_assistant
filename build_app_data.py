"""Build app data entirely from the 2025-26 Kaggle player-averages CSV.

No game logs, play-by-play, ESPN lookups, injuries, schedules or forecasts.
Usage: python3 -m app_data.build_app_data [optional/replacement.csv]
"""
from __future__ import annotations
import csv
import datetime as dt
import json
import math
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'data/source/nba_player_averages_2025_26_from_kaggle.csv'
DEST = ROOT / 'data/app'
SCORING = ROOT / 'league/scoring-system.json'
COLUMNS = ['Player ID','Player','Teams','GP','MPG','PPG','RPG','APG','SPG','BPG','TOPG',
           'FGM/G','FGA/G','FG%','3PM/G','3PA/G','3P%','FTM/G','FTA/G','FT%',
           'OREB/G','DREB/G','PF/G']
STAT_TO_CSV = {'PTS':'PPG','REB':'RPG','AST':'APG','STL':'SPG','BLK':'BPG','TO':'TOPG',
               'FGM':'FGM/G','FGA':'FGA/G','3PM':'3PM/G','FTM':'FTM/G','FTA':'FTA/G'}


def build(incoming: Path = SOURCE) -> list[dict]:
    incoming = incoming.resolve()
    if not incoming.is_file():
        raise FileNotFoundError(f'CSV not found: {incoming}')
    with incoming.open(newline='',encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != COLUMNS:
            raise ValueError(f'Unexpected CSV columns: {reader.fieldnames}')
        rows = list(reader)
    if not rows: raise ValueError('CSV contains no players')
    scoring = json.loads(SCORING.read_text())
    if not set(scoring) <= set(STAT_TO_CSV):
        raise ValueError(f'Unknown scoring fields: {set(scoring)-set(STAT_TO_CSV)}')
    players, used_ids = [], set()
    for line,row in enumerate(rows,2):
        try:
            player_id = int(row['Player ID'])
            gp = int(row['GP'])
            if not 1 <= gp <= 82: raise ValueError('GP outside 1–82')
            if player_id in used_ids: raise ValueError('Duplicate Player ID')
            used_ids.add(player_id)
            stats = {}
            for col in COLUMNS[4:]:
                value = float(row[col]) if row[col].strip() else None
                if value is not None and not math.isfinite(value): raise ValueError(f'Non-finite {col}')
                if value is None and col not in ('3P%','FT%'): raise ValueError(f'Missing {col}')
                stats[col] = value
            mpg = stats['MPG']
            if mpg is None or mpg < 0: raise ValueError('Bad MPG')
            teams = [t.strip() for t in row['Teams'].split(' / ') if t.strip()]
            if not teams: raise ValueError('Missing team')
            # FPPG is from rounded per-game inputs, not raw season totals.
            breakdown = {stat:round(weight * (stats[col] or 0),3)
                         for stat,weight in scoring.items() for col in [STAT_TO_CSV[stat]]}
            fppg = round(sum(breakdown.values()),3)
            players.append({
                'id':player_id,'name':row['Player'].strip(),'team':teams[-1],'teams':teams,
                'gp':gp,'mpg':mpg,'stats':stats,'fppg':fppg,
                'season_fpts':round(fppg * gp,2),
                'fp_per36':round(fppg*36/mpg,2) if mpg else None,
                'breakdown':breakdown,
            })
        except (ValueError,KeyError,TypeError) as exc:
            raise ValueError(f'Bad CSV row {line} ({row.get("Player")}): {exc}') from exc
    players.sort(key=lambda p:(-p['fppg'],-p['season_fpts'],p['name']))
    for rank,player in enumerate(players,1): player['rank']=rank
    DEST.mkdir(parents=True,exist_ok=True)
    (DEST/'players.json').write_text(json.dumps(players,ensure_ascii=False,indent=2)+'\n')
    (DEST/'league.json').write_text(json.dumps({
        'source':'User-supplied Kaggle 2025-26 player season averages CSV',
        'season':'2025-26','kind':'historical_per_game_averages',
        'player_count':len(players),'generated_at':dt.datetime.now(dt.timezone.utc).isoformat(),
        'scoring':scoring,
        'note':('Only the supplied CSV provides basketball statistics. Fantasy points and season '
                'total estimates use rounded per-game averages; there are no future forecasts, '
                'per-game records, play-by-play, positions, injuries, schedules, ADP or matchups.')
    },indent=2)+'\n')
    if incoming != SOURCE:
        SOURCE.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(incoming,SOURCE)
    return players

if __name__=='__main__':
    incoming=Path(sys.argv[1]) if len(sys.argv)>1 else SOURCE
    print(f'Rebuilt CSV-only app data for {len(build(incoming))} players.')
