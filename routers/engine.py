import logging

from fastapi import APIRouter, HTTPException, Request

from ichigo.book import BOOK
from ichigo.chess_utils import clean_uci_moves
from infra.engines import engines
from schemas.models import BestMoveRequest, BookMoveRequest
from infra.rate_limit import limiter

log = logging.getLogger("engine_routes")

router = APIRouter()


@router.post("/bookmove")
async def bookmove(body: BookMoveRequest):
    try:
        key = " ".join(body.moves).strip()
        return {"bookmove": BOOK.get(key)}
    except Exception:
        return {"bookmove": None}


@router.post("/bestmove")
@limiter.limit("30/minute")
async def bestmove(request: Request, body: BestMoveRequest):
    try:
        fen = body.fen if isinstance(body.fen, str) else None
        moves = clean_uci_moves(body.moves)

        depth = body.depth
        if depth is not None:
            try:
                depth = int(depth)
            except (TypeError, ValueError):
                depth = None
            if depth is not None:
                if depth < 1:
                    depth = None
                else:
                    depth = min(depth, 24)

        movetime_ms = body.movetimeMs
        try:
            movetime_ms = float(movetime_ms)
        except (TypeError, ValueError):
            movetime_ms = 50
        if movetime_ms < 50:
            movetime_ms = 50
        movetime_ms = min(movetime_ms, 5000)

        def as_int(x):
            if x is None:
                return None
            try:
                return max(0, int(float(x)))
            except (TypeError, ValueError):
                return None

        wtime, btime = as_int(body.wtime), as_int(body.btime)
        winc, binc = as_int(body.winc), as_int(body.binc)

        result = await engines.bestmove(
            fen=fen,
            moves=moves,
            movetime_ms=None if depth is not None else int(movetime_ms),
            depth=depth,
            wtime=wtime,
            btime=btime,
            winc=winc,
            binc=binc,
        )
        return result
    except Exception as e:
        log.error("bestmove error: %s", e)
        raise HTTPException(status_code=500, detail="engine error")
