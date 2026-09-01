# --- imports --- #
import logging  # tracking events

from contextlib import asynccontextmanager # creates async context managers for managing setup and cleanup around async resources

from fastapi import FastAPI # core fastapi module
from fastapi.staticfiles import StaticFiles # serves static assets (css & js) from a directory
from fastapi.responses import FileResponse # for serving the dev page

from config.config import BASE_DIR # the base dir for the project

from infra.engines import engines # manages custom c++ engine and stockfish

from routers import engine, games, health, pgn # maps requests to behavior  

# --- configures python logging and creates a logger named "main" --- #
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("main")

# --- define what should happens when the fastapi application starts up and shuts down --- #
@asynccontextmanager
async def lifespan(app: FastAPI):
    await engines.start() # run when server starts

    yield # fasat api runs here
        
    await engines.stop() # run when server shuts down

# --- intialize a fastapi instance --- #
app = FastAPI(title="Ichigo Chess API", lifespan=lifespan)

# --- initialize routers --- #
app.include_router(health.router)
app.include_router(engine.router)
app.include_router(pgn.router)
app.include_router(games.router)

# --- path to static files --- #
public_dir = BASE_DIR / "public"
public_dir.mkdir(exist_ok=True)

# --- declare /dev page route --- #
@app.get("/dev")
async def dev_page():
    return FileResponse(public_dir / "dev.html")


# --- mount static files --- #
app.mount("/", StaticFiles(directory=public_dir, html=True), name="static")


