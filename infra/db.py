"""
SQLite setup. Uses the stdlib sqlite3 module (sync) wrapped so it's safe to
call from async route handlers via a small threadpool helper — SQLite access
here is fast/local so this is fine without a heavier async driver.
"""
import sqlite3
import asyncio
from contextlib import contextmanager
from typing import Any, Iterable

from config.config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  result TEXT DEFAULT '*',
  moves TEXT DEFAULT '',
  pgn   TEXT,
  time_control TEXT DEFAULT '5+0'
);

CREATE TABLE IF NOT EXISTS puzzles (
  id INTEGER PRIMARY KEY,
  fen TEXT NOT NULL,
  side_to_move TEXT NOT NULL,           -- 'w' or 'b'
  solution_moves TEXT NOT NULL,         -- JSON array of UCI moves
  pre_eval_cp INTEGER NOT NULL,         -- eval before best move (centipawns)
  best_eval_cp INTEGER NOT NULL,        -- eval after best move
  played_eval_cp INTEGER NOT NULL,      -- eval after played move in original game
  eval_gap_cp INTEGER NOT NULL,         -- best_eval_cp - played_eval_cp
  heuristic_difficulty REAL NOT NULL,   -- handcrafted difficulty score
  is_mate INTEGER NOT NULL DEFAULT 0,   -- 1 if engine reports mate line
  source_game TEXT,                     -- e.g. "selfplay-001#23" or PGN tag
  ml_score REAL,
  source_event TEXT,
  source_game_id TEXT,
  time_control TEXT,
  time_class TEXT,
  rated INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
"""


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


# Single shared connection (sqlite3 connections are cheap; WAL mode makes
# concurrent readers/writers safe enough for this app's traffic patterns).
_conn = get_connection()
_conn.executescript(SCHEMA)
_conn.commit()


def _run(fn, *args, **kwargs):
    """Run a blocking sqlite call off the event loop."""
    return asyncio.to_thread(fn, *args, **kwargs)


def _query_all(sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
    cur = _conn.execute(sql, params)
    return cur.fetchall()


def _query_one(sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
    cur = _conn.execute(sql, params)
    return cur.fetchone()


def _execute(sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
    cur = _conn.execute(sql, params)
    _conn.commit()
    return cur


async def query_all(sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
    return await _run(_query_all, sql, params)


async def query_one(sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
    return await _run(_query_one, sql, params)


async def execute(sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
    return await _run(_execute, sql, params)


async def game_by_id(game_id: int) -> sqlite3.Row | None:
    return await query_one(
        "SELECT id, created_at, result, moves, pgn, time_control FROM games WHERE id=?",
        (game_id,),
    )
