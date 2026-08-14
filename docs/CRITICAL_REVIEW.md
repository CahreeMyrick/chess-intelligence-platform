# Critical Design and Code Review

## 1. Review method

The package was reviewed in four passes:

1. **Responsibility review:** identify mixed concerns and dependency direction.
2. **Correctness review:** examine FEN, UCI, castling, en passant, promotion, rollback, and async behavior.
3. **Security/reliability review:** inspect HTML rendering, stale requests, overlapping commands, and failures.
4. **Executable validation:** syntax-check all modules and run Node tests.

## 2. Corrections made during the review

### Async `onDrop` contract

**Problem:** The original `async onDrop()` returned a Promise to chessboard.js. chessboard.js expects the immediate string `'snapback'` or no return value.

**Correction:** `handleDrop()` is synchronous. It applies a local projection and returns immediately. Server persistence is started without awaiting inside the callback. Rejection later restores the Memento and rerenders.

### Transactional castling

**Problem:** A naive implementation could move the king and only then discover that the rook was missing.

**Correction:** Castling destination and rook state are validated before either piece is mutated. A unit test verifies no partial mutation.

### En-passant accuracy

**Problem:** The original Puzzle code removed a pawn after any diagonal pawn move into an empty square if an adjacent enemy pawn happened to exist.

**Correction:** En passant requires `destination === enPassantSquare` from current position metadata. A diagonal pawn move to any other empty square is rejected.

### Promotion coherence

**Problem:** A pawn could reach the final rank without a UCI suffix, or include a suffix on another rank.

**Correction:** Both conditions now throw a `ChessDataError`. Underpromotions are preserved from server UCI.

### Optimistic rollback completeness

**Problem:** Multiple individual previous variables make it easy to forget a field during rollback.

**Correction:** The Play Aggregate creates and restores one Memento containing position, moves, hint, and lock state.

### Stale async work

**Problem:** A slow Daily puzzle request could overwrite a newer Random/From Games selection. Repeated New Game clicks could initialize the wrong session.

**Correction:** Puzzle `loadVersion`, Play `sessionVersion`, and `startRequestVersion` invalidate stale results. Engine/hint requests also use `AbortController`.

### DOM injection

**Problem:** Original game rows used template-string `innerHTML` with remote usernames and results.

**Correction:** Game rows are assembled with `createElement()` and `textContent`.

### Inconsistent puzzle data

**Problem:** The original verifier could display an error but leave the puzzle interactive.

**Correction:** `PuzzleState.validationError` blocks drag, click, step, auto, and expected-move application.

### Clock drift

**Problem:** Subtracting exactly 1000 ms per interval accumulates drift when the browser delays timers.

**Correction:** `CountdownClock` subtracts actual elapsed time measured by `performance.now()`.

## 3. Strengths of the final design

### Clear dependency direction

Domain code has no DOM or HTTP dependencies. Views have no endpoint knowledge. Gateways have no UI state. This substantially reduces accidental coupling.

### Good change localization

Backend payload changes normally affect one Gateway. Visual changes normally affect HTML/CSS/View. chessboard.js replacement is isolated behind an Adapter.

### Explicit consistency boundaries

`PlayState` and `PuzzleState` communicate which fields must change together. Memento rollback is coherent rather than ad hoc.

### Minimal framework overhead

The design uses recognizable patterns without adding a frontend framework, bundler, global store, event bus, or dependency container that the current scale does not need.

### Improved observability

User-facing statuses and engine log messages identify book, hint, move rejection, engine, and game-over paths.

## 4. Remaining limitations and risks

### A. No complete local legal-move validation

**Severity:** Medium.

The frontend projection does not validate movement geometry or king safety. This is acceptable only because Play move legality remains server-authoritative and Puzzle moves must match server solutions.

**Consequence:** The board may display an illegal optimistic move briefly before rollback.

**Recommended next step:** Inject a proven chess rules library as a local validator, while retaining the backend as authority.

### B. Backend contracts were inferred, not integration-tested

**Severity:** High until verified.

Only frontend source files were supplied. Actual server response edge cases may differ.

**Recommended next step:** Run the smoke checklist against the real `server.js`, then add API integration tests.

### C. Clock is browser-authoritative

**Severity:** Medium for competitive timing, low for casual play.

Background-tab throttling and network latency can cause mismatch with server time. The drift-aware clock improves local accuracy but cannot provide authoritative synchronized time.

**Recommended next step:** Return clock values from every accepted move and resynchronize.

### D. Timeout is not persisted to the backend

**Severity:** Medium.

The local UI ends on timeout, matching the original behavior, but it does not currently submit the timeout result.

**Recommended next step:** Add a timeout-specific server endpoint or finish payload and perform best-effort persistence before/after local finalization.

### E. Promotion UI always chooses queen in Play

**Severity:** Medium.

The player drag handler appends `q` automatically. This prevents intentional rook, bishop, or knight promotion.

**Recommended next step:** Add a promotion-choice modal before applying/submitting a last-rank pawn move.

### F. External CDN dependency

**Severity:** Low to medium.

Google Fonts and jQuery are loaded from external CDNs. chessboard.js is local, but it requires jQuery.

**Recommended next step:** Self-host jQuery and fonts or add Subresource Integrity and a CSP.

### G. No browser integration test included

**Severity:** Medium.

Unit tests cover pure modules, but chessboard.js callbacks and real DOM behavior need browser automation.

**Recommended next step:** Add Playwright tests with mocked endpoints for New Game, move rejection/acceptance, puzzle load, and source races.

### H. Engine log grows without bound

**Severity:** Low.

Long sessions can create a large text node.

**Recommended next step:** Store a capped log array, such as the latest 200 entries.

### I. Accessibility is improved but incomplete

**Severity:** Low to medium.

Labels and status regions were added, but chessboard.js piece movement is not fully keyboard accessible.

**Recommended next step:** Add a keyboard board interaction model and announcements for selected square, piece, and move result.

### J. Puzzle solution remains discoverable

**Severity:** Low.

The original page displayed raw solution UCI. The refactor collapses it by default, but users can still reveal it.

**Recommended next step:** Make solution visibility a debug/development feature or reveal only after solving.

## 5. SOLID review

### Single Responsibility Principle

Mostly satisfied. Controllers remain the largest modules because they coordinate use cases; their private methods keep workflows separated.

### Open/Closed Principle

Puzzle sources and API mappings can be extended with contained changes. A formal source Strategy registry may become useful after several additional sources, but would be premature now.

### Liskov Substitution Principle

No inheritance hierarchy is used. Concrete collaborators can be replaced by compatible test fakes through constructor injection.

### Interface Segregation Principle

Collaborators expose small practical interfaces. Views still expose several methods because pages have many render regions, but controllers do not receive unrelated backend methods.

### Dependency Inversion Principle

Controllers depend on passed collaborator behavior rather than constructing `fetch`, DOM nodes, timers, or chessboard.js internally. JavaScript does not enforce interfaces, so documentation and tests serve as the contract.

## 6. Complexity review

### Appropriate complexity

- Two aggregates instead of one global store.
- Two controllers instead of one generic super-controller.
- Shared domain/transport/adapter only where actual duplication exists.

### Complexity intentionally avoided

- Redux-style global state.
- Event bus.
- Command and mediator layers.
- Generic abstract base controller.
- Dependency injection framework.
- Build tooling.

These may become useful only if the frontend grows significantly beyond Play and Puzzles.

## 7. Test result

```text
21 tests
21 passed
0 failed
16 ES modules syntax-checked
```

Covered areas:

- Controller rollback and asynchronous race behavior.

- Square and UCI parsing.
- FEN round trip and malformed FEN.
- Normal move metadata.
- En passant.
- Castling and transactional failure.
- Promotion.
- Clone independence.
- JSON requests and errors.
- Play Memento rollback.
- Puzzle orientation.

Not covered yet:

- Real DOM/chessboard.js rendering.
- Controller workflows with fakes.
- Real backend integration.
- Browser accessibility.

## 8. Review after receiving the server implementation

A fifth pass reconciled the frontend against the supplied `server.js` excerpt.

### Server-authoritative accepted-state reconciliation

The real move endpoint returns full `fen` and `moves` values. The Play controller now replaces its projection from these values after every accepted human or engine move. This reduces drift and makes the HLD authority boundary executable rather than merely documented.

### Manual finish semantics

The real finish endpoint does not return a reason. The prior default of `draw` was incorrect. The controller now uses `ended`, and the view renders `Game Ended`.

### Recent-game order

The server traverses Chess.com archives and games newest-first. Reversing the result in the view displayed the oldest item first. The view now sorts by `end_time` descending and caps the rendered list at 15.

### Backend route hardening

A separate Router Factory was added for the visible persisted-game endpoints. It validates IDs, UCI, and results; catches chess.js move exceptions; performs atomic terminal writes; and places the PGN route before the generic ID route.

See `SERVER_JS_REVIEW.md` for the complete server findings.

## 9. Updated test result

```text
30 tests
30 passed
0 failed
16 ES modules syntax-checked
2 CommonJS server modules syntax-checked
2 HTML/View contracts checked
```
