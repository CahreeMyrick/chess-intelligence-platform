/**
 * Extensible Plugin & Hook System for the Development Playground.
 * Allows easy plug-and-play experimentation with new engines,
 * eval bars, opening books, custom analysis, or telemetry.
 */
export class DevPluginManager {
  constructor() {
    this.plugins = new Map();
  }

  register(name, plugin) {
    if (this.plugins.has(name)) {
      console.warn(`Plugin '${name}' is already registered. Overwriting.`);
    }
    this.plugins.set(name, plugin);
    plugin.onRegister?.(this);
    return this;
  }

  unregister(name) {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.onUnregister?.(this);
      this.plugins.delete(name);
    }
  }

  async emit(event, data) {
    const hookName = `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
    for (const [name, plugin] of this.plugins.entries()) {
      if (typeof plugin[hookName] === 'function') {
        try {
          await plugin[hookName](data);
        } catch (error) {
          console.error(`Error in plugin '${name}' on hook '${hookName}':`, error);
        }
      }
    }
  }
}

/**
 * Built-in Plugin: Logs moves and engine diagnostics into the UI log
 */
export class DevLoggerPlugin {
  constructor({ logSink }) {
    this.logSink = logSink;
  }

  onMoveApplied({ uci, moveNumber, sideToMove, fen }) {
    this.logSink?.(`[Move #${moveNumber}] ${uci} (turn: ${sideToMove})`);
  }

  onEngineResponse({ bestmove, info, durationMs }) {
    const latency = durationMs ? ` in ${Math.round(durationMs)}ms` : '';
    this.logSink?.(`[Engine] bestmove: ${bestmove}${latency}`);
  }

  onGameFinished({ result, winner, message }) {
    this.logSink?.(`[Game Finished] ${message || result}`);
  }
}

/**
 * Built-in Plugin: Live FEN Synchronizer
 */
export class DevFenSyncPlugin {
  constructor({ onFenUpdate }) {
    this.onFenUpdate = onFenUpdate;
  }

  onPositionChanged({ fen }) {
    this.onFenUpdate?.(fen);
  }
}
