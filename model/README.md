# Model modules

Only locally sourced, Kaggle-based modeling utilities are included:

- `train_game_logs.py`: game-level gradient boosting training
- `train_transformer.py`: PyTorch sequence Transformer training
- `predict_transformer.py`: inference with the trained sequence Transformer

The original advanced team-aware PyTorch Transformer lives at `../game_model/run.py` and uses `../game_model/export_data.py` for local Kaggle inputs.

The old unused possession-level simulation and external-data modules have been removed.
