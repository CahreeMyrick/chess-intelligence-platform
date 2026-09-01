import { JsonApiClient } from '../shared/api-client.mjs';

/**
 * Infrastructure Gateway for Development Environment Engine Calls.
 */
export class DevApi {
  constructor({ client = new JsonApiClient() } = {}) {
    this.client = client;
  }

  async getBestMove({
    fen = null,
    moves = [],
    depth = null,
    movetimeMs = 500,
    wtime = null,
    btime = null,
    winc = null,
    binc = null,
    signal,
  } = {}) {
    return this.client.post(
      '/bestmove',
      {
        fen,
        moves,
        depth: depth !== null ? Number(depth) : null,
        movetimeMs: Number(movetimeMs) || 500,
        wtime: wtime !== null ? Math.round(Number(wtime)) : null,
        btime: btime !== null ? Math.round(Number(btime)) : null,
        winc: winc !== null ? Math.round(Number(winc)) : null,
        binc: binc !== null ? Math.round(Number(binc)) : null,
      },
      { signal },
    );
  }

  async getBookMove({ moves = [], signal } = {}) {
    return this.client.post('/bookmove', { moves }, { signal });
  }
}
