/**
 * VidStem - Signaling server
 * ---------------------------------------------------------------------------
 * A small WebSocket server that relays WebRTC "signaling" between browsers so
 * they can establish direct peer-to-peer calls. It also (optionally) serves
 * the demo pages and client SDK over plain HTTP for zero-config local dev.
 *
 * The wire protocol is a handful of JSON messages - see ARCHITECTURE.md for the
 * full reference. In short:
 *
 *   Client -> Server
 *     { type: 'join',   room, displayName }   join (or switch) rooms
 *     { type: 'signal', to, data }            relay a signal to one peer
 *     { type: 'leave' }                       leave the current room
 *
 *   Server -> Client
 *     { type: 'welcome',     peerId }                 assigned on connect
 *     { type: 'joined',      room, peerId, peers[] }  who is already here
 *     { type: 'peer-joined', peer }                   someone new arrived
 *     { type: 'peer-left',   peerId }                 someone left
 *     { type: 'signal',      from, data }             a relayed signal
 *     { type: 'error',       message }                something went wrong
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { RoomManager, Peer } from './room.js';
import { createStaticHandler } from './static.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/src -> project root (two levels up).
const PROJECT_ROOT = join(__dirname, '..', '..');

/**
 * Create (but do not start) a VidStem signaling server.
 *
 * The defaults are safe for a public deployment: tiny frames, bounded rooms,
 * and per-connection rate limiting so no single client can exhaust the server.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.serveStatic=true]   - also serve the demo + SDK files.
 * @param {number}  [opts.maxPayload=65536]   - max bytes per WebSocket frame.
 * @param {number}  [opts.maxConnections=5000]- max concurrent sockets.
 * @param {number}  [opts.maxRooms=1000]      - max simultaneous rooms.
 * @param {number}  [opts.maxPeersPerRoom=32] - max participants in one room.
 * @param {number}  [opts.msgRate=80]         - sustained inbound msgs/sec/peer.
 * @param {number}  [opts.msgBurst=200]       - inbound message burst allowance.
 * @param {string[]|null} [opts.allowedOrigins=null] - if set, only these
 *   Origins may open a WebSocket (mitigates cross-site WebSocket hijacking).
 *   Left null by default because VidStem is meant to embed on any site.
 * @returns {import('node:http').Server} call `.listen(port, host, cb)` on it.
 */
export function createVidStemServer({
  serveStatic = true,
  maxPayload = 64 * 1024,
  maxConnections = 5000,
  maxRooms = 1000,
  maxPeersPerRoom = 32,
  msgRate = 80,
  msgBurst = 200,
  allowedOrigins = null,
} = {}) {
  const rooms = new RoomManager();
  const limits = { maxRooms, maxPeersPerRoom, msgRate, msgBurst };

  const originAllow =
    allowedOrigins && allowedOrigins.length
      ? new Set(Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins])
      : null;

  const staticHandler = serveStatic
    ? createStaticHandler(PROJECT_ROOT, { rewrites: { '/': '/examples/index.html' } })
    : null;

  // --- HTTP layer: health check + optional static files --------------------
  const httpServer = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', rooms: rooms.rooms.size }));
      return;
    }
    if (staticHandler && (await staticHandler(req, res))) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  // --- WebSocket layer: the actual signaling -------------------------------
  // `maxPayload` caps frame size so one client cannot exhaust memory with a
  // huge frame; `verifyClient` enforces the connection cap and Origin policy
  // during the handshake, before any socket is established.
  let connections = 0;
  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload,
    verifyClient: ({ origin }, done) => {
      if (connections >= maxConnections) return done(false, 503, 'Server busy');
      if (originAllow && !originAllow.has(origin)) return done(false, 403, 'Forbidden origin');
      done(true);
    },
  });

  wss.on('connection', (socket) => {
    connections += 1;
    const peer = new Peer(socket);
    // Tell the client its assigned id immediately; it needs this to compute
    // deterministic negotiation roles (see client/src/peer.js).
    peer.send({ type: 'welcome', peerId: peer.id });

    socket.on('message', (raw) => handleMessage(peer, raw, rooms, limits));
    // 'ws' always emits 'close' (even after 'error'), so we decrement there.
    socket.on('close', () => {
      connections -= 1;
      handleLeave(peer, rooms);
    });
    socket.on('error', () => handleLeave(peer, rooms));
  });

  return httpServer;
}

/** Parse and route an incoming client message. */
function handleMessage(peer, raw, rooms, limits) {
  // Drop frames from a peer that is over its rate budget, before any parsing.
  if (!peer.allow(limits.msgRate, limits.msgBurst)) return;

  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return; // ignore malformed frames
  }

  switch (msg.type) {
    case 'join':
      return handleJoin(peer, msg, rooms, limits);
    case 'signal':
      return handleSignal(peer, msg, rooms);
    case 'leave':
      return handleLeave(peer, rooms);
    default:
      // Do not echo the raw type back; just report it was not understood.
      peer.send({ type: 'error', message: 'Unknown message type.' });
  }
}

/** A peer wants to join a room. */
function handleJoin(peer, msg, rooms, limits) {
  const roomId = String(msg.room || '').trim().slice(0, 128);
  if (!roomId) {
    return peer.send({ type: 'error', message: 'A "room" id is required to join.' });
  }

  // If the peer is already in a room, leave it first (clean room switching).
  if (peer.roomId) handleLeave(peer, rooms);

  // Capacity checks. Empty rooms are deleted, so a room "exists" iff it has
  // peers. This prevents both unbounded room creation and oversized meshes.
  const current = rooms.getPeers(roomId);
  if (current.length === 0 && rooms.rooms.size >= limits.maxRooms) {
    return peer.send({ type: 'error', message: 'Server is at capacity. Try again later.' });
  }
  if (current.length >= limits.maxPeersPerRoom) {
    return peer.send({ type: 'error', message: 'This room is full.' });
  }

  peer.displayName = String(msg.displayName || 'Guest').slice(0, 64);
  const existing = rooms.join(roomId, peer);

  // 1) Tell the newcomer who is already here. By convention the newcomer is the
  //    "initiator" toward each existing peer (see client/src/vidstem.js).
  peer.send({
    type: 'joined',
    room: roomId,
    peerId: peer.id,
    peers: existing.map((p) => ({ peerId: p.id, displayName: p.displayName })),
  });

  // 2) Tell everyone already in the room that a new peer arrived.
  for (const other of existing) {
    other.send({
      type: 'peer-joined',
      peer: { peerId: peer.id, displayName: peer.displayName },
    });
  }
}

/** Relay an opaque WebRTC signal to a specific peer in the same room. */
function handleSignal(peer, msg, rooms) {
  if (!peer.roomId || !msg.to) return;
  const target = rooms.getPeers(peer.roomId).find((p) => p.id === msg.to);
  if (!target) return; // target may have just left; safe to drop
  target.send({ type: 'signal', from: peer.id, data: msg.data });
}

/** A peer left (explicitly or by disconnecting). Notify the rest of the room. */
function handleLeave(peer, rooms) {
  if (!peer.roomId) return;
  const remaining = rooms.leave(peer);
  for (const other of remaining) {
    other.send({ type: 'peer-left', peerId: peer.id });
  }
}
