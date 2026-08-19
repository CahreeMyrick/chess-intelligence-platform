#!/usr/bin/env python3
"""Extract shared chess helpers from the Ichigo Play and Puzzles pages.

Run from the repository root:
    python3 tools/refactor_frontend.py
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

ROOT = Path.cwd()
PUBLIC = ROOT / "public"
PLAY_HTML = PUBLIC / "index.html"
PLAY_JS_OLD = PUBLIC / "js" / "play.js"
PLAY_JS_NEW = PUBLIC / "js" / "play" / "play.js"
PUZZLES_HTML = PUBLIC / "puzzles.html"
PUZZLES_JS = PUBLIC / "js" / "puzzles" / "puzzles.js"
COMMON_SOURCE = Path(__file__).resolve().parents[1] / "public" / "js" / "common" / "chess-utils.js"
COMMON_DEST = PUBLIC / "js" / "common" / "chess-utils.js"

IMPORT = '''import {
  boardArrayToPosition,
  coordinatesToSquare,
  createStartingBoard,
  parseFen,
  parseSquare,
} from "../common/chess-utils.js";\n\n'''


def backup(path: Path) -> None:
    backup_path = path.with_suffix(path.suffix + ".before-shared-utils")
    if not backup_path.exists():
        shutil.copy2(path, backup_path)


def replace_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"Could not uniquely patch {label}; matched {count} times")
    return updated


def refactor_play() -> None:
    source_path = PLAY_JS_OLD if PLAY_JS_OLD.exists() else PLAY_JS_NEW
    if not source_path.exists():
        raise FileNotFoundError("Expected public/js/play.js or public/js/play/play.js")

    backup(source_path)
    text = source_path.read_text()

    if not text.startswith("import {"):
        text = IMPORT + text

    text = replace_once(
        text,
        r"\n\s*function setupStartBoardArray\(\) \{.*?\n\s*\}\n\n\s*function rc2sq\(x\).*?\n\s*function parseSq\(id\).*?\n\n\s*function pieceToBoardJs\(p\) \{.*?\n\s*\}\n\n\s*function boardArrayToPosition\(\) \{.*?\n\s*\}\n",
        "\n",
        "Play shared helper block",
    )

    text = text.replace("setupStartBoardArray();", "boardArray = createStartingBoard();")
    text = text.replace("board.position(boardArrayToPosition(), false);", "board.position(boardArrayToPosition(boardArray), false);")
    text = text.replace("parseSq(", "parseSquare(")
    text = text.replace("rc2sq(", "coordinatesToSquare(")
    text = re.sub(r"\.r\b", ".row", text)
    text = re.sub(r"\.c\b", ".col", text)
    # Restore piece model property names; coordinates use row/col, pieces stay color/type.
    text = text.replace("moving.type", "moving.t").replace("moving.color", "moving.c")
    text = text.replace("targetPiece.color", "targetPiece.c")
    text = text.replace(".type==='", ".t==='").replace(".type !==", ".t !==")
    text = text.replace(".color==='", ".c==='").replace(".color!==", ".c!==")
    # Starting board now uses descriptive piece keys, so normalize it to the existing page model.
    text = text.replace(
        "boardArray = createStartingBoard();",
        "boardArray = createStartingBoard().map(rank => rank.map(piece => piece ? ({ c: piece.color, t: piece.type }) : null));",
    )

    PLAY_JS_NEW.parent.mkdir(parents=True, exist_ok=True)
    PLAY_JS_NEW.write_text(text)
    if source_path != PLAY_JS_NEW:
        source_path.unlink()

    backup(PLAY_HTML)
    html = PLAY_HTML.read_text()
    html = html.replace('<script src="./js/play.js"></script>', '<script type="module" src="./js/play/play.js"></script>')
    html = html.replace('<script src="/js/play.js"></script>', '<script type="module" src="/js/play/play.js"></script>')
    PLAY_HTML.write_text(html)


def extract_puzzles_script(html: str) -> tuple[str, str]:
    matches = list(re.finditer(r"<script(?:\s+[^>]*)?>(.*?)</script>", html, flags=re.S | re.I))
    inline = [m for m in matches if "src=" not in m.group(0).split(">", 1)[0].lower() and m.group(1).strip()]
    if not inline:
        raise RuntimeError("No non-empty inline script found in puzzles.html")
    match = inline[-1]
    new_html = html[: match.start()] + '<script type="module" src="./js/puzzles/puzzles.js"></script>' + html[match.end() :]
    return new_html, match.group(1).strip() + "\n"


def refactor_puzzles() -> None:
    if not PUZZLES_HTML.exists():
        raise FileNotFoundError("Expected public/puzzles.html")

    backup(PUZZLES_HTML)
    html = PUZZLES_HTML.read_text()
    html, script = extract_puzzles_script(html)

    script = IMPORT + script
    script = replace_once(
        script,
        r"\n\s*const files = 'abcdefgh';.*?\n\s*function boardArrayToPosition\(\) \{.*?\n\s*\}\n",
        "\n",
        "Puzzles coordinate and position helpers",
    )

    # Replace the page-specific FEN parser while preserving its UI side effects.
    fen_replacement = '''
  function parseFEN(fen) {
    const parsed = parseFen(fen);
    initSide = parsed.activeColor;
    boardArray = parsed.boardArray.map(rank =>
      rank.map(piece => piece ? ({ c: piece.color, t: piece.type }) : null)
    );
    turn = initSide;
    lastFromSq = null;
    lastToSq = null;
    selectedSq = null;
    setTurnPill();
    recomputeOrientation();
    if (board) board.orientation(whiteAtBottom ? 'white' : 'black');
  }
'''
    script = replace_once(
        script,
        r"\n\s*function parseFEN\(fen\) \{.*?\n\s*\}\n\n\s*/\* ═+\n\s*Move logic",
        fen_replacement + "\n  /* ═══════════════════════════════════════\n     Move logic",
        "Puzzles parseFEN",
    )

    script = script.replace("board.position(boardArrayToPosition(), false);", "board.position(boardArrayToPosition(boardArray), false);")
    script = script.replace("parseSq(", "parseSquare(")
    script = script.replace("rc2sq(", "coordinatesToSquare(")
    script = re.sub(r"\.r\b", ".row", script)
    script = re.sub(r"\.c\b", ".col", script)
    # Restore the existing compact piece keys after coordinate renaming.
    script = script.replace("moving.type", "moving.t").replace("moving.color", "moving.c")
    script = script.replace("dest.color", "dest.c")
    script = script.replace(".type==='", ".t==='").replace(".type !==", ".t !==")
    script = script.replace(".color==='", ".c==='").replace(".color!==", ".c!==")

    PUZZLES_JS.parent.mkdir(parents=True, exist_ok=True)
    PUZZLES_JS.write_text(script)
    PUZZLES_HTML.write_text(html)


def main() -> None:
    if not PUBLIC.exists():
        raise SystemExit("Run this script from the chess repository root")

    COMMON_DEST.parent.mkdir(parents=True, exist_ok=True)
    # When run from the distributed bundle, copy the module into the target repo.
    if COMMON_SOURCE.resolve() != COMMON_DEST.resolve():
        shutil.copy2(COMMON_SOURCE, COMMON_DEST)

    refactor_play()
    refactor_puzzles()
    print("Shared chess utilities refactor complete.")
    print("Backups use the suffix: .before-shared-utils")


if __name__ == "__main__":
    main()
