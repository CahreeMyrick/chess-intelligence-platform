"""
Configuration, mirrors the `// ---- config ----` block in the original server.js.
Values are read from environment variables with the same fallbacks/behavior.
"""
import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

PORT = int(os.environ.get("PORT", "8080"))
HOST = "0.0.0.0"
PUBLIC_URL = os.environ.get("PUBLIC_URL", f"http://localhost:{PORT}")
DEFAULT_SITE = PUBLIC_URL

# Play engine (e.g. a custom "Ichigo" UCI binary) used for actually playing games.
PLAY_ENGINE_PATH = os.environ.get(
    "PLAY_ENGINE_PATH",
    str(BASE_DIR / "build" / "chess_uci_bb"),
)


def _find_stockfish() -> str | None:
    env_path = os.environ.get("STOCKFISH_PATH")
    if env_path and Path(env_path).exists():
        return env_path
    for candidate in ("/opt/homebrew/bin/stockfish", "/usr/local/bin/stockfish"):
        if Path(candidate).exists():
            return candidate
    # Also check PATH, e.g. `apt install stockfish`
    found = shutil.which("stockfish")
    return found


STOCKFISH_BIN = _find_stockfish()

# Analysis engine (Stockfish), falls back to the play engine binary if Stockfish
# isn't found anywhere, exactly like the original.
ANALYSIS_ENGINE_PATH = os.environ.get(
    "ANALYSIS_ENGINE_PATH",
    STOCKFISH_BIN or PLAY_ENGINE_PATH,
)

DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "app.db"

PYTHON_MOVE_UCI_RE = r"^[a-h][1-8][a-h][1-8][qrbn]?$"
