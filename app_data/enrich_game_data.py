"""Enrich the existing app from local Kaggle NBA individual game logs and trained ML predictions.

The season averages app builder must run first. No scraping or external requests.
Run: python -m app_data.enrich_game_data
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from model.train_game_logs import load_logs, LATEST_SEASON

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'data' / 'app'
MODEL_DIR = ROOT / 'data' / 'model'

def read(name):
    return json.loads((APP / name).read_text(encoding='utf-8'))

def write(name, val):
    p = APP / name
    p.parent.mkdir(exist_ok=True, parents=True)
    p.write_text(json.dumps(val, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')

def num(value, decimals=2):
    if value is None or not np.isfinite(value):
        return None
    return round(float(value), decimals)

def split(df):
    if df is None or not len(df):
        return None
    mpg = float(df['MIN'].mean())
    fppg = float(df['FPTS'].mean())
    return {'GP': int(len(df)), 'MPG':num(mpg), 'FPPG':num(fppg),
            'FP_per_36':num(fppg*36/mpg) if mpg else None, 'start_rate':None}

def consistency(df):
    if len(df) < 4: return None
    a = df['FPTS'].to_numpy(dtype='float64')
    avg = float(np.mean(a))
    return {'mean':num(avg), 'median':num(np.median(a)),
            'std_dev':num(np.std(a)), 'floor_p10':num(np.percentile(a,10)),
            'ceiling_p90':num(np.percentile(a,90)),
            'boom_rate':num((a>=1.3*avg).mean()) if avg>0 else None,
            'bust_rate':num((a<=0.7*avg).mean()) if avg>0 else None,
            'best_game':num(a.max()),'worst_game':num(a.min())}

def summarize_player_game_logs(g):
    g = g.sort_values(['Date','GameID']).copy()
    c=consistency(g)
    first=g.iloc[:len(g)//2]
    second=g.iloc[len(g)//2:]
    g['month']=g['Date'].dt.strftime('%Y-%m')
    by_month={m:split(x) for m,x in g.groupby('month',sort=True)}
    role={'start_rate':None, 'as_starter':None, 'off_bench':None,
          'by_month':by_month,'first_half':split(first),'second_half':split(second),
          'last_20_games':split(g.tail(20))}
    days=g['Date'].diff().dt.days
    matchup={'home':split(g[g['Home']==1]),'away':split(g[g['Home']==0]),
             'wins':split(g[g['Win']==1]),'losses':split(g[g['Win']==0]),
             'back_to_back':split(g[days==1]), 'rested_2plus_days':split(g[days>=3]),
             'vs_tough_defenses':None,'vs_soft_defenses':None,
             'vs_tough_position_defenses':None,'vs_soft_position_defenses':None,
             'blowouts':None,'close_games':None}
    opponents=[]
    for name,x in g.groupby('Opponent'):
        if len(x)>=2:
            opponents.append({'opponent':name, **split(x)})
    opponents.sort(key=lambda x:-x['FPPG'])
    matchup['best_opponents']=opponents[:5]
    matchup['worst_opponents']=list(reversed(opponents[-5:]))
    return c,role,matchup

def enrich():
    players=read('players.json')
    profiles=read('profiles.json')
    league=read('league.json')
    df=load_logs().sort_values(['PlayerID','Date','GameID']).copy()
    ml_predictions=json.loads((MODEL_DIR/'next_game_predictions.json').read_text())
    evaluation=json.loads((MODEL_DIR/'evaluation.json').read_text())
    transformer_predictions_path=MODEL_DIR/'transformer_next_game_predictions.json'
    transformer_eval_path=MODEL_DIR/'transformer_evaluation.json'
    transformer_predictions=(json.loads(transformer_predictions_path.read_text())
                             if transformer_predictions_path.exists() else {})
    transformer_eval=(json.loads(transformer_eval_path.read_text())
                      if transformer_eval_path.exists() else None)

    # All eight seasons remain available in source CSV format, plus compact app JSON
    # indexed by player ID for lightweight on-demand game-log browsing.
    cols=['Date','GameID','Player','Team','Opponent','Home','Win',
          'MIN','PTS','REB','AST','STL','BLK','TOV','PF','FGM','FGA','3PM','3PA',
          'FTM','FTA','OREB','DREB','PLUS_MINUS','FPTS']
    outdir=APP/'game_logs_by_season'
    outdir.mkdir(exist_ok=True,parents=True)
    season_counts={}
    for season,group in df.groupby('Season',sort=True):
        by_id={}
        for pid,p in group.groupby('PlayerID',sort=False):
            entries=[]
            for row in p[cols].itertuples(index=False,name=None):
                rec={k:(v.strftime('%Y-%m-%d') if k=='Date' else int(v) if k=='GameID' else str(v) if k in ('Player','Team','Opponent') else num(v,2))
                     for k,v in zip(cols,row)}
                entries.append(rec)
            by_id[str(int(pid))]=entries
        season_counts[season]={'games':len(group),'players':len(by_id)}
        (outdir/f'{season}.json').write_text(json.dumps(by_id,ensure_ascii=False,separators=(',',':')))

    latest=df[df.Season==LATEST_SEASON]
    latest_groups={str(int(pid)):g for pid,g in latest.groupby('PlayerID',sort=False)}
    enriched=0
    for player in players:
        pid=str(player['id'])
        if pid not in latest_groups:
            continue
        g=latest_groups[pid]
        profile=profiles.get(pid)
        if not profile:
            continue
        c,role,matchups=summarize_player_game_logs(g)
        profile['consistency']=c
        profile['role']=role
        profile['matchups']=matchups
        profile['last_game']={
            'date':g['Date'].iat[-1].strftime('%Y-%m-%d'),
            'opponent':str(g['Opponent'].iat[-1]),
            'fantasy_points':num(float(g['FPTS'].iat[-1])),
        }
        parts={'FGM':2,'FGA':-1,'FTM':1,'FTA':-1,'3PM':1,
               'REB':1,'AST':2,'STL':4,'BLK':4,'TOV':-2,'PTS':1}
        part={'Scoring':0.,'Shooting efficiency':0.,'Rebounds':0.,'Assists':0.,
              'Steals':0.,'Blocks':0.,'Turnovers':0.}
        for stat,w in parts.items():
            k= ('Shooting efficiency' if stat in ('FGM','FGA','FTM','FTA','3PM') else
                'Scoring' if stat=='PTS' else 'Rebounds' if stat=='REB' else
                'Assists' if stat=='AST' else 'Steals' if stat=='STL' else
                'Blocks' if stat=='BLK' else 'Turnovers')
            part[k]+=float(g[stat].mean())*w
        total=sum(part.values())
        if total>0:
            profile['fp_breakdown']={k:num(v/total,4) for k,v in part.items()}
        last_team=str(g.sort_values(['Date','GameID']).iloc[-1]['Team'])
        player['team']=last_team
        profile['outlook']['team_2027']=last_team
        player['model']['ml_next_game']=None
        player['model']['gb_next_game']=None
        player['model']['transformer_next_game']=None
        player['model']['prediction_method']='historical_baseline'
        gb=ml_predictions.get(pid)
        tr=transformer_predictions.get(pid)
        if gb:
            player['model']['gb_next_game']=num(float(gb['fppg']))
        if tr:
            player['model']['transformer_next_game']=num(float(tr['fppg']))
        # Prefer the neural model when available, retain the GBDT estimate as a
        # side-by-side comparison. Neither predicts a known future opponent.
        chosen=tr if tr else gb
        if chosen:
            ml_value=float(chosen['fppg'])
            historical=float(player['model']['fppg'])
            blended=round(0.7*ml_value+0.3*historical,2)
            player['model']['ml_next_game']=num(ml_value)
            player['model']['fppg']=blended
            player['model']['total']=round(blended*player['model']['gp'])
            player['model']['rate']=num(blended*36/player['model']['mpg']) if player['model']['mpg'] else None
            engine='PyTorch Transformer' if tr else 'HistGradientBoosting'
            player['model']['prediction_method']=f'70% {engine} next-game estimate / 30% historical baseline'
            player['headline_notes'].insert(0,f'{engine} estimate: {ml_value:.1f} fantasy points next game (unknown opponent).')
            profile['scouting_notes'].insert(0,player['headline_notes'][0])
            profile['outlook']['projected_FPPG']=blended
            profile['outlook']['transformer_next_game']=(num(float(tr['fppg'])) if tr else None)
            profile['outlook']['gb_next_game']=(num(float(gb['fppg'])) if gb else None)
        if c:
            player['volatility']=num(c['std_dev'])
            player['floor']=c['floor_p10']
            player['ceiling']=c['ceiling_p90']
            # Nightly empirical percentiles replace seasonal min/max range.
            player['model']['floor_fppg']=c['floor_p10']
            player['model']['ceiling_fppg']=c['ceiling_p90']
            player['upside_fppg']=max(player['model']['fppg'],c['ceiling_p90'])
            player['upside_reasons']=['Observed 90th-percentile single-game score in 2025-26; not a forecast interval']
            sd_ratio=c['std_dev']/max(c['mean'],1) if c['mean'] is not None else 1
            missed=min(1.,1-g.shape[0]/82)
            player['risk']=num(min(1.,0.6*min(1.,sd_ratio)+0.4*missed))
            player['risk_reasons']=[f'{c["std_dev"]:.1f} nightly fantasy-point standard deviation over {len(g)} games',
                                     f'{len(g)} games played in 2025-26']
        enriched+=1
    players.sort(key=lambda x: -float(x['model']['fppg']))
    league['source']='User-provided Kaggle player-season averages and game-by-game logs, 2018-19 through 2025-26'
    league['projection_method']=('70% PyTorch Transformer / 30% historical-season baseline for players with >=5 completed games; '
                                 'HistGradientBoosting fallback; historical baseline otherwise')
    league['models']=['PyTorch TransformerEncoder','HistGradientBoostingRegressor'] if transformer_eval else ['HistGradientBoostingRegressor']
    league['game_logs']=season_counts
    league['next_game_backtest']={'transformer':transformer_eval,'gradient_boosting':evaluation} if transformer_eval else evaluation
    write('players.json',players)
    write('profiles.json',profiles)
    write('league.json',league)
    comparison={'gradient_boosting_mae':evaluation['model_mae'],
                'gradient_boosting_rmse':evaluation['model_rmse']}
    if transformer_eval:
        comparison['transformer_mae']=transformer_eval['model_mae']
        comparison['transformer_rmse']=transformer_eval['model_rmse']
        comparison['baseline_last10_mae']=transformer_eval['baseline_last10_mae']
        app_metrics={**transformer_eval,'training_seasons':transformer_eval['train_seasons'],
                     'comparison':comparison}
    else:
        app_metrics={**evaluation,'comparison':comparison}
    write('model_metrics.json',app_metrics)
    print(f'Enriched {enriched} current-player profiles and stored all {len(df):,} game logs for web browsing.')
    for season,counts in season_counts.items():
        print(f"  {season}: {counts['games']:,} player-game records, {counts['players']} players")

if __name__=='__main__':
    enrich()
