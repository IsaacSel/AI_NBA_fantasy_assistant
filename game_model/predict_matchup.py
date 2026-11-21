"""Use the ORIGINAL team-aware Transformer for a hypothetical matchup.

Requires a FULLY TRAINED, local checkpoint from `python game_model/run.py`.
Does not scrape schedules or invent verified future rosters; the default player
pool is the latest OBSERVED 2025-26 roster (what-if assumption only).

Example (after full training):
    python -m game_model.predict_matchup --home 'Dallas Mavericks' \\
        --away 'Boston Celtics' --date 2026-11-25 --as-of 2026-04-13

The date and matchup are a user-supplied scenario, NOT an asserted NBA fixture.
"""
from __future__ import annotations

import argparse
import collections
import datetime
import json
import math
from pathlib import Path

import numpy as np
import torch

from game_model import run as original

HERE = Path(__file__).resolve().parent


def available_teams():
    return sorted({g['team'] for g in original.FANTASY_GAMES[2026]})


def observed_roster(team: str, as_of: str):
    """Use ONLY previously observed NBA players, not an asserted future roster."""
    by_player=collections.defaultdict(list)
    for g in original.FANTASY_GAMES[2026]:
        if g['team'] != team or g['date'] >= as_of: continue
        for r in g['rows']:
            by_player[r[0]].append((g['date'],r[1]))
    latest_team={pid:s['team_last'] for pid,s in original.SEASONS[2026].items()}
    roster=[]
    for pid,games in by_player.items():
        if latest_team.get(pid)!=team: continue  # exclude traded players on previous team
        gg=sorted(games)[-12:]
        roster.append((pid, sum(t[1] for t in gg)/len(gg),len(games)))
    roster.sort(key=lambda item: (-item[1],-item[2]))
    return [pid for pid,_,_ in roster[:original.MAX_PLAYERS]]


def build_inputs(home, away, as_of, game_date, index):
    if home==away: raise ValueError('Choose two different teams')
    if not (datetime.date.fromisoformat(game_date)>datetime.date.fromisoformat(as_of)):
        raise ValueError('Game date must be after as-of date')
    if as_of>='2027-01-01':
        raise ValueError('The provided dataset ends 2025-26; use a past-only as-of date consistent with it')
    if home not in available_teams() or away not in available_teams():
        raise ValueError('Team not found in 2025-26 game logs. Available teams: '+', '.join(available_teams()))
    B,T,P=1,2,original.MAX_PLAYERS
    z=lambda *shape, dtype=np.float32:np.zeros(shape,dtype)
    idx=z(B,T,P,dtype=np.int64)
    role=z(B,T,P,original.ROLE_FEATURES)
    win=z(B,T,P,original.FORM_WINDOW,dtype=np.int64)
    gap=z(B,T,P,original.FORM_WINDOW)
    prior=z(B,T,P)
    anchor=z(B,T,P,len(original.STATS))
    mask=z(B,T,P,dtype=bool)
    ctx=z(B,T,original.GAME_CONTEXT)
    horizon=min(original.HORIZON_MAX,(datetime.date.fromisoformat(game_date)-datetime.date.fromisoformat(as_of)).days)
    sides=[]
    for i,team in enumerate((home,away)):
        roster=observed_roster(team,as_of)
        if not roster: raise ValueError(f'No observed roster for {team} before {as_of}')
        sides.append(roster)
        for j,p in enumerate(roster):
            idx[0,i,j]=index.get(p,0)
            role[0,i,j]=original.role_inputs(p,2027)
            w,g=original.form_window(p,date=as_of)
            win[0,i,j],gap[0,i,j]=w,g
            mask[0,i,j]=True
            prior[0,i,j]=original.minutes_prior(role[0,i,j])
            prior[0,i,j]=original.minutes_anchor(win[0,i,j],gap[0,i,j],prior[0,i,j])
            anchor[0,i,j]=original.line_anchor(win[0,i,j],gap[0,i,j])
        ctx[0,i]=[float(i==0),0.0,1.0,horizon/original.HORIZON_MAX,*original.team_form(team,2026,as_of)]
    tensors={k:torch.as_tensor(v,device=original.DEVICE) for k,v in
             dict(idx=idx,role=role,w_idx=win,w_gap=gap,prior=prior,anchor=anchor,mask=mask,ctx=ctx).items()}
    return tensors,sides


def run_matchup(home,away,game_date,as_of,checkpoint,allow_smoke=False):
    path=Path(checkpoint)
    if not path.is_file():
        raise FileNotFoundError(f'Fully trained original architecture checkpoint not found: {path}. Run python game_model/run.py first.')
    if 'SMOKE_' in path.name and not allow_smoke:
        raise ValueError('Smoke-test weights are not valid predictions. Full training is required.')
    # Only load a checkpoint you generated or trust: torch.load uses pickling for numpy metadata.
    state=torch.load(path,map_location=original.DEVICE,weights_only=False)
    index={int(p):int(i) for p,i in state['index'].items()}
    tensors,sides=build_inputs(home,away,as_of,game_date,index)
    models=[]
    for weights in state['models']:
        net=original.GameModel(state['n_players']).to(original.DEVICE)
        net.load_state_dict(weights)
        net.eval();models.append(net)
    with torch.no_grad():
        all_mins=[];all_lines=[]
        for net in models:
            m,l=original.predict(net,tensors)
            all_mins.append(m.cpu().numpy());all_lines.append(l.cpu().numpy())
        mins=np.mean(all_mins,axis=0)[0]
        lines=np.mean(all_lines,axis=0)[0]
    W=original.FANTASY_WEIGHTS.detach().numpy()
    results=[]
    for side,team in enumerate((home,away)):
        for j,p in enumerate(sides[side]):
            stat=lines[side,j]
            line={k:round(float(v),2) for k,v in zip(original.STATS,stat)}
            line['PTS']=round(float(2*stat[0]+stat[2]+stat[4]),2)
            line['REB']=round(float(stat[6]+stat[7]),2)
            results.append({'player_id':p,'name':(original.BIOS.get(p) or {}).get('name',str(p)),
                            'position':original.POSITIONS.get(p,''),'team':team,
                            'minutes':round(float(mins[side,j]),2),
                            'fantasy_points':round(float(stat@W),2),'stat_line':line})
    results.sort(key=lambda x:-x['fantasy_points'])
    return {'model':'ORIGINAL GameModel: three-layer, two-team PyTorch Transformer',
            'date':game_date,'as_of':as_of,'home_team':home,'away_team':away,
            'assumptions':['Hypothetical matchup, not a verified NBA schedule',
                           'Player availability and 2026-27 team membership NOT known; uses last observed 2025-26 rosters',
                           'No injuries, starter flags, play-by-play, college data, or future rest information'],
            'players':results}


def main():
    parser=argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--home',required=True)
    parser.add_argument('--away',required=True)
    parser.add_argument('--date',required=True,help='Hypothetical game date, YYYY-MM-DD')
    parser.add_argument('--as-of',default='2026-04-13',help='Data cutoff, after latest observed 2025-26 game')
    parser.add_argument('--checkpoint',default=str(HERE/'checkpoints/game_models_2027.pt'))
    parser.add_argument('--output',default=str(HERE/'output/hypothetical_matchup.json'))
    args=parser.parse_args()
    result=run_matchup(args.home,args.away,args.date,args.as_of,args.checkpoint)
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(result,indent=2));print(f'{len(result["players"])} player projections -> {out}')
    for p in result['players'][:10]:
        print(f"{p['name'][:24]:24} {p['team'][:20]:20} {p['minutes']:5.1f} MIN {p['fantasy_points']:6.1f} FP")

if __name__=='__main__':main()
