import test from 'node:test';
import assert from 'node:assert/strict';
import { PuzzleApi } from '../../public/js/puzzles/puzzle-api.mjs';

test('PuzzleApi maps the actual recent-games limit query contract', async () => {
  let call;
  const api = new PuzzleApi({
    get: async (url, options) => {
      call = { url, options };
      return { username: 'tester', games: [] };
    },
  });
  const controller = new AbortController();
  await api.getRecentGames('A User', { limit: 250, signal: controller.signal });
  assert.equal(call.url, '/chesscom/A%20User/games/recent?limit=100');
  assert.equal(call.options.signal, controller.signal);
});

test('PuzzleApi maps moveTimeMs to the server movetimeMs field', async () => {
  let call;
  const api = new PuzzleApi({
    post: async (url, body, options) => {
      call = { url, body, options };
      return { ok: true, puzzles: [] };
    },
  });
  await api.generatePuzzlesForUser({
    username: 'tester',
    maxGames: 3,
    maxPuzzles: 20,
    moveTimeMs: 75,
  });
  assert.equal(call.url, '/puzzles/from-user-ml');
  assert.deepEqual(call.body, {
    username: 'tester',
    maxGames: 3,
    maxPuzzles: 20,
    movetimeMs: 75,
  });
});
