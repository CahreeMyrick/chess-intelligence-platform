const FILES = "abcdefgh";
const PIECE_CODES = Object.freeze({
  p: "P",
  n: "N",
  b: "B",
  r: "R",
  q: "Q",
  k: "K",
});

export function parseSquare(square) {
  if (!/^[a-h][1-8]$/.test(square)) {
    throw new Error(`Invalid chess square: ${square}`);
  }

  return {
    row: 8 - Number(square[1]),
    col: square.charCodeAt(0) - 97,
  };
}

export function coordinatesToSquare({ row, col }) {
  if (!Number.isInteger(row) || row < 0 || row > 7 ||
      !Number.isInteger(col) || col < 0 || col > 7) {
    throw new Error(`Invalid board coordinates: row=${row}, col=${col}`);
  }

  return `${FILES[col]}${8 - row}`;
}

export function pieceToChessboardJs(piece) {
  if (!piece) return null;

  const code = PIECE_CODES[piece.type];
  if (!code || !["w", "b"].includes(piece.color)) {
    throw new Error(`Invalid piece: ${JSON.stringify(piece)}`);
  }

  return piece.color + code;
}

export function boardArrayToPosition(boardArray) {
  const position = {};

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = boardArray[row][col];
      if (!piece) continue;

      position[coordinatesToSquare({ row, col })] =
        pieceToChessboardJs(piece);
    }
  }

  return position;
}

export function createStartingBoard() {
  const backRank = (color) => [
    { color, type: "r" },
    { color, type: "n" },
    { color, type: "b" },
    { color, type: "q" },
    { color, type: "k" },
    { color, type: "b" },
    { color, type: "n" },
    { color, type: "r" },
  ];

  const pawns = (color) =>
    Array.from({ length: 8 }, () => ({ color, type: "p" }));
  const emptyRank = () => Array(8).fill(null);

  return [
    backRank("b"),
    pawns("b"),
    emptyRank(),
    emptyRank(),
    emptyRank(),
    emptyRank(),
    pawns("w"),
    backRank("w"),
  ];
}

export function parseFen(fen) {
  if (typeof fen !== "string" || !fen.trim()) {
    throw new Error("FEN must be a non-empty string");
  }

  const parts = fen.trim().split(/\s+/);
  const ranks = parts[0]?.split("/");
  const activeColor = parts[1] || "w";

  if (ranks?.length !== 8) {
    throw new Error(`Invalid FEN board: ${parts[0] || fen}`);
  }
  if (!["w", "b"].includes(activeColor)) {
    throw new Error(`Invalid FEN active color: ${activeColor}`);
  }

  const boardArray = Array.from({ length: 8 }, () => Array(8).fill(null));

  ranks.forEach((rank, row) => {
    let col = 0;

    for (const character of rank) {
      if (/^[1-8]$/.test(character)) {
        col += Number(character);
        continue;
      }

      const type = character.toLowerCase();
      if (!PIECE_CODES[type] || col > 7) {
        throw new Error(`Invalid FEN rank: ${rank}`);
      }

      boardArray[row][col] = {
        color: character === character.toLowerCase() ? "b" : "w",
        type,
      };
      col += 1;
    }

    if (col !== 8) {
      throw new Error(`FEN rank does not contain eight squares: ${rank}`);
    }
  });

  return {
    boardArray,
    activeColor,
    castling: parts[2] || "-",
    enPassant: parts[3] || "-",
    halfmoveClock: Number(parts[4] || 0),
    fullmoveNumber: Number(parts[5] || 1),
  };
}
