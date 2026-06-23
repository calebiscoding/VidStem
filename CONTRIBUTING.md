# Contributing to VidStem

Thanks for helping build VidStem! The goal of this project is to be a friendly,
readable, community-maintained base for real-time calls. You do **not** need to
be a WebRTC expert to contribute - start small.

## Local setup

```bash
git clone <your-fork-url>
cd VidStem
npm install
npm run dev      # starts the server and auto-restarts on changes
```

Open http://localhost:8080 and click **Start a call**. To test a real call,
open the demo in **two browser tabs** (or two devices) and join the same room.
`localhost` is treated as a secure context, so camera/mic work without HTTPS.

There is no build step. The client SDK is plain ES modules served as-is, so you
can edit `client/src/*.js`, refresh, and see changes immediately.

## How it's organized

Read [ARCHITECTURE.md](ARCHITECTURE.md) first - it's short and explains the
signaling flow and the Perfect Negotiation pattern. Then the most useful files
to know are:

- `client/src/vidstem.js` - the core that wires everything together.
- `client/src/peer.js` - a single WebRTC connection.
- `server/src/server.js` - the signaling protocol.

## Coding style

- **No new runtime dependencies** without discussion. The client SDK must stay
  dependency-free; the server should stay close to it (currently just `ws`).
- **Comment the "why".** This codebase is meant to teach. Favor clear names and
  short functions. Explain non-obvious WebRTC behavior.
- **Keep it framework-agnostic.** The SDK must work on a plain HTML page. UI
  features belong in `ui.js`, not the core.
- Use modern, standard JavaScript (ES modules, `async/await`). Match the
  existing formatting (2-space indent, semicolons, single quotes).

## Good first issues

These are scoped, high-value, and don't require deep WebRTC knowledge:

1. **Active-speaker highlight** - use the Web Audio API to outline the tile of
   whoever is currently talking.
2. **Connection quality indicator** - read `RTCPeerConnection.getStats()` and
   show a simple signal-strength dot per peer.
3. **Raise hand / reactions** - send a quick reaction over the data channel
   (`peer.sendData`) and show it briefly on the sender's tile.
4. **Persisted device choice** - remember the selected camera/mic in
   `localStorage` and reapply it on the next call.

Mute/camera state, device pickers, and text chat are already built; read them
in `client/src/vidstem.js` and `client/src/ui.js` for the patterns. Larger
efforts (recording, SFU mode) are listed in the
[roadmap](ARCHITECTURE.md#roadmap) - open an issue to discuss before starting.

## Submitting changes

1. Create a branch: `git checkout -b feature/short-name`.
2. Make your change with clear commits.
3. **Test manually** with two tabs: a fresh join, a second peer joining, muting
   (check the indicator on the other tab), camera toggle, screen share, device
   switching, chat, and leaving. Note what you tested in the PR.
4. Open a pull request describing **what** changed and **why**, with screenshots
   or a short clip for UI changes.

## Reporting bugs

Open an issue with:

- What you did, what you expected, and what happened.
- Browser + OS and whether you used the demo or your own integration.
- Any errors from the browser console and the server terminal.

By contributing you agree your work is licensed under the project's
[MIT License](LICENSE).
