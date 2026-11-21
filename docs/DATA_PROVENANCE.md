# Data provenance and limitations

All active basketball data inputs are user-supplied CSV exports of the Kaggle dataset `eoinamoore/historical-nba-data-and-player-box-scores`:

- `data/game_logs/`: eight regular-season player-game CSV files, 2018–19 through 2025–26
- `data/seasons/`: eight player-season average CSV files, same seasons
- `data/player_positions_kaggle.csv`: broad Guard/Forward/Center flags and player identities
- `data/model/`: locally trained, Kaggle-based models, evaluation results and prediction snapshots

The active data builders are `app_data/build_app_data.py`, `app_data/enrich_game_data.py`, and `game_model/export_data.py`. These have no outbound data fetching. There is no need for third-party fantasy data services.

The original advanced team-aware PyTorch model in `game_model/run.py` preserves its architecture. It has been tested with an adapter but has not been fully retrained or validated. The app currently displays predictions from the smaller trained player-sequence Transformer and historical baseline.

Historical starter flags, possession-level event data, future schedules, confirmed 2026–27 rosters, injuries, and detailed fantasy-platform position eligibility are not supplied; unavailable inputs remain empty or explicitly neutral.

The default league roster rules and scoring values are retained as editable configuration, not a sports-platform data connection. Verify data licensing and code reuse rights before public distribution.
