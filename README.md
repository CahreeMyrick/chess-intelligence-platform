# Ichigo Chess

A chess puzzle trainer with a custom UCI chess engine, Stockfish-backed analysis, and puzzles generated from your own Chess.com games.

## Features

- **Daily puzzle** — pulled live from Chess.com's public puzzle API
- **Random puzzle** — same source, random pick
- **Puzzles from your games** — load your recent Chess.com games, then either:
  - pick a single game to generate puzzles from, or
  - analyze all loaded games at once
- **ML-ranked puzzles** — puzzles scored by a trained model and served from a local ranked pool
- Custom chess engine (`ichigo/`, C++) for play, with Stockfish used for deeper analysis/evaluation when available

## Stack

- **Backend:** FastAPI (Python), SQLite, `python-chess`, `httpx`
- **Frontend:** vanilla JS (ES modules) + [chessboard.js](https://chessboardjs.com/), served as static files — no build step
- **Engine:** custom UCI engine in `ichigo/` (CMake/C++), with Stockfish as an optional/fallback analysis engine

## Project structure

```
main.py              # FastAPI app entrypoint, router registration, static file mount
routers/             # HTTP route handlers (puzzles, games, chesscom, engine, pgn, health)
services/            # Business logic (puzzle generation, Chess.com client)
infra/                # DB access, engine process management, rate limiting
schemas/              # Pydantic request/response models
config/config.py      # Env-var-driven configuration
ichigo/                # Custom C++ UCI chess engine
public/                # Served frontend (HTML/CSS/JS) — this is the live frontend
scripts/               # ML training, puzzle scoring/export, smoke tests (dev tooling)
tests/                 # Backend, frontend, and engine tests
```

> Note: `frontend/`, `server.js`, and `package.json` are leftovers from an earlier Express/Node prototype and are no longer used. `public/` is the frontend that's actually served.

## Setup

### Prerequisites

- Python 3.12+
- (Optional) [Stockfish](https://stockfishchess.org/) installed and on your `PATH`, or set `STOCKFISH_PATH` — used for puzzle-quality analysis. Falls back to the custom engine binary if not found.
- The custom engine binary built at `ichigo/build/chess_uci_bb` (see `ichigo/README.md` and `ichigo/CMakeLists.txt` for build steps), or override its location with `PLAY_ENGINE_PATH`.

### Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

> `requirements.txt` currently reflects a broader shared Python environment rather than being scoped to just this project. The packages this app actually depends on are: `fastapi`, `uvicorn`, `httpx`, `chess`, `pydantic`, `slowapi`, `python-dotenv`, `websockets`.

### Configuration

All configuration is via environment variables (see `config/config.py`), all optional with sensible defaults:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Server port |
| `PUBLIC_URL` | `http://localhost:{PORT}` | Public base URL |
| `PLAY_ENGINE_PATH` | `ichigo/build/chess_uci_bb` | Path to the custom UCI engine binary |
| `STOCKFISH_PATH` | auto-detected (`/opt/homebrew/bin/stockfish`, `/usr/local/bin/stockfish`, or `PATH`) | Path to Stockfish |
| `ANALYSIS_ENGINE_PATH` | Stockfish if found, else `PLAY_ENGINE_PATH` | Engine used for puzzle analysis |
| `DATA_DIR` | `./data` | Directory for the SQLite DB |

### Run

```bash
uvicorn main:app --reload --port 8080
```

Then open `http://localhost:8080/puzzles`.

## Dev tooling

`scripts/` contains standalone tooling not run as part of the server:

- `ml_scorer.py`, `train_puzzle_ranker.py`, `score_puzzles_with_ml.py`, `score_puzzles_ad_hoc.py`, `export_puzzles_for_ml.py` — training and scoring the puzzle-ranking model
- `generate_puzzles_from_pgn.js` — puzzle generation from a raw PGN
- `smoke-server.mjs`, `check-frontend.mjs` — smoke tests

