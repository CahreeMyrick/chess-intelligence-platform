/** Repository/Gateway for puzzle and Chess.com-related endpoints. */
export class PuzzleApi {
  constructor(client) {
    this.client = client;
  }

  getDailyPuzzle({ signal } = {}) {
    return this.client.get('/puzzles/daily', { signal });
  }

  getRandomPuzzle({ signal } = {}) {
    return this.client.get('/puzzles/random', { signal });
  }

  getRecentGames(username, { limit = 15, signal } = {}) {
    const normalizedLimit = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 15)));
    return this.client.get(
      `/chesscom/${encodeURIComponent(username)}/games/recent?limit=${normalizedLimit}`,
      { signal },
    );
  }

  generatePuzzlesForUser({ username, maxGames = 15, maxPuzzles = 200, moveTimeMs = 60, signal }) {
    return this.client.post('/puzzles/from-user-ml', {
      username,
      maxGames,
      maxPuzzles,
      movetimeMs: moveTimeMs,
    }, { signal });
  }

  generatePuzzlesFromGame({ pgn, username, maxPuzzles = 12, signal }) {
    return this.client.post('/puzzles/from-game', { pgn, username, maxPuzzles }, { signal });
  }
}
