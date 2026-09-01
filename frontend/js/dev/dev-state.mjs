import { ChessPosition } from '../shared/chess-position.mjs';

/**
 * State container for the development chess environment.
 * Supports Player vs Player (PvP) and Player vs Engine (PvEngine) modes,
 * timed and untimed matches, undo history, and custom FEN setups.
 */
export class DevState {
  constructor() {
    this.resetToDefaults();
  }

  resetToDefaults() {
    this.gameId = null;
    this.mode = 'pvp'; // 'pvp' | 'pve'
    this.timerMode = 'none'; // 'none' | 'timed'
    this.timeControl = { initialMinutes: 5, incrementSeconds: 0 };
    this.humanColor = 'w'; // 'w' | 'b' (used in PvE mode)
    this.engineDepth = 2; // default search depth
    this.engineMovetimeMs = 500; // default engine move time in ms
    this.whiteAtBottom = true;
    this.autoFlipPvP = false; // in PvP mode, rotate board after each move

    this.position = ChessPosition.standard();
    this.moves = []; // list of UCI strings
    this.history = []; // stack of { fen, moves, lastMove } for undo

    this.isActive = false;
    this.isThinking = false;
    this.inputLocked = false;
    this.lastMove = null;
    this.hintMove = null;
    this.statusText = 'Ready to play';
    this.gameResult = null; // null | 'checkmate' | 'draw' | 'timeout' | 'resigned'
    this.winner = null; // null | 'w' | 'b' | 'draw'
  }

  start({
    mode = this.mode,
    timerMode = this.timerMode,
    timeControl = this.timeControl,
    humanColor = this.humanColor,
    initialFen = null,
    engineDepth = this.engineDepth,
    engineMovetimeMs = this.engineMovetimeMs,
    autoFlipPvP = this.autoFlipPvP,
  } = {}) {
    this.mode = mode;
    this.timerMode = timerMode;
    this.timeControl = { ...timeControl };
    this.humanColor = humanColor;
    this.engineDepth = engineDepth;
    this.engineMovetimeMs = engineMovetimeMs;
    this.autoFlipPvP = autoFlipPvP;

    if (initialFen) {
      this.position = ChessPosition.fromFen(initialFen);
    } else {
      this.position = ChessPosition.standard();
    }

    this.moves = [];
    this.history = [
      {
        fen: this.position.toFen(),
        moves: [],
        lastMove: null,
      },
    ];

    this.whiteAtBottom = this.mode === 'pve' ? this.humanColor === 'w' : true;
    this.isActive = true;
    this.isThinking = false;
    this.inputLocked = false;
    this.lastMove = null;
    this.hintMove = null;
    this.gameResult = null;
    this.winner = null;
    this.statusText = this.buildInitialStatusText();
  }

  buildInitialStatusText() {
    if (this.mode === 'pvp') {
      return `PvP Game in progress (${this.timerMode === 'timed' ? `${this.timeControl.initialMinutes}m` : 'Untimed'}) — White to move`;
    }
    const sideName = this.humanColor === 'w' ? 'White' : 'Black';
    return `Playing as ${sideName} vs Ichigo Engine (${this.timerMode === 'timed' ? `${this.timeControl.initialMinutes}m` : 'Untimed'})`;
  }

  get sideToMove() {
    return this.position.sideToMove;
  }

  isHumanTurn() {
    if (!this.isActive) return false;
    if (this.mode === 'pvp') return true;
    return this.sideToMove === this.humanColor;
  }

  isEngineTurn() {
    if (!this.isActive) return false;
    if (this.mode !== 'pve') return false;
    return this.sideToMove !== this.humanColor;
  }

  createMemento() {
    return {
      position: this.position.clone(),
      moves: [...this.moves],
      lastMove: this.lastMove,
      hintMove: this.hintMove,
      isActive: this.isActive,
      isThinking: this.isThinking,
      inputLocked: this.inputLocked,
      statusText: this.statusText,
      gameResult: this.gameResult,
      winner: this.winner,
      whiteAtBottom: this.whiteAtBottom,
    };
  }

  restoreMemento(memento) {
    this.position = memento.position.clone();
    this.moves = [...memento.moves];
    this.lastMove = memento.lastMove;
    this.hintMove = memento.hintMove;
    this.isActive = memento.isActive;
    this.isThinking = memento.isThinking;
    this.inputLocked = memento.inputLocked;
    this.statusText = memento.statusText;
    this.gameResult = memento.gameResult;
    this.winner = memento.winner;
    this.whiteAtBottom = memento.whiteAtBottom;
  }

  recordMove(uci) {
    this.moves.push(uci);
    this.lastMove = uci;
    this.hintMove = null;
    this.history.push({
      fen: this.position.toFen(),
      moves: [...this.moves],
      lastMove: uci,
    });
  }

  undo() {
    if (this.history.length <= 1) return false;

    // In PvE mode, if it's human's turn, undo both engine and human moves (2 steps)
    const stepsToUndo = (this.mode === 'pve' && this.history.length >= 3) ? 2 : 1;

    for (let i = 0; i < stepsToUndo; i += 1) {
      if (this.history.length > 1) {
        this.history.pop();
      }
    }

    const previousState = this.history[this.history.length - 1];
    this.position = ChessPosition.fromFen(previousState.fen);
    this.moves = [...previousState.moves];
    this.lastMove = previousState.lastMove;
    this.hintMove = null;
    this.isActive = true;
    this.isThinking = false;
    this.inputLocked = false;
    this.gameResult = null;
    this.winner = null;
    this.statusText = `Undid move(s) — ${this.sideToMove === 'w' ? 'White' : 'Black'} to move`;
    return true;
  }

  finishGame({ result = 'ended', winner = null, message = '' } = {}) {
    this.isActive = false;
    this.inputLocked = true;
    this.gameResult = result;
    this.winner = winner;
    this.statusText = message || `Game Over: ${result}`;
  }
}
