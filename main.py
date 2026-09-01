import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from config.config import BASE_DIR
from infra.engines import engines
from infra.rate_limit import limiter
from routers import chesscom, engine, games, health, pgn, puzzles

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---- startup: mirrors the Node `(async () => { ... })()` engine init block ----
    await engines.start()
    yield
    # ---- shutdown: mirrors shutdown()/SIGINT/SIGTERM handling ----
    await engines.stop()


app = FastAPI(title="Ichigo Chess API", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ---- routers ----
app.include_router(health.router)
app.include_router(engine.router)
app.include_router(pgn.router)
app.include_router(games.router)
app.include_router(chesscom.router)
app.include_router(puzzles.router)

from fastapi.responses import FileResponse

# ---- static files, mirrors app.use(express.static(path.join(__dirname, "public"))) ----
public_dir = BASE_DIR / "public"
public_dir.mkdir(exist_ok=True)


@app.get("/dev")
async def dev_page():
    return FileResponse(public_dir / "dev.html")


app.mount("/", StaticFiles(directory=public_dir, html=True), name="static")

