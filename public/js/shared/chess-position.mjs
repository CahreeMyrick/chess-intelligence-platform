import { ChessDataError } from './errors.mjs';

const FILES = 'abcdefgh';
const VALID_PIECES = new Set(['p', 'n', 'b', 'r', 'q', 'k']);
const VALID_COLORS = new Set(['w', 'b']);
const VALID_PROMOTIONS = new Set(['q', 'r', 'b', 'n']);
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function emptyBoard() {
  return Array.from({ length: 8 }, () => Array(8).fill(null));
}

function cloneBoard(board) {
  return board.map((row) => row.map((piece) => (piece ? { ...piece } : null)));
}

function opposite(color) {
  return color === 'w' ? 'b' : 'w';
}

function normalizeCastlingRights(value) {
  if (!value || value === '-') return '';
  const normalized = [...new Set(String(value).split(''))]
    .filter((right) => 'KQkq'.includes(right))
    .join('');
  return 'KQkq'.split('').filter((right) => normalized.includes(right)).join('');
}

export function isSquare(value) {
  return typeof value === 'string' && /^[a-h][1-8]$/.test(value);
}

export function squareToCoordinates(square) {
  if (!isSquare(square)) {
    throw new ChessDataError(`Invalid chess square: ${String(square)}`, {
      code: 'INVALID_SQUARE',
      details: { square },
    });
  }
  return {
    row: 8 - Number(square[1]),
    column: FILES.indexOf(square[0]),
  };
}

export function coordinatesToSquare({ row, column }) {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || row > 7 || column < 0 || column > 7) {
    throw new ChessDataError(`Invalid coordinates: row=${row}, column=${column}`, {
      code: 'INVALID_COORDINATES',
      details: { row, column },
    });
  }
  return `${FILES[column]}${8 - row}`;
}

export function parseUci(uci) {
  const normalized = String(uci ?? '').trim().toLowerCase();
  const match = normalized.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  if (!match) {
    throw new ChessDataError(`Invalid UCI move: ${String(uci)}`, {
      code: 'INVALID_UCI',
      details: { uci },
    });
  }
  return {
    uci: normalized,
    from: match[1],
    to: match[2],
    promotion: match[3] ?? null,
  };
}

/**
 * Domain Model: a serializable chess-position projection used by the UI.
 *
 * Important boundary:
 * This model applies trusted UCI moves and maintains board metadata, but it is
 * intentionally not a complete legal-move engine. The server is authoritative
 * for Play. Puzzle moves are exact server-provided solution moves.
 */
export class ChessPosition {
  constructor({
    board = emptyBoard(),
    sideToMove = 'w',
    castlingRights = '',
    enPassantSquare = null,
    halfmoveClock = 0,
    fullmoveNumber = 1,
  } = {}) {
    if (!VALID_COLORS.has(sideToMove)) {
      throw new ChessDataError(`Invalid side to move: ${sideToMove}`, { code: 'INVALID_SIDE' });
    }
    this.board = cloneBoard(board);
    this.sideToMove = sideToMove;
    this.castlingRights = normalizeCastlingRights(castlingRights);
    this.enPassantSquare = enPassantSquare === '-' ? null : enPassantSquare;
    if (this.enPassantSquare !== null && !isSquare(this.enPassantSquare)) {
      throw new ChessDataError(`Invalid en-passant square: ${this.enPassantSquare}`, {
        code: 'INVALID_EN_PASSANT_SQUARE',
      });
    }
    this.halfmoveClock = Number.isInteger(halfmoveClock) && halfmoveClock >= 0 ? halfmoveClock : 0;
    this.fullmoveNumber = Number.isInteger(fullmoveNumber) && fullmoveNumber >= 1 ? fullmoveNumber : 1;
  }

  static standard() {
    return ChessPosition.fromFen(START_FEN);
  }

  static fromFen(fen) {
    if (typeof fen !== 'string' || !fen.trim()) {
      throw new ChessDataError('FEN must be a non-empty string.', { code: 'INVALID_FEN' });
    }

    const parts = fen.trim().split(/\s+/);
    if (parts.length < 1 || parts.length > 6) {
      throw new ChessDataError(`Invalid FEN field count: ${parts.length}`, { code: 'INVALID_FEN' });
    }

    const [placement, side = 'w', castling = '-', enPassant = '-', halfmove = '0', fullmove = '1'] = parts;
    const ranks = placement.split('/');
    if (ranks.length !== 8) {
      throw new ChessDataError('FEN placement must contain exactly eight ranks.', { code: 'INVALID_FEN' });
    }

    const board = emptyBoard();
    ranks.forEach((rank, row) => {
      let column = 0;
      for (const token of rank) {
        if (/^[1-8]$/.test(token)) {
          column += Number(token);
          continue;
        }
        const type = token.toLowerCase();
        if (!VALID_PIECES.has(type) || column > 7) {
          throw new ChessDataError(`Invalid FEN piece token: ${token}`, { code: 'INVALID_FEN' });
        }
        board[row][column] = {
          color: token === token.toUpperCase() ? 'w' : 'b',
          type,
        };
        column += 1;
      }
      if (column !== 8) {
        throw new ChessDataError(`FEN rank ${8 - row} expands to ${column} files instead of 8.`, {
          code: 'INVALID_FEN',
        });
      }
    });

    const halfmoveClock = Number.parseInt(halfmove, 10);
    const fullmoveNumber = Number.parseInt(fullmove, 10);
    const castlingValid = castling === '-' || (/^[KQkq]+$/.test(castling) && new Set(castling).size === castling.length);
    const enPassantValid = enPassant === '-' || /^[a-h][36]$/.test(enPassant);
    if (
      !VALID_COLORS.has(side)
      || !castlingValid
      || !enPassantValid
      || !Number.isInteger(halfmoveClock)
      || halfmoveClock < 0
      || !Number.isInteger(fullmoveNumber)
      || fullmoveNumber < 1
    ) {
      throw new ChessDataError('FEN metadata is invalid.', { code: 'INVALID_FEN' });
    }

    return new ChessPosition({
      board,
      sideToMove: side,
      castlingRights: castling,
      enPassantSquare: enPassant === '-' ? null : enPassant,
      halfmoveClock,
      fullmoveNumber,
    });
  }

  clone() {
    return new ChessPosition({
      board: this.board,
      sideToMove: this.sideToMove,
      castlingRights: this.castlingRights,
      enPassantSquare: this.enPassantSquare,
      halfmoveClock: this.halfmoveClock,
      fullmoveNumber: this.fullmoveNumber,
    });
  }

  pieceAt(square) {
    const { row, column } = squareToCoordinates(square);
    const piece = this.board[row][column];
    return piece ? { ...piece } : null;
  }

  toChessboardPosition() {
    const result = {};
    const boardCodes = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        const piece = this.board[row][column];
        if (piece) {
          result[coordinatesToSquare({ row, column })] = `${piece.color}${boardCodes[piece.type]}`;
        }
      }
    }
    return result;
  }

  toFen() {
    const ranks = this.board.map((row) => {
      let text = '';
      let empty = 0;
      for (const piece of row) {
        if (!piece) {
          empty += 1;
          continue;
        }
        if (empty) {
          text += String(empty);
          empty = 0;
        }
        const token = piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
        text += token;
      }
      if (empty) text += String(empty);
      return text;
    });

    return [
      ranks.join('/'),
      this.sideToMove,
      this.castlingRights || '-',
      this.enPassantSquare || '-',
      this.halfmoveClock,
      this.fullmoveNumber,
    ].join(' ');
  }

  /**
   * Applies a structurally valid trusted UCI move and mutates this position.
   * Returns a MoveRecord used by views and logs.
   */
  applyUci(uci, { enforceTurn = true } = {}) {
    const parsed = parseUci(uci);
    const from = squareToCoordinates(parsed.from);
    const to = squareToCoordinates(parsed.to);
    const moving = this.board[from.row][from.column];
    const destination = this.board[to.row][to.column];

    if (!moving) {
      throw new ChessDataError(`No piece exists on ${parsed.from}.`, {
        code: 'EMPTY_SOURCE',
        details: parsed,
      });
    }
    if (enforceTurn && moving.color !== this.sideToMove) {
      throw new ChessDataError(`Expected ${this.sideToMove} to move, but ${parsed.from} contains ${moving.color}.`, {
        code: 'WRONG_TURN',
        details: parsed,
      });
    }
    if (destination?.color === moving.color) {
      throw new ChessDataError(`${parsed.to} contains a friendly piece.`, {
        code: 'FRIENDLY_DESTINATION',
        details: parsed,
      });
    }
    if (parsed.promotion && moving.type !== 'p') {
      throw new ChessDataError('Only pawns may promote.', { code: 'INVALID_PROMOTION', details: parsed });
    }
    if (parsed.promotion && !VALID_PROMOTIONS.has(parsed.promotion)) {
      throw new ChessDataError(`Unsupported promotion: ${parsed.promotion}`, {
        code: 'INVALID_PROMOTION',
        details: parsed,
      });
    }

    const previousEnPassant = this.enPassantSquare;
    const isPawn = moving.type === 'p';
    const reachesPromotionRank = isPawn && (to.row === 0 || to.row === 7);
    if (reachesPromotionRank && !parsed.promotion) {
      throw new ChessDataError('A pawn move to the last rank requires a UCI promotion suffix.', {
        code: 'MISSING_PROMOTION',
        details: parsed,
      });
    }
    if (parsed.promotion && !reachesPromotionRank) {
      throw new ChessDataError('A promotion suffix is only valid on the last rank.', {
        code: 'INVALID_PROMOTION_RANK',
        details: parsed,
      });
    }

    const castling = moving.type === 'k' && Math.abs(to.column - from.column) === 2;
    let castlingRook = null;
    let castlingRookFromColumn = null;
    let castlingRookToColumn = null;
    if (castling) {
      const kingSide = to.column === 6;
      if (!kingSide && to.column !== 2) {
        throw new ChessDataError('Castling king destination must be the c-file or g-file.', {
          code: 'INVALID_CASTLING_DESTINATION',
          details: parsed,
        });
      }
      castlingRookFromColumn = kingSide ? 7 : 0;
      castlingRookToColumn = kingSide ? 5 : 3;
      castlingRook = this.board[from.row][castlingRookFromColumn];
      if (castlingRook?.type !== 'r' || castlingRook.color !== moving.color) {
        throw new ChessDataError('Castling move has no matching rook.', {
          code: 'INVALID_CASTLING_STATE',
          details: parsed,
        });
      }
    }

    const isCapture = Boolean(destination);
    let capturedPiece = destination ? { ...destination } : null;
    let capturedSquare = destination ? parsed.to : null;

    // En passant is recognized only when the destination equals the FEN/state
    // en-passant target. This corrects the original broad diagonal heuristic.
    if (isPawn && from.column !== to.column && !destination) {
      if (parsed.to !== previousEnPassant) {
        throw new ChessDataError('A pawn cannot move diagonally to an empty square unless en passant is available.', {
          code: 'INVALID_PAWN_DIAGONAL',
          details: parsed,
        });
      }
      const capturedRow = moving.color === 'w' ? to.row + 1 : to.row - 1;
      const candidate = this.board[capturedRow]?.[to.column] ?? null;
      if (candidate?.type !== 'p' || candidate.color === moving.color) {
        throw new ChessDataError('En-passant metadata does not match the board.', {
          code: 'INVALID_EN_PASSANT_STATE',
          details: parsed,
        });
      }
      capturedPiece = { ...candidate };
      capturedSquare = coordinatesToSquare({ row: capturedRow, column: to.column });
      this.board[capturedRow][to.column] = null;
    }

    this.board[to.row][to.column] = {
      color: moving.color,
      type: parsed.promotion ?? moving.type,
    };
    this.board[from.row][from.column] = null;

    // Trusted castling projection: the rook was validated before mutation.
    if (castling) {
      this.board[from.row][castlingRookToColumn] = { ...castlingRook };
      this.board[from.row][castlingRookFromColumn] = null;
    }

    this.#updateCastlingRights(moving, parsed.from, parsed.to, capturedPiece, capturedSquare);

    this.enPassantSquare = null;
    if (isPawn && from.column === to.column && Math.abs(to.row - from.row) === 2) {
      this.enPassantSquare = coordinatesToSquare({
        row: (from.row + to.row) / 2,
        column: from.column,
      });
    }

    this.halfmoveClock = isPawn || isCapture || capturedPiece ? 0 : this.halfmoveClock + 1;
    if (moving.color === 'b') this.fullmoveNumber += 1;
    this.sideToMove = opposite(this.sideToMove);

    return {
      ...parsed,
      movingPiece: { ...moving },
      capturedPiece,
      capturedSquare,
      sideToMove: this.sideToMove,
      fen: this.toFen(),
    };
  }

  #updateCastlingRights(moving, fromSquare, toSquare, capturedPiece, capturedSquare) {
    const remove = new Set();
    if (moving.type === 'k') {
      remove.add(moving.color === 'w' ? 'K' : 'k');
      remove.add(moving.color === 'w' ? 'Q' : 'q');
    }
    if (moving.type === 'r') {
      if (fromSquare === 'h1') remove.add('K');
      if (fromSquare === 'a1') remove.add('Q');
      if (fromSquare === 'h8') remove.add('k');
      if (fromSquare === 'a8') remove.add('q');
    }
    if (capturedPiece?.type === 'r') {
      if (capturedSquare === 'h1') remove.add('K');
      if (capturedSquare === 'a1') remove.add('Q');
      if (capturedSquare === 'h8') remove.add('k');
      if (capturedSquare === 'a8') remove.add('q');
    }
    this.castlingRights = [...this.castlingRights].filter((right) => !remove.has(right)).join('');
  }
}

export { START_FEN };
