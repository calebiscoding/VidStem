/**
 * VidStem - Tiny event emitter
 * ---------------------------------------------------------------------------
 * A minimal on/off/once/emit implementation. It exists so the entire SDK has
 * ZERO runtime dependencies and stays a few kilobytes - important for a
 * library meant to be dropped into any website. The API mirrors the familiar
 * Node.js EventEmitter so it feels natural.
 */
export class Emitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} fn
   * @returns {() => void} an unsubscribe function, for convenience.
   */
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  /** Subscribe to an event exactly once. */
  once(event, fn) {
    const wrapped = (...args) => {
      this.off(event, wrapped);
      fn(...args);
    };
    return this.on(event, wrapped);
  }

  /** Remove a previously added listener. */
  off(event, fn) {
    this._listeners.get(event)?.delete(fn);
  }

  /**
   * Emit an event to all listeners. A throwing listener is logged but does not
   * stop the others from running.
   */
  emit(event, ...args) {
    this._listeners.get(event)?.forEach((fn) => {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[VidStem] listener for "${event}" threw:`, err);
      }
    });
  }
}
