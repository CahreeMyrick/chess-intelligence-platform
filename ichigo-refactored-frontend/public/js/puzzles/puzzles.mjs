import { JsonApiClient } from '../shared/api-client.mjs';
import { ChessboardAdapter } from '../shared/chessboard-adapter.mjs';
import { PuzzleApi } from './puzzle-api.mjs';
import { PuzzleController } from './puzzle-controller.mjs';
import { PuzzleState } from './puzzle-state.mjs';
import { PuzzleView } from './puzzle-view.mjs';

/** Composition Root for the Puzzles page. */
const state = new PuzzleState();
const view = new PuzzleView(document);
const api = new PuzzleApi(new JsonApiClient());
let controller;

const board = new ChessboardAdapter({
  containerId: 'board',
  config: {
    draggable: true,
    dropOffBoard: 'snapback',
    position: 'start',
    orientation: 'white',
    pieceTheme: './chessboardjs-1.0.0/img/chesspieces/wikipedia/{piece}.png',
    snapbackSpeed: 180,
    snapSpeed: 80,
    onDragStart: (source, piece) => controller?.canDrag(source, piece) ?? false,
    onDrop: (source, target) => controller?.handleDrop(source, target) ?? 'snapback',
  },
});

controller = new PuzzleController({ state, api, view, boardAdapter: board });
window.addEventListener('resize', () => board.resize());
controller.initialize();
