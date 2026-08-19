import { clearElement, createElement, requireElement, setVisible } from '../shared/dom.mjs';
import { PuzzleSource } from './puzzle-state.mjs';

/** Passive View for puzzle-page DOM rendering. */
export class PuzzleView {
  constructor(root = document) {
    this.root = root;
    this.elements = {
      daily: requireElement('btnDaily', root),
      random: requireElement('btnRandom', root),
      fromGames: requireElement('btnFromGames', root),
      analyzeAll: requireElement('btnAnalyzeAll', root),
      flip: requireElement('btnFlip', root),
      viewMode: requireElement('viewMode', root),
      reset: requireElement('btnReset', root),
      step: requireElement('btnStep', root),
      auto: requireElement('btnAuto', root),
      previous: requireElement('btnPrevPuzzle', root),
      next: requireElement('btnNextPuzzle', root),
      id: requireElement('labId', root),
      rating: requireElement('labRating', root),
      turn: requireElement('labTurn', root),
      themes: requireElement('themesWrap', root),
      progressCount: requireElement('progressCount', root),
      progressFill: requireElement('progressFill', root),
      feedback: requireElement('feedbackBar', root),
      feedbackIcon: requireElement('feedbackIcon', root),
      feedbackText: requireElement('feedbackText', root),
      solution: requireElement('solutionRaw', root),
      username: requireElement('usernameInput', root),
      loadGames: requireElement('btnLoadGames', root),
      gamesList: requireElement('gamesList', root),
      gamesStatus: requireElement('gamesStatus', root),
      loadSpinner: requireElement('loadSpin', root),
      fromGamesCard: requireElement('fromGamesCard', root),
      sideId: requireElement('sideId', root),
      sideRating: requireElement('sideRating', root),
      sideTurn: requireElement('sideTurn', root),
      sideThemes: requireElement('sideThemes', root),
      sideMoves: requireElement('sideMoves', root),
    };
  }

  bind(handlers) {
    this.elements.daily.addEventListener('click', handlers.onDaily);
    this.elements.random.addEventListener('click', handlers.onRandom);
    this.elements.fromGames.addEventListener('click', handlers.onFromGames);
    this.elements.analyzeAll.addEventListener('click', handlers.onAnalyzeAll);
    this.elements.flip.addEventListener('click', handlers.onFlip);
    this.elements.viewMode.addEventListener('change', handlers.onViewModeChanged);
    this.elements.reset.addEventListener('click', handlers.onReset);
    this.elements.step.addEventListener('click', handlers.onStep);
    this.elements.auto.addEventListener('click', handlers.onAuto);
    this.elements.previous.addEventListener('click', handlers.onPrevious);
    this.elements.next.addEventListener('click', handlers.onNext);
    this.elements.loadGames.addEventListener('click', handlers.onLoadGames);
    this.elements.username.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') handlers.onLoadGames();
    });
  }

  getUsername() {
    return this.elements.username.value.trim();
  }

  getViewMode() {
    return this.elements.viewMode.value === 'white' ? 'white' : 'side';
  }

  renderSource(source) {
    this.elements.daily.classList.toggle('active', source === PuzzleSource.DAILY);
    this.elements.random.classList.toggle('active', source === PuzzleSource.RANDOM);
    this.elements.fromGames.classList.toggle('active', source === PuzzleSource.FROM_GAMES);
    setVisible(this.elements.fromGamesCard, source === PuzzleSource.FROM_GAMES);
  }

  renderPuzzleMetadata({ id, rating, themes, turnLabel, moveCount, solution }) {
    this.elements.id.textContent = id;
    this.elements.rating.textContent = rating;
    this.elements.sideId.textContent = id;
    this.elements.sideRating.textContent = rating;
    this.elements.turn.textContent = turnLabel;
    this.elements.sideTurn.textContent = turnLabel;
    this.elements.sideMoves.textContent = `${moveCount} moves`;
    this.elements.solution.textContent = solution.length ? solution.join(' ') : '—';
    this.renderThemes(themes);
  }

  renderTurn(color) {
    const label = color === 'w' ? 'White to move' : 'Black to move';
    this.elements.turn.textContent = label;
    this.elements.sideTurn.textContent = label;
  }

  renderThemes(themes) {
    const normalized = Array.isArray(themes) ? themes.map(String) : [];
    clearElement(this.elements.themes);
    normalized.forEach((theme) => {
      this.elements.themes.append(
        createElement('span', { className: 'theme-pill', text: theme }),
      );
    });
    this.elements.sideThemes.textContent = normalized.length ? normalized.join(', ') : '—';
  }

  renderProgress(index, total) {
    this.elements.progressCount.textContent = `${index} / ${total}`;
    this.elements.progressFill.style.width = `${total ? (index / total) * 100 : 0}%`;
  }

  showFeedback(type, message) {
    this.elements.feedback.className = `feedback-bar ${type}`;
    this.elements.feedbackIcon.textContent = type === 'correct' ? '✓' : '✗';
    this.elements.feedbackText.textContent = message;
  }

  hideFeedback() {
    this.elements.feedback.className = 'feedback-bar';
    this.elements.feedbackText.textContent = '';
  }

  setGamesStatus(text) {
    this.elements.gamesStatus.textContent = text;
  }

  setLoading(loading) {
    setVisible(this.elements.loadSpinner, loading, 'block');
    this.elements.loadGames.disabled = loading;
  }

  renderGames(data, onSelect) {
    const username = String(data?.username ?? '').toLowerCase();
    const games = (Array.isArray(data?.games) ? data.games : [])
      .slice()
      .sort((left, right) => Number(right?.end_time ?? 0) - Number(left?.end_time ?? 0))
      .slice(0, 15);
    clearElement(this.elements.gamesList);

    if (!games.length) {
      this.elements.gamesList.append(
        createElement('div', { className: 'games-empty', text: 'No recent games found.' }),
      );
      return;
    }

    games.forEach((game) => {
      const whiteUsername = String(game.white?.username ?? '');
      const blackUsername = String(game.black?.username ?? '');
      const youAreWhite = whiteUsername.toLowerCase() === username;
      const youAreBlack = blackUsername.toLowerCase() === username;
      const youColor = youAreWhite ? 'White' : youAreBlack ? 'Black' : '?';
      const opponent = youAreWhite ? blackUsername : youAreBlack ? whiteUsername : whiteUsername || '?';
      const result = youAreWhite ? game.white?.result : game.black?.result;
      const timeControl = game.time_class ?? game.time_control ?? '';

      const button = createElement('button', { className: 'game-item' });
      button.type = 'button';
      button.append(
        createElement('span', { className: 'game-item-left', text: `${youColor} vs ${opponent || '—'}` }),
        createElement('span', { className: 'game-item-right', text: `${result ?? ''} · ${timeControl}` }),
      );
      button.addEventListener('click', () => onSelect(game));
      this.elements.gamesList.append(button);
    });
  }

  setAnalyzeAllVisible(visible) {
  setVisible(this.elements.analyzeAll, visible);
  }
}
