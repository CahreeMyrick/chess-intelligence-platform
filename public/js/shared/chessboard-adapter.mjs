import { parseUci } from './chess-position.mjs';

/**
 * Adapter Pattern: translates the domain's ChessPosition into chessboard.js
 * calls and isolates chessboard.js-specific CSS selectors from controllers.
 */
export class ChessboardAdapter {
  constructor({ containerId, config = {}, chessboardFactory = globalThis.Chessboard }) {
    if (typeof chessboardFactory !== 'function') {
      throw new Error('chessboard.js is not loaded. Expected global Chessboard().');
    }
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    if (!this.container) throw new Error(`Board container #${containerId} was not found.`);
    this.board = chessboardFactory(containerId, config);
    this.squareClickHandler = null;
    this.ignoreNextClick = false;
    this.#bindSquareClicks();
  }

  render(position, animate = false) {
    this.board.position(position.toChessboardPosition(), animate);
  }

  setOrientation(color) {
    this.board.orientation(color);
  }

  resize() {
    this.board.resize();
  }

  setDisabled(disabled) {
    this.container.classList.toggle('board-disabled', disabled);
  }

  setSquareClickHandler(handler) {
    this.squareClickHandler = typeof handler === 'function' ? handler : null;
  }

  clearHighlights() {
    this.container
      .querySelectorAll('.square-55d63')
      .forEach((square) => square.classList.remove('last-move', 'hint-square', 'selected-square'));
  }

  highlightMove(uci, className = 'last-move') {
    if (!uci) return;
    let parsed;
    try {
      parsed = parseUci(uci);
    } catch {
      return;
    }
    this.highlightSquare(parsed.from, className);
    this.highlightSquare(parsed.to, className);
  }

  highlightSquare(square, className) {
    const element = this.container.querySelector(`.square-${square}`);
    if (element) element.classList.add(className);
  }

  #bindSquareClicks() {
    let startX = 0;
    let startY = 0;
    this.container.addEventListener('pointerdown', (event) => {
      startX = event.clientX;
      startY = event.clientY;
    });
    this.container.addEventListener('click', (event) => {
      if (!this.squareClickHandler) return;
      const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (distance > 6) return;
      const squareElement = event.target.closest('.square-55d63');
      if (!squareElement || !this.container.contains(squareElement)) return;
      const squareClass = [...squareElement.classList].find((name) => /^square-[a-h][1-8]$/.test(name));
      if (squareClass) this.squareClickHandler(squareClass.slice('square-'.length));
    });
  }
}
