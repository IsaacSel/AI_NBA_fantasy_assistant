# Fantasy Hoops Lab

Models, tools, and a web app for **Saint Pablo's Basketball League**: 10 teams, head-to-head points scoring, daily lineups, and a draft-focused view of the 2026–27 season. The project uses **locally stored Kaggle basketball data**; it does not collect live scores, schedules, injuries, or rosters.

The question everything here works toward answering is:

> **How many fantasy points might each player score in his next game, and what does that mean for rankings, drafts, and longer-term value?**

The project has two complementary approaches. A **trained player-sequence Transformer** forecasts next-game fantasy points from recent performances and powers the current app's ML estimates. Alongside it, the **original advanced game-level foundation model** is preserved: a three-layer, team-aware PyTorch Transformer designed to see both teams in a game and predict each participating player's minutes and full statistical line. That advanced architecture is **data-connected and training-ready, but not fully trained or validated in this release**.

## Contents

- [The process at a glance](#the-process-at-a-glance)
- [Repository map](#repository-map)
- [Quick start](#quick-start)
- [League scoring](#league-scoring)
- [Principles](#principles)
- [Results so far](#results-so-far)
- [Current limitations](#current-limitations)
- [Further reading](#further-reading)

## The process at a glance

1. **Extract historical data from Kaggle.** The notebooks in `kaggle_extract/` document how the player game logs, season averages, and broad player positions were exported from [NBA Dataset: Box Scores and Stats](https://www.kaggle.com/datasets/eoinamoore/historical-nba-data-and-player-box-scores). The required CSV files are included in this ZIP.
2. **Build the local app datasets.** `app_data/build_app_data.py` calculates season history, fantasy scoring, broad-position eligibility, and initial player rankings. `app_data/enrich_game_data.py` adds individual-game histories, performance trends, consistency measures, and predictions from previously trained comparison models.
3. **Prepare games for the original architecture.** `game_model/export_data.py` pairs both teams by game ID and creates `game_model/data/` in the structure expected by the original multi-stat Transformer. Unavailable possession, starter, college, and preseason inputs remain explicitly empty or neutral; no substitute observations are invented.
4. **Train and evaluate machine-learning models.** The shipped smaller PyTorch Transformer reads up to 12 prior games per player. A gradient-boosting regressor provides a comparison. Both have saved evaluations on the held-out **2025–26** season. The advanced, team-aware Transformer can be verified and trained separately.
5. **Use the app.** Browse player rankings, profiles, eight-season history, individual game logs, model accuracy, mock drafts, and a live draft board. Future-game streaming projections remain unavailable because no confirmed future schedule is provided.

**Data included:** eight seasons (**2018–19 through 2025–26**), **200,030** player-game records, **4,456** player-season rows, and **6,820** player identity/position entries. All **582** players in the 2025–26 draft pool have a broad G/F/C classification. Data coverage is historical; the presence of 2026–27 league settings does not mean the project has verified 2026–27 games or rosters.

The original model design and input contracts are explained in [`game_model/README.md`](game_model/README.md).

## Repository map

```text
fantasy-basketball/
├── game_model/           Original advanced team-aware PyTorch model
│   ├── run.py            Verify, train, evaluate, and checkpoint the original GameModel
│   ├── export_data.py    Kaggle CSVs -> original model input bundle
│   ├── predict_matchup.py
│   ├── data/             Prepared historical team/game tensors and metadata
│   └── README.md
├── model/                Trained comparison approaches
│   ├── train_transformer.py   2-layer player-sequence PyTorch Transformer
│   ├── train_game_logs.py     Gradient-boosting model
│   └── predict_transformer.py
├── kaggle_extract/       Kaggle notebooks for averages, game logs, positions
├── app_data/             Build and enrich the site's JSON data
├── web/                  Next.js application (rankings, drafts, profiles, history)
├── league/               Editable scoring, lineup, and draft settings
├── data/
│   ├── game_logs/        Eight game-by-game CSVs
│   ├── seasons/          Eight player-season average CSVs
│   ├── player_positions_kaggle.csv
│   ├── model/            Trained smaller-model artifacts and evaluation files
│   └── app/              Generated JSON consumed by the website
├── docs/                 Data provenance and limitations
├── tests/                Data, model, and architecture regression tests
├── refresh_data.sh      Rebuild app and advanced-model inputs from local CSVs
├── setup_history.sh     Re-export local advanced-model inputs (not a downloader)
├── requirements.txt
└── README.md
```

| Folder or file | Details |
| --- | --- |
| `game_model/run.py` | Original 64-dimensional player embeddings, 2-layer form encoder, 3-layer / 4-head team-aware Transformer, minutes and 13-stat output heads, training and evaluation workflow |
| `game_model/export_data.py` | Loads both sides of historic games from local CSVs, builds the original model's self-contained input bundle, and records missing feature availability |
| `model/train_transformer.py` | Trains the current 2-layer / 4-head, 32-wide player-history network from prior-game sequences; saves a `.pt` checkpoint and predictions |
| `model/train_game_logs.py` | Builds the gradient-boosting comparison model and evaluation/prediction files |
| `kaggle_extract/` | `2018-2026-avg-data.ipynb`, `game-by-game.ipynb`, and `positions.ipynb`, retained for reproducible extraction |
| `app_data/` | Produces `data/app/players.json`, `profiles.json`, `history.json`, seasonal game-log JSON, and evaluation summaries |
| `web/` | Next.js app with `/` rankings, `/players/[id]`, `/history`, `/model`, `/draft`, `/live`, and `/streaming` |
| `league/` | `scoring-system.json`, `league-settings.json`, `positions.json`, and scoring notes |
| `data/` | Source CSVs and pre-generated model/app outputs so the downloaded ZIP is usable without rerunning Kaggle notebooks |

**For GitHub:** the ZIP includes the data and trained comparison model, but the default `.gitignore` excludes large `data/` directories, checkpoints, and generated model inputs. A fresh clone **will not necessarily contain the data** unless you explicitly distribute it under appropriate permissions. The repository root is the working directory for all Python commands below.

## Quick start

### 1. Run the website with bundled data

Install [Node.js](https://nodejs.org/) and open a terminal in the extracted project root:

```bash
cd web
npm ci
npm run dev
```

Open **http://localhost:3000**. The saved player files and trained smaller-model predictions are included, so **Python and Kaggle access are not required merely to browse the app**.

### 2. Rebuild the data from your CSVs

From the repository root, with Python installed:

```bash
python -m venv .venv
# Activate .venv for your shell, then:
python -m pip install -r requirements.txt -r game_model/requirements.txt

python -m app_data.build_app_data
python -m app_data.enrich_game_data
python game_model/export_data.py
```

On a Bash-compatible system, `./refresh_data.sh` performs the last three commands. Despite its name, **`setup_history.sh` does not download history**: it only regenerates `game_model/data/` from local CSV files.

To retrain the two smaller comparison models, optionally run:

```bash
python -m model.train_game_logs
python -m model.train_transformer
python -m app_data.enrich_game_data
```

Retraining changes the saved predictions and evaluation artifacts; it is **not** needed for the included precomputed predictions.

### 3. Verify and train the original advanced Transformer

```bash
# Fast architecture and Kaggle-data compatibility check
python game_model/run.py --verify-only

# Tiny end-to-end smoke training; NOT a production model
python game_model/run.py --smoke --holdouts

# Full training + evaluation on held-out 2025–26 games
python game_model/run.py --holdouts 2026
```

The full run is compute-intensive. By default the original code selects CUDA, Apple Silicon MPS, or CPU according to availability; set `FOUNDATION_DEVICE=cpu` if needed. It prints training progress and, on successful full training, saves `game_model/checkpoints/game_models_2027.pt` and a held-out report in `game_model/output/`.

**Do not use a smoke checkpoint as a prediction model.** The ZIP does **not** contain a fully trained checkpoint for the original three-layer architecture. The website does not automatically switch to that advanced model after training.

Once the original model is fully trained, you can run a hypothetical matchup:

```bash
python -m game_model.predict_matchup \
  --home 'Dallas Mavericks' \
  --away 'Boston Celtics' \
  --date 2026-11-25 \
  --as-of 2026-04-13
```

This is a **what-if scenario**, not an actual future schedule or verified roster forecast. The script draws on historical participants and cannot determine who will actually play. The default `--as-of` can be changed to a valid historical data cutoff.

### 4. Run tests

```bash
python -m unittest discover -s tests -p 'test_rebuild.py' -v
python -m unittest discover -s tests -p 'test_transformer.py' -v
```

The `tests/test_original_model_bridge.py` file also contains checks written for `pytest`:

```bash
python -m pip install pytest
python -m pytest tests/test_original_model_bridge.py -q
```

The project has passed Python regression and architecture smoke checks. A complete Next.js production build was not verified in the packaged release; use `cd web && npm run build` to check it in your environment.

## League scoring

The editable scoring system is in [`league/scoring-system.json`](league/scoring-system.json).

| Stat | Fantasy points | Stat | Fantasy points |
| --- | ---: | --- | ---: |
| Point (PTS) | +1 | Rebound (REB) | +1 |
| Field goal made (FGM) | +2 | Assist (AST) | +2 |
| Field goal attempted (FGA) | −1 | Steal (STL) | +4 |
| Free throw made (FTM) | +1 | Block (BLK) | +4 |
| Free throw attempted (FTA) | −1 | Turnover (TO) | −2 |
| Three-pointer made (3PM) | +1 | | |

In practice:

| Shot | Fantasy points |
| --- | ---: |
| Made three | **+5** |
| Made two | **+3** |
| Made free throw | **+1** |
| Any missed field goal or free throw | **−1** |

Shooting efficiency, steals, and blocks can make a substantial difference in this scoring system. The **original advanced model predicts a full stat line**, which is then converted to fantasy points using these weights. The **smaller trained model predicts fantasy points directly**, so changing scoring weights would require recalculating game targets and retraining that model.

The bundled league configuration specifies **10 teams**, **10 starters + 3 bench + 1 IR**, a maximum of **4 centers**, **7 acquisitions per matchup week**, and **4 playoff teams** across two two-week rounds. The broad-position app lineup uses **3 G, 3 F, 1 C, and 3 UTIL** starters. A **February 19, 2027** trade deadline is recorded as an editable configuration value, **not verified against a live league**.

## Principles

The project follows these design choices and constraints:

**Game-level, not possession-by-possession.** Both the player-sequence model and the original foundation model learn from whole-game box scores. The original advanced architecture still has slots for possession-based summary features, but the supplied CSVs do not include play-by-play events. Those slots are neutral-filled and must not be mistaken for observed zero possessions.

**Player identity plus recent form.** The original foundation model combines learned player embeddings with a form encoder reading recent games. It then uses attention across both teams to account for teammates and opponents. The smaller shipped model instead learns from a player's previous 12 games and outputs next-game fantasy points directly.

**Use past performances for predictive features.** The trained sequence model constructs inputs from games before the target game; it uses the 2024–25 season for validation and keeps 2025–26 aside for testing. The advanced model's historical game examples contain the actual players who appeared, so its historical evaluation is **conditional on participation** and is not proof that it can know future lineups.

**Forecast statistical outcomes, not injuries.** The provided data has no confirmed future schedule, injuries, or active 2026–27 rosters. Predictions assume a player is available to participate; the app does not predict whether he will play.

**Distinguish trained models from architecture.** The smaller Transformer and gradient booster have trained checkpoints and saved holdout results. The original advanced network has verified forward passes, a smoke-training test, and a data adapter, but it has **no validated full-training checkpoint in this release**.

**Position labels are broad.** The player directory provides `G`, `F`, `C`, `G/F`, and `F/C`. These are not verified fantasy-site PG/SG/SF/PF eligibility; the mock draft uses compatible broad roster slots.

**Keep the pipeline local and repeatable.** Player data comes from the bundled CSVs. The notebooks document extraction; the Python builders create reproducible JSON inputs and model files without fetching data from a sports API.

## Results so far

The **saved** benchmark files report next-game fantasy-point prediction errors for the 2025–26 holdout. Mean absolute error (MAE) is the average absolute difference, in fantasy points, between a prediction and the actual game result; lower is better.

| Method | 2025–26 holdout MAE | Status |
| --- | ---: | --- |
| Last-10-game average baseline | **10.066** | Historical comparison |
| Gradient-boosting regressor | **9.791** | Trained and evaluated |
| 2-layer PyTorch player-sequence Transformer | **9.785** | Trained and evaluated; used by current app |
| Original 3-layer, team-aware PyTorch foundation model | **Not measured** | Architecture retained; full fitting/evaluation outstanding |

These results are drawn from `data/model/evaluation.json` and `data/model/transformer_evaluation.json`, which report **26,134** player-games in the 2025–26 test set. The smaller Transformer uses **2018–19 through 2023–24** for training, **2024–25** for validation, and **2025–26** for testing. Its reported RMSE is **12.623** fantasy points; the gradient-boosting model reports **12.500**. The 0.006-point MAE difference is negligible and does not demonstrate a meaningful advantage of one model over the other.

The Transformer improves on the last-10 baseline by approximately **2.8% in MAE** on the recorded evaluation. These are saved project metrics, **not a claim that the advanced original architecture achieves the same accuracy**.

## Current limitations

- **No verified 2026–27 NBA schedule or rosters.** The streaming page explains the limitation rather than generating made-up future games. Season-long fantasy totals remain provisional without future game counts.
- **No injuries, true starter flags, play-by-play events, preseason, or college rookie inputs.** The advanced architecture preserves relevant input dimensions, but missing source features are empty or neutral-filled, and the original rookie-trait pathway cannot be meaningfully trained from these CSVs alone.
- **No verified PG/SG/SF/PF eligibility.** Only broad G/F/C player classifications are included.
- **The original advanced Transformer is not yet production-trained.** Its smoke-training check verifies that the training loop works, not that its forecasts are accurate.
- **The web app's `/api/user` route is not authenticated.** Add access control and user isolation before a public deployment.
- **Code and dataset licensing need review.** The Kaggle source and the retained original application code may have separate reuse and redistribution conditions. A public GitHub repository or downloadable dataset is not automatically unrestricted.

## Further reading

- [`game_model/README.md`](game_model/README.md) — The preserved original team-aware Transformer, adapter, training, and what-if inference.
- [`model/README.md`](model/README.md) — Trained smaller Transformer and gradient-boosting comparison models.
- [`web/README.md`](web/README.md) — The app's routes, positions, and local-data behavior.
- [`docs/DATA_PROVENANCE.md`](docs/DATA_PROVENANCE.md) — Dataset origins, available and missing fields, and licensing caution.
- [`data/source_manifest.json`](data/source_manifest.json) — Coverage counts, model status, and exported source inventory.
- [`data/model/transformer_evaluation.json`](data/model/transformer_evaluation.json) and [`data/model/evaluation.json`](data/model/evaluation.json) — Saved holdout measurements.
- [`kaggle_extract/`](kaggle_extract/) — Original notebooks for extracting season averages, game-by-game statistics, and player positions.
