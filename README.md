# Fantasy Basketball — Original App + Original Game-Level Transformer + Kaggle Data

This edition **keeps the original web application and the original sophisticated PyTorch `GameModel` implementation** (`game_model/run.py`) and replaces the original data collection path with the NBA player-game, season-average, and player-position CSVs supplied by the user.

## What is actually working now

| Part | Status |
|---|---|
| Original draft, live draft, rankings, profiles, streaming UI | Retained, with modernized Kaggle-only data source |
| Player histories (2018–19 through 2025–26) | 200,030 individual player-games; 4,456 player-season rows |
| Verified broad G/F/C positions | All 582 current draft-pool players; not fantasy PG/SG/SF/PF eligibility |
| Immediate draft rankings and predictions | **Existing trained smaller** PyTorch player-sequence Transformer, plus historical baseline; gradient boosting retained as comparison |
| **Original 3-layer, two-team Transformer** | Original architecture preserved at `game_model/run.py`; real Kaggle-to-model export, full training CLI, tested forward pass, smoke training, and hypothetical matchup inference entry point |
| Original **full-training checkpoint** | **Not shipped.** Full fitting and fair validation of the large original model are computationally intensive. A smoke checkpoint is not a trained forecasting model. |
| Play-by-play events, historical starts, rookie college inputs, preseason, injuries, confirmed 2026–27 schedule | **Not supplied.** No invented data. Some original input features are neutral; some legacy modules remain for reference but are unavailable. |

**Important:** The app's current predictions still come from the previously trained 2-layer player-sequence Transformer (and historical baseline), **not the original 3-layer team-aware architecture** until you fully train the original model. Do not describe its accuracy as validated using this new architecture. A trainable architecture is not the same as a trained checkpoint.

## Start the web app

```bash
cd web
npm ci
npm run dev
```

Open http://localhost:3000. The JSON inputs and the previously trained Kaggle model outputs are already included; no internet API call or data collection is needed to view the application.

## Rebuild all Kaggle data

Set up Python from the repository root:

```bash
python -m pip install -r requirements.txt
python -m app_data.build_app_data
python -m app_data.enrich_game_data
python game_model/export_data.py
```

This regenerates `data/app/` for the website and `game_model/data/` for the **ORIGINAL team-aware architecture**. Files are read only from `data/seasons`, `data/game_logs`, and `data/player_positions_kaggle.csv`. No remote scraping or third-party sports API calls are used. Python model prediction files in `data/model/` are already provided. Refit the smaller comparison model only if desired:

```bash
python -m model.train_game_logs
python -m model.train_transformer
python -m app_data.enrich_game_data
```

## Train the ORIGINAL three-layer team-aware PyTorch Transformer

The original `GameModel` remains: a **2-layer form encoder**, per-player **64-dimensional embeddings**, a **3-layer, four-head Transformer over both teams**, team context tokens, minutes-share head, multi-stat per-minute output heads, and auxiliary forecast heads. It is fundamentally different from the smaller already-trained model.

```bash
# Fast no-training architecture and data compatibility verification:
python game_model/run.py --verify-only

# One-epoch MINI smoke check for forward + backward + checkpoint:
python game_model/run.py --smoke --holdouts

# Actual full model training, including held-out 2025–26 evaluation:
# Prefer CUDA or Apple Silicon acceleration; full training may take substantial resources.
python game_model/run.py --holdouts 2026
```

With **successful full training**, `game_model/checkpoints/game_models_2027.pt` will be created. A `SMOKE_NOT_FOR_PREDICTIONS.pt` file from `--smoke` is only a test artifact and **must not** be used as a forecast or published performance benchmark.

Use the original model for a *hypothetical matchup* (after full training):

```bash
python -m game_model.predict_matchup \
  --home 'Dallas Mavericks' --away 'Boston Celtics' \
  --date 2026-11-25 --as-of 2026-04-13 \
  --output game_model/output/hypothetical_matchup.json
```

This is a **what-if**, not a verified schedule, injury report, or future team roster. It uses most recently observed **2025–26** players to construct the lineup; the 2026–27 season data is not available in the uploaded files. For an actual matchup you would need confirmed schedules and active rosters from a properly licensed source.

The original `game_model/run.py` script automatically skips rest-of-season projection when confirmed future schedules/rosters are absent. It never fabricates them.

## Data origins and limitations

- Source is the user's CSV extracts from [`eoinamoore/historical-nba-data-and-player-box-scores`](https://www.kaggle.com/datasets/eoinamoore/historical-nba-data-and-player-box-scores). Determine the dataset's redistribution/license permissions before publishing it publicly.
- Eight complete regular seasons, **2018–19 to 2025–26**; `200,030` player-game rows, `4,456` player-season rows, `6,820` player-position records (some historical positions unknown).
- The original data input expected historical `starter` flags and **16 possession/play-by-play counts per player-game**. Neither is in these CSVs, so the bridge emits **zero placeholder values explicitly documented as missing**, while keeping the original model's input layer unchanged. Zero does **not** imply a real zero for possessions. A fully trained model would have to be retrained with this distribution.
- Game statistics (FGM, FGA, 3PM, 3PA, FTM, FTA, OREB, DREB, AST, STL, BLK, turnovers and fouls) are real recorded box scores. Pairing by game ID gives the original model both teams rather than treating players independently.
- No verified 2026–27 roster changes, future schedule, injuries, third-party market projections, preseason/college features, true starter flags, or position-specific fantasy eligibility are present.
- Unused legacy possession simulators and data ingestion modules have been removed. The active comparison models and original advanced team-aware Transformer are preserved.
- **No full Next.js production build has been verified** without installing npm dependencies; Python tests, model smoke training and inference checks have been run.

## Repository guide

- `web/`: Original application's interface and draft tools, plus history/game-log/model pages from the Kaggle rebuild.
- `data/game_logs/`: Eight user-provided individual player-game CSVs.
- `data/seasons/`: Eight user-provided season-average CSVs.
- `data/player_positions_kaggle.csv`: User-provided broad G/F/C positions.
- `app_data/build_app_data.py` + `app_data/enrich_game_data.py`: Regenerate website datasets from the user-provided CSVs and trained smaller model.
- `game_model/export_data.py`: **New adapter to the original team's Transformer input contracts.**
- `game_model/run.py`: **Original large model architecture**, with limited changes for data verification/smoke and no-schedule handling.
- `game_model/predict_matchup.py`: Generates full multi-stat output from a *fully trained* original checkpoint for a hypothetical matchup.
- `model/train_transformer.py`: Smaller previously trained and evaluated PyTorch Transformer for active draft estimates.
- `model/train_game_logs.py`: Previously trained gradient-boosting comparison model.
- `docs/DATA_PROVENANCE.md`: Source inventory and limitations for the local data pipeline.

## Removal of legacy dependencies

This package contains no original provider-branded settings export, no old scrapers, no legacy simulation modules depending on unavailable external feeds, no comparison component for that provider, and no provider-specific placeholders in generated player data. The league scoring values and roster rules remain editable project settings. The full advanced network code is retained but needs full training before its forecasts are usable.

## Ownership and licensing

Retaining original third-party source does not establish permission to redistribute it: the original ZIP did not include an explicit license. Before publishing or using this as an independent original software project, verify code authorship/license and dataset rights and credit other contributors appropriately.
