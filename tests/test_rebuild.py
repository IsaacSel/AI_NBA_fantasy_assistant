"""Validate the bundled offline Kaggle data pipeline without external API calls."""
import csv
import json
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APP=ROOT/'data/app'

def j(path):return json.loads(path.read_text())

class TestBundledRebuild(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.players=j(APP/'players.json')
        cls.profiles=j(APP/'profiles.json')
        cls.league=j(APP/'league.json')
        cls.metrics=j(APP/'model_metrics.json')

    def test_count_and_unique_ids(self):
        self.assertEqual(len(self.players),582)
        self.assertEqual(len(self.players),len({p['id'] for p in self.players}))
        self.assertEqual(len(self.players),len(self.profiles))

    def test_season_coverage(self):
        expected=['2018-19','2019-20','2020-21','2021-22','2022-23','2023-24','2024-25','2025-26']
        self.assertEqual(sorted(self.league['game_logs']),expected)
        self.assertEqual(sum(x['games'] for x in self.league['game_logs'].values()),200030)
        for season in expected:
            logs=j(APP/'game_logs_by_season'/f'{season}.json')
            self.assertEqual(sum(len(x) for x in logs.values()),self.league['game_logs'][season]['games'])
            self.assertTrue(logs)

    def test_prediction_and_game_information(self):
        predicted=sum(p['model']['ml_next_game'] is not None for p in self.players)
        self.assertGreaterEqual(predicted,500)
        self.assertEqual(self.metrics['test_season'],'2025-26')
        self.assertGreater(self.metrics['test_games'],20000)
        for p in self.players:
            self.assertIn(str(p['id']), self.profiles)
            self.assertGreaterEqual(p['model']['fppg'],0)
            prof=self.profiles[str(p['id'])]
            self.assertIsNotNone(prof['consistency']) if prof['season_2026']['GP']>=4 else None
            self.assertIn('season_history',prof)


    def test_positions_source_and_player_mapping(self):
        """Corrected Kaggle broad NBA categories must propagate through the app."""
        import collections
        source={}
        with (ROOT/'data/player_positions_kaggle.csv').open(newline='',encoding='utf-8-sig') as f:
            for row in csv.DictReader(f):
                source[int(row['personId'])] = row['position']
        self.assertEqual(len(source), 6820)
        expected=collections.Counter({'G':240,'F':180,'C':64,'G/F':51,'F/C':47})
        self.assertEqual(collections.Counter(p['position'] for p in self.players),expected)
        for player in self.players:
            pid=player['id']
            self.assertEqual(player['position'],source[pid])
            self.assertEqual(self.profiles[str(pid)]['position'],player['position'])
            self.assertEqual(self.profiles[str(pid)]['eligible_positions'],player['eligible'])
            allowed={'G','F','C','UTIL'}
            self.assertTrue(set(player['eligible']).issubset(allowed))
            self.assertIn('UTIL',player['eligible'])
            if player['position']=='G/F':
                self.assertTrue({'G','F'}.issubset(player['eligible']))
            if player['position']=='F/C':
                self.assertTrue({'F','C'}.issubset(player['eligible']))
        history=j(APP/'history.json')
        for games in history.values():
            for row in games:
                self.assertEqual(row['position'],source[row['id']])
        rules=self.league['positions']
        self.assertEqual(sum(rule['starters'] for k,rule in rules.items() if k not in {'BE','IR'}),10)
        self.assertEqual((rules['G']['starters'],rules['F']['starters'],rules['C']['starters']),(3,3,1))
        self.assertEqual((rules['PG']['starters'],rules['SG']['starters'],rules['SF']['starters'],rules['PF']['starters']),(0,0,0,0))
        self.assertEqual(rules['C']['maximum'],4)

    def test_scoring_from_real_example(self):
        logs=j(APP/'game_logs_by_season'/'2025-26.json')
        game=next(g for games in logs.values() for g in games if g['FGA']>0 and g['FPTS']>0)
        score=2*game['FGM']-game['FGA'] + game['FTM']-game['FTA'] + game['3PM'] + game['REB']+2*game['AST']+4*game['STL']+4*game['BLK']-2*game['TOV']+game['PTS']
        self.assertAlmostEqual(score,game['FPTS'],places=1)

if __name__=='__main__':unittest.main()
