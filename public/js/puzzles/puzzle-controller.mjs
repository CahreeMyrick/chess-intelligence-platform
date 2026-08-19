import { ChessPosition, parseUci } from '../shared/chess-position.mjs';
import { ApiError } from '../shared/errors.mjs';
import { PuzzleSource } from './puzzle-state.mjs';

/** Application Service / Controller for puzzle workflows. */
export class PuzzleController {
  constructor({ state, api, view, boardAdapter, scheduler = globalThis }) {
    this.state = state;
    this.api = api;
    this.view = view;
    this.board = boardAdapter;
    this.scheduler = scheduler;
    this.autoPlayTimer = null;
    this.autoReplyTimer = null;
    this.loadVersion = 0;
  }

  initialize() {
    this.view.bind({
      onDaily: () => this.selectSource(PuzzleSource.DAILY),
      onRandom: () => this.selectSource(PuzzleSource.RANDOM),
      onFromGames: () => this.selectSource(PuzzleSource.FROM_GAMES),
      onFlip: () => this.flipBoard(),
      onViewModeChanged: () => this.changeViewMode(),
      onReset: () => this.resetPuzzle(),
      onStep: () => this.stepSolution(),
      onAuto: () => this.toggleAutoPlay(),
      onPrevious: () => this.showPreviousGamePuzzle(),
      onNext: () => this.showNextGamePuzzle(),
      onLoadGames: () => this.loadGamesForUser(),
      onAnalyzeAll: () => this.analyzeAllGames(),
    });
    this.board.setSquareClickHandler((square) => this.handleSquareClick(square));
    this.view.renderSource(this.state.activeSource);
    this.render();
    void this.loadDaily();
  }

  canDrag(_source, pieceCode) {
    if (this.state.validationError || !this.state.solution.length || this.state.solved) return false;
    return pieceCode?.[0] === this.state.position.sideToMove;
  }

  handleDrop(source, target) {
    if (source === target || target === 'offboard') return 'snapback';
    return this.#attemptUserMove(source, target) ? undefined : 'snapback';
  }

  handleSquareClick(square) {
    if (this.state.validationError || !this.state.solution.length || this.state.solved) return;
    const piece = this.state.position.pieceAt(square);

    if (!this.state.selectedSquare) {
      if (piece?.color === this.state.position.sideToMove) {
        this.state.selectedSquare = square;
        this.renderHighlights();
      }
      return;
    }

    if (this.state.selectedSquare === square) {
      this.state.selectedSquare = null;
      this.renderHighlights();
      return;
    }

    if (piece?.color === this.state.position.sideToMove) {
      this.state.selectedSquare = square;
      this.renderHighlights();
      return;
    }

    const source = this.state.selectedSquare;
    this.state.selectedSquare = null;
    this.#attemptUserMove(source, square);
  }

  async selectSource(source) {
    this.loadVersion += 1;
    this.view.setLoading(false);
    this.#cancelTimers();
    this.state.activeSource = source;
    this.view.renderSource(source);
    if (source === PuzzleSource.DAILY) await this.loadDaily();
    if (source === PuzzleSource.RANDOM) await this.loadRandom();
  }

  async loadDaily() {
    await this.#loadPublicPuzzle(() => this.api.getDailyPuzzle(), 'Daily puzzle');
  }

  async loadRandom() {
    await this.#loadPublicPuzzle(() => this.api.getRandomPuzzle(), 'Random puzzle');
  }

  flipBoard() {
    this.state.whiteAtBottom = !this.state.whiteAtBottom;
    this.board.setOrientation(this.state.whiteAtBottom ? 'white' : 'black');
    this.render();
  }

  changeViewMode() {
    this.state.viewMode = this.view.getViewMode();
    this.state.recomputeOrientation();
    this.board.setOrientation(this.state.whiteAtBottom ? 'white' : 'black');
    this.render();
  }

  resetPuzzle() {
    this.#cancelTimers();
    if (!this.state.resetCurrentPuzzle()) return;
    this.view.hideFeedback();
    this.board.setOrientation(this.state.whiteAtBottom ? 'white' : 'black');
    this.render();
  }

  stepSolution() {
    this.#cancelAutoReply();
    if (!this.#applyExpectedMove()) return;
    if (this.state.solved) this.view.showFeedback('correct', 'Solved! Well done.');
  }

  toggleAutoPlay() {
    if (this.autoPlayTimer !== null) {
      this.#cancelAutoPlay();
      return;
    }
    if (!this.state.solution.length || this.state.solved) return;

    this.autoPlayTimer = this.scheduler.setInterval(() => {
      if (!this.#applyExpectedMove() || this.state.solved) {
        this.#cancelAutoPlay();
        if (this.state.solved) this.view.showFeedback('correct', 'Solved! Well done.');
      }
    }, 300);
  }

  showNextGamePuzzle() {
    if (!this.state.fromGamePuzzles.length) return;
    const next = (this.state.fromGameIndex + 1) % this.state.fromGamePuzzles.length;
    this.applyGamePuzzleAt(next);
  }

  showPreviousGamePuzzle() {
    if (!this.state.fromGamePuzzles.length) return;
    const previous = (this.state.fromGameIndex - 1 + this.state.fromGamePuzzles.length) % this.state.fromGamePuzzles.length;
    this.applyGamePuzzleAt(previous);
  }

async loadGamesForUser() {
  const username = this.view.getUsername();
  if (!username) {
    this.view.setGamesStatus('Enter a username');
    return;
  }

  const version = ++this.loadVersion;
  this.view.setLoading(true);
  this.view.setGamesStatus('Loading games…');
  this.view.setAnalyzeAllVisible(false);
  this.state.fromGamePuzzles = [];
  this.state.fromGameIndex = -1;
  this.state.fromGame = null;
  this.state.fromGameUsername = username;

  try {
    const recent = await this.api.getRecentGames(username);
    if (version !== this.loadVersion) return;
    const gameCount = Array.isArray(recent?.games) ? recent.games.length : 0;
    this.view.renderGames(recent, (game) => this.startPuzzlesFromGame(username, game));
    this.view.setAnalyzeAllVisible(gameCount > 0);
    this.view.setGamesStatus(
      gameCount ? `${gameCount} games loaded — pick one or analyze all` : 'No recent games found',
    );
  } catch (error) {
    if (version !== this.loadVersion) return;
    this.view.setGamesStatus('Failed to load games');
    this.view.showFeedback('wrong', this.#errorMessage(error));
  } finally {
    if (version === this.loadVersion) this.view.setLoading(false);
  }
}

async analyzeAllGames() {
  const username = this.state.fromGameUsername ?? this.view.getUsername();
  if (!username) {
    this.view.setGamesStatus('Enter a username');
    return;
  }

  const version = ++this.loadVersion;
  this.view.setLoading(true);
  this.view.setGamesStatus('Analyzing for puzzles…');
  this.view.hideFeedback();

  try {
    const generated = await this.api.generatePuzzlesForUser({ username });
    if (version !== this.loadVersion) return;
    const puzzles = Array.isArray(generated?.puzzles) ? generated.puzzles : [];
    if (!puzzles.length) {
      this.view.setGamesStatus('No puzzles found');
      this.view.showFeedback('wrong', 'No suitable puzzles found in your recent games.');
      return;
    }

    this.state.fromGamePuzzles = puzzles;
    this.state.fromGameUsername = username;
    this.state.fromGame = null;
    this.state.fromGameIndex = 0;
    this.applyGamePuzzleAt(0);
    this.view.setGamesStatus(`${puzzles.length} puzzles loaded`);
  } catch (error) {
    if (version !== this.loadVersion) return;
    this.view.setGamesStatus('Failed to analyze games');
    this.view.showFeedback('wrong', this.#errorMessage(error));
  } finally {
    if (version === this.loadVersion) this.view.setLoading(false);
  }
}
  async startPuzzlesFromGame(username, game) {
    if (!game?.pgn) {
      this.view.showFeedback('wrong', 'That game has no PGN.');
      return;
    }
    const version = ++this.loadVersion;
    this.view.setLoading(true);
    this.view.setGamesStatus('Building puzzles…');
    this.view.hideFeedback();
    try {
      const data = await this.api.generatePuzzlesFromGame({ pgn: game.pgn, username });
      if (version !== this.loadVersion) return;
      if (!data?.ok) throw new Error(data?.error ?? 'Puzzle generation failed.');
      const puzzles = Array.isArray(data.puzzles) ? data.puzzles : [];
      if (!puzzles.length) {
        this.view.setGamesStatus('No puzzles in this game');
        this.view.showFeedback('wrong', 'No suitable positions found in that game.');
        return;
      }
      this.state.fromGamePuzzles = puzzles;
      this.state.fromGame = game;
      this.state.fromGameUsername = username;
      this.state.fromGameIndex = 0;
      this.applyGamePuzzleAt(0);
      this.view.setGamesStatus(`${puzzles.length} puzzles in game`);
    } catch (error) {
      if (version !== this.loadVersion) return;
      this.view.setGamesStatus('Error building puzzles');
      this.view.showFeedback('wrong', this.#errorMessage(error));
    } finally {
      if (version === this.loadVersion) this.view.setLoading(false);
    }
  }

  applyGamePuzzleAt(index) {
    const puzzles = this.state.fromGamePuzzles;
    if (!puzzles.length || index < 0 || index >= puzzles.length) return;
    this.#cancelTimers();
    this.state.fromGameIndex = index;
    const puzzle = puzzles[index];
    const moves = this.#extractGamePuzzleMoves(puzzle);
    const total = puzzles.length;
    const id = puzzle.ml_score != null
      ? `Puzzle ${index + 1} of ${total}`
      : `Move ${puzzle.moveNumber ?? puzzle.ply ?? index + 1}`;
    const rating = puzzle.ml_score != null ? 'From your games' : this.state.fromGame?.time_class ?? '';

    this.#applyNormalizedPuzzle({
      fen: puzzle.fen,
      moves,
      metadata: {
        id,
        rating,
        themes: ['from your games'],
      },
    });
  }

  render() {
    this.board.render(this.state.position, false);
    this.renderHighlights();
    this.view.renderTurn(this.state.position.sideToMove);
    this.view.renderProgress(this.state.index, this.state.solution.length);
  }

  renderHighlights() {
    this.board.clearHighlights();
    if (this.state.lastMove) this.board.highlightMove(this.state.lastMove, 'last-move');
    if (this.state.selectedSquare) this.board.highlightSquare(this.state.selectedSquare, 'selected-square');
  }

  async #loadPublicPuzzle(loader, fallbackLabel) {
    const version = ++this.loadVersion;
    this.#cancelTimers();
    this.view.hideFeedback();
    try {
      const puzzle = await loader();
      if (version !== this.loadVersion) return;
      const normalized = this.#normalizePublicPuzzle(puzzle, fallbackLabel);
      this.state.fromGamePuzzles = [];
      this.state.fromGameIndex = -1;
      this.state.fromGame = null;
      this.#applyNormalizedPuzzle(normalized);
    } catch (error) {
      if (version === this.loadVersion) {
        this.view.showFeedback('wrong', `Failed to load puzzle: ${this.#errorMessage(error)}`);
      }
    }
  }

  #normalizePublicPuzzle(puzzle, fallbackLabel) {
    if (!puzzle?.fen || !Array.isArray(puzzle.moves) || !puzzle.moves.length) {
      throw new Error('Puzzle response requires fen and a non-empty moves array.');
    }
    return {
      fen: String(puzzle.fen),
      moves: puzzle.moves.map((move) => parseUci(move).uci),
      metadata: {
        id: String(puzzle.title ?? puzzle._title ?? puzzle.id ?? fallbackLabel),
        rating: puzzle.rating ? `~${puzzle.rating} ELO` : 'unrated',
        themes: Array.isArray(puzzle.themes) ? puzzle.themes.map(String) : [],
      },
    };
  }

  #applyNormalizedPuzzle({ fen, moves, metadata }) {
    if (!fen || !moves.length) {
      this.view.showFeedback('wrong', 'Puzzle has no playable solution.');
      return;
    }
    const verifiedMoves = moves.map((move) => parseUci(move).uci);
    const verificationError = this.#verifyProjection(fen, verifiedMoves);

    this.state.loadPuzzle({ fen, moves: verifiedMoves, metadata, validationError: verificationError });
    this.board.setOrientation(this.state.whiteAtBottom ? 'white' : 'black');
    this.view.renderPuzzleMetadata({
      id: metadata.id,
      rating: metadata.rating,
      themes: metadata.themes,
      turnLabel: this.state.position.sideToMove === 'w' ? 'White to move' : 'Black to move',
      moveCount: verifiedMoves.length,
      solution: verifiedMoves,
    });
    this.view.hideFeedback();
    this.render();
    if (verificationError) {
      this.view.showFeedback('wrong', `Puzzle data inconsistent: ${verificationError}`);
    }
  }

  #attemptUserMove(source, target) {
    if (this.state.validationError) return false;
    const expected = this.state.expectedMove;
    if (!expected) return false;
    const parsed = parseUci(expected);
    if (source !== parsed.from || target !== parsed.to) {
      this.state.selectedSquare = null;
      this.view.showFeedback('wrong', 'Incorrect — try again.');
      this.renderHighlights();
      return false;
    }

    if (!this.#applyExpectedMove()) return false;
    this.view.hideFeedback();
    if (this.state.solved) {
      this.view.showFeedback('correct', 'Solved! Well done.');
    } else {
      this.#scheduleAutoReply();
    }
    return true;
  }

  #applyExpectedMove() {
    if (this.state.validationError) return false;
    const expected = this.state.expectedMove;
    if (!expected) return false;
    try {
      this.state.position.applyUci(expected);
      this.state.index += 1;
      this.state.selectedSquare = null;
      this.state.lastMove = expected;
      this.render();
      return true;
    } catch (error) {
      this.view.showFeedback('wrong', `Puzzle data mismatch: ${error.message}`);
      return false;
    }
  }

  #scheduleAutoReply() {
    this.#cancelAutoReply();
    this.autoReplyTimer = this.scheduler.setTimeout(() => {
      this.autoReplyTimer = null;
      if (!this.#applyExpectedMove()) return;
      if (this.state.solved) this.view.showFeedback('correct', 'Solved! Well done.');
    }, 300);
  }

  #verifyProjection(fen, moves) {
    try {
      const position = ChessPosition.fromFen(fen);
      moves.forEach((move) => position.applyUci(move));
      return null;
    } catch (error) {
      return error.message;
    }
  }

  #extractGamePuzzleMoves(puzzle) {
    const raw = Array.isArray(puzzle?.solutionMoves) && puzzle.solutionMoves.length
      ? puzzle.solutionMoves
      : Array.isArray(puzzle?.moves) && puzzle.moves.length
        ? puzzle.moves
        : puzzle?.uci
          ? [puzzle.uci]
          : [];
    return raw.map((move) => parseUci(move).uci);
  }

  #cancelAutoPlay() {
    if (this.autoPlayTimer !== null) this.scheduler.clearInterval(this.autoPlayTimer);
    this.autoPlayTimer = null;
  }

  #cancelAutoReply() {
    if (this.autoReplyTimer !== null) this.scheduler.clearTimeout(this.autoReplyTimer);
    this.autoReplyTimer = null;
  }

  #cancelTimers() {
    this.#cancelAutoPlay();
    this.#cancelAutoReply();
  }

  #errorMessage(error) {
    if (error instanceof ApiError && error.status) return `${error.message} [HTTP ${error.status}]`;
    return error?.message ?? String(error);
  }
}
