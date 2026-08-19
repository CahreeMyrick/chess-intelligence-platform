"""
Manages the two UCI engine subprocesses:
  - play engine   (e.g. a custom "Ichigo" binary) -> used for /bestmove
  - analysis engine (Stockfish, falls back to play engine) -> used for puzzle eval

Uses python-chess's async UCI client (chess.engine) instead of hand-rolled
stdin/stdout string parsing + regexes like the original Node version.
"""
import asyncio
import logging
from dataclasses import dataclass

import chess
import chess.engine

from config.config import PLAY_ENGINE_PATH, ANALYSIS_ENGINE_PATH

log = logging.getLogger("engines")


@dataclass
class EvalResult:
    eval_cp: int | None
    eval_mate: int | None
    bestmove: str | None
    pv: list[str]


class EngineManager:
    """Holds the two long-lived engine processes and serializes access to each
    (a single UCI engine process can only handle one `go` at a time)."""

    def __init__(self):
        self.play_transport = None
        self.play_engine: chess.engine.UciProtocol | None = None
        self.analysis_transport = None
        self.analysis_engine: chess.engine.UciProtocol | None = None
        self._play_lock = asyncio.Lock()
        self._analysis_lock = asyncio.Lock()

    async def start(self):
        try:
            self.play_transport, self.play_engine = await chess.engine.popen_uci(
                PLAY_ENGINE_PATH
            )
            log.info("Play engine ready (%s).", PLAY_ENGINE_PATH)
        except Exception as e:
            log.error("Play engine failed to initialize: %s", e)

        try:
            self.analysis_transport, self.analysis_engine = await chess.engine.popen_uci(
                ANALYSIS_ENGINE_PATH
            )
            log.info("Analysis engine ready (%s).", ANALYSIS_ENGINE_PATH)
        except Exception as e:
            log.error("Analysis engine failed to initialize: %s", e)

    async def stop(self):
        for eng in (self.play_engine, self.analysis_engine):
            if eng is not None:
                try:
                    await eng.quit()
                except Exception:
                    pass

    # ---- analysis engine: single-position eval + PV (used by the puzzle pipeline) ----
    async def eval_fen(self, fen: str, movetime_ms: int = 80) -> EvalResult:
        if self.analysis_engine is None:
            return EvalResult(None, None, None, [])

        board = chess.Board(fen)
        limit = chess.engine.Limit(time=movetime_ms / 1000)

        async with self._analysis_lock:
            try:
                info = await self.analysis_engine.analyse(board, limit)
            except Exception as e:
                log.error("analysis engine error: %s", e)
                return EvalResult(None, None, None, [])

        score = info.get("score")
        eval_cp = None
        eval_mate = None
        if score is not None:
            # Use the side-to-move's point of view, matching the original UCI
            # `score cp` semantics (score is always relative to the side to move).
            relative = score.relative
            if relative.is_mate():
                eval_mate = relative.mate()
            else:
                eval_cp = relative.score()

        pv = info.get("pv") or []
        pv_uci = [m.uci() for m in pv]
        bestmove = pv_uci[0] if pv_uci else None

        return EvalResult(eval_cp, eval_mate, bestmove, pv_uci)

    # ---- play engine: pick a move given a position + time/depth/clock controls ----
    async def bestmove(
        self,
        fen: str | None,
        moves: list[str],
        movetime_ms: int | None,
        depth: int | None,
        wtime: int | None = None,
        btime: int | None = None,
        winc: int | None = None,
        binc: int | None = None,
    ) -> dict:
        if self.play_engine is None:
            raise RuntimeError("play engine not available")

        board = chess.Board(fen) if fen else chess.Board()
        for mv in moves:
            try:
                board.push_uci(mv)
            except Exception:
                break  # stop applying at first illegal move, same as original

        limit_kwargs: dict = {}
        if depth is not None:
            limit_kwargs["depth"] = depth
        elif movetime_ms is not None:
            limit_kwargs["time"] = movetime_ms / 1000

        if wtime is not None:
            limit_kwargs["white_clock"] = wtime / 1000
        if btime is not None:
            limit_kwargs["black_clock"] = btime / 1000
        if winc is not None:
            limit_kwargs["white_inc"] = winc / 1000
        if binc is not None:
            limit_kwargs["black_inc"] = binc / 1000

        limit = chess.engine.Limit(**limit_kwargs)

        async with self._play_lock:
            t0 = asyncio.get_event_loop().time()
            info: dict = {}

            def handle_info(i: chess.engine.InfoDict):
                info.update(i)

            result = await self.play_engine.play(
                board, limit, info=chess.engine.INFO_ALL
            )
            elapsed_ms = int((asyncio.get_event_loop().time() - t0) * 1000)

        best = result.move.uci() if result.move else None
        info = result.info or {}

        score = info.get("score")
        eval_cp = None
        eval_mate = None
        if score is not None:
            relative = score.relative
            if relative.is_mate():
                eval_mate = relative.mate()
            else:
                eval_cp = relative.score()

        pv = info.get("pv") or []
        pv_str = " ".join(m.uci() for m in pv) if pv else None

        stats = {
            "depth": info.get("depth"),
            "nps": info.get("nps"),
            "nodes": info.get("nodes"),
            "tbhits": info.get("tbhits"),
            "evalCp": eval_cp,
            "evalMate": eval_mate,
            "pv": pv_str,
            "elapsedMs": elapsed_ms,
        }

        return {"bestmove": best, "stats": stats}


engines = EngineManager()
