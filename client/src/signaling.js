import { Emitter } from './emitter.js';

/**
 * VidStem - Signaling client
 * ---------------------------------------------------------------------------
 * Manages the WebSocket connection to the VidStem signaling server. It speaks
 * the small JSON protocol (see ARCHITECTURE.md) and re-emits every server
 * message as a same-named event. It also auto-reconnects with exponential
 * backoff and buffers outgoing messages while disconnected, so a brief network
 * blip does not break a call.
 *
 * Emitted events mirror the server message types:
 *   'open'        -> the socket connected
 *   'welcome'     -> { peerId } assigned by the server
 *   'joined'      -> { room, peerId, peers[] }
 *   'peer-joined' -> { peer: { peerId, displayName } }
 *   'peer-left'   -> { peerId }
 *   'signal'      -> { from, data }
 *   'error'       -> { message }  (server-reported error)
 *   'close'       -> the socket closed
 */
export class Signaling extends Emitter {
  /** @param {string} serverUrl - e.g. "ws://localhost:8080" or "wss://your.host" */
  constructor(serverUrl) {
    super();
    this.serverUrl = serverUrl;
    /** @type {WebSocket|null} */
    this.ws = null;
    this._shouldReconnect = true;
    this._reconnectDelay = 500; // ms; grows up to _maxReconnectDelay
    this._maxReconnectDelay = 8000;
    /** Messages queued while the socket is not yet open. */
    this._queue = [];
  }

  /** Open the connection (idempotent-ish; call once per session). */
  connect() {
    this.ws = new WebSocket(this.serverUrl);

    this.ws.addEventListener('open', () => {
      this._reconnectDelay = 500; // reset backoff after a successful connect
      // Flush anything queued while we were offline.
      for (const msg of this._queue) this.ws.send(msg);
      this._queue = [];
      this.emit('open');
    });

    this.ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // ignore non-JSON frames
      }
      // Re-emit using the message's own type as the event name.
      this.emit(msg.type, msg);
    });

    this.ws.addEventListener('close', () => {
      this.emit('close');
      if (this._shouldReconnect) {
        setTimeout(() => this.connect(), this._reconnectDelay);
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxReconnectDelay);
      }
    });

    // A low-level socket error; surfaced under a distinct event name so it is
    // never confused with a server-reported 'error' message.
    this.ws.addEventListener('error', () => this.emit('socket-error'));
  }

  /**
   * Send a message to the server. If the socket is not open yet, the message
   * is queued and flushed automatically once it connects.
   * @param {object} message
   */
  send(message) {
    const data = JSON.stringify(message);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this._queue.push(data);
    }
  }

  /** Permanently close the connection and stop reconnecting. */
  close() {
    this._shouldReconnect = false;
    this.ws?.close();
  }
}
