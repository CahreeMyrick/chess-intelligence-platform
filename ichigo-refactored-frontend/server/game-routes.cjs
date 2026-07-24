'use strict';

const {
  normalizeResult,
  normalizeUci,
  parseMoveHistory,
  parsePositiveInteger,
} = require('./game-route-helpers.cjs');

/**
 * Router Factory / Dependency Injection boundary for persisted web games.
 *
 * Required collaborators:
 * - express: the installed Express module.
 * - DB: better-sqlite3 database instance.
 * - gameById(id): returns the persisted game row or null.
 * - gameFromMoves(moves): reconstructs a chess.js game or returns null.
 * - chessApi(game, modernName, legacyName): resolves chess.js version aliases.
 * - uciListToPgn({ movesUci, headers, result }): renders PGN.
 *
 * Mount with app.use(createGameRouter(...)) after deleting the old duplicate
 * /game and /games handlers from server.js.
 */
function createGameRouter({
  express,
  DB,
  gameById,
  gameFromMoves,
  chessApi,
  uciListToPgn,
}) {
  if (!express?.Router) throw new TypeError('express.Router is required.');
  if (!DB?.prepare || typeof DB.transaction !== 'function') {
    throw new TypeError('A better-sqlite3 DB instance with prepare() and transaction() is required.');
  }
  for (const [name, dependency] of Object.entries({ gameById, gameFromMoves, chessApi, uciListToPgn })) {
    if (typeof dependency !== 'function') throw new TypeError(`${name} must be a function.`);
  }

  const router = express.Router();

  const saveAcceptedMove = DB.transaction(({ id, moves, over, result, pgn }) => {
    if (over) {
      DB.prepare('UPDATE games SET moves=?, result=?, pgn=? WHERE id=?')
        .run(moves, result, pgn, id);
      return;
    }
    DB.prepare('UPDATE games SET moves=? WHERE id=?').run(moves, id);
  });

  const saveFinishedGame = DB.transaction(({ id, result, pgn }) => {
    DB.prepare('UPDATE games SET result=?, pgn=? WHERE id=?').run(result, pgn, id);
  });

  router.post('/game/:id/move', (req, res) => {
    try {
      const id = parsePositiveInteger(req.params.id);
      if (id == null) return res.status(400).json({ error: 'invalid game id' });

      const uci = normalizeUci(req.body?.uci);
      if (!uci) return res.status(400).json({ error: 'bad uci format' });

      const row = gameById(id);
      if (!row) return res.status(404).json({ error: 'not found' });

      const previousMoves = parseMoveHistory(row.moves);
      if (!previousMoves) return res.status(409).json({ error: 'corrupt game history' });

      let game;
      try {
        game = gameFromMoves(previousMoves);
      } catch {
        game = null;
      }
      if (!game) return res.status(409).json({ error: 'corrupt game history' });

      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci[4] || undefined;

      let acceptedMove;
      try {
        acceptedMove = game.move({ from, to, promotion });
      } catch {
        acceptedMove = null;
      }
      if (!acceptedMove) return res.status(422).json({ error: 'illegal move' });

      const movesUci = [...previousMoves, uci];
      const moves = movesUci.join(' ');

      const isCheckmate = chessApi(game, 'isCheckmate', 'in_checkmate')();
      const isStalemate = chessApi(game, 'isStalemate', 'in_stalemate')();
      const isDraw = chessApi(game, 'isDraw', 'in_draw')();
      const isThreefold = chessApi(game, 'isThreefoldRepetition', 'in_threefold_repetition')();
      const isInsufficient = chessApi(game, 'isInsufficientMaterial', 'insufficient_material')();

      let over = false;
      let reason = null;
      let result = '*';

      if (isCheckmate) {
        over = true;
        result = game.turn() === 'w' ? '0-1' : '1-0';
        reason = 'checkmate';
      } else if (isStalemate) {
        over = true;
        result = '1/2-1/2';
        reason = 'stalemate';
      } else if (isThreefold) {
        over = true;
        result = '1/2-1/2';
        reason = 'threefold repetition';
      } else if (isInsufficient) {
        over = true;
        result = '1/2-1/2';
        reason = 'insufficient material';
      } else if (isDraw) {
        over = true;
        result = '1/2-1/2';
        reason = 'draw';
      }

      const pgn = over
        ? uciListToPgn({
            movesUci,
            headers: {
              Event: 'Web Game',
              TimeControl: row.time_control || '300+0',
            },
            result,
          })
        : null;

      saveAcceptedMove({ id, moves, over, result, pgn });

      return res.json({
        ok: true,
        moves,
        fen: game.fen(),
        over,
        reason,
        result,
        pgn,
      });
    } catch (error) {
      console.error('[/game/:id/move]', error);
      return res.status(500).json({ error: 'move failed' });
    }
  });

  router.post('/game/:id/finish', (req, res) => {
    try {
      const id = parsePositiveInteger(req.params.id);
      if (id == null) return res.status(400).json({ error: 'invalid game id' });

      const result = normalizeResult(req.body?.result ?? '*');
      if (!result) return res.status(400).json({ error: 'invalid result' });

      const row = gameById(id);
      if (!row) return res.status(404).json({ error: 'not found' });

      const movesUci = parseMoveHistory(row.moves);
      if (!movesUci) return res.status(409).json({ error: 'corrupt game history' });

      const pgn = uciListToPgn({
        movesUci,
        headers: {
          Event: 'Web Game',
          TimeControl: row.time_control || '300+0',
        },
        result,
      });

      saveFinishedGame({ id, result, pgn });
      return res.json({ ok: true, result, reason: 'ended', pgn });
    } catch (error) {
      console.error('[/game/:id/finish]', error);
      return res.status(500).json({ ok: false, error: 'finish failed' });
    }
  });

  // This route must be registered before GET /game/:id. Otherwise "1.pgn"
  // is consumed as the generic :id segment and the PGN endpoint is shadowed.
  router.get('/game/:id.pgn', (req, res) => {
    try {
      const id = parsePositiveInteger(req.params.id);
      if (id == null) return res.status(400).type('text/plain').send('invalid game id');

      const row = DB.prepare('SELECT moves, pgn, time_control, result FROM games WHERE id=?').get(id);
      if (!row) return res.status(404).type('text/plain').send('not found');

      const movesUci = parseMoveHistory(row.moves);
      if (!movesUci) return res.status(409).type('text/plain').send('corrupt game history');

      const pgn = row.pgn || uciListToPgn({
        movesUci,
        headers: {
          Event: 'Web Game',
          TimeControl: row.time_control || '300+0',
        },
        result: normalizeResult(row.result) || '*',
      });
      return res.type('text/plain').send(pgn);
    } catch (error) {
      console.error('[/game/:id.pgn]', error);
      return res.status(500).type('text/plain').send('pgn generation failed');
    }
  });

  router.get('/game/:id', (req, res) => {
    const id = parsePositiveInteger(req.params.id);
    if (id == null) return res.status(400).json({ error: 'invalid game id' });
    const row = gameById(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    return res.json(row);
  });

  router.get('/games', (_req, res) => {
    const rows = DB.prepare(
      'SELECT id, created_at, result, time_control FROM games ORDER BY id DESC LIMIT 50',
    ).all();
    return res.json(rows);
  });

  return router;
}

module.exports = { createGameRouter };
