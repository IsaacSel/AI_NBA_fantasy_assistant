# Original advanced team-aware PyTorch GameModel (preserved)

This directory contains the original three-layer multi-head team-aware Transformer in `run.py`. It still uses learned player embeddings, a two-layer form encoder, two-team player interactions, an analytically constrained full-stat line and minutes-share head, and auxiliary forecast losses. It is **not** a rewrite into an independent-player fantasy-points regressor.

This version's new `export_data.py` converts the user's Kaggle season-average, game-log and position CSVs into this original architecture's tensors and JSON input bundle. Pairing by game ID preserves both sides of NBA games. No external sports-data scrapers or feeds are included.

```bash
# From the repo root:
python game_model/export_data.py
python game_model/run.py --verify-only
python game_model/run.py --smoke --holdouts
python game_model/run.py --holdouts 2026  # full expensive training and holdout evaluation
```

After full training, the predicted multi-stat output can be used to evaluate a **hypothetical, user-specified** two-team matchup:

```bash
python -m game_model.predict_matchup --home 'Dallas Mavericks' --away 'Boston Celtics' \
  --date 2026-11-25 --as-of 2026-04-13
```

Current **production app rankings** still use the *previously* trained smaller 2-layer PyTorch sequence Transformer and the historical baseline. The full original team-aware architecture is training-ready but **not pretrained in this release**. Its optional full checkpoint is created only after running a full training command; the smoke checkpoint is never treated as a predictive model.

### Unavailable inputs

The uploaded files omit play-by-play possession events, actual starts, preseason/college rookie features, injuries, and the upcoming schedule. The original feature dimensions are preserved; possession features and starts are explicitly marked missing and neutral-filled (zero), and the future schedule is an empty documented placeholder. These are modeling limitations, not reconstructed observations. Rest-of-season forecasts are skipped when a future schedule is absent. Rookie trait fitting is disabled without college data.

### Implementation notes

The advanced architecture is retained, while its data loader uses the local Kaggle adapter. Historical scripts that relied on other inputs have been removed.
