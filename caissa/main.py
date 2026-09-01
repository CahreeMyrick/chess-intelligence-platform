# --- imports --- #
import logging  # tracking events

from contextlib import asynccontextmanager # creates async context managers for managing setup and cleanup around async resources

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from config.config import BASE_DIR
from infra.engines import engines
from infra.rate_limit import limiter
from routers import chesscom, engine, games, health, pgn, puzzles

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("main")
