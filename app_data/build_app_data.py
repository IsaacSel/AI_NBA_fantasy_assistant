"""Build the app from local Kaggle-derived season averages and player positions.

Run from repository root: python -m app_data.build_app_data
No HTTP calls or scraping. Run app_data.enrich_game_data afterward for game logs and ML.
"""
from __future__ import annotations

import collections
import csv
import datetime as dt
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEASONS = [f"{y}_{str(y+1)[-2:]}" for y in range(2018, 2026)]
SCORING_KEYS = {'FGM':'FGM','FGA':'FGA','FTM':'FTM','FTA':'FTA','3PM':'3PM',
                'REB':'REB','AST':'AST','STL':'STL','BLK':'BLK','TO':'TOV','PTS':'PTS'}
STATS = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'FGM', 'FGA', 'FTM', 'FTA', '3PM', '3PA', 'OREB', 'DREB', 'PF']
REQUIRED = {'PlayerID','Player','Season','Team','GP','MPG',*STATS}
OUT = ROOT / 'data' / 'app'
SEASON_DIR = ROOT / 'data' / 'seasons'

def read_json(path):
    return json.loads((ROOT/path).read_text(encoding='utf-8'))

def dump(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',',':')), encoding='utf-8')

def number(value, default=0.0):
    try:
        x=float(value)
        return x if math.isfinite(x) else default
    except (ValueError,TypeError):
        return default

def maybe(value):
    if value is None or str(value).strip() == '':
        return None
    return number(value, None)

def rounded(v, nd=2):
    return round(float(v), nd) if v is not None else None

def parse_positions():
    """Read supplied broad G/F/C classes; optionally override with manually verified fantasy eligibility.

    Source flags are *not* PG/SG/SF/PF fantasy platform eligibility.
    Unknown players are utility only; don't fabricate position assignments.
    """
    broad = {'G': ['G'], 'F': ['F'], 'C': ['C'],
             'G/F': ['G', 'F'], 'F/C': ['F', 'C'],
             'Unknown': []}
    result = {}
    source = ROOT / 'data' / 'player_positions_kaggle.csv'
    if not source.is_file():
        raise FileNotFoundError(f'Expected uploaded position file: {source}')
    with source.open(newline='', encoding='utf-8-sig') as handle:
        reader = csv.DictReader(handle)
        required = {'personId', 'firstName', 'lastName', 'position'}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f'Position file requires {sorted(required)}')
        for row in reader:
            pid = str(row['personId']).strip()
            pos = str(row['position']).strip() or 'Unknown'
            if not pid.isdigit():
                raise ValueError(f'Invalid personId in positions file: {pid!r}')
            if pid in result:
                raise ValueError(f'Duplicate personId in positions file: {pid}')
            if pos not in broad:
                raise ValueError(f'Unexpected broad position {pos!r} for player {pid}')
            result[pid] = (pos if pos != 'Unknown' else 'UNK',
                           sorted(set(broad[pos] + ['UTIL'])))
    # Optional user-supplied *verified* specific fantasy-platform positions.
    override = ROOT / 'data' / 'player_positions.csv'
    if override.exists():
        with override.open(newline='', encoding='utf-8-sig') as handle:
            reader = csv.DictReader(handle)
            if not {'PlayerID', 'Positions'}.issubset(reader.fieldnames or []):
                raise ValueError('Position override requires PlayerID,Positions columns')
            for row in reader:
                pid = str(row['PlayerID']).strip()
                positions = [v.strip().upper() for v in str(row['Positions']).replace(';', ',').split(',') if v.strip()]
                allowed = {'PG','SG','SF','PF','C','G','F'}
                if pid and not pid.isdigit():
                    raise ValueError(f'Invalid PlayerID {pid!r} in position overrides')
                if set(positions) - allowed:
                    raise ValueError(f'Invalid specific positions: {positions!r}')
                if pid and positions:
                    eligible = set(positions) | {'UTIL'}
                    if 'PG' in eligible or 'SG' in eligible: eligible.add('G')
                    if 'SF' in eligible or 'PF' in eligible: eligible.add('F')
                    result[pid] = (positions[0], sorted(eligible))
    return result

def row_fppg(row, scoring):
    return sum(float(weight)*number(row[SCORING_KEYS[key]]) for key,weight in scoring.items())

def main():
    scoring=read_json('league/scoring-system.json')
    positions=read_json('league/positions.json')
    overrides=parse_positions()
    histories=collections.defaultdict(list)
    by_season={}
    checks=[]
    for season in SEASONS:
        path=SEASON_DIR/f'nba_player_averages_{season}.csv'
        if not path.is_file():
            raise FileNotFoundError(f'Missing required input: {path}')
        with path.open(encoding='utf-8-sig',newline='') as f:
            reader=csv.DictReader(f)
            missing=REQUIRED-set(reader.fieldnames or [])
            if missing:raise ValueError(f'{path.name}: missing columns {sorted(missing)}')
            records=[]
            seen=set()
            for row in reader:
                player_id=str(row['PlayerID']).strip()
                if not player_id.isdigit():
                    raise ValueError(f'Non-numeric PlayerID in {path.name}: {player_id!r}')
                if player_id in seen:
                    raise ValueError(f'Duplicate player {player_id} in {path.name}')
                seen.add(player_id)
                gp=int(number(row['GP']))
                if gp<=0:continue
                if row['Season'] != season.replace('_','-'):
                    raise ValueError(f'{path.name}: unexpected Season {row["Season"]!r}')
                position, eligible = overrides.get(player_id, ('UNK', ['UTIL']))
                entry={
                    'id':int(player_id), 'name':row['Player'].strip(), 'season':row['Season'], 'position':position,
                    'team':row['Team'].strip(), 'teams':row.get('Teams','').strip(),
                    'GP':gp, 'MPG':rounded(number(row['MPG'])),
                    'FPPG':rounded(row_fppg(row,scoring)),
                    'FG_pct':rounded(number(row.get('FG%'))/100,4) if maybe(row.get('FG%')) is not None else None,
                    '3P_pct':rounded(number(row.get('3P%'))/100,4) if maybe(row.get('3P%')) is not None else None,
                    'FT_pct':rounded(number(row.get('FT%'))/100,4) if maybe(row.get('FT%')) is not None else None,
                    'TS':rounded(number(row.get('TS%'))/100,4) if maybe(row.get('TS%')) is not None else None,
                }
                entry.update({key:rounded(number(row[key])) for key in STATS})
                entry['FP_per_36']=rounded(entry['FPPG']*36/entry['MPG']) if entry['MPG']>0 else None
                histories[player_id].append(entry)
                records.append(entry)
            by_season[season.replace('_','-')]=records
            checks.append({'season':season.replace('_','-'),'players':len(records)})

    latest_key='2025-26'
    latest=by_season[latest_key]
    rank_by_id={e['id']:i+1 for i,e in enumerate(sorted((e for e in latest if e['GP']>=40), key=lambda e:-e['FPPG']))}
    # League percentiles are a same-season comparison, not game-level estimates.
    percentiles={}
    pool=[e for e in latest if e['GP']>=10 and e['MPG']>=10]
    traits=['PTS','FGA','3PA','FTA','REB','OREB','AST','STL','BLK','TO','TS','3PA_RATE','FT_RATE','STOCKS']
    def traits_for(e):
        scale=36/e['MPG'] if e['MPG'] else 0
        result={k:rounded(e.get('TOV' if k=='TO' else k,0)*scale) for k in ['PTS','FGA','3PA','FTA','REB','OREB','AST','STL','BLK']}
        result.update({'TO':rounded(e['TOV']*scale),'TS':e['TS'],
                       '3PA_RATE':rounded(e['3PA']/e['FGA'],3) if e['FGA'] else None,
                       'FT_RATE':rounded(e['FTA']/e['FGA'],3) if e['FGA'] else None,
                       'STOCKS':rounded((e['STL']+e['BLK'])*scale)})
        return result
    distributions=collections.defaultdict(list)
    for e in pool:
        for k,v in traits_for(e).items():
            if v is not None:distributions[k].append(v)
    for key in distributions:distributions[key].sort()

    players=[]
    profiles={}
    for e in latest:
        pid=str(e['id'])
        history=histories[pid]
        recent=history[-3:]
        # Transparent, sample-size-aware historic baseline, NOT a trained model.
        weights=[0.15,0.30,0.55][-len(recent):]
        adjusted=[w*min(1, h['GP']/30) for h,w in zip(recent,weights)]
        den=sum(adjusted)
        fppg=rounded(sum(h['FPPG']*w for h,w in zip(recent,adjusted))/den) if den else e['FPPG']
        gp_pred=round(sum(h['GP']*w for h,w in zip(recent,adjusted))/den) if den else e['GP']
        gp_pred=min(82,max(0,gp_pred))
        mpg=rounded(sum(h['MPG']*w for h,w in zip(recent,adjusted))/den) if den else e['MPG']
        rate=rounded(fppg*36/mpg) if mpg else None
        prior=history[-2] if len(history)>1 else None
        season_range=[h['FPPG'] for h in recent if h['GP']>=10]
        if not season_range:season_range=[e['FPPG']]
        floor=rounded(min(season_range))
        ceiling=rounded(max(season_range))
        if floor==ceiling:floor=rounded(fppg)
        # Risk is a simple history-based indicator; nightly volatility can't be inferred.
        missed=1-min(gp_pred,82)/82
        swing=(max(season_range)-min(season_range))/max(fppg,1)
        risk=rounded(min(1,0.75*missed+0.25*min(1,swing)),2)
        notes=[f"2025-26: {e['FPPG']:.2f} fantasy points per game in {e['GP']} games."]
        if prior:
            delta=e['FPPG']-prior['FPPG']
            notes.append(f"Change from {prior['season']}: {delta:+.2f} fantasy points per game (season averages).")
        if e['3PM']>=2:notes.append(f"Made {e['3PM']:.2f} three-pointers per game in 2025-26.")
        notes.append('Broad G/F/C roster roles come from Kaggle Players.csv; PG/SG/SF/PF platform eligibility remains unverified.')
        notes.append('Injuries, ADP, and future team schedules are not included.')
        position,eligible=overrides.get(pid,('UNK',['UTIL']))
        per36=traits_for(e)
        lp={}
        for k,v in per36.items():
            vs=distributions.get(k,[])
            if v is None or not vs:lp[k]=None;continue
            import bisect
            lp[k]=round(100*(bisect.bisect_right(vs,v)-0.5*vs.count(v))/len(vs))
        season={
            'GP':e['GP'],'MPG':e['MPG'],'FPPG':e['FPPG'],'FP_per_36':e['FP_per_36'],
            'start_rate':None, 'FPPG_rank':rank_by_id.get(e['id']),
            'per_game': {**{k:e[k] for k in STATS}, 'TO':e['TOV']},
            'FG_pct':e['FG_pct'],'3P_pct':e['3P_pct'],'FT_pct':e['FT_pct'],'TS':e['TS']
        }
        rec={'id':e['id'],'name':e['name'],'position':position,'eligible':eligible,
             'team':(e['teams'].split(';')[-1].strip() if e['team']=='TOT' and e['teams'] else e['team']) or 'FA','team_2026':e['team'],'rookie':None,
             'adp':None,'owned':None,'injury':None,'injury_report':None,
             'position_source':'Kaggle Players.csv (G/F/C categories)' if pid in overrides else 'Not available',
             'model':{'fppg':fppg,'mpg':mpg,'gp':gp_pred,'rate':rate,'total':round(fppg*gp_pred),
                      'floor_fppg':floor,'ceiling_fppg':ceiling,
                      'changed_team':False,'low_confidence':e['GP']<15},
             'upside_fppg':max(ceiling,fppg),'upside_reasons':['Historical best season among last three'] if len(recent)>1 else [],
             'risk':risk,'risk_reasons':([f"Played {e['GP']} games in 2025-26"] if e['GP']<55 else []) + (['Small sample'] if e['GP']<15 else []),
             'volatility':None, 'floor':None, 'ceiling':None,
             'season_2026':{k:season[k] for k in ('GP','MPG','FPPG','FP_per_36','start_rate')},
             'fppg_rank_2026':rank_by_id.get(e['id']),
             'preseason':None, 'archetypes':[], 'headline_notes':notes[:4]}
        players.append(rec)
        profiles[pid]={
             'id':e['id'],'name':e['name'],'position':position,
             'position_source':'Kaggle Players.csv (G/F/C categories)' if pid in overrides else 'Not available',
             'eligible_positions':eligible,'team_2026':e['team'],'teams_2026':[e['team']],
             'season_2026':season, 'per_36':per36,'league_percentiles':lp,
             'low_minutes_sample':e['GP']<10,'archetypes':[],
             'outlook':{'team_2027':e['team'],'projected_FPPG':fppg,'projected_GP':gp_pred,'preseason':None},
             'scouting_notes':notes,'season_history':history,
        }
    players.sort(key=lambda e:-(e['model']['fppg'] or 0))
    OUT.mkdir(parents=True,exist_ok=True)
    dump(OUT/'players.json',players)
    dump(OUT/'profiles.json',profiles)
    dump(OUT/'history.json',by_season)
    dump(OUT/'schedule.json',{'weeks':[],'games_per_day':{},'light_day_max_games':6,
                              'note':'No schedule provided; streaming projections unavailable.'})
    dump(OUT/'league.json',{'scoring':scoring,'positions':positions,
                             'built_at':dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
                             'backtest':None,'source':'User-provided Kaggle NBA averages and Players.csv (2018-19 to 2025-26)',
                             'position_source':'Kaggle Players.csv guard/forward/center flags (broad NBA positions; not fantasy-platform eligibility)',
                             'projection_method':'weighted recent season averages (heuristic, not trained model)'})
    print(f"Built {len(players)} active players; {sum(x['players'] for x in checks)} total player-season rows.")
    print(f"  Broad positions verified for {sum(p['position'] != 'UNK' for p in players)}/{len(players)} current players.")
    for x in checks:print(f"  {x['season']}: {x['players']}")

if __name__=='__main__':
    main()
