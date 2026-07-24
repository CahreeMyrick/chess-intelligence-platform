# Monolith-to-Module Traceability

## Play page

| Original responsibility | New owner |
|---|---|
| Global board array and turn variables | `PlayState` + `ChessPosition` |
| `parseSq`, `rc2sq`, piece conversion | `chess-position.mjs` |
| Board creation and CSS square manipulation | `ChessboardAdapter` + composition root |
| `fetch` request repetition | `JsonApiClient` |
| `/game`, `/bookmove`, `/bestmove` URLs | `PlayApi` |
| Clock timer and formatting | `CountdownClock` + `PlayView` |
| Move-grid DOM construction | `PlayView.renderMoves()` |
| `handlePlayerDrop` mixed workflow | `PlayController.handleDrop()` + private commit method |
| Manual rollback variables | `PlayState` Memento |
| `applyEngineBestmove` duplicate mutation | Shared `ChessPosition.applyUci()` |
| Inline event assignments | `PlayView.bind()` |
| Inline initialization | `play.mjs` Composition Root |
| Inline CSS | `base.css` + `play.css` |

## Puzzle page

| Original responsibility | New owner |
|---|---|
| Global puzzle variables | `PuzzleState` |
| Duplicate FEN parser | `ChessPosition.fromFen()` |
| Duplicate UCI application | `ChessPosition.applyUci()` |
| Duplicate verifier board implementation | Clone-based projection verification |
| Unused `onSquareClick` function | Functioning adapter click delegation + controller |
| Daily/random HTTP calls | `PuzzleApi` + controller loader |
| Recent game list unsafe `innerHTML` | `PuzzleView.renderGames()` node construction |
| Source button state | `PuzzleController.selectSource()` + `PuzzleView.renderSource()` |
| Auto/step timers | `PuzzleController` with centralized cancellation |
| Inline DOM references | `PuzzleView` |
| Inline CSS and incomplete document prefix | Complete `puzzles.html` + CSS files |

## Defects corrected during mapping

1. **Async chessboard `onDrop`:** callbacks now return synchronously; persistence continues asynchronously.
2. **Overbroad en passant:** capture now requires the recorded FEN/state en-passant square.
3. **Castling partial mutation:** rook existence is validated before board mutation.
4. **Stale page requests:** version tokens prevent old responses from replacing newer state.
5. **Duplicate game creation race:** only the newest New Game response can initialize state.
6. **Unsafe game-list interpolation:** usernames/results are rendered as text nodes.
7. **Dead click-to-move path:** square click behavior is now connected through the adapter.
8. **Visible puzzle solution:** solution is now collapsed in a `<details>` element by default.
9. **Malformed puzzle interaction:** inconsistent puzzle projections are displayed with an error but interaction is blocked.
10. **Drifting one-second clock:** clock subtracts measured elapsed time.
