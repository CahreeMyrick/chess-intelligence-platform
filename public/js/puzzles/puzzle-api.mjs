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

    getRecentGames(username, { maxGames = 15, signal } = {}) {
      return this.client.post('/puzzles/user-games', { username, maxGames }, { signal });
    }

    generatePuzzlesForUser({ username, maxGames = 15, maxPuzzles = 200, movetimeMs = 40, signal }) {
      return this.client.post('/puzzles/analyze-all', { username, maxGames, maxPuzzles, movetimeMs }, { signal });
    }
  generatePuzzlesFromGame({ pgn, username, maxPuzzles = 12, signal }) {
    return this.client.post('/puzzles/from-game', { pgn, username, maxPuzzles }, { signal });
  }
}
