"""Train an actual PyTorch Transformer on past-only player-game sequences.

Run from project root: python -m model.train_transformer

Training: 2018-19 through 2023-24; validation: 2024-25; untouched test:
2025-26. All features in a training sample describe *previous* games. The
serialized model can be loaded offline; next-game estimates do not require a
future schedule, opponent, or external API.
"""
from __future__ import annotations

import argparse
import json
import random
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.metrics import mean_absolute_error, mean_squared_error
from torch import Tensor, nn
from torch.utils.data import DataLoader, TensorDataset

from model.train_game_logs import ROOT, OUTPUT, STATS, load_logs

SEQUENCE_LENGTH = 12
MIN_PREVIOUS = 5
FEATURE_NAMES = ('FPTS','MIN','PTS','REB','AST','STL','BLK','TOV',
                 'FGM','FGA','FTM','FTA','3PM','Home','Win','days_since_prior')
FEATURE_SCALE = np.array([40,36,30,10,8,2,2,3,10,18,6,8,4,1,1,7],dtype=np.float32)
EVALUATION = '2025-26'
VALIDATION = '2024-25'


@dataclass(frozen=True)
class Config:
    seq_len: int = SEQUENCE_LENGTH
    input_dim: int = len(FEATURE_NAMES)
    width: int = 32
    heads: int = 4
    layers: int = 2
    dropout: float = 0.10


class FantasyTransformer(nn.Module):
    """Causal-by-construction prior-games encoder with positional embeddings.

    For target game t, the sequence includes games [t-12, ..., t-1] only.
    A key padding mask handles players with fewer than 12 previous games.
    Predicts a learned correction to the previous-10-game mean.
    """
    def __init__(self, cfg: Config):
        super().__init__()
        self.cfg = cfg
        self.input_projection = nn.Sequential(nn.Linear(cfg.input_dim, cfg.width), nn.GELU())
        self.positional_embedding = nn.Parameter(torch.zeros(1,cfg.seq_len,cfg.width))
        nn.init.normal_(self.positional_embedding, std=0.02)
        layer = nn.TransformerEncoderLayer(
            d_model=cfg.width, nhead=cfg.heads, dim_feedforward=cfg.width*2,
            dropout=cfg.dropout, batch_first=True, norm_first=False,
            activation='gelu',
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=cfg.layers, enable_nested_tensor=False)
        self.head = nn.Sequential(nn.LayerNorm(cfg.width*2), nn.Linear(cfg.width*2,cfg.width),
                                  nn.GELU(), nn.Linear(cfg.width,1))

    def forward(self, seq: Tensor, mask: Tensor) -> Tensor:
        # mask = True for real prior games, False for left padding.
        h = self.input_projection(seq) + self.positional_embedding
        h = self.encoder(h, src_key_padding_mask=~mask)
        weights = mask.unsqueeze(-1).to(h.dtype)
        pooled = (h*weights).sum(dim=1)/weights.sum(dim=1).clamp_min(1)
        last = h[:, -1]
        # The previous ten games, never the target game or a later one.
        last10_valid = mask[:, -10:].to(seq.dtype)
        historical = (seq[:, -10:, 0]*last10_valid).sum(dim=1)/last10_valid.sum(dim=1).clamp_min(1)
        correction = 0.6*torch.tanh(self.head(torch.cat([last,pooled],dim=1)).squeeze(1))
        return historical+correction  # normalized by 40 fantasy points


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def arrays_from_games(df: pd.DataFrame):
    """Build sliding prior-game windows; never use the target game's box score."""
    from numpy.lib.stride_tricks import sliding_window_view
    X, M, Y, seasons, player_ids = [], [], [], [], []
    for pid, g in df.groupby('PlayerID', sort=False):
        n=len(g)
        if n <= MIN_PREVIOUS:
            continue
        v=g[list(FEATURE_NAMES[:-1])].to_numpy(dtype=np.float32,copy=True)
        delta=g['Date'].diff().dt.days.fillna(7).clip(1,30).to_numpy(dtype=np.float32)
        v=np.column_stack([v,delta]).astype(np.float32)
        v=np.clip(v / FEATURE_SCALE, -4, 8)
        pad=np.zeros((SEQUENCE_LENGTH,len(FEATURE_NAMES)), dtype=np.float32)
        window=sliding_window_view(np.concatenate([pad,v]),SEQUENCE_LENGTH,axis=0)
        window=window[:n].transpose(0,2,1)
        valid=np.concatenate([np.zeros(SEQUENCE_LENGTH,dtype=np.bool_),np.ones(n,dtype=np.bool_)])
        winmask=sliding_window_view(valid,SEQUENCE_LENGTH)[:n]
        sel=slice(MIN_PREVIOUS,n)
        X.append(np.ascontiguousarray(window[sel]))
        M.append(np.ascontiguousarray(winmask[sel]))
        Y.append((g['FPTS'].to_numpy(dtype=np.float32)[sel]/40).copy())
        seasons.append(g['Season'].to_numpy()[sel])
        player_ids.append(np.full(n-MIN_PREVIOUS,int(pid),dtype=np.int32))
    return tuple(np.concatenate(x,axis=0) for x in (X,M,Y,seasons,player_ids))


def latest_windows(df: pd.DataFrame):
    """At inference, build one sequence per player with >=5 completed games."""
    X,M,IDs=[],[],[]
    for pid,g in df[df['Season']==EVALUATION].groupby('PlayerID',sort=False):
        if len(g)<MIN_PREVIOUS: continue
        tail=g.tail(SEQUENCE_LENGTH)
        v=tail[list(FEATURE_NAMES[:-1])].to_numpy(dtype=np.float32,copy=True)
        delta=tail['Date'].diff().dt.days.fillna(7).clip(1,30).to_numpy(dtype=np.float32)
        v=np.clip(np.column_stack([v,delta])/FEATURE_SCALE,-4,8)
        n=len(v)
        X.append(np.vstack((np.zeros((SEQUENCE_LENGTH-n,len(FEATURE_NAMES)),dtype=np.float32),v)))
        M.append(np.array([False]*(SEQUENCE_LENGTH-n)+[True]*n,dtype=np.bool_))
        IDs.append(str(int(pid)))
    return np.stack(X),np.stack(M),IDs


def predict_batches(net: FantasyTransformer, X: np.ndarray, masks: np.ndarray,
                    batch_size:int=1024) -> np.ndarray:
    net.eval()
    chunks=[]
    with torch.inference_mode():
        for start in range(0,len(X),batch_size):
            a=torch.from_numpy(X[start:start+batch_size])
            m=torch.from_numpy(masks[start:start+batch_size])
            chunks.append(net(a,m).numpy()*40)
    return np.concatenate(chunks)


def evaluate(net, X, M, y, batch_size):
    pred=predict_batches(net,X,M,batch_size)
    return float(mean_absolute_error(y*40,pred)),float(np.sqrt(mean_squared_error(y*40,pred)))


def main(argv=None):
    parser=argparse.ArgumentParser()
    parser.add_argument('--epochs',type=int,default=6)
    parser.add_argument('--patience',type=int,default=2)
    parser.add_argument('--batch-size',type=int,default=768)
    parser.add_argument('--threads',type=int,default=4)
    parser.add_argument('--seed',type=int,default=42)
    args=parser.parse_args(argv)
    seed_everything(args.seed)
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    df=load_logs()
    X,M,y,seasons,pids=arrays_from_games(df)
    train=(seasons!=VALIDATION)&(seasons!=EVALUATION)
    val=(seasons==VALIDATION)
    test=(seasons==EVALUATION)
    if not all(x.sum()>1000 for x in (train,val,test)):
        raise ValueError('Insufficient samples in training/validation/test seasons')
    print(f'PyTorch {torch.__version__}: train={train.sum():,}; val={val.sum():,}; test={test.sum():,}',flush=True)
    cfg=Config()
    net=FantasyTransformer(cfg)
    opt=torch.optim.AdamW(net.parameters(),lr=8e-4,weight_decay=1e-3)
    loss_fn=nn.SmoothL1Loss(beta=0.35)
    dataset=TensorDataset(torch.from_numpy(X[train]),torch.from_numpy(M[train]),torch.from_numpy(y[train]))
    loader=DataLoader(dataset,batch_size=args.batch_size,shuffle=True,num_workers=0)
    Xv,Mv,yv=X[val],M[val],y[val]
    best_mae=float('inf')
    best_weights=None
    best_epoch=0
    no_improve=0
    progress=[]
    for epoch in range(1,args.epochs+1):
        net.train()
        total_loss=0.
        for xb,mb,yb in loader:
            opt.zero_grad(set_to_none=True)
            estimated=net(xb,mb)
            loss=loss_fn(estimated,yb)
            loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(),1.0)
            opt.step()
            total_loss += loss.item()*len(xb)
        val_mae,_=evaluate(net,Xv,Mv,yv,args.batch_size)
        progress.append({'epoch':epoch,'train_loss':round(total_loss/len(dataset),5),'validation_mae':round(val_mae,3)})
        print(f'Epoch {epoch}: train_loss={total_loss/len(dataset):.5f}, validation MAE={val_mae:.3f}',flush=True)
        if val_mae+0.01 < best_mae:
            best_mae=val_mae
            best_weights={key:val.detach().clone() for key,val in net.state_dict().items()}
            best_epoch=epoch
            no_improve=0
        else:
            no_improve+=1
            if no_improve >= args.patience:break
    net.load_state_dict(best_weights)
    mae,rmse=evaluate(net,X[test],M[test],y[test],args.batch_size)
    # Baseline measures previous 10, never current game.
    baseline=np.sum(X[test,-10:,0]*M[test,-10:],axis=1)/np.maximum(M[test,-10:].sum(axis=1),1)*40
    base_mae=float(mean_absolute_error(y[test]*40,baseline))
    eval_data={
        'model':'PyTorch TransformerEncoder', 'architecture':'2 Transformer encoder layers, 4 attention heads, 32 hidden dimensions, 12 prior games',
        'torch_version':str(torch.__version__), 'sequence_length':SEQUENCE_LENGTH,
        'train_seasons':[f'{a}-{str(a+1)[-2:]}' for a in range(2018,2024)],
        'validation_season':VALIDATION,'test_season':EVALUATION,
        'training_games':int(train.sum()),'validation_games':int(val.sum()),'test_games':int(test.sum()),
        'best_epoch':best_epoch, 'model_mae':round(mae,3), 'model_rmse':round(rmse,3),
        'baseline_last10_mae':round(base_mae,3),'training_history':progress,
        'coverage_note':'Minimum 5 prior games. Training 2018-19 to 2023-24, early stopping on 2024-25; 2025-26 held out entirely for test.',
        'projection_note':'Sequence includes previous games only; no known future opponent, schedule or injuries. The model is not a play-by-play simulator.',
        'target':'next-game fantasy points under league/scoring-system.json',
    }
    print(f'TEST: Transformer MAE={mae:.3f}; last-10 baseline MAE={base_mae:.3f}',flush=True)
    latest_X,latest_M,latest_ids=latest_windows(df)
    vals=predict_batches(net,latest_X,latest_M,args.batch_size)
    preds={pid:{'fppg':round(max(0.0,float(value)),3),'sequence_length':int(mask.sum())}
           for pid,value,mask in zip(latest_ids,vals,latest_M)}
    OUTPUT.mkdir(parents=True,exist_ok=True)
    torch.save({'config':asdict(cfg),'model_state':net.state_dict(),
                'features':list(FEATURE_NAMES),'scale':FEATURE_SCALE.tolist(),
                'evaluation':eval_data,'training_seed':args.seed},OUTPUT/'next_game_transformer.pt')
    (OUTPUT/'transformer_evaluation.json').write_text(json.dumps(eval_data,indent=2))
    (OUTPUT/'transformer_next_game_predictions.json').write_text(json.dumps(preds))
    print(f'Wrote transformer weights and predictions for {len(preds)} players.',flush=True)
    return eval_data


def load_trained(path:Path|None=None) -> FantasyTransformer:
    """Load checkpoint without re-training, using PyTorch's safe weights-only loader."""
    checkpoint=torch.load(path or OUTPUT/'next_game_transformer.pt',map_location='cpu',weights_only=True)
    net=FantasyTransformer(Config(**checkpoint['config']))
    net.load_state_dict(checkpoint['model_state'])
    net.eval()
    return net


if __name__=='__main__':
    main()
