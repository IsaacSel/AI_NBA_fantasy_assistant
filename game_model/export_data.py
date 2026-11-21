"""Adapt the user-provided Kaggle box-score CSVs to the ORIGINAL 3-layer game model.

Run from repository root: python -m game_model.export_data
This adapter makes no web/API calls and never creates synthetic play-by-play or
future game schedules. Missing starts, preseason, college, and injury inputs
remain explicitly missing/neutral rather than fabricated.
"""
from __future__ import annotations

import collections
import csv
import json
import math
import shutil
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data' / 'game_logs'
SEASON_AVG = ROOT / 'data' / 'seasons'
OUT = ROOT / 'game_model' / 'data'
STATS = ('FGM','FGA','3PM','3PA','FTM','FTA','OREB','DREB','AST','STL','BLK','TO','PF')
SEASON_LABELS = [(y, f'{y}_{(y + 1) % 100:02}') for y in range(2018, 2026)]


def save(name, value):
    (OUT/name).write_text(json.dumps(value, separators=(',',':'), allow_nan=False), encoding='utf-8')


def numeric(value):
    try:
        x = float(value)
        return x if math.isfinite(x) else 0.0
    except (ValueError, TypeError):
        return 0.0


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    scoring=json.loads((ROOT/'league/scoring-system.json').read_text())
    positions={}
    names={}
    with (ROOT/'data/player_positions_kaggle.csv').open(newline='', encoding='utf-8-sig') as file:
        for row in csv.DictReader(file):
            pid=str(row['personId']).strip()
            if not pid.isdigit(): continue
            pos=row.get('position','Unknown').strip()
            positions[pid]=pos if pos!='Unknown' else ''
            names[pid]=' '.join(filter(None,[row.get('firstName','').strip(),row.get('lastName','').strip()])).strip()
    players={pid:{'name':name,'birth_date':None,'draft_pick':None,'draft_year':None,
                  'height':None,'weight':None,'position':positions.get(pid)} for pid,name in names.items()}

    # One team-game per (season, game ID, team). Both sides share the game ID.
    fantasy={}; season_starts={}; seasons={}; plans={}; season_teams={}
    summary=[]
    for first,label in SEASON_LABELS:
        season=first+1
        source=SOURCE/f'nba_player_game_logs_{label}.csv'
        avg=SEASON_AVG/f'nba_player_averages_{label}.csv'
        if not source.exists() or not avg.exists():
            raise FileNotFoundError(f'Missing season inputs: {source}, {avg}')
        games={}
        logs_by_player=collections.defaultdict(list)
        earliest=None
        with source.open(newline='',encoding='utf-8-sig') as file:
            reader=csv.DictReader(file)
            required={'PlayerID','Player','GameID','Date','Team','Opponent','Home','MIN','PTS','REB','FGM','FGA','3PM','3PA','FTM','FTA','OREB','DREB','AST','STL','BLK','TOV','PF'}
            if required - set(reader.fieldnames or []):
                raise ValueError(f'{source.name} missing required columns {required-set(reader.fieldnames or [])}')
            seen=set()
            for r in reader:
                pid=int(r['PlayerID'])
                gid=str(r['GameID']).strip()
                day=r['Date'][:10]
                date.fromisoformat(day)  # strict ISO date validation
                if earliest is None or day<earliest: earliest=day
                team=r['Team'].strip()
                key=(gid,team)
                if (gid,pid) in seen:
                    raise ValueError(f'Duplicate player-game {gid}:{pid}')
                seen.add((gid,pid))
                line=[numeric(r.get('TOV') if s=='TO' else r.get(s)) for s in STATS]
                stat=dict(zip(STATS,line))
                # Score the original full stat line using the ORIGINAL league rules.
                pts=2*stat['FGM']+stat['3PM']+stat['FTM']
                fpts=pts*scoring.get('PTS',0)+sum(scoring.get(s,0)*stat[s] for s in STATS) + scoring.get('REB',0)*(stat['OREB']+stat['DREB'])
                home=bool(int(float(r['Home'])))
                g=games.setdefault(key,{'game_id':gid,'date':day,'team':team,
                                        'opponent':r['Opponent'].strip(),'home':home,
                                        'score':0.,'rows':[]})
                if g['date']!=day or g['home']!=home:
                    raise ValueError(f'Inconsistent team game {key}')
                g['score']+=numeric(r['PTS'])
                # Starting-lineup information is NOT present in the uploaded CSVs.
                g['rows'].append([pid,numeric(r['MIN']),round(fpts,4),False,line])
                logs_by_player[pid].append((day,team,numeric(r['MIN']),fpts,numeric(r['STL']),numeric(r['BLK'])))
                players.setdefault(str(pid),{'name':r['Player'].strip(),'birth_date':None,'draft_pick':None,
                                             'draft_year':None,'height':None,'weight':None,'position':positions.get(str(pid))})
        pairs=collections.Counter(g['game_id'] for g in games.values())
        if any(n != 2 for n in pairs.values()):
            raise ValueError(f'{source.name} contains {sum(n!=2 for n in pairs.values())} unpaired games; team-aware predictions require both teams')
        fantasy[str(season)]=sorted(games.values(),key=lambda g:(g['date'],g['game_id'],not g['home']))
        season_starts[str(season)]=earliest

        stats_by_player={}
        last_teams={}
        with avg.open(newline='',encoding='utf-8-sig') as file:
            for r in csv.DictReader(file):
                pid=str(r['PlayerID']).strip()
                gp=int(numeric(r['GP']))
                if gp<1: continue
                mpg=numeric(r['MPG']);
                line={s:numeric(r.get('TOV') if s=='TO' else r.get(s)) for s in STATS}
                pts=2*line['FGM']+line['3PM']+line['FTM']
                fppg=pts*scoring.get('PTS',0)+sum(scoring.get(s,0)*line[s] for s in STATS) + scoring.get('REB',0)*(line['OREB']+line['DREB'])
                teams=sorted(logs_by_player.get(int(pid),[]),key=lambda v:v[0])
                team_last=teams[-1][1] if teams else r['Team']
                last_teams[pid]=team_last
                stats_by_player[pid]={'GP':gp,'MIN':mpg*gp,'MPG':mpg,'FP36':fppg*36/mpg if mpg else 0,
                                      'FPTS':fppg*gp,'FPPG':fppg,'STL':numeric(r['STL'])*gp,
                                      'BLK':numeric(r['BLK'])*gp,'start_rate':None,
                                      'main_team':team_last,'team_last':team_last}
        seasons[str(season)]=stats_by_player
        season_teams[str(season)]=last_teams
        # The plan is based ONLY on the preceding season (no look-ahead).
        previous=seasons.get(str(season-1),{})
        plans[str(season)]={pid:round(numeric(rec['MPG']),3) for pid,rec in previous.items()}
        summary.append({'season':f'{first}-{(first+1)%100:02}','player_games':sum(len(g['rows']) for g in games.values()),
                        'team_games':len(games),'players':len(stats_by_player),'first_date':earliest})

    plans['2027']={pid:round(numeric(rec['MPG']),3) for pid,rec in seasons['2026'].items()}
    save('team_games_full.json',fantasy)
    save('seasons.json',seasons)
    save('players.json',players)
    save('season_starts.json',season_starts)
    save('positions.json',positions)
    save('plans.json',plans)
    save('scoring.json',scoring)
    save('preseason.json',{})
    save('preseason_team_games.json',{})
    save('college.json',{})
    # No future 2026-27 roster, schedule, or injury data supplied.
    save('target_2027.json',{'rosters':{},'current':{}})
    save('schedule_2027.json',{'games':[], 'weeks':[], 'source':'not supplied; no future schedules are assumed'})
    save('league.json',json.loads((ROOT/'league/league-settings.json').read_text()))
    save('availability.json',{
        'team_lineups':'players who actually appeared in historical games; no prior participation forecasts',
        'starter_flags':'unavailable; represented with zeros in original 35-feature form',
        'play_by_play':'unavailable; original 16 possession features stay zero, not estimated',
        'preseason':'unavailable','college':'unavailable','birth_dates_and_draft_picks':'unavailable',
        'injuries':'unavailable','future_schedule':'unavailable','season_average_source':'user Kaggle export',
        'historical_player_positions':'G/F/C roster categories only',
        'method_note':'These files maintain the original GameModel tensor contracts using only locally supplied CSV records.'
    })
    save('export_summary.json',{'seasons':summary,'total_player_games':sum(x['player_games'] for x in summary)})
    print('Kaggle -> original model:',sum(x['player_games'] for x in summary),'player games;'
          ,sum(x['team_games'] for x in summary),'team-games;',len(players),'player identities')

if __name__=='__main__': main()
