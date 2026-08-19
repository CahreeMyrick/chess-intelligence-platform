import logging
import random
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ichigo.chess_utils import extract_san_from_pgn, san_to_uci_array
from config.config import BASE_DIR
from infra.db import query_all
from schemas.models import FromGameRequest, FromUserMlRequest
from services.puzzles_logic import (
    build_puzzles_from_pgn_with_eval,
    build_user_recent_puzzles_ml,
)

log = logging.getLogger("puzzle_routes")

router = APIRouter()

FALLBACK_PUZZLE = {
    "id": "fallback-queen-mate",
    "source": "fallback",
    "fen": "7k/5Q2/7K/8/8/8/8/8 w - - 0 1",
    "moves": ["f7g7"],  # Qg7#
    "rating": 1200,
    "themes": ["mateIn1", "basic"],
}

CHESSCOM_UA = "Ichigo/1.0"


@router.get("/puzzles/daily")
async def puzzles_daily():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                "https://api.chess.com/pub/puzzle",
                headers={"User-Agent": CHESSCOM_UA, "Accept": "application/json"},
            )
            if r.status_code != 200:
                raise httpx.HTTPStatusError("bad status", request=r.request, response=r)
            j = r.json()
    except Exception as e:
        log.error("[/puzzles/daily] chess.com fetch failed: %s", e)
        return FALLBACK_PUZZLE

    fen = j.get("fen") or j.get("FEN")
    if not fen:
        log.warning("[/puzzles/daily] missing FEN; using fallback")
        return FALLBACK_PUZZLE

    san = None
    if isinstance(j.get("moves"), str) and j["moves"].strip():
        san = j["moves"].strip()
    elif isinstance(j.get("pgn"), str) and j["pgn"].strip():
        san = extract_san_from_pgn(j["pgn"])

    if not san:
        log.warning("[/puzzles/daily] no SAN found; using fallback")
        return FALLBACK_PUZZLE

    try:
        moves = san_to_uci_array(fen, san)
    except Exception as e:
        log.error("[/puzzles/daily] SAN->UCI failed; using fallback: %s", e)
        return FALLBACK_PUZZLE

    if not moves:
        log.warning("[/puzzles/daily] empty UCI after convert; using fallback")
        return FALLBACK_PUZZLE

    puzzle_id = j.get("id") or j.get("title") or j.get("url") or f"chesscom-{j.get('publish_time', 'na')}"
    themes = j.get("themes")
    if isinstance(themes, str):
        themes = [t.strip() for t in themes.split(",") if t.strip()]
    elif not isinstance(themes, list):
        themes = []

    return {
        "id": puzzle_id,
        "source": "chess.com",
        "fen": fen,
        "moves": moves,
        "rating": j.get("rating"),
        "themes": themes,
        "_title": j.get("title"),
        "_san": san,
        "_pgnSeen": bool(j.get("pgn")),
        "_url": j.get("url"),
    }


@router.get("/puzzles/random")
async def puzzles_random():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                "https://api.chess.com/pub/puzzle/random",
                headers={"User-Agent": "Ichigo/1.0 (+your-email-or-site)"},
            )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"chess.com {r.status_code}")
        j = r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"random puzzle fetch failed: {e}")

    if not j.get("fen") or (not j.get("moves") and not j.get("pgn")):
        raise HTTPException(status_code=502, detail="chess.com random: missing fen/moves")

    san = ""
    if isinstance(j.get("moves"), str) and j["moves"].strip():
        san = j["moves"]
    elif isinstance(j.get("pgn"), str):
        body = " ".join(
            line for line in j["pgn"].splitlines() if line and not line.startswith("[")
        )
        import re

        san = re.sub(r"\d+\.(\.\.)?", " ", body)
        san = re.sub(r"\s*(1-0|0-1|1/2-1/2|\*)\s*$", "", san).strip()

    try:
        moves = san_to_uci_array(j["fen"], san)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"random SAN->UCI failed: {e}")

    themes = j.get("themes")
    if isinstance(themes, str):
        themes = [t.strip() for t in themes.split(",")]
    elif not isinstance(themes, list):
        themes = []

    return {
        "id": j.get("id") or j.get("title") or j.get("url") or "random",
        "fen": j["fen"],
        "moves": moves,
        "rating": j.get("rating"),
        "themes": themes,
        "source": "chess.com",
        "_san": san,
        "_title": j.get("title"),
        "_puzzleUrl": j.get("url"),
    }


@router.get("/puzzles/random-ml")
async def puzzles_random_ml():
    rows = await query_all(
        """
        SELECT id, fen, side_to_move, solution_moves, heuristic_difficulty,
               ml_score, source_game
        FROM puzzles
        WHERE ml_score IS NOT NULL AND ml_score >= 0.7
        ORDER BY ml_score DESC
        LIMIT 100
        """
    )
    if not rows:
        raise HTTPException(status_code=404, detail="no ML-scored puzzles available in band")

    picked = random.choice(rows)

    import json as _json

    raw = picked["solution_moves"] or ""
    moves = []
    try:
        trimmed = str(raw).strip()
        if trimmed.startswith("[") and trimmed.endswith("]"):
            moves = _json.loads(trimmed)
        else:
            moves = trimmed.split()
    except Exception as e:
        log.error("[/puzzles/random-ml] parse solution_moves failed: %s", e)
        moves = str(raw).strip().split()

    moves = [str(m).strip().lower() for m in (moves or []) if str(m).strip()]
    if not moves:
        raise HTTPException(status_code=500, detail="ml puzzle has no moves")

    return {
        "id": picked["id"],
        "fen": picked["fen"],
        "moves": moves,
        "rating": picked["heuristic_difficulty"],
        "themes": ["ml-ranked"],
        "source": picked["source_game"] or "ml",
        "ml_score": picked["ml_score"],
    }


@router.get("/puzzles")
async def puzzles_page():
    html_path = BASE_DIR / "public" / "puzzles.html"
    if not html_path.exists():
        raise HTTPException(status_code=404, detail="puzzles.html not found in public/")
    return FileResponse(html_path)


@router.post("/puzzles/from-game")
async def puzzles_from_game(body: FromGameRequest):
    try:
        max_puzzles = min(max(int(body.maxPuzzles or 12), 1), 50)
        puzzles = await build_puzzles_from_pgn_with_eval(
            pgn=body.pgn,
            username=body.username,
            max_puzzles=max_puzzles,
            movetime_ms=80,
        )
        return {"ok": True, "count": len(puzzles), "puzzles": puzzles}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error("[/puzzles/from-game] error: %s", e)
        raise HTTPException(status_code=500, detail="puzzle generation failed")


@router.post("/puzzles/from-user-ml")
async def puzzles_from_user_ml(body: FromUserMlRequest):
    uname = str(body.username or "").strip()
    if not uname:
        raise HTTPException(status_code=400, detail="missing username")

    max_games = min(max(int(body.maxGames or 5), 1), 50)
    max_puzzles = min(max(int(body.maxPuzzles or 100), 1), 500)
    movetime_ms = min(max(int(body.movetimeMs or 40), 20), 200)

    try:
        puzzles = await build_user_recent_puzzles_ml(
            username=uname,
            max_games=max_games,
            max_puzzles=max_puzzles,
            movetime_ms=movetime_ms,
        )
        if puzzles:
            log.info("=== OUTGOING from-user-ml SAMPLE ===\n%s", puzzles[0])
        return {"ok": True, "username": uname, "count": len(puzzles), "puzzles": puzzles}
    except Exception as e:
        log.error("[/puzzles/from-user-ml] error: %s", e)
        raise HTTPException(status_code=500, detail="puzzle generation failed")
