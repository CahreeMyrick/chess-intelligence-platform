# Extending and Modifying the System

## General rule

Place a change in the layer that owns the reason for change:

- Visual layout or labels -> HTML/CSS/View.
- Use-case sequence or policy -> Controller.
- Persistent page state -> Aggregate state.
- Chess position representation -> `ChessPosition`.
- Backend URL or payload -> API Gateway.
- HTTP-wide behavior -> `JsonApiClient`.
- chessboard.js behavior -> `ChessboardAdapter`.
- Object construction -> Composition Root.

## 1. Add a new puzzle source

Example: "Featured" puzzles.

1. Add `FEATURED` to `PuzzleSource`.
2. Add a button to `puzzles.html`.
3. Add a required element and binding in `PuzzleView`.
4. Add `getFeaturedPuzzle()` to `PuzzleApi`.
5. Extend `PuzzleController.selectSource()`.
6. Reuse `#loadPublicPuzzle()` rather than duplicating normalization.
7. Add tests for source-race behavior if the controller becomes unit-tested.

Do not place `fetch('/puzzles/featured')` directly in the View or HTML handler.

## 2. Change an endpoint payload

Example: backend renames `movetimeMs` to `move_time_ms`.

Change only `PlayApi.getBestMove()` unless the semantic input also changed. Controllers should continue passing `moveTimeMs` as application language.

This is the purpose of the Gateway boundary: backend DTO naming does not leak through the application.

## 3. Add authentication

1. Add token/header behavior to `JsonApiClient` construction in the composition roots.
2. Prefer a token provider callback rather than reading storage inside every Gateway.
3. Handle 401/403 in a centralized application policy.
4. Do not add authentication logic to `ChessPosition`, View rendering methods, or CSS.

## 4. Add chess increments

1. Extend `CountdownClock` with increment application on accepted moves.
2. Add `incrementMs` to `PlayState` or a time-control value object.
3. Apply the increment only after server acceptance.
4. Pass `winc` and `binc` from state through `PlayApi.getBestMove()`.
5. Update API documentation and tests.

Do not apply increment at optimistic-drop time unless rollback also restores clock state.

## 5. Add server clock synchronization

Recommended response extension:

```json
{
  "over": false,
  "clocks": {
    "w": 295000,
    "b": 297500
  }
}
```

Add `CountdownClock.setRemaining(clocks)` and call it after accepted server moves. The backend then becomes authoritative for time as well as legality.

## 6. Replace chessboard.js

Only `ChessboardAdapter`, composition-root board configuration, and possibly CSS selectors should change.

Required adapter interface used by controllers:

```javascript
render(position, animate)
setOrientation('white' | 'black')
resize()
setDisabled(boolean)
setSquareClickHandler(handler)
clearHighlights()
highlightMove(uci, className)
highlightSquare(square, className)
```

Preserving this interface prevents controller changes.

## 7. Add a complete local legal-move engine

Use an established chess rules library rather than expanding `ChessPosition` into a second engine.

Recommended integration:

1. Define a `LegalMoveValidator` port:

```javascript
isLegal(fen, uci) -> boolean
apply(fen, uci) -> nextFen
```

2. Implement it with a proven chess library.
3. Inject it into `PlayController` and Puzzle verification.
4. Keep the backend authoritative; local validation is an early UX check.
5. Add rule conformance tests for castling, en passant, check, mate, repetition, and promotion.

## 8. Add engine analysis lines

1. Extend `/bestmove` DTO in `PlayApi` to expose evaluation/PV.
2. Add state fields for analysis.
3. Add a new View method such as `renderAnalysis(analysis)`. 
4. Do not overload `engine-log` parsing with engine-specific raw text if a structured DTO is available.

## 9. Add persistent puzzle progress

Introduce a `PuzzleProgressRepository` port with implementations such as:

- LocalStorage repository.
- Backend repository.

Controller uses the port after correct/incorrect attempts. Puzzle state remains independent of storage technology.

## 10. Change move display from UCI to SAN

Do not derive SAN from UCI using string formatting. SAN depends on legal context and disambiguation.

Best options:

- Return SAN alongside accepted moves from the backend.
- Inject a proven chess library that can calculate SAN from FEN and UCI.

Then store move records:

```javascript
{ uci: 'g1f3', san: 'Nf3' }
```

Update only move rendering and API mapping where possible.

## 11. Add a new Play action

Example: resign.

1. Add button in `index.html`.
2. Add element/binding in `PlayView`.
3. Add `resignGame(gameId, result)` to `PlayApi` if needed.
4. Add `resign()` workflow to `PlayController`.
5. Finish through the existing `endGame()` path.

Avoid direct state mutation from the button handler.

## 12. Testing expectations for changes

| Change | Minimum tests |
|---|---|
| FEN/UCI/chess metadata | Domain unit tests. |
| JSON/error handling | API client tests. |
| Aggregate rollback | State tests. |
| Controller race/policy | Controller unit tests with fakes. |
| DOM markup | Browser smoke test. |
| Backend contract | Integration test against running server. |
