# Ichigo Frontend and Server-Contract Refactor

This package replaces the two monolithic HTML pages with a modular, documented frontend, reconciles it against the supplied `server.js` contracts, and includes an optional hardened extraction for the visible persisted-game routes.

## What is included

- Complete `public/index.html` Play page.
- Complete reconstructed `public/puzzles.html` Puzzles page.
- Shared CSS plus page-specific CSS.
- ES module-based JavaScript organized by architectural layer and feature.
- A shared FEN/UCI chess-position projection.
- Central JSON API handling and typed application errors.
- Drift-aware chess clocks.
- Optimistic Play moves with Memento rollback after server rejection.
- Daily, random, recent-user-game, and single-game puzzle workflows.
- Drag-to-move and functioning click-to-move puzzle interaction.
- Server-authoritative reconciliation from accepted `fen` and `moves` responses.
- Optional hardened Express Router Factory for game move/finish/read/PGN routes.
- Non-destructive live server contract smoke test.
- Node-based frontend, gateway, controller, domain, and server-boundary tests.
- HLD, LLD, API, migration, extension, server-review, and critical-review documentation.

## Important system boundary

The frontend `ChessPosition` is a **position projection**, not a complete legal-move engine. It maintains pieces, turn, FEN metadata, castling projection, en passant, promotion, and move history. It does not prove that a bishop followed a diagonal or that a king is not in check.

- **Play:** the backend `/game/:id/move` endpoint is the legal-move authority.
- **Puzzles:** the frontend only accepts the exact UCI move supplied by the backend solution.

This boundary is deliberate. It prevents a second, incomplete chess rules engine from becoming a competing source of truth.

## Directory structure

```text
ichigo-refactored-frontend/
├── public/
│   ├── index.html
│   ├── puzzles.html
│   ├── css/
│   │   ├── base.css
│   │   ├── play.css
│   │   └── puzzles.css
│   └── js/
│       ├── shared/
│       ├── play/
│       └── puzzles/
├── server/                       # optional hardened route extraction
├── docs/
├── scripts/
│   ├── check-frontend.mjs
│   ├── smoke-server.mjs
│   └── install-server-hardening.sh
└── tests/
    ├── frontend/
    └── server/
```

The package intentionally does not duplicate the third-party `public/chessboardjs-1.0.0/` directory. Retain that existing directory in your project.

## Installation

From your existing project root:

```bash
# Back up the current pages first.
cp public/index.html public/index.before-refactor.html
cp public/puzzles.html public/puzzles.before-refactor.html

# Copy the replacement frontend files.
cp -R /path/to/ichigo-refactored-frontend/public/* public/
```

Confirm that your project still contains:

```text
public/chessboardjs-1.0.0/css/chessboard-1.0.0.min.css
public/chessboardjs-1.0.0/js/chessboard-1.0.0.min.js
public/chessboardjs-1.0.0/img/chesspieces/wikipedia/
```

Then run your normal server:

```bash
npm run dev
```

Do not open the HTML with a `file://` URL. ES modules and API calls should be served through your application server.

## Validation

Run all syntax checks and tests without changing your existing `package.json`:

```bash
node scripts/check-frontend.mjs
```

Current result:

```text
30 tests passed
16 frontend modules syntax-checked
2 optional server modules syntax-checked
2 HTML/View contracts checked
```

With your real server running:

```bash
BASE_URL=http://127.0.0.1:3000 node scripts/smoke-server.mjs
```

The smoke test is non-destructive.

## Optional server hardening

The frontend works with the visible current contracts. The `server/` directory is an optional backend correction, not an automatic replacement for your entire `server.js`.

Copy the modules safely:

```bash
./scripts/install-server-hardening.sh /absolute/path/to/chess
```

Then remove the original duplicate game handlers and mount the Router Factory as documented in `docs/SERVER_JS_REVIEW.md`. The installer deliberately does not edit `server.js`.

The hardened router corrects:

- non-string UCI crashes;
- thrown illegal-move errors from modern chess.js;
- arbitrary PGN results;
- non-atomic terminal writes;
- invalid path IDs;
- `/game/:id.pgn` being shadowed by `/game/:id`;
- missing manual-finish reason.

## Documentation map

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): high-level system architecture and data flow.
- [`docs/LOW_LEVEL_DESIGN.md`](docs/LOW_LEVEL_DESIGN.md): classes, responsibilities, patterns, invariants, and sequence behavior.
- [`docs/COMPONENT_REFERENCE.md`](docs/COMPONENT_REFERENCE.md): every module's inputs, outputs, dependencies, and change impact.
- [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md): confirmed, unconfirmed, and recommended backend HTTP contracts.
- [`docs/SERVER_JS_REVIEW.md`](docs/SERVER_JS_REVIEW.md): actual server compatibility review, defects, route hardening, and integration instructions.
- [`docs/EXTENDING_THE_SYSTEM.md`](docs/EXTENDING_THE_SYSTEM.md): safe modification and extension recipes.
- [`docs/MIGRATION.md`](docs/MIGRATION.md): rollout and rollback instructions.
- [`docs/CRITICAL_REVIEW.md`](docs/CRITICAL_REVIEW.md): design review, corrections, limitations, and next steps.
- [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md): mapping from old monolithic responsibilities to new modules.
- [`docs/VALIDATION_REPORT.md`](docs/VALIDATION_REPORT.md): automated checks, coverage, and unverified integration areas.

## Design vocabulary used

At the high level, the frontend follows a **layered architecture** with feature-oriented modules:

- Presentation layer
- Application layer
- Domain layer
- Infrastructure layer
- Composition roots

At the low level, it uses:

- Controller / Application Service
- Passive View
- Repository / Gateway
- Adapter
- Domain Model
- Aggregate Root
- Memento
- Service Object
- Dependency Injection
- Composition Root

See the architecture documents for where each pattern is used and where it is intentionally not used.
