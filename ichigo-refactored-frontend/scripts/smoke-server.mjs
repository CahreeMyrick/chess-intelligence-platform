#!/usr/bin/env node

/**
 * Non-destructive live contract smoke test.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:3000 node scripts/smoke-server.mjs
 *   BASE_URL=http://127.0.0.1:3000 CHESSCOM_USERNAME=name node scripts/smoke-server.mjs
 *
 * This deliberately does not create, move, or finish a game. Those operations
 * mutate the database and belong in an isolated integration-test environment.
 */
const baseUrl = String(process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const username = String(process.env.CHESSCOM_USERNAME || '').trim();

async function request(path, { expectedType = 'json' } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: expectedType === 'json' ? 'application/json' : 'text/plain' },
  });
  const body = expectedType === 'json' ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
}

const checks = [
  ['GET /games', async () => {
    const rows = await request('/games');
    if (!Array.isArray(rows)) throw new Error('/games must return an array.');
    return `${rows.length} rows`;
  }],
  ['GET /puzzles/daily', async () => {
    const puzzle = await request('/puzzles/daily');
    if (typeof puzzle?.fen !== 'string' || !Array.isArray(puzzle?.moves) || !puzzle.moves.length) {
      throw new Error('/puzzles/daily must return fen and a non-empty moves array.');
    }
    return `${puzzle.moves.length} solution plies`;
  }],
  ['GET /puzzles/random', async () => {
    const puzzle = await request('/puzzles/random');
    if (typeof puzzle?.fen !== 'string' || !Array.isArray(puzzle?.moves) || !puzzle.moves.length) {
      throw new Error('/puzzles/random must return fen and a non-empty moves array.');
    }
    return `${puzzle.moves.length} solution plies`;
  }],
];

if (username) {
  checks.push([`GET Chess.com games for ${username}`, async () => {
    const data = await request(`/chesscom/${encodeURIComponent(username)}/games/recent?limit=2`);
    if (!Array.isArray(data?.games)) throw new Error('Recent-games response must contain games[].');
    return `${data.games.length} games`;
  }]);
}

let failures = 0;
for (const [name, run] of checks) {
  try {
    const detail = await run();
    console.log(`PASS ${name}: ${detail}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

if (failures) process.exitCode = 1;
