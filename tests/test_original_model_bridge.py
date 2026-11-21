"""Regression tests: the ORIGINAL GameModel reads actual Kaggle data from local CSV exports."""
from __future__ import annotations

import collections
import json
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'game_model' / 'data'


def test_export_contains_all_players_and_full_paired_games():
    summary=json.loads((DATA/'export_summary.json').read_text())
    assert summary['total_player_games']==200030
    assert len(summary['seasons'])==8
    assert sum(v['team_games'] for v in summary['seasons'])==18896
    assert all(v['team_games']%2==0 for v in summary['seasons'])


def test_2026_game_pair_and_real_stats():
    data=json.loads((DATA/'team_games_full.json').read_text())
    assert set(map(int,data))==set(range(2019,2027))
    gids=collections.Counter(g['game_id'] for g in data['2026'])
    assert len(gids)==1230 and all(n==2 for n in gids.values())
    game=data['2026'][0]
    assert len(game['rows'])>0
    assert len(game['rows'][0][4])==13
    assert game['rows'][0][1]>0
    # No starter indicator is in the supplied data: neutral placeholder, not fabricated.
    assert all(row[3] is False for g in data['2026'] for row in g['rows'])


def test_no_unverified_schedule_or_preseason():
    for fname in ['preseason.json','preseason_team_games.json','college.json']:
        assert json.loads((DATA/fname).read_text())=={}
    assert json.loads((DATA/'schedule_2027.json').read_text())['games']==[]
    assert not (ROOT/'scrapers').exists()
    assert not (ROOT/'data/current').exists()


def test_original_transformer_keeps_full_architecture():
    from game_model.run import GameModel, FormEncoder, STATS, REC_FEATURES
    net=GameModel(4)
    assert len(net.encoder.layers)==3
    assert isinstance(net.form_enc, FormEncoder)
    assert len(net.form_enc.enc.layers)==2
    assert net.encoder.layers[0].self_attn.num_heads==4
    assert net.base.embedding_dim==64
    assert len(STATS)==13
    assert REC_FEATURES==35


def test_current_app_player_positions_and_ml():
    players=json.loads((ROOT/'data/app/players.json').read_text())
    assert len(players)==582
    assert len(set(p['id'] for p in players))==582
    assert all(p['position'] in {'G','F','C','G/F','F/C'} for p in players)
    assert sum(bool(p['model'].get('transformer_next_game')) for p in players)>=500


def test_smoke_checkpoint_is_never_shipped_as_production_model():
    assert not (ROOT/'game_model/checkpoints/game_models_2027.pt').exists()
    assert (ROOT/'data/model/next_game_transformer.pt').exists()
