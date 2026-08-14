# Backend API Contracts

## 1. Contract status

This document distinguishes between:

- **Confirmed:** present in the supplied `server.js` excerpt.
- **Frontend-required but unconfirmed:** referenced by the supplied frontend, but the uploaded server text begins in the middle of `/puzzles/random-ml`, so earlier routes were not present in the attachment.
- **Recommended:** a hardening or consistency improvement rather than the current response.

All API responses are JSON unless explicitly marked as plain text.

## 2. Error envelope

The current server consistently uses:

```json
{
  "error": "human-readable explanation"
}
```

Some generation endpoints include `ok: false`:

```json
{
  "ok": false,
  "error": "puzzle generation failed"
}
```

`JsonApiClient` accepts either `error` or `message` as the error description.

## 3. Play contracts

### `POST /game/new`

**Status:** Frontend-required but unconfirmed in the supplied excerpt.

Request:

```json
{
  "time_control": "300+0"
}
```

Required response:

```json
{
  "gameId": 123
}
```

The frontend does not create an offline pseudo-game if this route fails. The server is the game-session and legal-move authority.

---

### `POST /game/:id/move`

**Status:** Confirmed.

Request:

```json
{
  "uci": "e2e4"
}
```

Successful nonterminal response:

```json
{
  "ok": true,
  "moves": "e2e4 e7e5",
  "fen": "complete authoritative FEN",
  "over": false,
  "reason": null,
  "result": "*",
  "pgn": null
}
```

Successful terminal response:

```json
{
  "ok": true,
  "moves": "...",
  "fen": "...",
  "over": true,
  "reason": "checkmate",
  "result": "1-0",
  "pgn": "..."
}
```

Observed error statuses:

- `400`: malformed UCI.
- `404`: unknown game.
- `409`: corrupt persisted move history.
- `422`: illegal move.

The refactored Play controller now reconciles its client projection with both returned fields:

- `fen` replaces the local `ChessPosition` projection.
- `moves` replaces the local move-history projection.

This is an HLD **server-authoritative state reconciliation boundary**. A malformed successful response is logged as a contract defect, but the client does not roll back an already-persisted server move.

---

### `POST /game/:id/finish`

**Status:** Confirmed.

Current request:

```json
{
  "result": "*"
}
```

Current response:

```json
{
  "ok": true,
  "result": "*",
  "pgn": "..."
}
```

The current route does not return `reason`. The frontend therefore maps a successful manual finish to the semantic reason `ended`, not `draw`.

Recommended hardened response:

```json
{
  "ok": true,
  "result": "*",
  "reason": "ended",
  "pgn": "..."
}
```

Accepted result values should be restricted to:

- `*`
- `1-0`
- `0-1`
- `1/2-1/2`

---

### `GET /game/:id`

**Status:** Confirmed.

Returns the persisted game row from `gameById(id)`.

The exact row schema depends on the SQLite table. Consumers should not assume fields beyond those stored by the backend.

---

### `GET /games`

**Status:** Confirmed.

Response:

```json
[
  {
    "id": 123,
    "created_at": "...",
    "result": "*",
    "time_control": "300+0"
  }
]
```

The route returns at most 50 rows, newest database ID first.

---

### `GET /game/:id.pgn`

**Status:** Confirmed.

Response content type: `text/plain`.

The route returns persisted PGN when available or reconstructs it from UCI history.

Important registration invariant:

```text
GET /game/:id.pgn
must be registered before
GET /game/:id
```

Otherwise the generic `:id` route can consume a path segment such as `12.pgn`.

---

### `POST /bookmove`

**Status:** Frontend-required but unconfirmed in the supplied excerpt.

Request:

```json
{
  "moves": ["e2e4", "e7e5"]
}
```

Expected response when found:

```json
{
  "bookmove": "g1f3"
}
```

Opening-book failure is nonfatal. The controller falls back to `/bestmove`.

---

### `POST /bestmove`

**Status:** Frontend-required but unconfirmed in the supplied excerpt.

Request:

```json
{
  "moves": ["e2e4"],
  "movetimeMs": 500,
  "depth": null,
  "wtime": 298750,
  "btime": 300000,
  "winc": 0,
  "binc": 0
}
```

Expected response:

```json
{
  "bestmove": "e7e5",
  "raw": "optional engine diagnostics"
}
```

## 4. Public puzzle contracts

### `GET /puzzles/daily`

### `GET /puzzles/random`

**Status:** Frontend-required but unconfirmed in the supplied excerpt.

Required response:

```json
{
  "id": "puzzle-id",
  "fen": "complete FEN",
  "moves": ["e2e4", "e7e5"],
  "rating": 1450,
  "themes": ["fork", "middlegame"]
}
```

Required fields:

- `fen`: non-empty string.
- `moves`: non-empty UCI array.

The complete FEN must include side to move, castling rights, and en-passant state.

---

### `GET /puzzles/random-ml`

**Status:** Partially confirmed; the supplied text begins inside this route.

Visible response:

```json
{
  "id": 10,
  "fen": "...",
  "moves": ["e2e4", "e7e5"],
  "rating": 1800,
  "themes": ["ml-ranked"],
  "source": "...",
  "ml_score": 0.91
}
```

This route is not currently used by the supplied Puzzle UI.

## 5. Chess.com contracts

### `GET /chesscom/:username/games/recent?limit=15`

**Status:** Confirmed.

`limit` is clamped by the server to the range 1–100, with a default of 15.

Response:

```json
{
  "username": "player",
  "archives": ["https://..."],
  "games": [
    {
      "id": 0,
      "url": "...",
      "end_time": 1234567890,
      "time_control": "600",
      "time_class": "rapid",
      "rated": true,
      "white": {
        "username": "player",
        "rating": 1600,
        "result": "win"
      },
      "black": {
        "username": "opponent",
        "rating": 1550,
        "result": "checkmated"
      },
      "pgn": "..."
    }
  ]
}
```

The server walks archives and games from newest to oldest. The frontend now sorts by `end_time` descending rather than reversing the array.

## 6. Generated-puzzle contracts

### `POST /puzzles/from-user-ml`

**Status:** Confirmed.

Request:

```json
{
  "username": "player",
  "maxGames": 15,
  "maxPuzzles": 200,
  "movetimeMs": 60
}
```

The server clamps:

- `maxGames`: 1–50.
- `maxPuzzles`: 1–500.
- `movetimeMs`: 20–200.

Response:

```json
{
  "ok": true,
  "username": "player",
  "count": 1,
  "puzzles": [
    {
      "fen": "...",
      "sideToMove": "w",
      "uci": "e2e4",
      "san": "e4",
      "ply": 17,
      "moveNumber": 9,
      "pre_eval_cp": 120,
      "best_eval_cp": 120,
      "played_eval_cp": -80,
      "eval_gap_cp": 200,
      "heuristic_difficulty": 320,
      "is_mate": 0,
      "source_event": "...",
      "source_game_id": 0,
      "time_control": "600",
      "time_class": "rapid",
      "rated": true,
      "ml_score": 0.91,
      "moves": ["e2e4", "e7e5"],
      "solutionMoves": ["e2e4", "e7e5"]
    }
  ]
}
```

The frontend accepts solution fields in this order:

1. `solutionMoves`
2. `moves`
3. single `uci`

---

### `POST /puzzles/from-game`

**Status:** Confirmed.

Request:

```json
{
  "pgn": "...",
  "username": "player",
  "maxPuzzles": 12
}
```

Response:

```json
{
  "ok": true,
  "count": 1,
  "puzzles": [
    {
      "fen": "...",
      "solutionMoves": ["e2e4", "e7e5"],
      "ml_score": 0.88,
      "heuristic_difficulty": 300,
      "moveNumber": 12
    }
  ]
}
```

Unlike `/puzzles/from-user-ml`, this visible implementation does not normalize `solutionMoves` to a duplicate `moves` field. The frontend compatibility extractor intentionally supports both representations.

## 7. Page route

### `GET /puzzles`

**Status:** Confirmed.

Serves:

```text
public/puzzles.html
```

## 8. Contract verification boundary

The uploaded server text starts midway through `/puzzles/random-ml`. Therefore these frontend dependencies still require runtime verification against the complete repository:

- `/game/new`
- `/bookmove`
- `/bestmove`
- `/puzzles/daily`
- `/puzzles/random`

Run:

```bash
BASE_URL=http://127.0.0.1:3000 node scripts/smoke-server.mjs
```

Add `CHESSCOM_USERNAME` to include the recent-games contract check.
