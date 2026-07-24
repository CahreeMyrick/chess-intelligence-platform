# Validation Report

**Validation date:** July 24, 2026  
**Scope:** Refactored frontend, server contract adapter, and hardened visible game-route extraction.

## Automated command

```bash
node scripts/check-frontend.mjs
```

## Results

```text
30 tests passed
0 tests failed
16 frontend ES modules passed syntax checks
2 server CommonJS modules passed syntax checks
2 HTML/View element contracts passed
6 test files executed
0 direct fetch calls outside JsonApiClient
0 innerHTML assignments in application HTML/JavaScript
0 missing relative frontend module imports
```

## Test groups

### ChessPosition domain tests

- Square conversion.
- UCI normalization and rejection.
- Standard FEN round trip.
- Normal move state updates.
- En-passant metadata and capture.
- Invalid diagonal pawn transaction safety.
- Castling rook projection and rights.
- Invalid castling transaction safety.
- Promotion requirements and underpromotion.
- Clone isolation.
- Malformed placement and FEN metadata.

### API and gateway tests

- POST body serialization.
- Parsed success response.
- Non-2xx `ApiError` mapping.
- Successful empty response.
- Invalid JSON contract failure.
- Chess.com `limit` query mapping.
- `moveTimeMs` to server `movetimeMs` mapping.

### State and controller tests

- Play Memento rollback.
- Synchronous chessboard `onDrop` behavior.
- Rejected optimistic-move rollback.
- Latest New Game request wins.
- Latest puzzle request wins.
- Exact puzzle move acceptance.
- Automatic puzzle reply.
- Puzzle orientation from FEN side to move.
- Accepted move reconciliation from server FEN.
- Accepted history reconciliation from server move string.
- Manual finish uses `ended` rather than false `draw` semantics.

### Server input-boundary tests

- UCI accepts canonical strings and normalizes case.
- UCI rejects non-string values before `.slice()` use.
- Game IDs accept only safe positive integers.
- Results accept only PGN result vocabulary.
- Persisted move histories validate every UCI token.

## Static contract checks

The validation script:

- Extracts every `requireElement('id')` call from each View and verifies its HTML element.
- Resolves every relative frontend ES-module import.
- Confines direct `fetch()` usage to `JsonApiClient`.
- Rejects `.innerHTML` assignments in application HTML and JavaScript.
- Syntax-checks the extracted CommonJS server modules.

## Live contract smoke test

Start the existing server, then run:

```bash
BASE_URL=http://127.0.0.1:3000 node scripts/smoke-server.mjs
```

Optional Chess.com verification:

```bash
BASE_URL=http://127.0.0.1:3000 \
CHESSCOM_USERNAME=your_username \
node scripts/smoke-server.mjs
```

The script is intentionally non-destructive. It does not create, move, or finish games.

## Checks still requiring the complete running repository

- `/game/new`, because it was outside the uploaded server excerpt.
- `/bookmove` and `/bestmove`, because they were outside the uploaded excerpt.
- `/puzzles/daily` and `/puzzles/random`, because they were outside the uploaded excerpt.
- Real SQLite transaction integration for the optional hardened router.
- Real browser rendering with local chessboard.js assets.
- Real engine, opening-book, Python model, and Chess.com execution.
- Cross-browser and accessibility automation.
