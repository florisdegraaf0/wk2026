# WK Poule 2026

A static dashboard for a World Cup prediction pool. The site shows the leaderboard, next games, player profiles, charts, scores, and a few extra stats based on predictions and results from a Google Sheet.

## Project Structure

```text
.
├── api/data.js          # Serverless JSON endpoint that reads the Google Sheet
├── main.py             # Python generator for the static fallback data file
├── input.xlsx          # Optional local workbook fallback/source
├── site/
│   ├── index.html      # Static app shell
│   ├── app.js          # Frontend rendering, charts, scoring views
│   ├── styles.css      # Site styling and responsive layout
│   └── data.json       # Static fallback data used when /api/data is unavailable
└── package.json        # Static build script
```

## Data Flow

The frontend first tries to fetch live data from:

```text
/api/data
```

That endpoint reads the configured Google Sheet through the Google Visualization API and calculates match points, leaderboard totals, progress values, winner-prediction points, and per-match prediction data.

If the live endpoint is unavailable, the frontend falls back to:

```text
site/data.json
```

You can regenerate that fallback file with `main.py`.

## Configuration

Both the API endpoint and Python generator use this Google Sheet by default:

```text
1fozCeduyiHd2W66pqQHGKjAPH5zBtczB24yjBeGOyK8
```

Override it with:

```powershell
$env:GOOGLE_SHEET_ID = "your-sheet-id"
```

For the Python generator, set this to use `input.xlsx` instead of downloading the Google Sheet:

```powershell
$env:USE_LOCAL_INPUT = "1"
```

## Run Locally

The app is static, so the quickest local preview is a simple file server:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory .\site
```

Then open:

```text
http://127.0.0.1:8000/
```

This serves the static fallback path. In local static mode, `/api/data` will usually be unavailable, so the app should load `site/data.json`.

## Regenerate Static Data

Install the Python dependencies, then run:

```powershell
python main.py
```

The script writes:

```text
site/data.json
```

Python dependencies are listed in `pyproject.toml`:

- `pandas`
- `openpyxl`

## Build

The npm build copies the static site into `dist`:

```powershell
npm run build
```

Current build script:

```json
"build": "rm -rf dist && mkdir -p dist && cp -R site/. dist/"
```

Note: this script uses Unix shell commands, so on Windows run it from Git Bash, WSL, or another shell that provides `rm`, `mkdir -p`, and `cp`.

## Scoring Rules

For each match:

- Exact score: `10` points
- Correct result and one exact team score: `7` points
- Correct result only: `5` points
- One exact team score only: `2` points
- No match: `0` points

Winner prediction:

- Correct tournament winner: `50` points

## Deployment Notes

The repository is shaped for a static host with a serverless API route. On Vercel, `api/data.js` can serve `/api/data`, while the static app comes from `site` or the generated `dist` folder depending on the deployment setup.

Keep `site/data.json` committed as a fallback so the site still works when the live sheet endpoint cannot be reached.
