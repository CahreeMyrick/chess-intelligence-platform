import { clearElement, createElement, requireElement, setVisible } from '../shared/dom.mjs';

const GAME_REASON_LABELS = Object.freeze({
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  'threefold repetition': 'Draw · Threefold',
  'insufficient material': 'Draw · Material',
  draw: 'Draw',
  timeout: 'Timeout',
  ended: 'Game Ended',
});

function formatClock(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Passive View: owns DOM reads/writes but no business decisions. */
export class PlayView {
  constructor(root = document) {
    this.root = root;
    this.elements = {
      board: requireElement('board', root),
      playAs: requireElement('playAs', root),
      difficulty: requireElement('difficulty', root),
      difficultyLabel: requireElement('diffLabel', root),
      moveTime: requireElement('ms', root),
      depth: requireElement('depth', root),
      spinner: requireElement('spinner', root),
      thinkingText: requireElement('thinkingText', root),
      whiteClock: requireElement('wClock', root),
      blackClock: requireElement('bClock', root),
      movesGrid: requireElement('movesGrid', root),
      log: requireElement('log', root),
      gameBanner: requireElement('gameBanner', root),
      newGame: requireElement('new', root),
      flip: requireElement('flip', root),
      hint: requireElement('hintBtn', root),
      engineMove: requireElement('engineMove', root),
      finish: requireElement('finish', root),
    };
  }

  bind(handlers) {
    this.elements.newGame.addEventListener('click', handlers.onNewGame);
    this.elements.flip.addEventListener('click', handlers.onFlip);
    this.elements.hint.addEventListener('click', handlers.onHint);
    this.elements.engineMove.addEventListener('click', handlers.onEngineMove);
    this.elements.finish.addEventListener('click', handlers.onFinish);
    this.elements.difficulty.addEventListener('input', handlers.onDifficultyChanged);
    window.addEventListener('keydown', handlers.onKeyDown);
  }

  getHumanColor() {
    return this.elements.playAs.value === 'b' ? 'b' : 'w';
  }

  getEngineSettings({ hint = false } = {}) {
    const depthValue = Number(this.elements.depth.value);
    const depth = Number.isFinite(depthValue) && depthValue > 0 ? depthValue : null;
    const difficulty = Math.min(5, Math.max(1, Number(this.elements.difficulty.value) || 2));
    const difficultyTimes = [250, 500, 1000, 2000, 4000];
    const configuredMoveTime = Math.max(50, Number(this.elements.moveTime.value) || 500);
    const baseMoveTime = depth ? configuredMoveTime : difficultyTimes[difficulty - 1];
    return {
      depth,
      moveTimeMs: hint ? Math.min(baseMoveTime, 1000) : baseMoveTime,
    };
  }

  updateDifficultyLabel() {
    this.elements.difficultyLabel.textContent = `${this.elements.difficulty.value}/5`;
  }

  renderMoves(moves) {
    clearElement(this.elements.movesGrid);
    if (!moves.length) {
      this.elements.movesGrid.append(
        createElement('span', { className: 'moves-empty', text: 'No moves yet' }),
      );
      return;
    }

    moves.forEach((move, index) => {
      if (index % 2 === 0) {
        this.elements.movesGrid.append(
          createElement('span', { className: 'move-num', text: `${Math.floor(index / 2) + 1}.` }),
        );
      }
      const cell = createElement('span', {
        className: `move-cell${index === moves.length - 1 ? ' latest' : ''}`,
        text: move,
      });
      this.elements.movesGrid.append(cell);
      if (index % 2 === 0 && index === moves.length - 1) {
        this.elements.movesGrid.append(createElement('span', { className: 'move-cell', text: '' }));
      }
    });
    this.elements.movesGrid.scrollTop = this.elements.movesGrid.scrollHeight;
  }

  renderClocks(clocks, activeColor) {
    this.elements.whiteClock.textContent = formatClock(clocks.w);
    this.elements.blackClock.textContent = formatClock(clocks.b);
    this.elements.whiteClock.classList.toggle('active', activeColor === 'w');
    this.elements.blackClock.classList.toggle('active', activeColor === 'b');
    this.elements.whiteClock.classList.toggle('low', clocks.w < 30_000);
    this.elements.blackClock.classList.toggle('low', clocks.b < 30_000);
  }

  setThinking(thinking, text = 'Thinking…') {
    setVisible(this.elements.spinner, thinking, 'inline-block');
    this.elements.thinkingText.textContent = thinking ? text : '';
  }

  setStatus(text) {
    this.elements.thinkingText.textContent = text;
  }

  setEngineRetryVisible(visible) {
    this.elements.engineMove.classList.toggle('hidden', !visible);
  }

  showGameBanner({ result = '*', reason = null }) {
    clearElement(this.elements.gameBanner);
    const title = GAME_REASON_LABELS[reason] ?? 'Game Over';
    const strong = createElement('strong', { text: title });
    const separator = createElement('span', { className: 'banner-separator', text: '·' });
    const resultText = createElement('span', { text: result });
    this.elements.gameBanner.append(strong, separator, resultText);
    setVisible(this.elements.gameBanner, true, 'block');
  }

  hideGameBanner() {
    setVisible(this.elements.gameBanner, false);
  }

  log(message) {
    if (this.elements.log.textContent === '—') this.elements.log.textContent = '';
    this.elements.log.textContent = `${String(message)}\n${this.elements.log.textContent}`;
  }
}

export { formatClock };
