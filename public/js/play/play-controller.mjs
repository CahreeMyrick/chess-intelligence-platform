import { ChessPosition, parseUci } from '../shared/chess-position.mjs';
import { ChessDataError, ApiError } from '../shared/errors.mjs';

/**
 * Application Service / Controller.
 * Orchestrates state, domain model, infrastructure gateways, clock, and view.
 */
export class PlayController {
  constructor({ state, api, view, boardAdapter, clock }) {
    this.state = state;
    this.api = api;
    this.view = view;
    this.board = boardAdapter;
    this.clock = clock;
    this.engineAbortController = null;
    this.startRequestVersion = 0;
    this.pendingMoveSubmissions = 0;
  }

  initialize() {
    this.view.bind({
      onNewGame: () => this.startNewGame(),
      onFlip: () => this.flipBoard(),
      onHint: () => this.requestHint(),
      onEngineMove: () => this.requestEngineMove(),
      onFinish: () => this.finishGame(),
      onDifficultyChanged: () => this.view.updateDifficultyLabel(),
      onKeyDown: (event) => this.handleKeyboardShortcut(event),
    });
    this.view.updateDifficultyLabel();
    this.board.setDisabled(true);
    this.render();
  }

  canDrag(source, pieceCode) {
    if (!this.state.isActive || this.state.inputLocked) return false;
    if (this.state.humanColor !== this.state.position.sideToMove) return false;
    const pieceColor = pieceCode?.[0];
    return source && pieceColor === this.state.position.sideToMove;
  }

  handleDrop(source, target) {
    if (target === 'offboard' || source === target) return 'snapback';
    if (!this.state.isActive || this.state.inputLocked) return 'snapback';

    const moving = this.state.position.pieceAt(source);
    if (!moving || moving.color !== this.state.position.sideToMove) return 'snapback';

    const promotion = moving.type === 'p' && (target.endsWith('1') || target.endsWith('8')) ? 'q' : '';
    const uci = `${source}${target}${promotion}`;
    const memento = this.state.createMemento();

    this.clock.stop();
    try {
      this.state.position.applyUci(uci);
      this.state.moves.push(uci);
      this.state.hintMove = null;
      this.state.inputLocked = true;
      this.board.clearHighlights();
      this.board.highlightMove(uci, 'last-move');
      this.view.renderMoves(this.state.moves);
      this.view.renderClocks(this.clock.snapshot(), this.state.isActive ? this.state.position.sideToMove : null);
    } catch (error) {
      this.clock.start();
      if (error instanceof ChessDataError) this.view.log(`[local reject] ${error.message}`);
      else this.view.log(`[local error] ${error.message}`);
      return 'snapback';
    }

    void this.#commitPlayerMove(uci, memento);
    return undefined;
  }

  handleSnapEnd() {
    this.render();
  }

  async startNewGame() {
    const requestVersion = ++this.startRequestVersion;
    let startError = null;
    this.#cancelEngineRequest();
    this.clock.stop();
    this.state.invalidateSession();
    this.board.setDisabled(true);
    this.view.setEngineRetryVisible(false);
    this.view.setThinking(true, 'Starting…');
    try {
      const { gameId } = await this.api.createGame({ timeControl: '300+0' });
      if (requestVersion !== this.startRequestVersion) return;
      this.state.start({ gameId, humanColor: this.view.getHumanColor() });
      this.clock.reset(300_000);
      this.clock.start();
      this.board.setDisabled(false);
      this.board.setOrientation(this.state.whiteAtBottom ? 'white' : 'black');
      this.view.hideGameBanner();
      this.render();
      if (this.state.humanColor === 'b') await this.requestEngineMove();
    } catch (error) {
      if (requestVersion !== this.startRequestVersion) return;
      startError = error;
      this.state.resetToIdle();
      this.board.setDisabled(true);
      this.view.log(`[new game failed] ${this.#errorMessage(error)}`);
      this.render();
    } finally {
      if (requestVersion === this.startRequestVersion && !this.state.isThinking) {
        this.view.setThinking(false);
        if (startError) this.view.setStatus('Unable to start game');
      }
    }
  }

  flipBoard() {
    this.state.whiteAtBottom = !this.state.whiteAtBottom;
    this.board.setOrientation(this.state.whiteAtBottom ? 'white' : 'black');
    this.render();
  }

  async requestHint() {
    if (!this.state.isActive) {
      this.view.log('Start a game first.');
      return;
    }
    if (this.state.isThinking) return;

    const sessionVersion = this.state.sessionVersion;
    this.state.isThinking = true;
    this.view.setThinking(true);
    const abortController = new AbortController();
    this.engineAbortController = abortController;

    try {
      const settings = this.view.getEngineSettings({ hint: true });
      const data = await this.api.getBestMove({
        moves: [...this.state.moves],
        ...settings,
        clocks: this.clock.snapshot(),
        signal: abortController.signal,
      });
      if (!this.#isCurrentSession(sessionVersion)) return;
      if (!data?.bestmove) {
        this.view.log(`[hint error]\n${data?.raw ?? 'No move returned.'}`);
        return;
      }
      this.state.hintMove = String(data.bestmove).toLowerCase();
      this.view.log(`[hint] ${this.state.hintMove}`);
      this.render();
    } catch (error) {
      if (error?.name !== 'AbortError') this.view.log(`[hint failed] ${this.#errorMessage(error)}`);
    } finally {
      if (this.#isCurrentSession(sessionVersion)) {
        this.state.isThinking = false;
        this.view.setThinking(false);
      }
      if (this.engineAbortController === abortController) this.engineAbortController = null;
    }
  }

  async requestEngineMove() {
    if (!this.state.isActive || this.state.isThinking) return;
    if (this.state.position.sideToMove === this.state.humanColor) return;

    const sessionVersion = this.state.sessionVersion;
    const expectedTurn = this.state.position.sideToMove;
    this.state.isThinking = true;
    this.state.inputLocked = true;
    this.view.setEngineRetryVisible(false);
    this.view.setThinking(true);
    const abortController = new AbortController();
    this.engineAbortController = abortController;

    try {
      let bestMove = null;
      try {
        const book = await this.api.getBookMove([...this.state.moves], { signal: abortController.signal });
        bestMove = book?.bookmove ? String(book.bookmove).toLowerCase() : null;
        if (bestMove) this.view.log(`[book] ${bestMove}`);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        // Opening-book failure is optional; continue to the engine.
        this.view.log(`[book unavailable] ${this.#errorMessage(error)}`);
      }

      if (!bestMove) {
        const settings = this.view.getEngineSettings();
        const data = await this.api.getBestMove({
          moves: [...this.state.moves],
          ...settings,
          clocks: this.clock.snapshot(),
          signal: abortController.signal,
        });
        bestMove = data?.bestmove ? String(data.bestmove).toLowerCase() : null;
        if (!bestMove) throw new Error(data?.raw || 'The engine returned no best move.');
      }

      if (!this.#isCurrentSession(sessionVersion) || this.state.position.sideToMove !== expectedTurn) return;
      await this.#applyAndPersistEngineMove(bestMove);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        this.view.log(`[engine failed] ${this.#errorMessage(error)}`);
        this.state.inputLocked = false;
        this.view.setEngineRetryVisible(true);
        this.clock.start();
      }
    } finally {
      if (this.#isCurrentSession(sessionVersion)) {
        this.state.isThinking = false;
        this.view.setThinking(false);
      }
      if (this.engineAbortController === abortController) this.engineAbortController = null;
      this.render();
    }
  }

  async finishGame() {
    if (!this.state.isActive) {
      this.view.log('No active game.');
      return;
    }
    if (this.pendingMoveSubmissions > 0) {
      this.view.log('A move is still being validated. Try ending the game again after it completes.');
      return;
    }
    const sessionVersion = this.state.sessionVersion;
    this.#cancelEngineRequest();
    this.state.inputLocked = true;
    this.render();
    try {
      const data = await this.api.finishGame(this.state.gameId, '*');
      if (this.state.sessionVersion !== sessionVersion) return;
      this.endGame({
        result: data?.result ?? '*',
        reason: data?.reason ?? 'ended',
        pgn: data?.pgn ?? null,
      });
    } catch (error) {
      this.state.inputLocked = false;
      this.view.log(`[finish failed] ${this.#errorMessage(error)}`);
      this.render();
    }
  }

  endGame({ result = '*', reason = null, pgn = null } = {}) {
    this.#cancelEngineRequest();
    this.clock.stop();
    this.state.finish({ result, reason, pgn });
    this.board.setDisabled(true);
    this.view.setEngineRetryVisible(false);
    this.view.setThinking(false);
    this.view.setStatus('Game over');
    this.view.showGameBanner({ result, reason });
    if (pgn) this.view.log(`PGN:\n${pgn}`);
    this.view.log(`[over] ${result}${reason ? ` · ${reason}` : ''}`);
    this.render();
  }

  handleTimeout(color) {
    if (!this.state.isActive) return;
    this.endGame({ result: color === 'w' ? '0-1' : '1-0', reason: 'timeout' });
  }

  handleKeyboardShortcut(event) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    if (key === 'n') void this.startNewGame();
    if (key === 'f') this.flipBoard();
    if (key === 'e') void this.requestEngineMove();
  }

  render() {
    this.board.render(this.state.position, false);
    this.board.clearHighlights();
    const lastMove = this.state.moves.at(-1);
    if (lastMove) this.board.highlightMove(lastMove, 'last-move');
    if (this.state.hintMove) this.board.highlightMove(this.state.hintMove, 'hint-square');
    this.view.renderMoves(this.state.moves);
    this.view.renderClocks(this.clock.snapshot(), this.state.isActive ? this.state.position.sideToMove : null);
  }

  async #commitPlayerMove(uci, memento) {
    const sessionVersion = this.state.sessionVersion;
    let requestEngine = false;
    this.pendingMoveSubmissions += 1;
    try {
      const response = await this.api.submitMove(this.state.gameId, uci);
      if (!this.#isCurrentSession(sessionVersion)) return;
      this.#reconcileAcceptedMove(response, uci);
      if (response?.over) {
        this.endGame({ result: response.result, reason: response.reason, pgn: response.pgn });
        return;
      }
      this.state.inputLocked = false;
      this.clock.start();
      this.render();
      requestEngine = this.state.position.sideToMove !== this.state.humanColor;
    } catch (error) {
      if (!this.#isCurrentSession(sessionVersion)) return;
      this.state.restore(memento);
      this.state.inputLocked = false;
      this.clock.start();
      this.view.log(`[move rejected] ${uci} (${this.#errorMessage(error)})`);
      this.render();
    } finally {
      this.pendingMoveSubmissions = Math.max(0, this.pendingMoveSubmissions - 1);
    }

    if (requestEngine && this.#isCurrentSession(sessionVersion)) {
      await this.requestEngineMove();
    }
  }

  async #applyAndPersistEngineMove(uci) {
    const memento = this.state.createMemento();
    this.clock.stop();
    try {
      this.state.position.applyUci(uci);
      this.state.moves.push(uci);
      this.state.hintMove = null;
      this.render();

      this.pendingMoveSubmissions += 1;
      let response;
      try {
        response = await this.api.submitMove(this.state.gameId, uci);
      } finally {
        this.pendingMoveSubmissions = Math.max(0, this.pendingMoveSubmissions - 1);
      }

      this.view.log(`[engine] ${uci}`);
      this.#reconcileAcceptedMove(response, uci);
      if (response?.over) {
        this.endGame({ result: response.result, reason: response.reason, pgn: response.pgn });
        return;
      }
      this.state.inputLocked = false;
      this.view.setEngineRetryVisible(false);
      this.clock.start();
    } catch (error) {
      this.state.restore(memento);
      this.state.inputLocked = true;
      this.render();
      throw error;
    }
  }

  #reconcileAcceptedMove(response, expectedUci) {
    // The server is the legal-move authority. Its FEN and move history are
    // treated as authoritative projections after a successful 2xx response.
    // Contract defects are logged without rolling back a move the server has
    // already persisted, because rollback would create a client/server split.
    if (typeof response?.fen === 'string' && response.fen.trim()) {
      try {
        this.state.position = ChessPosition.fromFen(response.fen);
      } catch (error) {
        this.view.log(`[server contract] invalid FEN after ${expectedUci}: ${error.message}`);
      }
    }

    const rawMoves = Array.isArray(response?.moves)
      ? response.moves
      : typeof response?.moves === 'string'
        ? response.moves.trim().split(/\s+/).filter(Boolean)
        : null;

    if (rawMoves) {
      try {
        const authoritativeMoves = rawMoves.map((move) => parseUci(String(move).toLowerCase()).uci);
        const lastMove = authoritativeMoves.at(-1);
        if (lastMove && lastMove !== expectedUci) {
          this.view.log(`[server contract] accepted history ends with ${lastMove}, expected ${expectedUci}`);
        }
        this.state.moves = authoritativeMoves;
      } catch (error) {
        this.view.log(`[server contract] invalid move history after ${expectedUci}: ${error.message}`);
      }
    }
  }

  #cancelEngineRequest() {
    this.engineAbortController?.abort();
    this.engineAbortController = null;
    this.state.isThinking = false;
  }

  #isCurrentSession(version) {
    return this.state.isActive && this.state.sessionVersion === version;
  }

  #errorMessage(error) {
    if (error instanceof ApiError && error.status) return `${error.message} [HTTP ${error.status}]`;
    return error?.message ?? String(error);
  }
}
