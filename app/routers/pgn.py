import logging

from fastapi import APIRouter, HTTPException, Query, Response

from ..chess_utils import clean_uci_moves, uci_list_to_pgn
from ..models import PgnRequest

log = logging.getLogger("pgn_routes")

router = APIRouter()


@router.post("/pgn")
async def pgn(body: PgnRequest):
    try:
        moves_uci = clean_uci_moves(body.moves, limit=10_000)
        pgn_text = uci_list_to_pgn(moves_uci, body.headers, body.result)
        return {"pgn": pgn_text}
    except Exception as e:
        log.error("pgn generation error: %s", e)
        raise HTTPException(status_code=500, detail="PGN generation failed")


@router.get("/pgn/download")
async def pgn_download(
    moves: str = Query(default=""),
    white: str | None = None,
    black: str | None = None,
    event: str | None = None,
    tc: str | None = None,
    result: str = "*",
):
    try:
        moves_uci = [m for m in moves.split(",") if m]
        headers = {"White": white, "Black": black, "Event": event, "TimeControl": tc}
        pgn_text = uci_list_to_pgn(moves_uci, headers, result)
        return Response(
            content=pgn_text,
            media_type="text/plain",
            headers={"Content-Disposition": 'attachment; filename="game.pgn"'},
        )
    except Exception as e:
        log.error("pgn download error: %s", e)
        return Response(content="PGN generation failed", status_code=500, media_type="text/plain")
