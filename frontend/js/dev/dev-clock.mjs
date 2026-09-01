/**
 * Service Object: Multi-mode chess clock supporting timed countdowns
 * with increments as well as untimed / casual play modes.
 */
export class DevClock {
  constructor({
    initialMs = 300_000,
    incrementMs = 0,
    timerMode = 'none',
    tickIntervalMs = 200,
    getActiveColor,
    onTick,
    onTimeout,
    now = () => performance.now(),
  }) {
    this.initialMs = initialMs;
    this.incrementMs = incrementMs;
    this.timerMode = timerMode; // 'none' | 'timed'
    this.tickIntervalMs = tickIntervalMs;
    this.getActiveColor = getActiveColor;
    this.onTick = onTick;
    this.onTimeout = onTimeout;
    this.now = now;

    this.remaining = { w: initialMs, b: initialMs };
    this.elapsed = { w: 0, b: 0, total: 0 };
    this.timerId = null;
    this.lastTimestamp = null;
  }

  configure({ timerMode = this.timerMode, initialMs = this.initialMs, incrementMs = this.incrementMs } = {}) {
    this.stop();
    this.timerMode = timerMode;
    this.initialMs = initialMs;
    this.incrementMs = incrementMs;
    this.remaining = { w: initialMs, b: initialMs };
    this.elapsed = { w: 0, b: 0, total: 0 };
    this.#notifyTick();
  }

  reset(initialMs = this.initialMs, incrementMs = this.incrementMs) {
    this.stop();
    this.initialMs = initialMs;
    this.incrementMs = incrementMs;
    this.remaining = { w: initialMs, b: initialMs };
    this.elapsed = { w: 0, b: 0, total: 0 };
    this.#notifyTick();
  }

  start() {
    if (this.timerId !== null) return;
    this.lastTimestamp = this.now();
    this.timerId = setInterval(() => this.#tick(), this.tickIntervalMs);
  }

  stop() {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.lastTimestamp = null;
  }

  /**
   * Called on move completion: applies increment to the player who just moved
   */
  switchTurn(completedColor) {
    if (this.timerMode === 'timed' && this.incrementMs > 0 && (completedColor === 'w' || completedColor === 'b')) {
      this.remaining[completedColor] += this.incrementMs;
      this.#notifyTick();
    }
  }

  snapshot() {
    return {
      timerMode: this.timerMode,
      remaining: { ...this.remaining },
      elapsed: { ...this.elapsed },
    };
  }

  #notifyTick() {
    this.onTick?.({
      timerMode: this.timerMode,
      remaining: { ...this.remaining },
      elapsed: { ...this.elapsed },
    });
  }

  #tick() {
    const current = this.now();
    const delta = Math.max(0, current - (this.lastTimestamp ?? current));
    this.lastTimestamp = current;

    const color = this.getActiveColor?.();
    if (color !== 'w' && color !== 'b') return;

    this.elapsed.total += delta;
    this.elapsed[color] += delta;

    if (this.timerMode === 'timed') {
      this.remaining[color] = Math.max(0, this.remaining[color] - delta);
      this.#notifyTick();

      if (this.remaining[color] <= 0) {
        this.stop();
        this.onTimeout?.(color);
      }
    } else {
      this.#notifyTick();
    }
  }
}
