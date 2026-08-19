import logging

from fastapi import APIRouter, HTTPException, Query

from ..chesscom_client import ChessComError, get_recent_games

log = logging.getLogger("chesscom_routes")

router = APIRouter()


@router.get("/chesscom/{username}/games/recent")
async def recent_games(username: str, limit: int = Query(default=15)):
    try:
        limit = max(1, min(limit, 100))
        data = await get_recent_games(username, limit)
        return data
    except ChessComError as e:
        log.error("[/chesscom/%s/games/recent] %s", username, e)
        if e.status == 404:
            raise HTTPException(status_code=404, detail="user not found on chess.com")
        raise HTTPException(status_code=502, detail="failed to load games from chess.com")
    except Exception as e:
        log.error("[/chesscom/%s/games/recent] %s", username, e)
        raise HTTPException(status_code=502, detail="failed to load games from chess.com")
