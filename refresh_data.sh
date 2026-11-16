#!/usr/bin/env bash
# Refresh only from the supplied 2025-26 player-averages CSV (no ESPN or PBP requests).
# Optional: ./refresh_data.sh /path/to/replacement.csv
set -euo pipefail
cd "$(dirname "$0")"
"${PYTHON:-python3}" -m app_data.build_app_data "${1:-data/source/nba_player_averages_2025_26_from_kaggle.csv}"
