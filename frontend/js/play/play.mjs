import { JsonApiClient } from '../shared/api-client.mjs';
import { ChessboardAdapter } from '../shared/chessboard-adapter.mjs';
import { CountdownClock } from '../shared/countdown-clock.mjs';
import { PlayApi } from './play-api.mjs';
import { PlayController } from './play-controller.mjs';
import { PlayState } from './play-state.mjs';
import { PlayView } from './play-view.mjs';

/** Composition Root: constructs dependencies and wires callbacks. */
const state = new PlayState();
const view = new PlayView(document);
const api = new PlayApi(new JsonApiClient());

let controller;
const board = new ChessboardAdapter({
  containerId: 'board',
  config: {
    draggable: true,
    dropOffBoard: 'snapback',
    sparePieces: false,
    orientation: 'white',
    pieceTheme: './chessboardjs-1.0.0/img/chesspieces/wikipedia/{piece}.png',
    snapbackSpeed: 180,
    snapSpeed: 80,
    onDragStart: (source, piece) => controller?.canDrag(source, piece) ?? false,
    onDrop: (source, target) => controller?.handleDrop(source, target) ?? 'snapback',
  },
});

const clock = new CountdownClock({
  initialMs: 300_000,
  getActiveColor: () => (state.isActive ? state.position.sideToMove : null),
  onTick: (clocks) => view.renderClocks(clocks, state.isActive ? state.position.sideToMove : null),
  onTimeout: (color) => controller?.handleTimeout(color),
});

controller = new PlayController({ state, api, view, boardAdapter: board, clock });
window.addEventListener('resize', () => board.resize());
controller.initialize();
