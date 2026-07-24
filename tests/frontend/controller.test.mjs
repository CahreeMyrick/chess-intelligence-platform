import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayController } from '../../public/js/play/play-controller.mjs';
import { PlayState } from '../../public/js/play/play-state.mjs';
import { PuzzleController } from '../../public/js/puzzles/puzzle-controller.mjs';
import { PuzzleState } from '../../public/js/puzzles/puzzle-state.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createPlayView() {
  return {
    logs: [],
    bind() {},
    updateDifficultyLabel() {},
    getHumanColor: () => 'w',
    getEngineSettings: () => ({ depth: null, moveTimeMs: 100 }),
    setThinking() {},
    setStatus() {},
    setEngineRetryVisible() {},
    hideGameBanner() {},
    banner: null,
    showGameBanner(value) { this.banner = value; },
    renderMoves() {},
    renderClocks() {},
    log(message) { this.logs.push(String(message)); },
  };
}

function createBoard() {
  return {
    render() {},
    clearHighlights() {},
    highlightMove() {},
    highlightSquare() {},
    setDisabled() {},
    setOrientation() {},
    setSquareClickHandler() {},
  };
}

function createClock() {
  return {
    running: false,
    values: { w: 300000, b: 300000 },
    start() { this.running = true; },
    stop() { this.running = false; },
    reset() { this.values = { w: 300000, b: 300000 }; },
    snapshot() { return { ...this.values }; },
  };
}

function createPuzzleView() {
  return {
    metadata: null,
    feedback: [],
    bind() {},
    renderSource() {},
    renderTurn() {},
    renderProgress() {},
    renderThemes() {},
    renderGames() {},
    setGamesStatus() {},
    setLoading() {},
    hideFeedback() {},
    getUsername: () => 'tester',
    getViewMode: () => 'side',
    renderPuzzleMetadata(metadata) { this.metadata = metadata; },
    showFeedback(type, message) { this.feedback.push({ type, message }); },
  };
}

test('PlayController returns synchronously from onDrop and rolls back a rejected optimistic move', async () => {
  const state = new PlayState();
  state.start({ gameId: 'g1', humanColor: 'w' });
  const view = createPlayView();
  const clock = createClock();
  clock.start();
  const controller = new PlayController({
    state,
    api: {
      submitMove: async () => { throw new Error('illegal'); },
    },
    view,
    boardAdapter: createBoard(),
    clock,
  });

  const result = controller.handleDrop('e2', 'e4');
  assert.equal(result, undefined);
  assert.deepEqual(state.moves, ['e2e4']);
  assert.equal(clock.running, false);

  await flush();
  assert.deepEqual(state.moves, []);
  assert.equal(state.position.pieceAt('e2')?.type, 'p');
  assert.equal(state.position.pieceAt('e4'), null);
  assert.equal(state.inputLocked, false);
  assert.equal(clock.running, true);
  assert.match(view.logs.at(-1), /move rejected/);
});

test('only the newest New Game response may initialize PlayState', async () => {
  const first = deferred();
  const second = deferred();
  let call = 0;
  const state = new PlayState();
  const controller = new PlayController({
    state,
    api: {
      createGame: () => (++call === 1 ? first.promise : second.promise),
    },
    view: createPlayView(),
    boardAdapter: createBoard(),
    clock: createClock(),
  });

  const requestOne = controller.startNewGame();
  const requestTwo = controller.startNewGame();
  second.resolve({ gameId: 'newest' });
  await requestTwo;
  first.resolve({ gameId: 'stale' });
  await requestOne;
  assert.equal(state.gameId, 'newest');
  assert.equal(state.isActive, true);
});

test('PuzzleController ignores a stale daily puzzle response', async () => {
  const first = deferred();
  const second = deferred();
  let call = 0;
  const state = new PuzzleState();
  const view = createPuzzleView();
  const controller = new PuzzleController({
    state,
    api: { getDailyPuzzle: () => (++call === 1 ? first.promise : second.promise) },
    view,
    boardAdapter: createBoard(),
  });

  const loadOne = controller.loadDaily();
  const loadTwo = controller.loadDaily();
  second.resolve({
    id: 'newest',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    moves: ['e1d1'],
  });
  await loadTwo;
  first.resolve({
    id: 'stale',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    moves: ['e1f1'],
  });
  await loadOne;

  assert.equal(state.currentPuzzle.metadata.id, 'newest');
  assert.equal(view.metadata.id, 'newest');
});

test('PuzzleController accepts the exact user move and automatically applies the reply', () => {
  const scheduled = [];
  const scheduler = {
    setTimeout(callback) { scheduled.push(callback); return scheduled.length; },
    clearTimeout() {},
    setInterval() { throw new Error('not used'); },
    clearInterval() {},
  };
  const state = new PuzzleState();
  state.loadPuzzle({
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    moves: ['e1d1', 'e8d8'],
    metadata: {},
  });
  const view = createPuzzleView();
  const controller = new PuzzleController({
    state,
    api: {},
    view,
    boardAdapter: createBoard(),
    scheduler,
  });

  assert.equal(controller.handleDrop('e1', 'd1'), undefined);
  assert.equal(state.index, 1);
  assert.equal(scheduled.length, 1);
  scheduled[0]();
  assert.equal(state.index, 2);
  assert.equal(state.solved, true);
  assert.equal(view.feedback.at(-1).type, 'correct');
});


test('PlayController reconciles an accepted move from the server FEN and move history', async () => {
  const state = new PlayState();
  state.start({ gameId: 'g1', humanColor: 'w' });
  const view = createPlayView();
  const controller = new PlayController({
    state,
    api: {
      submitMove: async () => ({
        ok: true,
        moves: 'e2e4',
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        over: false,
      }),
      getBookMove: async () => ({}),
      getBestMove: async () => { throw new Error('stop after reconciliation'); },
    },
    view,
    boardAdapter: createBoard(),
    clock: createClock(),
  });

  controller.handleDrop('e2', 'e4');
  await flush();
  await flush();

  assert.deepEqual(state.moves, ['e2e4']);
  assert.equal(state.position.sideToMove, 'b');
  assert.equal(state.position.enPassantSquare, 'e3');
  assert.equal(state.position.toFen(), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
});

test('manual finish uses the server-compatible ended reason instead of claiming a draw', async () => {
  const state = new PlayState();
  state.start({ gameId: 'g1', humanColor: 'w' });
  const view = createPlayView();
  const controller = new PlayController({
    state,
    api: { finishGame: async () => ({ ok: true, result: '*', pgn: '[Result "*"]' }) },
    view,
    boardAdapter: createBoard(),
    clock: createClock(),
  });

  await controller.finishGame();
  assert.equal(state.reason, 'ended');
  assert.equal(view.banner.reason, 'ended');
});
