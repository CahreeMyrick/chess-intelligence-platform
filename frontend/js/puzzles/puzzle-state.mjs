import { ChessPosition } from '../shared/chess-position.mjs';

export const PuzzleSource = Object.freeze({
  DAILY: 'daily',
  RANDOM: 'random',
  FROM_GAMES: 'fromgames',
});

/** Aggregate Root for all puzzle-page state. */
export class PuzzleState {
  constructor() {
    this.position = ChessPosition.standard();
    this.startFen = null;
    this.solution = [];
    this.index = 0;
    this.initialSide = 'w';
    this.viewMode = 'side';
    this.whiteAtBottom = true;
    this.selectedSquare = null;
    this.lastMove = null;
    this.activeSource = PuzzleSource.DAILY;
    this.currentPuzzle = null;
    this.fromGamePuzzles = [];
    this.fromGameIndex = -1;
    this.fromGame = null;
    this.fromGameUsername = null;
    this.loading = false;
    this.validationError = null;
  }

  loadPuzzle({ fen, moves, metadata, validationError = null }) {
    this.position = ChessPosition.fromFen(fen);
    this.startFen = fen;
    this.solution = [...moves];
    this.index = 0;
    this.initialSide = this.position.sideToMove;
    this.selectedSquare = null;
    this.lastMove = null;
    this.currentPuzzle = { fen, moves: [...moves], metadata: { ...metadata }, validationError };
    this.validationError = validationError;
    this.recomputeOrientation();
  }

  resetCurrentPuzzle() {
    if (!this.startFen) return false;
    this.position = ChessPosition.fromFen(this.startFen);
    this.index = 0;
    this.initialSide = this.position.sideToMove;
    this.selectedSquare = null;
    this.lastMove = null;
    this.validationError = this.currentPuzzle?.validationError ?? null;
    this.recomputeOrientation();
    return true;
  }

  recomputeOrientation() {
    this.whiteAtBottom = this.viewMode === 'white' || this.initialSide === 'w';
  }

  get expectedMove() {
    return this.solution[this.index] ?? null;
  }

  get solved() {
    return this.solution.length > 0 && this.index >= this.solution.length;
  }
}
