import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayState } from '../../public/js/play/play-state.mjs';
import { PuzzleState } from '../../public/js/puzzles/puzzle-state.mjs';

test('PlayState memento restores an optimistic move', () => {
  const state = new PlayState();
  state.start({ gameId: 'g-1', humanColor: 'w' });
  const memento = state.createMemento();
  state.position.applyUci('e2e4');
  state.moves.push('e2e4');
  state.restore(memento);
  assert.equal(state.position.pieceAt('e4'), null);
  assert.deepEqual(state.moves, []);
  assert.equal(state.position.sideToMove, 'w');
});

test('PuzzleState side-to-move orientation follows the initial FEN side', () => {
  const state = new PuzzleState();
  state.loadPuzzle({
    fen: '8/8/8/8/8/8/4k3/4K3 b - - 0 1',
    moves: ['e2e1'],
    metadata: {},
  });
  assert.equal(state.whiteAtBottom, false);
  state.viewMode = 'white';
  state.recomputeOrientation();
  assert.equal(state.whiteAtBottom, true);
});
