/**
 * Repository/Gateway Pattern: typed façade over Play-related HTTP endpoints.
 * The controller does not know URL construction or transport details.
 */
export class PlayApi {
  constructor(client) {
    this.client = client;
  }

  async createGame({ timeControl = '300+0' } = {}) {
    const data = await this.client.post('/game/new', { time_control: timeControl });
    if (!data?.gameId) throw new Error('The server did not return gameId for /game/new.');
    return { gameId: data.gameId };
  }

  submitMove(gameId, uci) {
    return this.client.post(`/game/${encodeURIComponent(gameId)}/move`, { uci });
  }

  finishGame(gameId, result = '*') {
    return this.client.post(`/game/${encodeURIComponent(gameId)}/finish`, { result });
  }

  getBookMove(moves, { signal } = {}) {
    return this.client.post('/bookmove', { moves }, { signal });
  }

  getBestMove({ moves, moveTimeMs, depth, clocks, signal }) {
    return this.client.post('/bestmove', {
      moves,
      movetimeMs: moveTimeMs,
      depth: depth ?? null,
      wtime: Math.max(0, Math.round(clocks.w)),
      btime: Math.max(0, Math.round(clocks.b)),
      winc: 0,
      binc: 0,
    }, { signal });
  }
}
