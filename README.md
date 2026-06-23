# VidStem

[![Open Source by Aero Softworks](https://img.shields.io/badge/Open%20Source-Aero%20Softworks-6c8cff?style=flat-square&logo=opensourceinitiative&logoColor=white)](https://aerosoftworks.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-3ddc97?style=flat-square)](LICENSE)

**Lightweight, open-source video & audio calling you can embed in any website - no paid provider required.**

VidStem adds real-time video and audio calls to any page using [WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API). Media flows **directly between participants** (peer-to-peer), so the only thing you host is a tiny *signaling* server that helps browsers find each other. That server is small enough to run on a $5 VPS, a Raspberry Pi, or a free hosting tier.

- **Zero-dependency client SDK** - pure web standards, a few kilobytes, no build step.
- **Tiny server** - Node.js with a single dependency (`ws`).
- **Drop-in UI** - a clean call interface (mute, camera, screen share, device settings, chat) in ~3 lines.
- **Live status + chat** - see who is muted or camera-off, switch camera/mic/speaker mid-call, and chat over a peer-to-peer data channel.
- **Runs anywhere** - any modern browser; Windows, macOS, or Linux on the server.
- **Private by design** - your server relays connection setup only; it never sees audio, video, or chat.
- **Hardened by default** - frame-size caps, per-connection rate limiting, room/connection limits, an optional Origin allowlist, and HTML-escaped peer input.
- **MIT licensed** - fork it, theme it, extend it.

---

## Quick start

**Requirements:** [Node.js](https://nodejs.org) 16 or newer.

```bash
# 1. Get the code
git clone https://github.com/coleauburnwesley/VidStem.git
cd VidStem

# 2. Install the one server dependency
npm install

# 3. Start the signaling server (also serves the demo)
npm start
```

Then open **http://localhost:8080** and click **Start a call**. To see two-way video, open the demo in a second browser tab (or another device) and join the **same room**.

> **Tip:** Calls require a *secure context*. `localhost` counts as secure, so local development just works. When you deploy, you must serve over **HTTPS/WSS** (see [Deploying](#deploying)).

---

## Add a call to your own site

Three steps. That's the whole integration:

```html
<!-- 1) Include the stylesheet once -->
<link rel="stylesheet" href="/client/src/vidstem.css" />

<!-- 2) A container with a height -->
<div id="call" style="height: 600px"></div>

<!-- 3) Start the call -->
<script type="module">
  import { VidStemUI } from '/client/src/ui.js';

  new VidStemUI({
    container: '#call',
    serverUrl: 'ws://localhost:8080', // your signaling server
    room: 'team-standup',             // anyone with this room id joins the call
    displayName: 'Alice',
  }).start();
</script>
```

See [`examples/embed.html`](examples/embed.html) for the minimal version and [`examples/demo.html`](examples/demo.html) for a version with a pre-call "lobby".

---

## Bring your own UI

Want full control over the look? Use the `VidStem` core directly and render however you like - the UI component is just a consumer of these same events.

```js
import { VidStem } from '/client/src/vidstem.js';

const call = new VidStem({
  serverUrl: 'wss://calls.yoursite.com',
  room: 'team-standup',
  displayName: 'Alice',
});

// Your camera/mic is ready
call.on('local-stream', (stream) => {
  myVideoEl.srcObject = stream;
});

// A remote participant's media arrived
call.on('peer-stream', ({ peerId, stream, displayName }) => {
  addRemoteVideo(peerId, stream, displayName);
});

// A participant left
call.on('peer-removed', ({ peerId }) => removeRemoteVideo(peerId));

// A remote participant muted/unmuted or toggled their camera
call.on('peer-state', ({ peerId, muted, videoOff }) => updateTile(peerId, muted, videoOff));

// A chat message arrived (self: true for messages you sent)
call.on('chat', ({ displayName, text, self }) => addChatLine(displayName, text, self));

await call.join();

// Controls
call.toggleMute();              // mute/unmute mic
call.toggleVideo();             // camera off/on
call.shareScreen();             // start screen sharing
call.sendChat('hello');         // send a chat message to everyone
call.setCamera(deviceId);       // switch camera live (see getDevices())
call.setMicrophone(deviceId);   // switch microphone live
call.leave();                   // hang up and clean up
```

---

## API reference

### `new VidStem(options)`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `serverUrl` | `string` | - | **Required.** Signaling server WebSocket URL (`ws://` or `wss://`). |
| `room` | `string` | - | Room id. Required by `join()` (can be passed there instead). |
| `displayName` | `string` | `'Guest'` | Name shown to other participants. |
| `iceServers` | `RTCIceServer[]` | Google STUN | Override STUN/TURN servers. |
| `constraints` | `MediaStreamConstraints` | 720p + audio | Override capture quality. |

**Methods:** `join(room?)`, `toggleMute(force?)`, `toggleVideo(force?)`, `shareScreen()`, `sendChat(text)`, `getDevices()`, `setCamera(deviceId)`, `setMicrophone(deviceId)`, `leave()`.

**Events:** `local-stream`, `peer-added`, `peer-stream`, `peer-removed`, `mute-changed`, `video-changed`, `peer-state`, `chat`, `left`, `error`.

### `new VidStemUI(options)`

Accepts everything `VidStem` does, plus:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `container` | `string \| HTMLElement` | - | **Required.** Where to render the UI. |
| `showScreenShare` | `boolean` | `true` | Show the screen-share button. |

**Methods:** `start()` (asks for camera/mic, then joins), `leave()`. The underlying core is exposed as `ui.vs` if you need it.

The UI wires up the rest for you: live muted / camera-off indicators on each tile, a device settings menu (camera, microphone, and speaker where supported), and a chat panel with an unread badge. Keyboard shortcuts: `m` mute, `v` camera, `Esc` close menus.

**Theming:** override CSS variables on `.vs-root` (e.g. `--vs-accent`, `--vs-bg`, `--vs-radius`). See [`client/src/vidstem.css`](client/src/vidstem.css).

---

## Project structure

```
VidStem/
├── server/                 # Signaling server (Node + ws)
│   ├── index.js            # Entry point - `npm start` runs this
│   └── src/
│       ├── server.js       # HTTP + WebSocket signaling
│       ├── room.js         # Room / peer bookkeeping
│       └── static.js       # Tiny static file server (for the demo)
├── client/src/             # Browser SDK (zero dependencies)
│   ├── vidstem.js          # VidStem core - orchestrates everything
│   ├── peer.js             # One WebRTC connection (Perfect Negotiation)
│   ├── signaling.js        # WebSocket client + auto-reconnect
│   ├── media.js            # getUserMedia / screen share helpers
│   ├── emitter.js          # Tiny event emitter
│   ├── ui.js               # Drop-in call UI (VidStemUI)
│   └── vidstem.css         # UI styles (themeable)
├── examples/
│   ├── index.html          # Landing page
│   ├── demo.html           # Full demo with a lobby
│   └── embed.html          # Minimal embed
├── ARCHITECTURE.md         # How it works + how to extend it
└── CONTRIBUTING.md         # How to get involved
```

---

## Deploying

VidStem needs two things in production:

1. **HTTPS for your pages and WSS for signaling.** Browsers only grant camera/mic access in a secure context. Put the signaling server behind a TLS-terminating reverse proxy (Caddy, Nginx, a cloud load balancer) and connect with `wss://`.
2. **A TURN server (strongly recommended).** STUN alone fails on strict/symmetric NATs (many corporate and mobile networks). A TURN server relays media when a direct path is impossible. You can self-host one for free with [coturn](https://github.com/coturn/coturn):

   ```js
   new VidStem({
     serverUrl: 'wss://calls.yoursite.com',
     room: 'team',
     iceServers: [
       { urls: 'stun:stun.l.google.com:19302' },
       {
         urls: 'turn:turn.yoursite.com:3478',
         username: 'user',
         credential: 'pass',
       },
     ],
   });
   ```

Run signaling-only (no demo files) by setting `VIDSTEM_NO_STATIC=1`. See [ARCHITECTURE.md](ARCHITECTURE.md) for scaling notes.

---

## Security

The signaling server only relays connection-setup messages; it never sees your audio, video, or chat (those flow peer-to-peer, encrypted by WebRTC). The server ships with safe defaults against common abuse:

- **Bounded frames** - WebSocket messages are capped (64 KB) so no client can exhaust memory with a giant frame.
- **Rate limiting** - a per-connection token bucket absorbs the join-time burst, then throttles sustained floods.
- **Capacity caps** - limits on total connections, simultaneous rooms, and participants per room prevent memory-exhaustion DoS.
- **No data trust** - inbound JSON is size-checked; the `from` field on relayed signals is set by the server, so peer ids cannot be spoofed.
- **Escaped output** - the client treats all peer-provided text (display names, chat, device labels) as untrusted and HTML-escapes it, so a malicious name or message cannot inject script.

For an internet-facing deployment:

1. **Serve over HTTPS/WSS** - required for camera/mic access and for encrypted media.
2. **Lock down origins** with `VIDSTEM_ALLOWED_ORIGINS=https://yoursite.com` to mitigate cross-site WebSocket hijacking. It is open by default so you can embed VidStem anywhere during development.
3. **Run signaling-only** with `VIDSTEM_NO_STATIC=1` and serve the SDK from your own web server or CDN.
4. **Put it behind your reverse proxy / WAF** for TLS termination and IP-level rate limiting. Every limit above is tunable via the `VIDSTEM_*` environment variables (see [`server/index.js`](server/index.js)).

---

## How many people per call?

VidStem uses a **mesh** topology: every participant connects directly to every other participant. This is perfect for **1-on-1 and small group calls** (roughly 2 to 6 people) and keeps the server trivially cheap. For large rooms or live streaming to many viewers you'd add an SFU, see the [roadmap](ARCHITECTURE.md#roadmap).

---

## Browser support

Works in current versions of Chrome, Edge, Firefox, and Safari (15+). VidStem uses the modern, no-argument `setLocalDescription()` form for [Perfect Negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation).

---

## Contributing

VidStem is meant to be built upon by a community. Good first issues, the coding style, and the local setup are all in [CONTRIBUTING.md](CONTRIBUTING.md). The code is heavily commented on purpose - start with [ARCHITECTURE.md](ARCHITECTURE.md) to get the lay of the land.

## License

[MIT](LICENSE) © VidStem contributors.
