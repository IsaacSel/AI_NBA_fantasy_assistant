"""Train a chronological NBA fantasy next-game predictor on user-provided Kaggle game logs.

Uses only prior games as input features. Holds out the entire 2025-26 season
for a one-time chronological evaluation, then refits all seasons for inference.
Does not scrape data and does not use current-game outcomes as features.

Run from repository root: python -m model.train_game_logs
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error

ROOT = Path(__file__).resolve().parents[1]
GAME_DIR = ROOT / 'data' / 'game_logs'
OUTPUT = ROOT / 'data' / 'model'
LATEST_SEASON = '2025-26'
GAMES = [f'{y}_{str(y + 1)[-2:]}' for y in range(2018, 2026)]
STATS = ('PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'FGM', 'FGA', 'FTM', 'FTA', '3PM', 'MIN')
WINDOWS = (3, 5, 10, 20)
FEATURES = (
    ['games_prior', 'home', 'days_since_last', 'last_fpts', 'last_min']
    + [f'fpts_{window}' for window in WINDOWS]
    + [f'min_{window}' for window in (5, 10, 20)]
    + [f'{stat.lower()}_10' for stat in ('PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'FGA', '3PM')]
    + ['fpts_std_10', 'fpts_std_20', 'season_games_prior']
)


def load_logs() -> pd.DataFrame:
    frames = []
    for name in GAMES:
        path = GAME_DIR / f'nba_player_game_logs_{name}.csv'
        if not path.is_file():
            raise FileNotFoundError(f'Missing game log CSV: {path}')
        frame = pd.read_csv(path, low_memory=False)
        required = {'PlayerID', 'Player', 'Season', 'GameID', 'Date', 'Team', 'Opponent', 'Home', 'MIN', *STATS}
        missing = required - set(frame.columns)
        if missing:
            raise ValueError(f'{path}: missing columns: {sorted(missing)}')
        if frame['Season'].nunique() != 1 or frame['Season'].iat[0] != name.replace('_', '-'):
            raise ValueError(f'Incorrect season label in {path.name}')
        frames.append(frame)
    df = pd.concat(frames, ignore_index=True)
    df['Date'] = pd.to_datetime(df['Date'], errors='raise')
    df = df.drop_duplicates(['PlayerID', 'GameID'], keep='last')
    df = df.sort_values(['PlayerID', 'Date', 'GameID'], kind='stable').reset_index(drop=True)
    for col in STATS:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0.0)
    df['Home'] = pd.to_numeric(df['Home'], errors='coerce').fillna(0.5)
    scoring = json.loads((ROOT / 'league' / 'scoring-system.json').read_text())
    mapping = {'TO': 'TOV'}
    df['FPTS'] = 0.0
    for key, weight in scoring.items():
        stat = mapping.get(key, key)
        df['FPTS'] += df[stat] * float(weight)
    return df


def features_for_games(df: pd.DataFrame) -> pd.DataFrame:
    """Past-only features for each row (predicting that row's game)."""
    out = df[['PlayerID', 'Season', 'Date', 'FPTS', 'MIN', 'Home']].copy()
    player = df.groupby('PlayerID', sort=False)
    shifted_fp = player['FPTS'].shift(1)
    shifted_min = player['MIN'].shift(1)
    out['games_prior'] = player.cumcount().astype('float32')
    out['season_games_prior'] = df.groupby(['PlayerID', 'Season'], sort=False).cumcount().astype('float32')
    out['home'] = df['Home'].astype('float32')
    out['days_since_last'] = (df['Date'] - player['Date'].shift(1)).dt.days.clip(1, 180).fillna(3).astype('float32')
    out['last_fpts'] = shifted_fp.astype('float32')
    out['last_min'] = shifted_min.astype('float32')
    for window in WINDOWS:
        out[f'fpts_{window}'] = (shifted_fp.groupby(df['PlayerID'], sort=False)
            .transform(lambda s: s.rolling(window, min_periods=1).mean())).astype('float32')
    for window in (5, 10, 20):
        out[f'min_{window}'] = (shifted_min.groupby(df['PlayerID'], sort=False)
            .transform(lambda s: s.rolling(window, min_periods=1).mean())).astype('float32')
    for stat in ('PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'FGA', '3PM'):
        lagged = player[stat].shift(1)
        out[f'{stat.lower()}_10'] = (lagged.groupby(df['PlayerID'], sort=False)
            .transform(lambda s: s.rolling(10, min_periods=1).mean())).astype('float32')
    for window in (10, 20):
        out[f'fpts_std_{window}'] = (shifted_fp.groupby(df['PlayerID'], sort=False)
            .transform(lambda s: s.rolling(window, min_periods=2).std())).astype('float32')
    return out


def next_game_features(df: pd.DataFrame) -> pd.DataFrame:
    """Create prediction inputs strictly from already-completed player games."""
    records = []
    for pid, group in df.groupby('PlayerID', sort=False):
        group = group.tail(20)
        if len(group) < 5:
            continue
        last = group.iloc[-1]
        row = {'PlayerID': int(pid), 'Season': str(last['Season']), 'games_prior': len(df[df.PlayerID == pid]) if False else float(group.shape[0]),
               'season_games_prior': float((df[(df.PlayerID == pid) & (df.Season == last['Season'])].shape[0])),
               'home': 0.5, 'days_since_last': 3.0, 'last_fpts': float(last['FPTS']), 'last_min': float(last['MIN'])}
        for w in WINDOWS:
            row[f'fpts_{w}'] = float(group['FPTS'].tail(w).mean())
        for w in (5, 10, 20):
            row[f'min_{w}'] = float(group['MIN'].tail(w).mean())
        for col in ('PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'FGA', '3PM'):
            row[f'{col.lower()}_10'] = float(group[col].tail(10).mean())
        for w in (10, 20):
            row[f'fpts_std_{w}'] = float(group['FPTS'].tail(w).std(ddof=1))
        records.append(row)
    return pd.DataFrame(records)


def model():
    return HistGradientBoostingRegressor(max_iter=110, max_leaf_nodes=15,
        learning_rate=0.07, min_samples_leaf=75, l2_regularization=5,
        random_state=42, early_stopping=False)


def main():
    df = load_logs()
    print(f'Loaded {len(df):,} individual player-games from {len(GAMES)} seasons.', flush=True)
    feat = features_for_games(df)
    eligible = feat['games_prior'] >= 5
    train = eligible & (feat['Season'] != LATEST_SEASON)
    test = eligible & (feat['Season'] == LATEST_SEASON)
    if train.sum() < 1000 or test.sum() < 100:
        raise ValueError('Not enough game logs for a chronological train/test split')
    X_train = feat.loc[train, FEATURES].astype('float32')
    y_train = feat.loc[train, 'FPTS'].astype('float32')
    X_test = feat.loc[test, FEATURES].astype('float32')
    y_test = feat.loc[test, 'FPTS'].astype('float32')
    print(f'Training chronological model on {len(X_train):,} rows; testing on {len(X_test):,} games...', flush=True)
    m = model()
    m.fit(X_train, y_train)
    pred = m.predict(X_test)
    baseline = feat.loc[test, 'fpts_10'].fillna(feat.loc[test, 'last_fpts']).to_numpy()
    metrics = {
        'model': 'HistGradientBoostingRegressor',
        'target': 'next-game fantasy points using league/scoring-system.json',
        'training_seasons': list(sorted(feat.loc[train, 'Season'].unique())),
        'test_season': LATEST_SEASON,
        'training_games': int(train.sum()),
        'test_games': int(test.sum()),
        'model_mae': round(float(mean_absolute_error(y_test, pred)), 3),
        'baseline_last10_mae': round(float(mean_absolute_error(y_test, baseline)), 3),
        'model_rmse': round(float(np.sqrt(mean_squared_error(y_test, pred))), 3),
        'coverage_note': 'Only players with 5+ earlier games evaluated; features use only games before prediction date.',
        'projection_note': 'Neutral-site/unknown-opponent next-game estimate, not a guaranteed 2026-27 season projection.',
    }
    print('Held-out MAE',metrics['model_mae'],'baseline',metrics['baseline_last10_mae'],flush=True)
    final_model = model()
    final_model.fit(feat.loc[eligible, FEATURES].astype('float32'), feat.loc[eligible, 'FPTS'].astype('float32'))
    next_feat = next_game_features(df[df['Season'] == LATEST_SEASON].copy())
    predicted = final_model.predict(next_feat[FEATURES].astype('float32'))
    predictions = {}
    for row, value in zip(next_feat.to_dict('records'), predicted):
        predictions[str(int(row['PlayerID']))] = {
            'fppg': round(max(0., float(value)), 3),
            'recent10': round(float(row['fpts_10']), 3),
            'recent20': round(float(row['fpts_20']), 3),
            'recent_std20': round(float(row['fpts_std_20']), 3) if np.isfinite(row['fpts_std_20']) else None,
            'games_prior': int(row['season_games_prior']),
        }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / 'evaluation.json').write_text(json.dumps(metrics, indent=2))
    (OUTPUT / 'next_game_predictions.json').write_text(json.dumps(predictions))
    joblib.dump({'estimator': final_model, 'features': FEATURES, 'metrics': metrics},
                OUTPUT / 'next_game_model.joblib', compress=3)
    print(f'Wrote predictions for {len(predictions):,} players; model artifact saved.',flush=True)
    return metrics


if __name__ == '__main__':
    main()
