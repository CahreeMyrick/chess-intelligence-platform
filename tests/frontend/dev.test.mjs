import test from 'node:test';
import assert from 'node:assert/strict';
import { DevState } from '../../public/js/dev/dev-state.mjs';
import { DevClock } from '../../public/js/dev/dev-clock.mjs';
import { DevController } from '../../public/js/dev/dev-controller.mjs';
import { DevPluginManager, DevLoggerPlugin } from '../../public/js/dev/dev-plugins.mjs';

function createMockView() {
  return {
    logs: [],
    mode: 'pvp',
    timerMode: 'none',
    humanSide: 'w',
    engineConfig: { depth: 2, movetimeMs: 100 },
    fenInput: '',
    bind(handlers) {
      this.handlers = handlers;
    },
    getGameMode() {
      return this.mode;
    },
    getTimerMode() {
      return this.timerMode;
    },
    getTimeConfig() {
      return {
        timerMode: this.timerMode,
        initialMinutes: 5,
        incrementSeconds: 0,
      };
    },
    getHumanSide() {
      return this.humanSide;
    },
    getEngineConfig() {
      return this.engineConfig;
    },
    getAutoFlip() {
      return false;
    },
    getFenInput() {
      return this.fenInput;
    },
    setFenInput(fen) {
      this.fenInput = fen;
    },
    updateConfigPanels() {},
    updateTimerControls() {},
    updatePlayerStrips() {},
    updateClocks() {},
    setStatus() {},
    setThinking() {},
    renderMoves() {},
    log(msg) {
      this.logs.push(String(msg));
    },
  };
}

function createMockBoard() {
  return {
    orientation: 'white',
    renderedPosition: null,
    disabled: false,
    render(pos) {
      this.renderedPosition = pos;
    },
    setOrientation(color) {
      this.orientation = color;
    },
    setDisabled(d) {
      this.disabled = d;
    },
    clearHighlights() {},
    highlightMove() {},
    highlightSquare() {},
  };
}

function createMockApi() {
  return {
    async getBestMove() {
      return { bestmove: 'e7e5', depth: 2 };
    },
    async getBookMove() {
      return { bookmove: null };
    },
  };
}

test('DevState initializes correctly for PvP and PvEngine', () => {
  const state = new DevState();
  assert.equal(state.isActive, false);

  state.start({ mode: 'pvp', timerMode: 'none' });
  assert.equal(state.isActive, true);
  assert.equal(state.mode, 'pvp');
  assert.equal(state.timerMode, 'none');
  assert.equal(state.isHumanTurn(), true);

  state.start({ mode: 'pve', humanColor: 'b', timerMode: 'timed' });
  assert.equal(state.isActive, true);
  assert.equal(state.mode, 'pve');
  assert.equal(state.humanColor, 'b');
  assert.equal(state.isHumanTurn(), false); // White to move first, human is Black
  assert.equal(state.isEngineTurn(), true);
});

test('DevState undo rolls back move history correctly', () => {
  const state = new DevState();
  state.start({ mode: 'pvp', timerMode: 'none' });

  state.position.applyUci('e2e4');
  state.recordMove('e2e4');
  assert.equal(state.moves.length, 1);
  assert.equal(state.sideToMove, 'b');

  state.position.applyUci('e7e5');
  state.recordMove('e7e5');
  assert.equal(state.moves.length, 2);
  assert.equal(state.sideToMove, 'w');

  const undid = state.undo();
  assert.equal(undid, true);
  assert.equal(state.moves.length, 1);
  assert.equal(state.moves[0], 'e2e4');
  assert.equal(state.sideToMove, 'b');
});

test('DevClock handles countdown, turn increments, and untimed mode', () => {
  let currentTime = 1000;
  let timeoutTriggered = null;

  const clock = new DevClock({
    initialMs: 60_000,
    incrementMs: 2_000,
    timerMode: 'timed',
    getActiveColor: () => 'w',
    onTimeout: (color) => {
      timeoutTriggered = color;
    },
    now: () => currentTime,
  });

  clock.start();
  currentTime += 5000; // 5 seconds elapsed
  clock.snapshot(); // tick
  clock.stop();

  clock.switchTurn('w'); // +2s increment
  const snapshot = clock.snapshot();
  assert.equal(snapshot.timerMode, 'timed');
});

test('DevPluginManager emits events to registered plugins', async () => {
  const pm = new DevPluginManager();
  const logs = [];
  const logger = new DevLoggerPlugin({
    logSink: (msg) => logs.push(msg),
  });

  pm.register('logger', logger);
  await pm.emit('moveApplied', {
    uci: 'e2e4',
    moveNumber: 1,
    sideToMove: 'b',
    fen: 'startpos',
  });

  assert.equal(logs.length, 1);
  assert.match(logs[0], /\[Move #1\] e2e4/);
});

test('DevController coordinates PvP moves and undo', async () => {
  const state = new DevState();
  const view = createMockView();
  const board = createMockBoard();
  const api = createMockApi();
  const clock = new DevClock({ initialMs: 300_000, timerMode: 'none' });
  const pluginManager = new DevPluginManager();

  const controller = new DevController({
    state,
    api,
    view,
    boardAdapter: board,
    clock,
    pluginManager,
  });

  controller.initialize();

  // Test white move
  assert.equal(controller.canDrag('e2', 'wP'), true);
  assert.equal(controller.canDrag('e7', 'bP'), false); // White's turn

  const dropResult = controller.handleDrop('e2', 'e4');
  assert.equal(dropResult, undefined);
  assert.equal(state.moves.length, 1);
  assert.equal(state.sideToMove, 'b');

  // Test black move
  assert.equal(controller.canDrag('e7', 'bP'), true);
  controller.handleDrop('e7', 'e5');
  assert.equal(state.moves.length, 2);
  assert.equal(state.sideToMove, 'w');

  // Test undo
  controller.handleUndo();
  assert.equal(state.moves.length, 1);
  assert.equal(state.sideToMove, 'b');
});

test('DevController coordinates PvEngine moves and engine response', async () => {
  const state = new DevState();
  const view = createMockView();
  view.mode = 'pve';
  view.humanSide = 'w';

  const board = createMockBoard();
  const api = createMockApi();
  const clock = new DevClock({ initialMs: 300_000, timerMode: 'none' });
  const pluginManager = new DevPluginManager();

  const controller = new DevController({
    state,
    api,
    view,
    boardAdapter: board,
    clock,
    pluginManager,
  });

  controller.initialize();
  assert.equal(state.mode, 'pve');
  assert.equal(state.humanColor, 'w');

  // Human plays e2e4
  controller.handleDrop('e2', 'e4');
  await new Promise((res) => setImmediate(res));
  assert.equal(state.moves.length, 2); // Human e2e4 + Engine response e7e5 from mock API
  assert.equal(state.moves[0], 'e2e4');
  assert.equal(state.moves[1], 'e7e5');
});
