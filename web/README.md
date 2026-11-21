# Fantasy Hoops Lab — game-log ML edition

Run `npm ci && npm run dev` from `web/` and open http://localhost:3000. Uses prebuilt data in `../data/app/`.

Player position filters use broad G/F/C Kaggle labels. Exact fantasy-site PG/SG/SF/PF eligibility is not provided, so mock drafts use 3 G, 3 F, 1 C and 3 UTIL starter slots.

Pages: `/` rankings and personalized drafts, `/model` evaluation for the trained game-log model, `/history` all season averages, `/players/[id]` season history and individual game logs (all eight seasons), `/draft` mock draft, `/live` live draft, and `/streaming` schedule-not-provided explanation.

To regenerate data, see the root README. The app reads local Kaggle-derived files only and makes no remote data requests. Before deploying publicly, protect the unauthenticated `/api/user` route and confirm redistribution rights for retained source code and input data.
