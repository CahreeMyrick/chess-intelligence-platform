import { JsonApiClient } from '../shared/api-client.mjs';
import { ChessboardAdapter } from '../shared/chessboard-adapter.mjs';
import { DevApi } from './dev-api.mjs';
import { DevClock } from './dev-clock.mjs';
import { DevController } from './dev-controller.mjs';
import { DevPluginManager, DevLoggerPlugin, DevFenSyncPlugin } from './dev-plugins.mjs';
import { DevState } from './dev-state.mjs';
import { DevView } from './dev-view.mjs';

/**
 * Composition Root for Development Chess Playground
 */
const state = new DevState();
const view = new DevView(document);
const api = new DevApi({ client: new JsonApiClient() });
const pluginManager = new DevPluginManager();

// Register extensible plugins
pluginManager.register(
  'logger',
  new DevLoggerPlugin({
    logSink: (msg) => view.log(msg),
  }),
);

pluginManager.register(
  'fenSync',
  new DevFenSyncPlugin({
    onFenUpdate: (fen) => view.setFenInput(fen),
  }),
);

let controller;

const board = new ChessboardAdapter({
  containerId: 'devBoard',
  config: {
    draggable: true,
    dropOffBoard: 'snapback',
    sparePieces: false,
    orientation: 'white',
    pieceTheme: '/chessboardjs-1.0.0/img/chesspieces/wikipedia/{piece}.png',
    snapbackSpeed: 180,
    snapSpeed: 80,
    onDragStart: (source, piece) => controller?.canDrag(source, piece) ?? false,
    onDrop: (source, target) => controller?.handleDrop(source, target) ?? 'snapback',
  },
});

const clock = new DevClock({
  initialMs: 300_000,
  incrementMs: 0,
  timerMode: 'none',
  getActiveColor: () => (state.isActive ? state.position.sideToMove : null),
  onTick: ({ remaining, activeColor, timerMode }) => {
    view.updateClocks({
      remaining,
      activeColor,
      timerMode,
      whiteAtBottom: state.whiteAtBottom,
    });
  },
  onTimeout: (color) => controller?.handleTimeout(color),
});

controller = new DevController({
  state,
  api,
  view,
  boardAdapter: board,
  clock,
  pluginManager,
});

window.addEventListener('resize', () => board.resize());
controller.initialize();
requestAnimationFrame(() => board.resize());
setTimeout(() => board.resize(), 100);

// Expose on window for easy developer experimentation in browser console
window.ichigoDev = {
  state,
  controller,
  board,
  clock,
  pluginManager,
  api,
};
