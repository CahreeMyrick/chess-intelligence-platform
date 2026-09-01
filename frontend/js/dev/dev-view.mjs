import { requireElement, clearElement, setVisible, createElement } from '../shared/dom.mjs';

/**
 * View layer for the development chess playground.
 * Interacts safely with the DOM without unsafe innerHTML.
 */
export class DevView {
  constructor(root = document) {
    this.elements = {
      // Configuration & Modes
      gameMode: requireElement('gameMode', root),
      timerMode: requireElement('timerMode', root),
      timePreset: requireElement('timePreset', root),
      customTimeRow: requireElement('customTimeRow', root),
      customMinutes: requireElement('customMinutes', root),
      customIncrement: requireElement('customIncrement', root),
      sideSelect: requireElement('sideSelect', root),
      engineSideWrapper: requireElement('engineSideWrapper', root),
      engineSettingsCard: requireElement('engineSettingsCard', root),
      pvpSettingsCard: requireElement('pvpSettingsCard', root),
      autoFlipCheck: requireElement('autoFlipCheck', root),

      // Engine parameters
      engineDepth: requireElement('engineDepth', root),
      depthLabel: requireElement('depthLabel', root),
      engineMovetime: requireElement('engineMovetime', root),
      movetimeLabel: requireElement('movetimeLabel', root),

      // Players & Clocks
      topPlayerName: requireElement('topPlayerName', root),
      topPlayerRole: requireElement('topPlayerRole', root),
      topAvatar: requireElement('topAvatar', root),
      topClock: requireElement('topClock', root),

      bottomPlayerName: requireElement('bottomPlayerName', root),
      bottomPlayerRole: requireElement('bottomPlayerRole', root),
      bottomAvatar: requireElement('bottomAvatar', root),
      bottomClock: requireElement('bottomClock', root),

      // Status & Board controls
      statusBanner: requireElement('statusBanner', root),
      thinkingIndicator: requireElement('thinkingIndicator', root),
      thinkingText: requireElement('thinkingText', root),

      newGameBtn: requireElement('newGameBtn', root),
      undoBtn: requireElement('undoBtn', root),
      flipBtn: requireElement('flipBtn', root),
      hintBtn: requireElement('hintBtn', root),
      engineMoveBtn: requireElement('engineMoveBtn', root),
      endGameBtn: requireElement('endGameBtn', root),

      // FEN and Notation
      fenInput: requireElement('fenInput', root),
      copyFenBtn: requireElement('copyFenBtn', root),
      loadFenBtn: requireElement('loadFenBtn', root),
      movesGrid: requireElement('movesGrid', root),
      devLog: requireElement('devLog', root),
    };

    this.logMessages = [];
  }

  bind(handlers = {}) {
    if (handlers.onNewGame) {
      this.elements.newGameBtn.addEventListener('click', handlers.onNewGame);
    }
    if (handlers.onUndo) {
      this.elements.undoBtn.addEventListener('click', handlers.onUndo);
    }
    if (handlers.onFlip) {
      this.elements.flipBtn.addEventListener('click', handlers.onFlip);
    }
    if (handlers.onHint) {
      this.elements.hintBtn.addEventListener('click', handlers.onHint);
    }
    if (handlers.onEngineMove) {
      this.elements.engineMoveBtn.addEventListener('click', handlers.onEngineMove);
    }
    if (handlers.onEndGame) {
      this.elements.endGameBtn.addEventListener('click', handlers.onEndGame);
    }
    if (handlers.onCopyFen) {
      this.elements.copyFenBtn.addEventListener('click', handlers.onCopyFen);
    }
    if (handlers.onLoadFen) {
      this.elements.loadFenBtn.addEventListener('click', handlers.onLoadFen);
    }

    // Config changes
    this.elements.gameMode.addEventListener('change', () => {
      this.updateConfigPanels();
      handlers.onModeChanged?.(this.getGameMode());
    });

    this.elements.timerMode.addEventListener('change', () => {
      this.updateTimerControls();
      handlers.onTimerModeChanged?.(this.getTimerMode());
    });

    this.elements.timePreset.addEventListener('change', () => {
      this.updateTimerControls();
      handlers.onTimeConfigChanged?.(this.getTimeConfig());
    });

    this.elements.customMinutes.addEventListener('input', () => {
      handlers.onTimeConfigChanged?.(this.getTimeConfig());
    });

    this.elements.customIncrement.addEventListener('input', () => {
      handlers.onTimeConfigChanged?.(this.getTimeConfig());
    });

    this.elements.engineDepth.addEventListener('input', () => {
      this.elements.depthLabel.textContent = `${this.elements.engineDepth.value}`;
      handlers.onEngineConfigChanged?.(this.getEngineConfig());
    });

    this.elements.engineMovetime.addEventListener('input', () => {
      this.elements.movetimeLabel.textContent = `${this.elements.engineMovetime.value} ms`;
      handlers.onEngineConfigChanged?.(this.getEngineConfig());
    });

    this.elements.sideSelect.addEventListener('change', () => {
      handlers.onSideChanged?.(this.elements.sideSelect.value);
    });

    this.elements.autoFlipCheck.addEventListener('change', () => {
      handlers.onAutoFlipChanged?.(this.elements.autoFlipCheck.checked);
    });

    this.updateConfigPanels();
    this.updateTimerControls();
  }

  getGameMode() {
    return this.elements.gameMode.value; // 'pvp' | 'pve'
  }

  getTimerMode() {
    return this.elements.timerMode.value; // 'none' | 'timed'
  }

  getTimeConfig() {
    const timerMode = this.getTimerMode();
    if (timerMode === 'none') {
      return { timerMode: 'none', initialMinutes: 0, incrementSeconds: 0 };
    }

    const preset = this.elements.timePreset.value;
    if (preset === 'custom') {
      const mins = Math.max(1, Math.min(180, Number(this.elements.customMinutes.value) || 5));
      const inc = Math.max(0, Math.min(60, Number(this.elements.customIncrement.value) || 0));
      return { timerMode: 'timed', initialMinutes: mins, incrementSeconds: inc };
    }

    const [mins, inc] = preset.split('+').map(Number);
    return {
      timerMode: 'timed',
      initialMinutes: mins || 5,
      incrementSeconds: inc || 0,
    };
  }

  getHumanSide() {
    return this.elements.sideSelect.value; // 'w' | 'b'
  }

  getEngineConfig() {
    return {
      depth: Number(this.elements.engineDepth.value) || null,
      movetimeMs: Number(this.elements.engineMovetime.value) || 500,
    };
  }

  getAutoFlip() {
    return this.elements.autoFlipCheck.checked;
  }

  getFenInput() {
    return this.elements.fenInput.value.trim();
  }

  setFenInput(fen) {
    this.elements.fenInput.value = fen;
  }

  updateConfigPanels() {
    const isPve = this.getGameMode() === 'pve';
    setVisible(this.elements.engineSettingsCard, isPve);
    setVisible(this.elements.engineSideWrapper, isPve);
    setVisible(this.elements.pvpSettingsCard, !isPve);
    setVisible(this.elements.engineMoveBtn, isPve);
  }

  updateTimerControls() {
    const isTimed = this.getTimerMode() === 'timed';
    setVisible(this.elements.timePreset.parentElement, isTimed);
    const isCustom = isTimed && this.elements.timePreset.value === 'custom';
    setVisible(this.elements.customTimeRow, isCustom);
  }

  updatePlayerStrips({ mode, humanColor, whiteAtBottom, timerMode }) {
    const topIsWhite = !whiteAtBottom;
    const bottomIsWhite = whiteAtBottom;

    if (mode === 'pvp') {
      this.elements.topPlayerName.textContent = topIsWhite ? 'Player 1 (White)' : 'Player 2 (Black)';
      this.elements.topPlayerRole.textContent = 'Human';
      this.elements.topAvatar.textContent = topIsWhite ? '♙' : '♟';
      this.elements.topAvatar.className = 'avatar human';

      this.elements.bottomPlayerName.textContent = bottomIsWhite ? 'Player 1 (White)' : 'Player 2 (Black)';
      this.elements.bottomPlayerRole.textContent = 'Human';
      this.elements.bottomAvatar.textContent = bottomIsWhite ? '♙' : '♟';
      this.elements.bottomAvatar.className = 'avatar human';
    } else {
      // PvE mode
      const isTopEngine = (topIsWhite && humanColor === 'b') || (!topIsWhite && humanColor === 'w');

      if (isTopEngine) {
        this.elements.topPlayerName.textContent = 'Ichigo Engine';
        this.elements.topPlayerRole.textContent = 'Bot';
        this.elements.topAvatar.textContent = '⚙';
        this.elements.topAvatar.className = 'avatar engine';

        this.elements.bottomPlayerName.textContent = 'You';
        this.elements.bottomPlayerRole.textContent = humanColor === 'w' ? 'White' : 'Black';
        this.elements.bottomAvatar.textContent = humanColor === 'w' ? '♙' : '♟';
        this.elements.bottomAvatar.className = 'avatar human';
      } else {
        this.elements.topPlayerName.textContent = 'You';
        this.elements.topPlayerRole.textContent = humanColor === 'w' ? 'White' : 'Black';
        this.elements.topAvatar.textContent = humanColor === 'w' ? '♙' : '♟';
        this.elements.topAvatar.className = 'avatar human';

        this.elements.bottomPlayerName.textContent = 'Ichigo Engine';
        this.elements.bottomPlayerRole.textContent = 'Bot';
        this.elements.bottomAvatar.textContent = '⚙';
        this.elements.bottomAvatar.className = 'avatar engine';
      }
    }

    const showClocks = timerMode === 'timed';
    setVisible(this.elements.topClock, showClocks);
    setVisible(this.elements.bottomClock, showClocks);
  }

  updateClocks({ remaining, activeColor, timerMode, whiteAtBottom }) {
    if (timerMode !== 'timed' || !remaining) {
      this.elements.topClock.textContent = '∞';
      this.elements.bottomClock.textContent = '∞';
      this.elements.topClock.classList.remove('active', 'low');
      this.elements.bottomClock.classList.remove('active', 'low');
      return;
    }

    const topColor = whiteAtBottom ? 'b' : 'w';
    const bottomColor = whiteAtBottom ? 'w' : 'b';

    const formatTime = (ms) => {
      const totalSec = Math.max(0, Math.ceil(ms / 1000));
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    const topMs = remaining[topColor] ?? 0;
    const bottomMs = remaining[bottomColor] ?? 0;

    this.elements.topClock.textContent = formatTime(topMs);
    this.elements.bottomClock.textContent = formatTime(bottomMs);

    this.elements.topClock.classList.toggle('active', activeColor === topColor);
    this.elements.topClock.classList.toggle('low', topMs < 20_000);

    this.elements.bottomClock.classList.toggle('active', activeColor === bottomColor);
    this.elements.bottomClock.classList.toggle('low', bottomMs < 20_000);
  }

  setStatus(message, type = 'info') {
    this.elements.statusBanner.textContent = message;
    this.elements.statusBanner.className = `game-banner status-${type}`;
    setVisible(this.elements.statusBanner, Boolean(message));
  }

  setThinking(active, text = 'Calculating…') {
    setVisible(this.elements.thinkingIndicator, active, 'inline-block');
    this.elements.thinkingText.textContent = active ? text : '';
  }

  renderMoves(moves = []) {
    clearElement(this.elements.movesGrid);
    if (!moves.length) {
      const emptySpan = createElement('span', { className: 'moves-empty', text: 'No moves yet' });
      this.elements.movesGrid.appendChild(emptySpan);
      return;
    }

    for (let i = 0; i < moves.length; i += 2) {
      const moveRow = createElement('div', { className: 'move-row' });
      const moveNumber = createElement('span', {
        className: 'move-number',
        text: `${Math.floor(i / 2) + 1}.`,
      });
      const whiteMove = createElement('span', {
        className: 'move-san white-move',
        text: moves[i],
      });
      moveRow.appendChild(moveNumber);
      moveRow.appendChild(whiteMove);

      if (moves[i + 1]) {
        const blackMove = createElement('span', {
          className: 'move-san black-move',
          text: moves[i + 1],
        });
        moveRow.appendChild(blackMove);
      }

      this.elements.movesGrid.appendChild(moveRow);
    }

    this.elements.movesGrid.scrollTop = this.elements.movesGrid.scrollHeight;
  }

  log(message) {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    this.logMessages.push(`[${timestamp}] ${message}`);
    if (this.logMessages.length > 100) {
      this.logMessages.shift();
    }
    this.elements.devLog.textContent = this.logMessages.join('\n');
    this.elements.devLog.scrollTop = this.elements.devLog.scrollHeight;
  }
}
