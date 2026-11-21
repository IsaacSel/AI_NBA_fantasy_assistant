#!/usr/bin/env bash
# Kaggle-only refresh. Uses only local CSV inputs.
set -euo pipefail
cd "$(dirname "$0")"
python -m app_data.build_app_data
python -m app_data.enrich_game_data
python game_model/export_data.py
echo 'Kaggle app data and original GameModel inputs rebuilt.'
