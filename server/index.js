/**
 * VidStem signaling server - entry point.
 * ---------------------------------------------------------------------------
 * Run it with:
 *     npm start            # production-ish
 *     npm run dev          # auto-restarts on file changes
 *
 * Environment variables (all optional):
 *     PORT                      port to listen on          (default 8080)
 *     HOST                      interface to bind          (default 0.0.0.0)
 *     VIDSTEM_NO_STATIC=1       disable serving demo files (signaling only)
 *
 *   Hardening knobs (sensible defaults; override only if you need to):
 *     VIDSTEM_MAX_PAYLOAD       max bytes per WS frame      (default 65536)
 *     VIDSTEM_MAX_CONNECTIONS   max concurrent sockets      (default 5000)
 *     VIDSTEM_MAX_ROOMS         max simultaneous rooms       (default 1000)
 *     VIDSTEM_MAX_PEERS_PER_ROOM max participants per room   (default 32)
 *     VIDSTEM_MSG_RATE          sustained inbound msgs/sec   (default 80)
 *     VIDSTEM_MSG_BURST         inbound message burst        (default 200)
 *     VIDSTEM_ALLOWED_ORIGINS   comma-separated Origin allowlist for the
 *                               WebSocket (default: allow any origin)
 */
import { createVidStemServer } from './src/server.js';

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const SERVE_STATIC = process.env.VIDSTEM_NO_STATIC !== '1';

const ALLOWED_ORIGINS = (process.env.VIDSTEM_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const server = createVidStemServer({
  serveStatic: SERVE_STATIC,
  // `Number(...) || undefined` lets the server's own defaults apply when a var
  // is unset or not a positive number.
  maxPayload: Number(process.env.VIDSTEM_MAX_PAYLOAD) || undefined,
  maxConnections: Number(process.env.VIDSTEM_MAX_CONNECTIONS) || undefined,
  maxRooms: Number(process.env.VIDSTEM_MAX_ROOMS) || undefined,
  maxPeersPerRoom: Number(process.env.VIDSTEM_MAX_PEERS_PER_ROOM) || undefined,
  msgRate: Number(process.env.VIDSTEM_MSG_RATE) || undefined,
  msgBurst: Number(process.env.VIDSTEM_MSG_BURST) || undefined,
  allowedOrigins: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : null,
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  VidStem signaling server is running');
  console.log(`  -> WebSocket : ws://localhost:${PORT}`);
  if (SERVE_STATIC) {
    console.log(`  -> Demo      : http://localhost:${PORT}/`);
  }
  console.log(`  -> Health    : http://localhost:${PORT}/health`);
  if (ALLOWED_ORIGINS.length) {
    console.log(`  -> Origins   : restricted to ${ALLOWED_ORIGINS.join(', ')}`);
  }
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});

// Exit cleanly on Ctrl+C / container stop so sockets are released promptly.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n  Shutting down VidStem...');
    server.close(() => process.exit(0));
  });
}
