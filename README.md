# Fantasy Hoops Lab — CSV-only edition

A reduced fantasy basketball website using **only the user-supplied 2025–26 NBA player averages CSV** for basketball statistics. The application retains the fantasy scoring formula, but removes **all** ESPN data collection, play-by-play, possession simulations, game logs, neural-network models, legacy projections, college data, injuries, schedules, matchup/teammate analysis, and streaming tools.

## Supported features

- **Player rankings** (582 players), sortable by fantasy points per game, games played, scoring, rebounding, shooting, and other fields in the CSV.
- **Player detail pages** with all available CSV per-game statistics, estimated season fantasy points, fantasy points per 36 minutes, and fantasy point contributions by category.
- **Player comparison** showing two players side-by-side using actual supplied season averages.
- **Manual fantasy draft tracker** with player lookup, snake-draft pick numbering, selection history, and locally saved picks.
- **Fantasy mock draft simulator** at `/mock-draft`, with computer-controlled opponents, snake draft order, configurable teams/rounds/slot, 2025–26 games-played eligibility threshold, opponent strategies, recommended historical-stat picks, full auto-completion, undo, round-by-round draft board and team comparisons. Drafts save locally in your browser.

## Data source and limitations

- `data/source/nba_player_averages_2025_26_from_kaggle.csv`: **582 rows**, **23 columns**, one row per player; source is the CSV provided with the project, not a live API.
- All displayed basketball statistics come from that CSV. Team labels come from its `Teams` field. Player URLs use the CSV's `Player ID` (NBA ID).
- `league/scoring-system.json` defines fantasy point weights. **FPPG** = sum of each per-game average multiplied by the weight. **Season FP** = FPPG × `GP`. Since CSV per-game averages are rounded, season totals are **estimates**, not official totals.
- Missing 3P% or FT% values remain missing, not zero. There is no opponent or date context.
- Historical 2025–26 averages are **not 2026–27 forecasts**. No real-time injuries, advanced scouting, game-by-game variance, or predictions are provided.
- The CSV does not contain player positions; no position eligibility or roster optimization is claimed. Simulated opponents use simple, reproducible historical-stat heuristics, **not a trained AI model or an ADP-based simulation**. The mock draft is a practice tool, not a forecast of real selections or the next season.

## Run

Prerequisites: Python 3.10+, Node.js 20.9+, npm.

```bash
./refresh_data.sh          # Regenerate JSON from the bundled CSV (offline)
cd web
npm ci
npm run dev
```

Open http://localhost:3000. For an updated CSV with the *same 23-column schema*:

```bash
./refresh_data.sh /path/to/replacement.csv
```

That copies the CSV into `data/source/` and rebuilds both `data/app/players.json` and `data/app/league.json`. **No other statistical files or game scripts are involved.**

## Mock draft usage

1. Navigate to **Mock draft simulator** in the sidebar (`/mock-draft`).
2. Choose the league size, number of rounds, your pick position, minimum historical games played and opponent behavior.
3. Click **Start mock draft**. Computer teams automatically select until your pick, including through the rest of every turn. Each new draft uses a fresh random seed, while undo/reload preserves the same opponent choices.
4. Select a player from the recommended picks or the searchable list. The simulator auto-runs opponent turns to your next pick.
5. Review the snake draft board, compare drafted teams, undo the latest human pick, or **Auto-finish draft** (this also automatically selects your remaining picks).

No play-by-play, schedules, roster eligibility, ADP, live ESPN access, machine-learning prediction, or additional datasets are needed.

## Tests

```bash
python -m unittest discover -s tests -p "test_csv_only.py"
node --experimental-strip-types --test tests/test_mock_draft.mjs  # Node 22+
```

## Files kept

| Path | Purpose |
| --- | --- |
| `data/source/*.csv` | Original supplied season averages, the source of truth |
| `app_data/build_app_data.py` | Validates CSV and computes fantasy-point values and player ranks |
| `data/app/players.json` | Generated website player records |
| `data/app/league.json` | Generated scoring and dataset metadata |
| `league/scoring-system.json` | Fantasy scoring weights |
| `web/src/` | Rankings, player details, comparison, manual draft tracker, mock-draft simulator, API |
| `tests/test_csv_only.py` | Checks the generated dataset against the CSV and that no game/PBP files survive
| `tests/test_mock_draft.mjs` | Tests snake order, bot picks, undo, auto-finish, and session validation |

The project has no Python package dependencies beyond the standard library. Frontend packages are described in `web/package.json`.
