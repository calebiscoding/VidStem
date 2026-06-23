# VidStem architecture

This document explains how VidStem works end to end, so you can confidently
extend it. The code itself is heavily commented - this is the map that ties it
together.

## The big idea

WebRTC lets two browsers send audio/video **directly** to each other. But before
they can, they need to exchange a little setup information (network addresses and
media capabilities). They can't do that directly - they don't know about each
other yet. That's what a **signaling server** is for: a meeting point that
relays small JSON messages until the browsers can talk directly.

```
   Browser A                  Signaling server                Browser B
      │   1. join "room"            │                              │
      ├────────────────────────────►                              │
      │                             │     2. join "room"           │
      │                             ◄──────────────────────────────┤
      │   3. relay offer/answer/ICE │  (tiny JSON messages only)   │
      │ ◄───────────────────────────────────────────────────────► │
      │                             │                              │
      │   4. DIRECT media (audio/video) - server NOT involved       │
      │ ◄═════════════════════════════════════════════════════════►│
```

The server only handles step 1–3. Once the direct connection is up (step 4),
audio and video never touch the server. That is why VidStem is cheap to host and
private by default.

## Components

| Layer | File(s) | Responsibility |
| --- | --- | --- |
| Signaling server | `server/src/server.js`, `room.js` | Group peers into rooms; relay signaling messages. |
| Static server | `server/src/static.js` | Serve demo + SDK locally (optional). |
| Signaling client | `client/src/signaling.js` | WebSocket + auto-reconnect; emits typed events. |
| Peer | `client/src/peer.js` | One `RTCPeerConnection`; Perfect Negotiation. |
| Media | `client/src/media.js` | `getUserMedia` / screen share / device list. |
| Core | `client/src/vidstem.js` | Ties signaling + media + peers into a mesh. |
| UI | `client/src/ui.js`, `vidstem.css` | Optional drop-in interface. |

## Topology: mesh

VidStem connects **every participant to every other participant** directly (a
"full mesh"). For N participants, each browser maintains N-1 connections and
sends its video N-1 times.

- **Pros:** dead simple, no media server, lowest latency, private.
- **Cons:** upload bandwidth grows with room size. Great for 2 to 6 people; not
  for large rooms or one-to-many streaming (that needs an SFU, see
  [Roadmap](#roadmap)).

## The signaling protocol

A handful of JSON messages over one WebSocket. The server never inspects the
`data` field of a `signal` - it's an opaque blob it forwards to one peer.

**Client → Server**

| Message | Purpose |
| --- | --- |
| `{ type: 'join', room, displayName }` | Join (or switch to) a room. |
| `{ type: 'signal', to, data }` | Relay a signal to one specific peer. |
| `{ type: 'leave' }` | Leave the current room. |

**Server → Client**

| Message | Purpose |
| --- | --- |
| `{ type: 'welcome', peerId }` | Your assigned id (sent on connect). |
| `{ type: 'joined', room, peerId, peers[] }` | Confirms your join + lists who's already here. |
| `{ type: 'peer-joined', peer }` | Someone new arrived after you. |
| `{ type: 'peer-left', peerId }` | Someone left. |
| `{ type: 'signal', from, data }` | A relayed signal from another peer. |
| `{ type: 'error', message }` | Something went wrong. |

## Connection flow

1. A browser connects; the server replies with `welcome` (its `peerId`).
2. It sends `join`. The server replies with `joined` (the list of existing
   peers) and tells the others with `peer-joined`.
3. **The newcomer is the initiator.** For each existing peer it creates a `Peer`
   and adds its local tracks. Adding tracks fires `negotiationneeded`, which
   produces an **offer** that is relayed via `signal`.
4. The receiving side creates its `Peer` lazily on the first `signal`, applies
   the offer, and replies with an **answer**.
5. Both sides trickle **ICE candidates** through `signal` until a direct path is
   found. Media flows.

## Control channel (mute state and chat)

Alongside the audio/video, each `Peer` opens a small **data channel** on the
same connection. It is created in "negotiated" mode with a fixed id, so both
sides open the identical channel with no extra handshake. Because it rides the
peer-to-peer connection, the server never sees its contents.

Two message kinds travel over it, both tiny JSON objects:

| Message | Purpose |
| --- | --- |
| `{ kind: 'state', muted, videoOff }` | A peer's mic/camera status. Sent when the channel opens and whenever it changes, so every tile shows accurate indicators. |
| `{ kind: 'chat', text, ts }` | A chat message. Broadcast to every peer; the sender also gets a local echo. |

Adding a new control message is easy: send it with `peer.sendData(obj)` (or the
core's `_broadcast`) and handle it in `vidstem.js` -> `_handlePeerData`.

## Perfect Negotiation (why `peer.js` looks the way it does)

When two sides try to negotiate at the same time (a "glare" collision), naive
WebRTC code deadlocks. VidStem uses the standard
[Perfect Negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)
pattern: each side is assigned a role.

- **polite** - on a collision, rolls back its own offer and accepts the other's.
- **impolite** - on a collision, ignores the incoming offer and proceeds.

Roles must be **opposite** on the two sides and decided **without coordination**.
VidStem derives them from the peer ids: the lexicographically larger id is
polite (`vidstem.js → _isPolite`). Because both sides compare the same two ids,
they always pick opposite roles. This also makes later renegotiation (e.g.
starting a screen share) robust.

## STUN and TURN

- **STUN** tells a browser its own public address so peers can attempt a direct
  connection. VidStem defaults to free Google STUN servers.
- **TURN** relays media when a direct connection is impossible (strict/symmetric
  NATs, some corporate/mobile networks). For reliable production calls you
  should run a TURN server (e.g. [coturn](https://github.com/coturn/coturn)) and
  pass it via the `iceServers` option. TURN is the one piece that uses real
  bandwidth on your infrastructure, but self-hosting it is free.

## Scaling

The in-memory `RoomManager` is per-process. To run multiple server instances
behind a load balancer, share room membership across them:

- Put a **Redis pub/sub** layer behind `RoomManager` so a `signal` for a peer on
  another instance is forwarded to the instance holding that peer's socket.
- Use **sticky sessions** (or any consistent routing) so a peer's WebSocket
  stays on one instance.

The wire protocol does not change - only the relay backend does.

## Roadmap

Already built, and worth reading as examples of how to extend the project:

- **Mute/camera state, device pickers, and text chat** all ride the
  peer-to-peer data channel (see "Control channel" above, plus `vidstem.js` and
  `ui.js`).

Great ways to extend VidStem next (good contribution ideas):

- **Active-speaker detection** - highlight whoever is talking using the Web
  Audio API. *(good first issue)*
- **Connection quality** - read `RTCPeerConnection.getStats()` and show a
  per-peer signal-strength indicator. *(good first issue)*
- **Recording** - capture the local mix with `MediaRecorder`.
- **SFU mode** - route media through a Selective Forwarding Unit (e.g.
  mediasoup) for large rooms and one-to-many streaming.
- **Reconnection of media** - re-establish peers after longer network drops.

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.
