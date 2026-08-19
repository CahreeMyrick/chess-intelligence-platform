import asyncio
from fastapi import APIRouter, Response

from ..engines import engines

router = APIRouter()


@router.get("/ping")
async def ping():
    return Response(content="pong", media_type="text/plain")


@router.get("/health")
async def health():
    return Response(content="ok", media_type="text/plain")


@router.get("/healthz")
async def healthz():
    """Mirrors /healthz: pings the (play) engine with isready and waits up to
    800ms for readyok. The original referenced an undefined `engine` var here
    (a leftover from before the play/analysis engine split) — this version
    fixes that by checking the play engine specifically."""
    if engines.play_engine is None:
        return Response(status_code=500, content='{"ok":false}', media_type="application/json")
    try:
        await asyncio.wait_for(engines.play_engine.ping(), timeout=0.8)
        return {"ok": True}
    except Exception:
        return Response(status_code=500, content='{"ok":false}', media_type="application/json")
