"""Validate PyTorch architecture, temporal feature safety, and bundled predictions."""
import json
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from model.train_transformer import (
    FantasyTransformer, Config, arrays_from_games, load_trained,
)

ROOT=Path(__file__).resolve().parents[1]

class TransformerTests(unittest.TestCase):
    def test_architecture_is_real_transformer(self):
        net=FantasyTransformer(Config())
        self.assertEqual(len(net.encoder.layers),2)
        self.assertEqual(net.encoder.layers[0].self_attn.num_heads,4)
        self.assertIsInstance(net.encoder.layers[0],torch.nn.TransformerEncoderLayer)
        sample=torch.zeros((2,12,16),dtype=torch.float32)
        mask=torch.tensor([[False]*7+[True]*5,[True]*12])
        with torch.inference_mode():
            prediction=net(sample,mask)
        self.assertEqual(prediction.shape,(2,))
        self.assertTrue(torch.isfinite(prediction).all())

    def test_no_current_game_leakage(self):
        dates=pd.date_range('2024-01-01',periods=7)
        base={
            'PlayerID':[100]*7,'Season':['2023-24']*7,
            'Date':dates,'FPTS':[10.,11.,12.,13.,14.,15.,16.],
            'MIN':[20.]*7, 'PTS':[10.]*7,'REB':[5.]*7,'AST':[4.]*7,
            'STL':[1.]*7,'BLK':[1.]*7,'TOV':[2.]*7,'FGM':[4.]*7,
            'FGA':[8.]*7,'FTM':[1.]*7,'FTA':[2.]*7,
            '3PM':[1.]*7,'Home':[1.]*7,'Win':[1.]*7,
        }
        original=pd.DataFrame(base)
        a=arrays_from_games(original)
        modified=original.copy()
        modified.loc[5,['FPTS','PTS','MIN']]=[99.,99.,99.]
        b=arrays_from_games(modified)
        np.testing.assert_allclose(a[0][0],b[0][0]) # target game 6 remains unseen
        self.assertNotEqual(float(a[2][0]),float(b[2][0]))
        self.assertFalse(np.array_equal(a[0][1],b[0][1]))  # only next target now sees game 6

    def test_checkpoint_predictions_and_app(self):
        net=load_trained()
        self.assertIsInstance(net,FantasyTransformer)
        self.assertTrue(any(p.requires_grad for p in net.parameters()))
        model_root=ROOT/'data/model'
        estimates=json.loads((model_root/'transformer_next_game_predictions.json').read_text())
        evaluation=json.loads((model_root/'transformer_evaluation.json').read_text())
        app=json.loads((ROOT/'data/app/players.json').read_text())
        self.assertEqual(evaluation['test_season'],'2025-26')
        self.assertEqual(evaluation['validation_season'],'2024-25')
        self.assertGreaterEqual(len(estimates),500)
        self.assertEqual(sum(x['model']['transformer_next_game'] is not None for x in app),len(estimates))
        for row in app:
            if str(row['id']) in estimates:
                self.assertAlmostEqual(row['model']['transformer_next_game'],estimates[str(row['id'])]['fppg'],delta=0.011)

if __name__=='__main__':unittest.main()
