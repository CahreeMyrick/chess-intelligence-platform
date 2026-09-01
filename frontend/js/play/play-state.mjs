import { ChessPosition } from '../shared/chess-position.mjs';

export const GameLifecycle = Object.freeze({
  IDLE: 'idle',
  ACTIVE: 'active',
  FINISHED: 'finished',
});

/**
 * Aggregate Root for Play-page client state.
 * Controllers mutate this object; views only read snapshots passed to them.
 */
export class PlayState {
  constructor() {
    this.sessionVersion = 0;
    this.resetToIdle();
  }

  resetToIdle() {
    this.position = ChessPosition.standard();
    this.moves = [];
    this.lifecycle = GameLifecycle.IDLE;
    this.gameId = null;
    this.humanColor = 'w';
    this.whiteAtBottom = true;
    this.hintMove = null;
    this.inputLocked = false;
    this.isThinking = false;
    this.result = null;
    this.reason = null;
    this.pgn = null;
  }

  invalidateSession() {
    this.sessionVersion += 1;
    this.inputLocked = true;
  }

  start({ gameId, humanColor }) {
    this.sessionVersion += 1;
    this.position = ChessPosition.standard();
    this.moves = [];
    this.lifecycle = GameLifecycle.ACTIVE;
    this.gameId = gameId;
    this.humanColor = humanColor;
    this.whiteAtBottom = humanColor === 'w';
    this.hintMove = null;
    this.inputLocked = false;
    this.isThinking = false;
    this.result = null;
    this.reason = null;
    this.pgn = null;
  }

  finish({ result = '*', reason = null, pgn = null } = {}) {
    this.sessionVersion += 1;
    this.lifecycle = GameLifecycle.FINISHED;
    this.inputLocked = true;
    this.isThinking = false;
    this.result = result;
    this.reason = reason;
    this.pgn = pgn;
  }

  get isActive() {
    return this.lifecycle === GameLifecycle.ACTIVE;
  }

  createMemento() {
    return {
      position: this.position.clone(),
      moves: [...this.moves],
      hintMove: this.hintMove,
      inputLocked: this.inputLocked,
    };
  }

  restore(memento) {
    this.position = memento.position.clone();
    this.moves = [...memento.moves];
    this.hintMove = memento.hintMove;
    this.inputLocked = memento.inputLocked;
  }
}
