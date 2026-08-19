"""
Optional opening book. Original Node code did `require("./book")`, a JS
module exporting an object like {"e2e4 e7e5": "g1f3", ...}. Here we look for
book.json next to this file (or BOOK_PATH env var) with the same shape.
Missing file -> empty book, same as the original's try/catch.
"""
import json
import logging
import os
from pathlib import Path

log = logging.getLogger("book")

_BOOK_PATH = Path(os.environ.get("BOOK_PATH", Path(__file__).resolve().parent.parent / "book.json"))

BOOK: dict[str, str] = {}
if _BOOK_PATH.exists():
    try:
        with open(_BOOK_PATH) as f:
            BOOK = json.load(f)
    except Exception as e:
        log.warning("Failed to load opening book from %s: %s", _BOOK_PATH, e)
        BOOK = {}
