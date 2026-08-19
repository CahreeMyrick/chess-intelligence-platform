"""
PGN / SAN / UCI helpers, using python-chess instead of chess.js.
Mirrors uciListToPgn, gameFromMoves, extractSANFromPGN, sanToUciArray.
"""
import datetime
import re
from typing import Optional

import chess
import chess.pgn

from .config import DEFAULT_SITE

UCI_MOVE_RE = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")


def board_from_moves(moves_uci: list[str]) -> Optional[chess.Board]:
    """Rebuild a board from a UCI move list; returns None on any illegal move
    (mirrors gameFromMoves)."""
    board = chess.Board()
    for u in moves_uci:
        try:
            move = chess.Move.from_uci(u)
        except ValueError:
            return None
        if move not in board.legal_moves:
            return None
        board.push(move)
    return board


def uci_list_to_pgn(
    moves_uci: list[str],
    headers: Optional[dict] = None,
    result: str = "*",
) -> str:
    """Mirrors uciListToPgn(): builds a PGN string from a list of UCI moves,
    stopping at the first illegal move (matching the original's `if (!ok) break`)."""
    headers = headers or {}
    board = chess.Board()
    game = chess.pgn.Game()
    node = game

    for uci in moves_uci:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            break
        if move not in board.legal_moves:
            break
        node = node.add_variation(move)
        board.push(move)

    game.headers["Event"] = headers.get("Event") or "Casual Game"
    game.headers["Site"] = headers.get("Site") or DEFAULT_SITE
    game.headers["Date"] = headers.get("Date") or datetime.date.today().isoformat()
    game.headers["Round"] = headers.get("Round") or "1"
    game.headers["White"] = headers.get("White") or "White"
    game.headers["Black"] = headers.get("Black") or "Black"
    game.headers["Result"] = result or "*"
    game.headers["TimeControl"] = headers.get("TimeControl") or "300+0"

    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
    return game.accept(exporter)


def extract_san_from_pgn(pgn_raw: str) -> str:
    """Strip PGN tag pairs and comments, leaving just the SAN move text.
    Mirrors extractSANFromPGN()."""
    text = str(pgn_raw or "").replace("\r\n", "\n")
    body = " ".join(
        line for line in text.split("\n") if not re.match(r"^\s*\[.*\]\s*$", line)
    )
    body = re.sub(r"\d+\.(\.\.)?", " ", body)
    body = re.sub(r"\b(1-0|0-1|1/2-1/2|\*)\b", " ", body)
    body = re.sub(r"\s*\{[^}]*\}\s*", " ", body)
    body = re.sub(r"\s+", " ", body).strip()
    return body


def san_to_uci_array(fen: str, san_string: str) -> list[str]:
    """Replay SAN moves from a starting FEN, returning UCI moves.
    Mirrors sanToUciArray(); raises ValueError on an illegal SAN token."""
    board = chess.Board(fen)
    tokens = [t for t in str(san_string or "").strip().split() if t]
    uci_moves: list[str] = []
    for san in tokens:
        try:
            move = board.parse_san(san)
        except ValueError as e:
            raise ValueError(f'SAN could not be applied: "{san}"') from e
        uci_moves.append(move.uci())
        board.push(move)
    return uci_moves


def build_solution_from_pv(fen: str, pv_moves_uci: list[str], max_plies: int = 5) -> list[str]:
    """Validate/replay a PV move list from a FEN, stopping at the first
    illegal move or once max_plies is reached. Mirrors buildSolutionFromPV()."""
    if not pv_moves_uci:
        return []
    board = chess.Board(fen)
    out: list[str] = []
    for mv in pv_moves_uci:
        mv = str(mv).lower()
        if len(mv) < 4:
            break
        try:
            move = chess.Move.from_uci(mv)
        except ValueError:
            break
        if move not in board.legal_moves:
            break
        board.push(move)
        out.append(mv)
        if len(out) >= max_plies:
            break
    return out


def clean_uci_moves(moves: list[str], limit: int = 512) -> list[str]:
    """Validate/normalize a raw list of candidate UCI moves the same way the
    Express /bestmove handler did (regex filter + lowercase + length cap)."""
    out = []
    for m in moves or []:
        if not isinstance(m, str):
            continue
        m = m.strip().lower()
        if UCI_MOVE_RE.match(m):
            out.append(m)
    return out[:limit]
