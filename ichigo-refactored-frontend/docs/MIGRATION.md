# Migration and Rollback

## 1. Scope

The default installer replaces frontend files only. It does not modify:

- `server.js`
- C++ engine code
- CMake configuration
- puzzle-generation backend code
- data files
- chessboard.js third-party assets

## 2. Pre-migration checklist

- Commit or stash the working tree.
- Confirm the current branch.
- Confirm `public/index.html` and `public/puzzles.html` are the active pages.
- Confirm the backend endpoints in `API_CONTRACTS.md`.
- Confirm Node/browser support for ES modules.

Recommended branch:

```bash
git switch -c frontend-modular-refactor
```

## 3. Backup

```bash
mkdir -p public/legacy
cp public/index.html public/legacy/index.monolith.html
cp public/puzzles.html public/legacy/puzzles.monolith.html
```

## 4. Copy

From the project root:

```bash
cp -R /path/to/ichigo-refactored-frontend/public/* public/
cp -R /path/to/ichigo-refactored-frontend/docs ./frontend-docs
cp -R /path/to/ichigo-refactored-frontend/tests/frontend tests/
cp /path/to/ichigo-refactored-frontend/scripts/check-frontend.mjs scripts/
```

If `scripts/` does not exist:

```bash
mkdir -p scripts
```

## 5. Static validation

```bash
node scripts/check-frontend.mjs
```

Expected:

```text
30 tests passed in the complete package
Checked 16 frontend modules, 2 optional server modules, and 2 HTML/View contracts.
```

A frontend-only installation runs the tests and modules copied into that project.

## 6. Runtime smoke test

Start the existing server and verify:

### Play

- Initial board renders but cannot be moved before New Game.
- New Game creates a server game.
- White and Black side selection work.
- Illegal move is rolled back after server rejection.
- Opening-book or engine move appears.
- Hint highlights two squares.
- Flip works.
- Clock runs and active side changes.
- Finish shows result and PGN when returned.

### Puzzles

- Daily puzzle loads.
- Random puzzle load does not get overwritten by a stale Daily response.
- Side-to-move orientation is correct.
- Wrong move snaps back and shows feedback.
- Correct move triggers automatic reply.
- Click-to-move and drag-to-move both work.
- Reset, Step, and Auto work.
- From Games loads usernames safely.
- Previous/Next work for personalized puzzles.

## 7. Server route note

The HTML links to `/puzzles`. If your server only serves static filenames, either:

- Add a route from `/puzzles` to `public/puzzles.html`, or
- Change links to `/puzzles.html`.

Use one convention consistently.

## 8. Rollback

```bash
cp public/legacy/index.monolith.html public/index.html
cp public/legacy/puzzles.monolith.html public/puzzles.html
rm -rf public/js/shared public/js/play public/js/puzzles
rm -f public/css/base.css public/css/play.css public/css/puzzles.css
```

A Git rollback is safer:

```bash
git restore public
```

## 9. Suggested commits

```text
refactor(frontend): extract shared styles and browser modules
refactor(chess-ui): centralize FEN and UCI position projection
refactor(play): introduce controller gateway view and memento rollback
refactor(puzzles): modularize puzzle sources and solving workflow
docs(frontend): add HLD LLD API and extension guides
test(frontend): cover position projection API errors and state rollback
```


## 10. Reconcile against the live server

Start the server, then run the non-destructive contract smoke test:

```bash
BASE_URL=http://127.0.0.1:3000 node scripts/smoke-server.mjs
```

Optional Chess.com check:

```bash
BASE_URL=http://127.0.0.1:3000 \
CHESSCOM_USERNAME=your_username \
node scripts/smoke-server.mjs
```

The uploaded `server.js` text began in the middle of a route, so this runtime step is still required for `/game/new`, `/bookmove`, `/bestmove`, `/puzzles/daily`, and `/puzzles/random`.

## 11. Optional hardened game routes

Copy, but do not automatically mount, the optional modules:

```bash
./scripts/install-server-hardening.sh /absolute/path/to/chess
```

In `server.js`:

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

Before mounting, remove the old handlers for:

```text
POST /game/:id/move
POST /game/:id/finish
GET  /game/:id.pgn
GET  /game/:id
GET  /games
```

Mounting both copies creates duplicate route behavior and defeats the refactor.
