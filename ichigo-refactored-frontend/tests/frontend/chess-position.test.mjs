import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChessPosition,
  START_FEN,
  coordinatesToSquare,
  parseUci,
  squareToCoordinates,
} from '../../public/js/shared/chess-position.mjs';

function piece(position, square) {
  return position.pieceAt(square);
}

test('square coordinate conversion is reversible', () => {
  assert.deepEqual(squareToCoordinates('a8'), { row: 0, column: 0 });
  assert.deepEqual(squareToCoordinates('h1'), { row: 7, column: 7 });
  assert.equal(coordinatesToSquare({ row: 3, column: 4 }), 'e5');
});

test('UCI parser normalizes valid moves and rejects invalid moves', () => {
  assert.deepEqual(parseUci('E7E8Q'), { uci: 'e7e8q', from: 'e7', to: 'e8', promotion: 'q' });
  assert.throws(() => parseUci('e2-e4'), /Invalid UCI move/);
});

test('standard FEN round-trips', () => {
  const position = ChessPosition.standard();
  assert.equal(position.toFen(), START_FEN);
  assert.deepEqual(piece(position, 'e1'), { color: 'w', type: 'k' });
  assert.deepEqual(piece(position, 'a7'), { color: 'b', type: 'p' });
});

test('normal move updates board, side, clocks, and en-passant square', () => {
  const position = ChessPosition.standard();
  const record = position.applyUci('e2e4');
  assert.equal(piece(position, 'e2'), null);
  assert.deepEqual(piece(position, 'e4'), { color: 'w', type: 'p' });
  assert.equal(position.sideToMove, 'b');
  assert.equal(position.enPassantSquare, 'e3');
  assert.equal(position.halfmoveClock, 0);
  assert.equal(record.from, 'e2');
});

test('en passant removes only the pawn identified by position metadata', () => {
  const position = ChessPosition.standard();
  for (const move of ['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']) position.applyUci(move);
  assert.deepEqual(piece(position, 'd6'), { color: 'w', type: 'p' });
  assert.equal(piece(position, 'd5'), null);
  assert.equal(position.enPassantSquare, null);
});

test('diagonal pawn move to an empty non-en-passant square is rejected transactionally', () => {
  const position = ChessPosition.fromFen('8/8/8/4P3/8/8/8/4K2k w - - 0 1');
  const before = position.toFen();
  assert.throws(() => position.applyUci('e5d6'), /unless en passant is available/);
  assert.equal(position.toFen(), before);
});

test('castling moves the rook and removes only the moving side castling rights', () => {
  const position = ChessPosition.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  position.applyUci('e1g1');
  assert.deepEqual(piece(position, 'g1'), { color: 'w', type: 'k' });
  assert.deepEqual(piece(position, 'f1'), { color: 'w', type: 'r' });
  assert.equal(piece(position, 'h1'), null);
  assert.equal(position.castlingRights, 'kq');
});

test('invalid castling state does not partially mutate the position', () => {
  const position = ChessPosition.fromFen('4k3/8/8/8/8/8/8/4K3 w K - 0 1');
  const before = position.toFen();
  assert.throws(() => position.applyUci('e1g1'), /no matching rook/);
  assert.equal(position.toFen(), before);
});

test('promotion requires a suffix and updates the piece type', () => {
  const position = ChessPosition.fromFen('7k/P7/8/8/8/8/8/7K w - - 0 1');
  assert.throws(() => position.applyUci('a7a8'), /requires a UCI promotion suffix/);
  position.applyUci('a7a8n');
  assert.deepEqual(piece(position, 'a8'), { color: 'w', type: 'n' });
});

test('clone is independent from the original', () => {
  const original = ChessPosition.standard();
  const clone = original.clone();
  clone.applyUci('e2e4');
  assert.deepEqual(piece(original, 'e2'), { color: 'w', type: 'p' });
  assert.equal(piece(original, 'e4'), null);
});

test('malformed FEN is rejected', () => {
  assert.throws(() => ChessPosition.fromFen('8/8/8/8/8/8/8 w - - 0 1'), /eight ranks/);
  assert.throws(() => ChessPosition.fromFen('9/8/8/8/8/8/8/8 w - - 0 1'), /Invalid FEN piece token|expands/);
  assert.throws(() => ChessPosition.fromFen('8/8/8/8/8/8/8/8 w KK - 0 1'), /metadata is invalid/);
  assert.throws(() => ChessPosition.fromFen('8/8/8/8/8/8/8/8 w - e4 0 1'), /metadata is invalid/);
  assert.throws(() => ChessPosition.fromFen('8/8/8/8/8/8/8/8 w - - -1 1'), /metadata is invalid/);
});
