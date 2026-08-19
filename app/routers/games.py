"""
Game persistence routes.

NOTE: the original server.js delegates most of this to
`require("./server/game-routes.cjs")`, whose source wasn't included in what
was provided for this rewrite — only its call signature was visible:

    createGameRouter({ express, DB, gameById, gameFromMoves, chessApi, uciListToPgn })

`POST /game/new` (which *was* fully visible in server.js) is reproduced
exactly. The rest of this router is a reasonable reconstruction of typical
game-persistence endpoints built from the same helpers
(gameById/board_from_moves/uci_list_to_pgn) that game-routes.cjs was clearly
using. If your actual game-routes.cjs exposes different paths/behavior,
send it over and I'll swap this out to match exactly.
"""
import json
import logging

from fastapi import APIRouter, HTTPException

from ..chess_utils import board_from_moves, uci_list_to_pgn
from ..db import execute, game_by_id, query_all
from ..models import GameMoveRequest, NewGameRequest

log = logging.getLogger("game_routes")

router = APIRouter()


def _row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "result": row["result"],
        "moves": json.loads(row["moves"]) if row["moves"] else [],
        "pgn": row["pgn"],
        "time_control": row["time_control"],
    }


@router.post("/game/new")
async def new_game(body: NewGameRequest):
    cur = await execute(
        "INSERT INTO games (time_control) VALUES (?)", (body.time_control,)
    )
    return {"gameId": cur.lastrowid}


@router.get("/game/{game_id}")
async def get_game(game_id: int):
    row = await game_by_id(game_id)
    if row is None:
        raise HTTPException(status_code=404, detail="game not found")
    return _row_to_dict(row)


@router.get("/games")
async def list_games(limit: int = 50):
    limit = max(1, min(limit, 200))
    rows = await query_all(
        "SELECT id, created_at, result, moves, pgn, time_control FROM games ORDER BY id DESC LIMIT ?",
        (limit,),
    )
    return [_row_to_dict(r) for r in rows]


@router.post("/game/{game_id}/move")
async def add_move(game_id: int, body: GameMoveRequest):
    row = await game_by_id(game_id)
    if row is None:
        raise HTTPException(status_code=404, detail="game not found")

    existing_moves = json.loads(row["moves"]) if row["moves"] else []
    candidate_moves = existing_moves + [body.uci]
   
    board = board_from_moves(candidate_moves)
    if board is None:
        raise HTTPException(status_code=400, detail="illegal move")

    result = "*"
    if board.is_checkmate():
        result = "0-1" if board.turn else "1-0"
    elif board.is_stalemate() or board.is_insufficient_material() or board.can_claim_draw():
        result = "1/2-1/2"

    pgn_text = uci_list_to_pgn(candidate_moves, {}, result)

    await execute(
        "UPDATE games SET moves=?, pgn=?, result=? WHERE id=?",
        (json.dumps(candidate_moves), pgn_text, result, game_id),
    )

    updated = await game_by_id(game_id)
    return _row_to_dict(updated)
