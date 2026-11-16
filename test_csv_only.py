"""Verify the CSV-only pipeline and no unsupported legacy data are packaged."""
import csv
import json
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
class CSVOnlyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with (ROOT/'data/source/nba_player_averages_2025_26_from_kaggle.csv').open(newline='',encoding='utf-8-sig') as fh:
            cls.rows=list(csv.DictReader(fh))
        cls.players=json.loads((ROOT/'data/app/players.json').read_text())
        cls.league=json.loads((ROOT/'data/app/league.json').read_text())
        cls.scoring=json.loads((ROOT/'league/scoring-system.json').read_text())
    def test_all_rows_and_nba_ids(self):
        self.assertEqual(len(self.rows),582)
        self.assertEqual(len(self.players),len(self.rows))
        self.assertEqual({p['id'] for p in self.players},{int(r['Player ID']) for r in self.rows})
    def test_every_csv_value_kept_exactly(self):
        by_id={p['id']:p for p in self.players}
        for r in self.rows:
            p=by_id[int(r['Player ID'])]
            self.assertEqual(p['name'],r['Player'])
            self.assertEqual(p['teams'],[x.strip() for x in r['Teams'].split(' / ')])
            self.assertEqual(p['gp'],int(r['GP']))
            for k,v in p['stats'].items():
                self.assertEqual(v,float(r[k]) if r[k].strip() else None,(r['Player'],k))
    def test_scoring_and_ranks(self):
        mapping={'PTS':'PPG','REB':'RPG','AST':'APG','STL':'SPG','BLK':'BPG','TO':'TOPG','FGM':'FGM/G','FGA':'FGA/G','3PM':'3PM/G','FTM':'FTM/G','FTA':'FTA/G'}
        for p in self.players:
            expected=sum(p['stats'][mapping[k]]*weight for k,weight in self.scoring.items())
            self.assertAlmostEqual(p['fppg'],expected,delta=0.002)
            self.assertAlmostEqual(p['season_fpts'],p['fppg']*p['gp'],delta=0.011)
        self.assertEqual([p['rank'] for p in self.players],list(range(1,len(self.players)+1)))
        self.assertEqual([p['fppg'] for p in self.players],sorted((p['fppg'] for p in self.players),reverse=True))
    def test_no_legacy_data(self):
        for name in ['scrapers','model','game_model','data/current','data/model','data/app/profiles.json','data/app/schedule.json','web/src/components/streaming']:
            self.assertFalse((ROOT/name).exists(),name)
        self.assertEqual(self.league['kind'],'historical_per_game_averages')
        self.assertEqual(self.league['player_count'],len(self.rows))
    def test_missing_percentages_not_zeroed(self):
        by_id={p['id']:p for p in self.players}
        for col in ['3P%','FT%']:
            missing=[int(r['Player ID']) for r in self.rows if not r[col]]
            self.assertTrue(missing)
            self.assertTrue(all(by_id[i]['stats'][col] is None for i in missing))
if __name__ == '__main__': unittest.main()
