#!/usr/bin/env bash
# No scraping. Only read user-provided local Kaggle CSV exports.
set -euo pipefail
cd "$(dirname "$0")"
python game_model/export_data.py
