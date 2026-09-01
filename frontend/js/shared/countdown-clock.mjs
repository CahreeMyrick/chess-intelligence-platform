/**
 * Service Object: drift-aware two-sided countdown clock.
 * The active color is supplied by the controller's state on every tick.
 */
export class CountdownClock {
  constructor({
    initialMs = 300_000,
    tickIntervalMs = 250,
    getActiveColor,
    onTick,
    onTimeout,
    now = () => performance.now(),
  }) {
    this.initialMs = initialMs;
    this.tickIntervalMs = tickIntervalMs;
    this.getActiveColor = getActiveColor;
    this.onTick = onTick;
    this.onTimeout = onTimeout;
    this.now = now;
    this.remaining = { w: initialMs, b: initialMs };
    this.timerId = null;
    this.lastTimestamp = null;
  }

  reset(initialMs = this.initialMs) {
    this.stop();
    this.initialMs = initialMs;
    this.remaining = { w: initialMs, b: initialMs };
    this.onTick?.({ ...this.remaining });
  }

  start() {
    if (this.timerId !== null) return;
    this.lastTimestamp = this.now();
    this.timerId = setInterval(() => this.#tick(), this.tickIntervalMs);
  }

  stop() {
    if (this.timerId !== null) clearInterval(this.timerId);
    this.timerId = null;
    this.lastTimestamp = null;
  }

  snapshot() {
    return { ...this.remaining };
  }

  #tick() {
    const current = this.now();
    const elapsed = Math.max(0, current - this.lastTimestamp);
    this.lastTimestamp = current;
    const color = this.getActiveColor?.();
    if (color !== 'w' && color !== 'b') return;

    this.remaining[color] = Math.max(0, this.remaining[color] - elapsed);
    this.onTick?.({ ...this.remaining });
    if (this.remaining[color] <= 0) {
      this.stop();
      this.onTimeout?.(color);
    }
  }
}
