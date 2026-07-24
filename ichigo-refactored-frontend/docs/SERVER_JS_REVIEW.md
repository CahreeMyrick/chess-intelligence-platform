# `server.js` Integration and Critical Review

## 1. Review scope

The supplied attachment begins in the middle of the `/puzzles/random-ml` route and continues through game persistence, Chess.com loading, puzzle generation, ML scoring, shutdown, and `app.listen`.

This review therefore has two boundaries:

- The visible routes and functions were reviewed directly.
- Earlier declarations, imports, engine lifecycle code, database setup, and routes such as `/game/new`, `/bookmove`, `/bestmove`, `/puzzles/daily`, and `/puzzles/random` were not present in the uploaded text.

## 2. Current high-level architecture

The visible server is a **modular monolith at deployment time but a procedural monolith in source organization**.

```text
Express route handlers
        │
        ├── SQLite persistence
        ├── chess.js compatibility and game reconstruction
        ├── PGN conversion
        ├── Chess.com HTTP gateway
        ├── engine evaluation gateway
        ├── feature engineering
        └── Python ML scoring gateway
```

All of these responsibilities share one file and mutable process-level collaborators. The deployment archetype is reasonable for the application’s current size, but the source boundaries are too weak.

Recommended HLD decomposition:

```text
HTTP / Presentation Layer
    routes/game-routes
    routes/puzzle-routes
    routes/chesscom-routes

Application Layer
    services/game-service
    services/puzzle-generation-service
    services/recent-game-puzzle-service

Domain Layer
    game result policy
    puzzle candidate model
    puzzle scoring model

Infrastructure Layer
    repositories/game-repository
    gateways/chesscom-gateway
    gateways/engine-gateway
    gateways/python-scorer
```

This does not require microservices. A layered modular monolith is the appropriate target.

## 3. Confirmed frontend compatibility

### Compatible without server changes

- `/game/:id/move` request body `{ uci }`.
- `/game/:id/move` terminal fields `over`, `result`, `reason`, and `pgn`.
- `/puzzles/from-user-ml` request field `movetimeMs`.
- `/puzzles/from-user-ml` exposes both `moves` and `solutionMoves`.
- `/puzzles/from-game` exposes `solutionMoves`; the frontend accepts it.
- Recent games expose the fields required by `PuzzleView`.
- `/puzzles` serves `public/puzzles.html`.

### Frontend changes made after seeing the real server

1. Accepted Play moves now reconcile from returned `fen` and `moves`.
2. Manual finish maps a missing reason to `ended`, not `draw`.
3. Recent Chess.com games are sorted by `end_time` descending; the server already emits newest-first data.
4. `PuzzleApi` sends the actual `limit` query contract.
5. Tests cover `movetimeMs`, server FEN reconciliation, server move-history reconciliation, and manual-finish semantics.

## 4. Backend findings and corrections

### Finding A — non-string UCI may crash after validation

**Severity:** High.

Current pattern:

```js
if (!UCI_REGEX.test(String(uci || ""))) ...
const from = uci.slice(0, 2);
```

An object with a custom `toString()` could satisfy validation, while the raw object has no `.slice()` method.

**Correction:** Require `typeof raw === "string"`, normalize once, and use only the normalized value.

Implemented in:

```text
server/game-route-helpers.cjs
normalizeUci(raw)
```

---

### Finding B — modern chess.js can throw for an illegal move

**Severity:** High.

The route assumes:

```js
const ok = game.move(...);
if (!ok) ...
```

Depending on the chess.js version, invalid input may throw instead of returning `null`.

**Correction:** Wrap `game.move()` and normalize both failure modes to HTTP 422.

---

### Finding C — arbitrary results can be persisted

**Severity:** Medium.

`POST /game/:id/finish` currently accepts any `result` string and feeds it to PGN generation and SQLite.

**Correction:** Restrict to the PGN result vocabulary:

```text
*
1-0
0-1
1/2-1/2
```

---

### Finding D — move and terminal metadata are separate writes

**Severity:** Medium.

A terminal move first updates `moves`, then separately updates `result` and `pgn`. A failure between writes leaves a partially committed terminal game.

**Correction:** Use a better-sqlite3 transaction and one terminal update:

```sql
UPDATE games
SET moves=?, result=?, pgn=?
WHERE id=?
```

---

### Finding E — PGN route can be shadowed

**Severity:** High for PGN retrieval.

The visible order is:

```text
GET /game/:id
GET /games
...
GET /game/:id.pgn
```

`/game/12.pgn` can match `/game/:id` first, producing `id = "12.pgn"` and preventing the intended route from running.

**Correction:** Register `/game/:id.pgn` before `/game/:id`.

---

### Finding F — route IDs are not validated as positive integers

**Severity:** Low to medium.

`Number(req.params.id)` permits `NaN`, decimal numbers, whitespace-like forms, and values outside safe integer range.

**Correction:** Parse a digit-only safe positive integer and return HTTP 400 for invalid syntax.

---

### Finding G — manual finish is semantically mislabeled by old frontend behavior

**Severity:** Medium UX defect.

The current server returns `{ ok, result, pgn }` and no reason. Mapping that absence to `draw` falsely claims the game ended in a draw.

**Correction:** The updated frontend uses `ended`; the hardened route returns `reason: "ended"` explicitly.

---

### Finding H — generated-puzzle schemas are inconsistent

**Severity:** Medium maintainability issue.

`/puzzles/from-user-ml` returns both `moves` and `solutionMoves`, while `/puzzles/from-game` returns `solutionMoves` only.

**Correction options:**

1. Normalize all backend responses to `moves` at the HTTP boundary; or
2. Keep the compatibility extractor temporarily and version the API before removing aliases.

The current frontend implements option 2.

---

### Finding I — ML fallback score changes units

**Severity:** Medium correctness/observability issue.

When Python scoring fails, `ml_score` is populated with `eval_gap_cp`. The normal score appears probability-like, while the fallback is centipawns. The same property therefore has two incompatible units.

**Correction:** Return separate fields:

```json
{
  "ranking_score": 240,
  "ranking_score_type": "eval_gap_cp",
  "ml_score": null
}
```

or normalize fallback values to the trained model’s score range.

---

### Finding J — duplicated puzzle-evaluation pipelines

**Severity:** Medium design debt.

`buildEvalPuzzlesFromPGN()` and `buildPuzzlesFromPGNWithEval()` duplicate PGN loading, focus-color resolution, replay, pre/post evaluation, feature calculation, PV extraction, and filtering.

**Correction:** Extract:

- `parseGameContext(pgn, username)`
- `collectCandidatePositions(context)`
- `evaluateCandidate(candidate, enginePolicy)`
- `rankPuzzleCandidates(candidates, scoringPolicy)`
- `normalizePuzzleDto(candidate)`

This is an LLD application of **Template Method through composition**, not inheritance: share the pipeline steps and inject threshold/scoring policies.

---

### Finding K — unknown username silently defaults to White

**Severity:** Medium data-quality defect.

If the supplied username matches neither PGN White nor Black, puzzle generation defaults to White positions.

**Correction:** Return a validation error or accept an explicit focus color. Silent fallback produces puzzles attributed to the wrong player.

---

### Finding L — duplicate debug output and sensitive operational logging

**Severity:** Low.

The normalized puzzle sample is logged twice, and complete puzzle objects may include game-derived context.

**Correction:** Use a structured logger with levels and redact or sample fields in production.

## 5. Hardened route module

The package includes:

```text
server/game-route-helpers.cjs
server/game-routes.cjs
```

LLD patterns:

- **Router Factory**: constructs an isolated Express Router.
- **Dependency Injection**: DB and domain collaborators are passed in.
- **Gateway boundary**: HTTP syntax is translated into game-service collaborators.
- **Transaction Script**: each route coordinates one atomic use case.
- **Input Value Normalization**: IDs, UCI, results, and move history are parsed once.

Integration:

```js
const { createGameRouter } = require('./server/game-routes.cjs');

app.use(createGameRouter({
  express,
  DB,
  gameById,
  gameFromMoves,
  chessApi: api,
  uciListToPgn,
}));
```

Delete the old handlers for:

```text
POST /game/:id/move
POST /game/:id/finish
GET  /game/:id.pgn
GET  /game/:id
GET  /games
```

Do not mount both implementations.

## 6. Recommended modification sequence

1. Install the frontend only and run the non-destructive smoke test.
2. Add the hardened game router on a separate branch.
3. Run a database-backed integration test with a temporary SQLite database.
4. Extract Chess.com access behind a gateway.
5. Consolidate the two evaluation pipelines.
6. Normalize generated-puzzle DTOs at the HTTP boundary.
7. Add cancellation/concurrency limits for engine-heavy batch analysis.
8. Add structured logging and request correlation IDs.

## 7. Remaining integration boundary

The uploaded text was not the complete beginning of `server.js`. Before declaring full end-to-end compatibility, verify:

- `/game/new` returns `gameId`.
- `/bookmove` accepts `{ moves }` and returns `bookmove`.
- `/bestmove` accepts the exact timing field names.
- `/puzzles/daily` and `/puzzles/random` return `fen` plus non-empty `moves`.
