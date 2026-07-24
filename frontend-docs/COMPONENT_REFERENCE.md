# Component Reference

This document is the change-impact catalog. Use it to determine where a modification belongs and which components it can affect.

## Shared modules

### `public/js/shared/errors.mjs`

**Role:** Error taxonomy.

**Inputs:** Error messages, status, cause, and details.

**Outputs:** `ApplicationError`, `ApiError`, `ChessDataError` instances.

**Dependencies:** None.

**Affected by changes to:** Cross-layer error policy.

**Affects:** API client, controllers, domain model.

---

### `public/js/shared/dom.mjs`

**Role:** Minimal DOM helper functions.

**Inputs:** Element IDs, parent elements, tag descriptions.

**Outputs:** Required elements and newly constructed DOM nodes.

**Dependencies:** Browser DOM.

**Affected by:** DOM helper conventions.

**Affects:** Both views.

---

### `public/js/shared/api-client.mjs`

**Role:** HTTP/JSON transport service.

**Inputs:** URL, HTTP method, JSON body, headers, abort signal.

**Outputs:** Parsed response JSON or `null`.

**Throws:** `ApiError`.

**Dependencies:** `fetch`, `errors.mjs`.

**Affected by:** Authentication, global headers, error-envelope changes, non-JSON APIs.

**Affects:** Every backend request through `PlayApi` and `PuzzleApi`.

---

### `public/js/shared/chess-position.mjs`

**Role:** Shared chess position Domain Model.

**Inputs:** FEN, UCI, squares.

**Outputs:** Position projection, FEN, board map, move records.

**Dependencies:** `ChessDataError` only.

**Affected by:** Move representation, FEN requirements, local rule boundary.

**Affects:** Play state, puzzle state, both board renderings, rollback, solution verification.

**Modification warning:** This is the highest-impact frontend module. Add tests before changing it.

---

### `public/js/shared/chessboard-adapter.mjs`

**Role:** Adapter around chessboard.js.

**Inputs:** `ChessPosition`, orientation, square/move highlights, chessboard callbacks.

**Outputs:** Board DOM changes.

**Dependencies:** Global `Chessboard`, browser DOM.

**Affected by:** Replacing chessboard.js, changing piece assets, highlight implementation.

**Affects:** Both pages' board presentation.

---

### `public/js/shared/countdown-clock.mjs`

**Role:** Drift-aware two-sided countdown service.

**Inputs:** Initial time, active-color callback, time source.

**Outputs:** Tick snapshots and timeout callback.

**Dependencies:** `performance.now`, timers.

**Affected by:** Increments, delay, server clock synchronization, pause policy.

**Affects:** Play clock display and timeout handling.

## Play feature

### `play-state.mjs`

**Role:** Play Aggregate Root and lifecycle.

**Inputs:** Game ID, human color, result DTO, Memento.

**Outputs:** Coherent current state and rollback snapshot.

**Dependencies:** `ChessPosition`.

**Change here when:** Adding game-level client state such as increment, player identity, or analysis mode.

---

### `play-api.mjs`

**Role:** Play HTTP Gateway.

**Inputs:** Domain-oriented arguments such as `gameId`, `uci`, and engine settings.

**Outputs:** Backend DTO promises.

**Dependencies:** `JsonApiClient` interface.

**Change here when:** Backend Play URLs or payload names change.

---

### `play-view.mjs`

**Role:** Passive Play DOM view.

**Inputs:** Move arrays, clock snapshots, status text, result data.

**Outputs:** DOM updates and user setting reads.

**Dependencies:** DOM helpers and exact HTML IDs.

**Change here when:** Play markup, rendering, controls, or labels change.

---

### `play-controller.mjs`

**Role:** Play application workflow orchestrator.

**Inputs:** UI events, API results, clock callbacks.

**Outputs:** State transitions, API calls, renders, logs.

**Dependencies:** Play state/API/view, board adapter, clock.

**Change here when:** The order or policy of Play use cases changes.

**Avoid:** Adding raw `fetch`, raw DOM queries, or chessboard.js selectors.

---

### `play.mjs`

**Role:** Composition Root.

**Inputs:** Browser globals and concrete classes.

**Outputs:** Wired running application.

**Change here when:** Replacing an implementation or adding a top-level dependency.

## Puzzle feature

### `puzzle-state.mjs`

**Role:** Puzzle Aggregate Root.

**Inputs:** Normalized puzzle data and orientation policy.

**Outputs:** Current progress, source, personalized puzzle collection.

**Change here when:** Adding durable puzzle-session state.

---

### `puzzle-api.mjs`

**Role:** Puzzle HTTP Gateway.

**Inputs:** Username, PGN, generation limits.

**Outputs:** Puzzle and game DTO promises.

**Change here when:** Puzzle/Chess.com endpoints change.

---

### `puzzle-view.mjs`

**Role:** Passive Puzzle DOM view.

**Inputs:** Metadata, progress, games, feedback, loading state.

**Outputs:** DOM updates and username/orientation reads.

**Security:** Constructs game-list nodes with `textContent`; does not trust usernames as HTML.

---

### `puzzle-controller.mjs`

**Role:** Puzzle workflow orchestrator.

**Inputs:** Page events and API DTOs.

**Outputs:** Normalized state, board moves, auto-replies, source transitions.

**Change here when:** Adding puzzle-source policies or solving behavior.

---

### `puzzles.mjs`

**Role:** Puzzle Composition Root.

**Inputs/outputs:** Same composition responsibility as `play.mjs`.

## HTML and CSS

### `index.html`

Defines Play semantic structure and script/style loading. IDs form the View contract.

### `puzzles.html`

Defines complete reconstructed Puzzle markup. The provided source attachment began inside a CSS block, so missing document structure was rebuilt from the available markup, IDs, and shared page design.

### `base.css`

Shared design tokens, layout, cards, controls, board presentation, highlights, and responsive behavior.

### `play.css`

Play-specific player strips, clocks, move list, status, banner, and log.

### `puzzles.css`

Puzzle source controls, metadata, feedback, progress, game list, and info panel.

## Dependency direction

Allowed direction:

```text
composition root
  -> controller
     -> state/domain
     -> gateway
     -> view
     -> adapter/service
```

Disallowed direction examples:

- Domain model importing a View.
- API gateway querying the DOM.
- View calling `fetch`.
- Shared module importing a page controller.
- Play module importing Puzzle state.

## Optional server hardening modules

### `server/game-route-helpers.cjs`

**Role:** Pure HTTP/input normalization boundary.

**Inputs:** Raw route IDs, UCI values, result strings, persisted move-history strings.

**Outputs:** Canonical values or `null` for invalid input.

**Dependencies:** None.

**Patterns:** Value Object parsing, Guard Clauses.

**Affected by:** API input grammar or persisted move format.

**Affects:** Hardened game router only.

---

### `server/game-routes.cjs`

**Role:** Express Router Factory for persisted web-game endpoints.

**Inputs:** Injected Express module, SQLite DB, chess reconstruction helper, chess.js compatibility helper, and PGN serializer.

**Outputs:** Express Router containing move, finish, PGN, game-detail, and game-list routes.

**Patterns:** Router Factory, Dependency Injection, Transaction Script, Gateway boundary.

**Important invariant:** `GET /game/:id.pgn` is declared before `GET /game/:id`.

**Change here when:** Game HTTP semantics, persistence transaction boundaries, or response DTOs change.

**Do not mount alongside the original handlers.**

## Validation and integration scripts

### `scripts/check-frontend.mjs`

Runs frontend syntax checks, HTML/View contracts, security checks, optional server-module syntax checks, and all detected Node tests.

### `scripts/smoke-server.mjs`

Runs non-destructive live HTTP checks against `/games`, Daily, Random, and optionally Chess.com recent games.

### `scripts/install-server-hardening.sh`

Copies optional server modules and tests into a project without editing or mounting routes.
