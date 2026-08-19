"""
The "find my blunders and turn them into puzzles" pipeline.
Mirrors buildEvalPuzzlesFromPGN / buildPuzzlesFromPGNWithEval /
buildUserRecentPuzzlesML / extractSolutionMoves / puzzleRowToJson.
"""
import io
import json
import logging

import chess
import chess.pgn

from infra.engines import engines
from services.chesscom_client import get_recent_games
from scripts.ml_scorer import score_puzzles

log = logging.getLogger("puzzles_logic")


def _load_pgn(pgn_text: str) -> chess.pgn.Game | None:
    game = chess.pgn.read_game(io.StringIO(pgn_text or ""))
    return game


def _mate_to_cp(mate: int | None) -> int | None:
    if mate is None:
        return None
    return 100000 if mate > 0 else -100000


async def build_eval_puzzles_from_pgn(
    pgn: str,
    username: str | None = None,
    movetime_ms: int = 60,
    max_puzzles_per_game: int = 50,
) -> list[dict]:
    """Replay a single game, find the user's moves, eval before/after each
    with the analysis engine, and keep the ones with a big eval swing.
    Mirrors buildEvalPuzzlesFromPGN()."""
    game = _load_pgn(pgn)
    if game is None:
        raise ValueError("bad PGN")

    headers = game.headers
    uname = username.lower() if username else None
    focus_color = chess.WHITE
    if uname:
        if (headers.get("White") or "").lower() == uname:
            focus_color = chess.WHITE
        elif (headers.get("Black") or "").lower() == uname:
            focus_color = chess.BLACK

    board = game.board()
    candidates = []
    ply = 0
    for move in game.mainline_moves():
        ply += 1
        side_to_move = board.turn
        fen_before = board.fen()
        san = board.san(move)
        move_number = (ply - 1) // 2 + 1
        played_uci = move.uci()

        if side_to_move == focus_color:
            after_board = board.copy()
            after_board.push(move)
            candidates.append(
                {
                    "gameTag": headers.get("Event"),
                    "fen": fen_before,
                    "fenAfterPlayed": after_board.fen(),
                    "sideToMove": "w" if side_to_move == chess.WHITE else "b",
                    "uci": played_uci,
                    "san": san,
                    "ply": ply,
                    "moveNumber": move_number,
                }
            )
        board.push(move)

    # Sample up to 15 candidates per game to keep response times sane
    sampled = candidates
    if len(candidates) > 15:
        step = max(1, len(candidates) // 15)
        sampled = candidates[::step][:15]

    evaluated = []
    for c in sampled:
        try:
            pre = await engines.eval_fen(c["fen"], movetime_ms)
            if pre.eval_cp is None and pre.eval_mate is None:
                continue
            aft = await engines.eval_fen(c["fenAfterPlayed"], movetime_ms)
            if aft.eval_cp is None and aft.eval_mate is None:
                continue

            pre_cp_raw = pre.eval_cp if pre.eval_cp is not None else _mate_to_cp(pre.eval_mate)
            after_cp_raw = aft.eval_cp if aft.eval_cp is not None else _mate_to_cp(aft.eval_mate)
            if pre_cp_raw is None or after_cp_raw is None:
                continue

            pre_eval_cp = pre_cp_raw
            best_eval_cp = pre_eval_cp
            played_eval_cp = -after_cp_raw  # flip sign: hero POV
            eval_gap_cp = best_eval_cp - played_eval_cp
            abs_gap = abs(eval_gap_cp)

            heuristic_difficulty = max(0, min(4000, abs_gap + max(0, best_eval_cp)))
            is_mate = 1 if pre.eval_mate is not None else 0

            pv_moves = pre.pv or []
            solution_moves = pv_moves[:6] if pv_moves else [c["uci"]]

            evaluated.append(
                {
                    "fen": c["fen"],
                    "sideToMove": c["sideToMove"],
                    "uci": c["uci"],
                    "san": c["san"],
                    "ply": c["ply"],
                    "moveNumber": c["moveNumber"],
                    "source_event": c["gameTag"],
                    "pre_eval_cp": pre_eval_cp,
                    "best_eval_cp": best_eval_cp,
                    "played_eval_cp": played_eval_cp,
                    "eval_gap_cp": eval_gap_cp,
                    "heuristic_difficulty": heuristic_difficulty,
                    "is_mate": is_mate,
                    "solutionMoves": solution_moves,
                }
            )
        except Exception as e:
            log.error("eval failed for game %s move %s (%s): %s", headers.get("Event"), c["san"], c["uci"], e)

    log.info(
        "[from-user] game %s: candidates=%d, evaluated=%d",
        headers.get("Event"), len(candidates), len(evaluated),
    )

    if not evaluated:
        return []

    BIG_GAP_CP = 60  # ~0.6 pawns
    filtered = [p for p in evaluated if p.get("eval_gap_cp") is not None and p["eval_gap_cp"] >= BIG_GAP_CP]

    log.info("[from-user] game %s: filtered=%d (gap >= %d)", headers.get("Event"), len(filtered), BIG_GAP_CP)

    if not filtered:
        return []

    if len(filtered) > max_puzzles_per_game:
        filtered = filtered[:max_puzzles_per_game]

    return filtered


def extract_solution_moves(p: dict) -> list[str]:
    """Mirrors extractSolutionMoves(): pull a UCI move list out of a puzzle
    dict from whichever field it happens to be stored in."""
    raw = p.get("solution_moves")
    if raw:
        try:
            arr = json.loads(raw)
            if isinstance(arr, list) and arr:
                return arr
        except (json.JSONDecodeError, TypeError):
            log.warning("[ML] bad solution_moves JSON: %s", raw)

    if isinstance(p.get("solutionMoves"), list) and p["solutionMoves"]:
        return p["solutionMoves"]
    if isinstance(p.get("moves"), list) and p["moves"]:
        return p["moves"]
    if p.get("uci"):
        return [p["uci"]]
    return []


async def build_user_recent_puzzles_ml(
    username: str,
    max_games: int = 15,
    max_puzzles: int = 200,
    movetime_ms: int = 60,
) -> list[dict]:
    """Mirrors buildUserRecentPuzzlesML(): pull a user's recent games,
    generate blunder-based puzzle candidates from each, then rank with the
    ML scorer."""
    data = await get_recent_games(username, max_games)
    games = data.get("games") or []
    if not games:
        return []

    sorted_games = sorted(
        (g for g in games if g.get("pgn")),
        key=lambda g: g.get("end_time") or 0,
        reverse=True,
    )
    selected = sorted_games[:max_games]

    all_puzzles: list[dict] = []
    for g in selected:
        try:
            puzzles = await build_eval_puzzles_from_pgn(
                pgn=g["pgn"],
                username=username,
                movetime_ms=movetime_ms,
                max_puzzles_per_game=50,
            )
            log.info("[from-user] game id=%s, got %d puzzles", g["id"], len(puzzles))
            for p in puzzles:
                p["source_game_id"] = g["id"]
                p["time_control"] = g.get("time_control")
                p["time_class"] = g.get("time_class")
                p["rated"] = bool(g.get("rated"))
            all_puzzles.extend(puzzles)
        except Exception as e:
            log.error("[from-user] failed on game %s: %s", g.get("id"), e)

    log.info("[from-user] total puzzles before ML: %d", len(all_puzzles))
    if not all_puzzles:
        return []

    scored, used_fallback = score_puzzles(all_puzzles)
    thresh = 0.05 if used_fallback else 0.1
    ml_puzzles = [p for p in scored if p.get("ml_score") is not None and p["ml_score"] >= thresh]

    log.info(
        "[from-user] ML accepted %d / %d candidates (threshold=%s)",
        len(ml_puzzles), len(scored), thresh,
    )

    ml_puzzles.sort(key=lambda p: p.get("ml_score") or 0, reverse=True)
    if len(ml_puzzles) > max_puzzles:
        ml_puzzles = ml_puzzles[:max_puzzles]

    normalized = []
    for p in ml_puzzles:
        solution_moves = extract_solution_moves(p)
        normalized.append(
            {
                "fen": p.get("fen"),
                "sideToMove": p.get("sideToMove") or p.get("side_to_move") or "w",
                "uci": p.get("uci"),
                "san": p.get("san"),
                "ply": p.get("ply"),
                "moveNumber": p.get("moveNumber") or p.get("move_number"),
                "pre_eval_cp": p.get("pre_eval_cp"),
                "best_eval_cp": p.get("best_eval_cp"),
                "played_eval_cp": p.get("played_eval_cp"),
                "eval_gap_cp": p.get("eval_gap_cp"),
                "heuristic_difficulty": p.get("heuristic_difficulty"),
                "is_mate": p.get("is_mate"),
                "source_event": p.get("source_event"),
                "source_game_id": p.get("source_game_id"),
                "time_control": p.get("time_control"),
                "time_class": p.get("time_class"),
                "rated": bool(p.get("rated")),
                "ml_score": p.get("ml_score"),
                "moves": solution_moves,
                "solutionMoves": solution_moves,
            }
        )

    return normalized


async def build_puzzles_from_pgn_with_eval(
    pgn: str,
    username: str | None = None,
    max_puzzles: int = 12,
    movetime_ms: int = 80,
) -> list[dict]:
    """Mirrors buildPuzzlesFromPGNWithEval(): single-game version with a
    higher eval-gap threshold (150cp) used by /puzzles/from-game."""
    game = _load_pgn(pgn)
    if game is None:
        raise ValueError("bad PGN")

    headers = game.headers
    uname = username.lower() if username else None
    focus_color = chess.WHITE
    if uname:
        if (headers.get("White") or "").lower() == uname:
            focus_color = chess.WHITE
        elif (headers.get("Black") or "").lower() == uname:
            focus_color = chess.BLACK

    board = game.board()
    candidates = []
    ply = 0
    for move in game.mainline_moves():
        ply += 1
        side_to_move = board.turn
        fen_before = board.fen()
        san = board.san(move)
        move_number = (ply - 1) // 2 + 1

        if side_to_move == focus_color:
            after_board = board.copy()
            after_board.push(move)
            candidates.append(
                {
                    "id": ply - 1,
                    "fen": fen_before,
                    "sideToMove": "w" if side_to_move == chess.WHITE else "b",
                    "uci": move.uci(),
                    "san": san,
                    "ply": ply,
                    "moveNumber": move_number,
                    "fenAfterPlayed": after_board.fen(),
                }
            )
        board.push(move)

    evaluated = []
    for c in candidates:
        try:
            pre = await engines.eval_fen(c["fen"], movetime_ms)
            if pre.eval_cp is None and pre.eval_mate is None:
                continue
            aft = await engines.eval_fen(c["fenAfterPlayed"], movetime_ms)
            if aft.eval_cp is None and aft.eval_mate is None:
                continue

            pre_cp_raw = pre.eval_cp if pre.eval_cp is not None else _mate_to_cp(pre.eval_mate)
            after_cp_raw = aft.eval_cp if aft.eval_cp is not None else _mate_to_cp(aft.eval_mate)
            if pre_cp_raw is None or after_cp_raw is None:
                continue

            pre_eval_cp = pre_cp_raw
            best_eval_cp = pre_eval_cp
            played_eval_cp = -after_cp_raw
            eval_gap_cp = best_eval_cp - played_eval_cp
            abs_gap = abs(eval_gap_cp)
            heuristic_difficulty = max(0, min(4000, abs_gap + max(0, best_eval_cp)))
            is_mate = 1 if pre.eval_mate is not None else 0

            pv_moves = pre.pv or []
            solution_moves = pv_moves[:6] if pv_moves else [c["uci"]]

            evaluated.append(
                {
                    **c,
                    "pre_eval_cp": pre_eval_cp,
                    "best_eval_cp": best_eval_cp,
                    "played_eval_cp": played_eval_cp,
                    "eval_gap_cp": eval_gap_cp,
                    "heuristic_difficulty": heuristic_difficulty,
                    "is_mate": is_mate,
                    "solutionMoves": solution_moves,
                    "moves": solution_moves,
                }
            )
        except Exception as e:
            log.error("[from-game eval] failed for ply %s: %s", c["ply"], e)

    filtered = [p for p in evaluated if p.get("eval_gap_cp") is not None and p["eval_gap_cp"] >= 150]
    if not filtered:
        return []

    scored, _used_fallback = score_puzzles(filtered)
    scored.sort(key=lambda p: p.get("ml_score") or 0, reverse=True)
    return scored[:max_puzzles]


def puzzle_row_to_json(row) -> dict:
    """Mirrors puzzleRowToJson() for the /puzzles/{daily,random} DB-backed
    variants (currently unused by the active routes, kept for parity)."""
    try:
        moves = json.loads(row["solution_moves"] or "[]")
    except (json.JSONDecodeError, TypeError):
        moves = []

    themes = ["engine-generated", "mate" if row["is_mate"] else "tactic"]
    if row["source_game"]:
        themes.append("from-self-play")

    return {
        "id": row["id"],
        "fen": row["fen"],
        "moves": moves,
        "rating": round(row["heuristic_difficulty"]) if row["heuristic_difficulty"] else None,
        "themes": themes,
    }
