/**
 * VidStem - Room management
 * ---------------------------------------------------------------------------
 * The signaling server groups participants into "rooms". Everyone in the same
 * room negotiates direct WebRTC connections with each other.
 *
 * IMPORTANT: The server NEVER sees audio or video. It only relays tiny JSON
 * "signaling" messages so two browsers can discover each other and open a
 * direct peer-to-peer connection. Once connected, media flows browser ->
 * browser. That is what keeps VidStem cheap to host - a small VPS, a Raspberry
 * Pi, or a free tier can serve a lot of calls.
 */

// Monotonic counter used to build readable, unique peer ids.
let nextPeerSeq = 1;

/**
 * A single connected client (one browser tab).
 */
export class Peer {
  /**
   * @param {import('ws').WebSocket} socket - the client's WebSocket connection
   */
  constructor(socket) {
    // Short, collision-resistant id: "p_<seq>_<random>".
    this.id = `p_${(nextPeerSeq++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.socket = socket;
    this.roomId = null;
    this.displayName = 'Guest';

    // Token bucket for inbound message rate limiting (see allow()). Starts full
    // so the burst of offers/ICE candidates at join time is never throttled.
    this._tokens = 0;
    this._lastRefill = 0;
  }

  /**
   * Rate-limit inbound messages with a token bucket: up to `burst` messages may
   * arrive at once, then a sustained `rate` per second. Returns false when the
   * peer is over budget so the caller can cheaply drop the frame.
   * @param {number} rate  - tokens refilled per second (sustained rate).
   * @param {number} burst - bucket capacity (max instantaneous burst).
   * @returns {boolean} true if the message is allowed.
   */
  allow(rate, burst) {
    const now = Date.now();
    if (this._lastRefill === 0) {
      this._tokens = burst; // first message: start with a full bucket
    } else {
      this._tokens = Math.min(burst, this._tokens + ((now - this._lastRefill) / 1000) * rate);
    }
    this._lastRefill = now;
    if (this._tokens < 1) return false;
    this._tokens -= 1;
    return true;
  }

  /**
   * Send a JSON message to this peer. Silently ignored if the socket has
   * already closed, so callers never need to null-check.
   * @param {object} message
   */
  send(message) {
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}

/**
 * Tracks every room and the peers inside it. Kept deliberately in-memory and
 * simple. To scale across multiple server processes you would back this with
 * Redis (see ARCHITECTURE.md → "Scaling"), but the interface stays the same.
 */
export class RoomManager {
  constructor() {
    /** @type {Map<string, Set<Peer>>} roomId -> set of peers */
    this.rooms = new Map();
  }

  /**
   * Add a peer to a room.
   * @returns {Peer[]} the peers that were ALREADY in the room, so the newcomer
   *   knows who to open connections with.
   */
  join(roomId, peer) {
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Set());
    const room = this.rooms.get(roomId);
    const existing = [...room]; // snapshot before we add the newcomer
    room.add(peer);
    peer.roomId = roomId;
    return existing;
  }

  /**
   * Remove a peer from its current room.
   * @returns {Peer[]} the peers that remain, so they can be told someone left.
   */
  leave(peer) {
    const room = this.rooms.get(peer.roomId);
    if (!room) return [];
    room.delete(peer);
    const remaining = [...room];
    if (room.size === 0) this.rooms.delete(peer.roomId); // tidy up empty rooms
    peer.roomId = null;
    return remaining;
  }

  /** @returns {Peer[]} everyone currently in the given room. */
  getPeers(roomId) {
    return [...(this.rooms.get(roomId) || [])];
  }
}
