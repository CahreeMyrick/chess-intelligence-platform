import { ChessPosition } from '../shared/chess-position.mjs';
import { ChessDataError, ApiError } from '../shared/errors.mjs';

/**
 * Main Controller for the Development Environment.
 * Orchestrates DevState, DevView, DevApi, DevClock, and DevPluginManager.
 */
export class DevController {
  constructor({ state, api, view, boardAdapter, clock, pluginManager }) {
    this.state = state;
    this.api = api;
    this.view = view;
    this.board = boardAdapter;
    this.clock = clock;
    this.pluginManager = pluginManager;
    this.engineAbortController = null;
  }

  initialize() {
    this.view.bind({
      onNewGame: () => this.startNewGame(),
      onUndo: () => this.handleUndo(),
      onFlip: () => this.flipBoard(),
      onHint: () => this.requestHint(),
      onEngineMove: () => this.requestEngineMove(),
      onEndGame: () => this.finishGame({ result: 'ended', message: 'Game ended by user' }),
      onCopyFen: () => this.copyFen(),
      onLoadFen: () => this.loadFenFromInput(),
      onModeChanged: (mode) => this.handleModeChanged(mode),
      onTimerModeChanged: () => this.render(),
      onTimeConfigChanged: () => {},
      onEngineConfigChanged: (config) => {
        this.state.engineDepth = config.depth;
        this.state.engineMovetimeMs = config.movetimeMs;
      },
      onSideChanged: (side) => {
        this.state.humanColor = side;
        if (!this.state.isActive) {
          this.state.whiteAtBottom = side === 'w';
          this.board.setOrientation(this.state.whiteAtBottom ? 'white' : 'black');
        }
      },
      onAutoFlipChanged: (enabled) => {
        this.state.autoFlipPvP = enabled;
      },
    });

    this.board.setDisabled(false);
    this.startNewGame();
  }

  canDrag(source, pieceCode) {
    if (!this.state.isActive || this.state.inputLocked) return false;
    const pieceColor = pieceCode?.[0];
    if (pieceColor !== this.state.sideToMove) return false;

    if (this.state.mode === 'pve') {
      return pieceColor === this.state.humanColor;
    }

    return true; // in PvP mode, current side to move can drag
  }

  handleDrop(source, target) {
    if (target === 'offboard' || source === target) return 'snapback';
    if (!this.state.isActive || this.state.inputLocked) return 'snapback';

    const moving = this.state.position.pieceAt(source);
    if (!moving || moving.color !== this.state.sideToMove) return 'snapback';

    const isPawnPromotion = moving.type === 'p' && (target.endsWith('1') || target.endsWith('8'));
    const uci = `${source}${target}${isPawnPromotion ? 'q' : ''}`;
    const memento = this.state.createMemento();
    const movingColor = this.state.sideToMove;

    try {
      this.state.position.applyUci(uci);
      this.state.recordMove(uci);
      this.clock.switchTurn(movingColor);
      this.render();

      this.pluginManager?.emit('moveApplied', {
        uci,
        moveNumber: this.state.moves.length,
        sideToMove: this.state.sideToMove,
        fen: this.state.position.toFen(),
      });
      this.pluginManager?.emit('positionChanged', { fen: this.state.position.toFen() });

      if (this.state.mode === 'pvp' && this.state.autoFlipPvP) {
        this.state.whiteAtBottom = this.state.sideToMove === 'w';
        this.board.setOrientation(this.state.whiteAtBottom ? 'white' : 'black');
      }

      if (this.state.mode === 'pve' && this.state.isEngineTurn()) {
        void this.requestEngineMove();
      }
    } catch (error) {
      this.state.restoreMemento(memento);
      this.render();
      if (error instanceof ChessDataError) {
        this.view.log(`[Move Rejected] ${error.message}`);
      } else {
        this.view.log(`[Move Error] ${error.message}`);
      }
      return 'snapback';
    }

    return undefined;
  }

  async startNewGame() {
    this.#cancelEngine();
    const mode = this.view.getGameMode();
    const timerConfig = this.view.getTimeConfig();
    const humanColor = this.view.getHumanSide();
    const engineConfig = this.view.getEngineConfig();
    const autoFlipPvP = this.view.getAutoFlip();

    const initialMs = timerConfig.timerMode === 'timed' ? timerConfig.initialMinutes * 60_000 : 300_000;
    const incrementMs = timerConfig.timerMode === 'timed' ? timerConfig.incrementSeconds * 1000 : 0;

    this.clock.configure({
      timerMode: timerConfig.timerMode,
      initialMs,
      incrementMs,
    });

    this.state.start({
      mode,
      timerMode: timerConfig.timerMode,
      timeControl: timerConfig,
      humanColor,
      engineDepth: engineConfig.depth,
      engineMovetimeMs: engineConfig.movetimeMs,
      autoFlipPvP,
    });

    this.board.setOrientation(this.state.whiteAtBottom ? 'white' : 'black');
    this.board.setDisabled(false);

    if (timerConfig.timerMode === 'timed') {
      this.clock.start();
    }

    this.view.log(`[Game Started] Mode: ${mode.toUpperCase()} | Timer: ${timerConfig.timerMode === 'timed' ? `${timerConfig.initialMinutes}m+${timerConfig.incrementSeconds}s` : 'No Time'}`);
    this.render();

    this.pluginManager?.emit('gameStart', { state: this.state });
    this.pluginManager?.emit('positionChanged', { fen: this.state.position.toFen() });

    if (this.state.mode === 'pve' && this.state.isEngineTurn()) {
      await this.requestEngineMove();
    }
  }

  handleModeChanged(mode) {
    this.state.mode = mode;
    this.view.updateConfigPanels();
    this.view.log(`[Mode Switched] Switched to ${mode.toUpperCase()}. Click 'New Game' or continue playing.`);
  }

  handleUndo() {
    this.#cancelEngine();
    const success = this.state.undo();
    if (success) {
      this.view.log('[Undo] Stepped back move history.');
      this.render();
      this.pluginManager?.emit('positionChanged', { fen: this.state.position.toFen() });
    } else {
      this.view.log('[Undo] No moves to undo.');
    }
  }

  flipBoard() {
    this.state.whiteAtBottom = !this.state.whiteAtBottom;
    this.board.setOrientation(this.state.whiteAtBottom ? 'white' : 'black');
    this.render();
  }

  async requestHint() {
    if (!this.state.isActive) return;
    this.view.setThinking(true, 'Finding hint…');

    try {
      const best = await this.api.getBestMove({
        fen: this.state.position.toFen(),
        moves: this.state.moves,
        depth: this.state.engineDepth || 3,
        movetimeMs: 300,
      });

      const move = best?.bestmove;
      if (move) {
        this.state.hintMove = move;
        this.board.highlightMove(move, 'hint-square');
        this.view.log(`[Hint] Suggested move: ${move}`);
      } else {
        this.view.log('[Hint] No hint available.');
      }
    } catch (error) {
      this.view.log(`[Hint Error] ${error.message}`);
    } finally {
      this.view.setThinking(false);
    }
  }

  async requestEngineMove() {
    if (!this.state.isActive) return;
    this.#cancelEngine();

    this.engineAbortController = new AbortController();
    const signal = this.engineAbortController.signal;

    this.state.isThinking = true;
    this.state.inputLocked = true;
    this.view.setThinking(true, 'Ichigo thinking…');

    const clockSnapshot = this.clock.snapshot();
    const startTs = performance.now();

    try {
      const response = await this.api.getBestMove({
        fen: this.state.position.toFen(),
        moves: this.state.moves,
        depth: this.state.engineDepth,
        movetimeMs: this.state.engineMovetimeMs,
        wtime: clockSnapshot.timerMode === 'timed' ? clockSnapshot.remaining.w : null,
        btime: clockSnapshot.timerMode === 'timed' ? clockSnapshot.remaining.b : null,
        winc: clockSnapshot.timerMode === 'timed' ? this.clock.incrementMs : null,
        binc: clockSnapshot.timerMode === 'timed' ? this.clock.incrementMs : null,
        signal,
      });

      const bestmove = response?.bestmove;
      const durationMs = performance.now() - startTs;

      if (!bestmove || bestmove === '(none)') {
        this.view.log('[Engine] No legal moves returned.');
        this.finishGame({ result: 'checkmate', message: 'Game finished (no legal moves)' });
        return;
      }

      const movingColor = this.state.sideToMove;
      this.state.position.applyUci(bestmove);
      this.state.recordMove(bestmove);
      this.clock.switchTurn(movingColor);

      this.pluginManager?.emit('engineResponse', { bestmove, info: response, durationMs });
      this.pluginManager?.emit('moveApplied', {
        uci: bestmove,
        moveNumber: this.state.moves.length,
        sideToMove: this.state.sideToMove,
        fen: this.state.position.toFen(),
      });
      this.pluginManager?.emit('positionChanged', { fen: this.state.position.toFen() });

      this.render();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      this.view.log(`[Engine Error] ${error.message}`);
    } finally {
      this.state.isThinking = false;
      this.state.inputLocked = false;
      this.view.setThinking(false);
    }
  }

  loadFenFromInput() {
    const fen = this.view.getFenInput();
    if (!fen) {
      this.view.log('[FEN Error] Please enter a FEN string.');
      return;
    }

    try {
      const position = ChessPosition.fromFen(fen);
      this.state.position = position;
      this.state.moves = [];
      this.state.history = [{ fen: position.toFen(), moves: [], lastMove: null }];
      this.state.lastMove = null;
      this.state.hintMove = null;
      this.state.isActive = true;
      this.state.inputLocked = false;
      this.state.statusText = `Loaded position: ${position.sideToMove === 'w' ? 'White' : 'Black'} to move`;
      this.render();
      this.view.log(`[FEN Loaded] ${fen}`);
      this.pluginManager?.emit('positionChanged', { fen });
    } catch (error) {
      this.view.log(`[FEN Parse Error] ${error.message}`);
    }
  }

  copyFen() {
    const fen = this.state.position.toFen();
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(fen).then(() => {
        this.view.log(`[Copied FEN] ${fen}`);
      }).catch(() => {
        this.view.log(`[FEN] ${fen}`);
      });
    } else {
      this.view.log(`[FEN] ${fen}`);
    }
  }

  handleTimeout(loserColor) {
    const winnerColor = loserColor === 'w' ? 'b' : 'w';
    const winnerName = winnerColor === 'w' ? 'White' : 'Black';
    this.finishGame({
      result: 'timeout',
      winner: winnerColor,
      message: `Time out! ${winnerName} wins on time.`,
    });
  }

  finishGame({ result, winner, message } = {}) {
    this.clock.stop();
    this.#cancelEngine();
    this.state.finishGame({ result, winner, message });
    this.view.setStatus(this.state.statusText, 'ended');
    this.render();
    this.pluginManager?.emit('gameFinished', { result, winner, message });
  }

  render() {
    this.board.render(this.state.position, false);
    this.board.clearHighlights();

    if (this.state.lastMove) {
      this.board.highlightMove(this.state.lastMove, 'last-move');
    }
    if (this.state.hintMove) {
      this.board.highlightMove(this.state.hintMove, 'hint-square');
    }

    this.view.updatePlayerStrips({
      mode: this.state.mode,
      humanColor: this.state.humanColor,
      whiteAtBottom: this.state.whiteAtBottom,
      timerMode: this.state.timerMode,
    });

    const clockSnapshot = this.clock.snapshot();
    this.view.updateClocks({
      remaining: clockSnapshot.remaining,
      activeColor: this.state.sideToMove,
      timerMode: this.state.timerMode,
      whiteAtBottom: this.state.whiteAtBottom,
    });

    this.view.setStatus(this.state.statusText, this.state.isActive ? 'active' : 'idle');
    this.view.renderMoves(this.state.moves);
    this.view.setFenInput(this.state.position.toFen());
  }

  #cancelEngine() {
    if (this.engineAbortController) {
      this.engineAbortController.abort();
      this.engineAbortController = null;
    }
    this.state.isThinking = false;
  }
}
