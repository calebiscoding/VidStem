import { Emitter } from './emitter.js';
import { Signaling } from './signaling.js';
import { Peer } from './peer.js';
import { getLocalStream, getScreenStream, listDevices, DEFAULT_CONSTRAINTS } from './media.js';

/**
 * Default ICE servers. STUN helps peers discover their public address so they
 * can connect directly. These free Google STUN servers are fine for demos and
 * many real networks.
 *
 * For PRODUCTION reliability you should also add a TURN server (relays media
 * when a direct path is impossible, e.g. strict corporate NATs). You can
 * self-host one for free with coturn - see ARCHITECTURE.md -> "TURN".
 */
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * VidStem - Core client
 * ---------------------------------------------------------------------------
 * The main entry point for embedding calls. It wires together signaling, the
 * local camera/mic, and one Peer per remote participant (a mesh). Use this
 * directly if you want to build your own UI; or use `VidStemUI` for a ready
 * made interface.
 *
 * Quick start:
 *
 *   import { VidStem } from '/client/src/vidstem.js';
 *
 *   const call = new VidStem({
 *     serverUrl: 'ws://localhost:8080',
 *     room: 'my-room',
 *     displayName: 'Alice',
 *   });
 *
 *   call.on('local-stream', (stream) => attachToVideoEl(stream));
 *   call.on('peer-stream', ({ peerId, stream }) => addRemoteVideo(peerId, stream));
 *   call.on('peer-removed', ({ peerId }) => removeRemoteVideo(peerId));
 *
 *   await call.join();
 *   // ...later: call.toggleMute(); call.toggleVideo(); call.leave();
 *
 * Emitted events:
 *   'local-stream'  -> (MediaStream) your camera/mic is ready
 *   'peer-added'    -> ({ peerId, displayName }) a participant is in the room
 *   'peer-stream'   -> ({ peerId, stream, displayName }) their media arrived
 *   'peer-removed'  -> ({ peerId }) a participant left
 *   'mute-changed'  -> (isMuted: boolean) your own mic toggled
 *   'video-changed' -> (isVideoOff: boolean) your own camera toggled
 *   'peer-state'    -> ({ peerId, muted, videoOff }) a remote person toggled
 *   'chat'          -> ({ peerId, displayName, text, ts, self }) a chat message
 *   'left'          -> you left the call
 *   'error'         -> (Error)
 */
export class VidStem extends Emitter {
  /**
   * @param {object} opts
   * @param {string} opts.serverUrl            - signaling server WebSocket URL
   * @param {string} [opts.room]               - room id (can also pass to join)
   * @param {string} [opts.displayName='Guest']
   * @param {RTCIceServer[]} [opts.iceServers] - override the default STUN/TURN
   * @param {MediaStreamConstraints} [opts.constraints] - override capture quality
   */
  constructor({ serverUrl, room, displayName = 'Guest', iceServers, constraints } = {}) {
    super();
    if (!serverUrl) throw new Error('VidStem: "serverUrl" is required.');

    this.serverUrl = serverUrl;
    this.room = room;
    this.displayName = displayName;
    this.constraints = constraints || DEFAULT_CONSTRAINTS;
    this.config = { iceServers: iceServers || DEFAULT_ICE_SERVERS };

    /** Our own id, assigned by the server on connect. */
    this.peerId = null;
    /** @type {MediaStream|null} */
    this.localStream = null;
    this.isMuted = false;
    this.isVideoOff = false;

    /** @type {Map<string, Peer>} remote peerId -> Peer */
    this.peers = new Map();
    /** @type {Map<string, string>} remote peerId -> displayName */
    this.names = new Map();

    this.signaling = new Signaling(serverUrl);
    this._wireSignaling();
  }

  /**
   * Acquire the camera/mic, connect to the server, and join the room.
   * @param {string} [room] - optional room id (overrides the constructor's).
   */
  async join(room = this.room) {
    this.room = room;
    if (!this.room) throw new Error('VidStem: a "room" is required to join.');

    try {
      // 1) Capture local media FIRST, so tracks exist before any peer is made.
      this.localStream = await getLocalStream(this.constraints);
      this.emit('local-stream', this.localStream);
    } catch (err) {
      this.emit('error', err);
      throw err;
    }

    // 2) Connect and announce ourselves once the socket is open.
    this.signaling.connect();
    this.signaling.once('open', () => {
      this.signaling.send({ type: 'join', room: this.room, displayName: this.displayName });
    });
  }

  /** Subscribe to all the signaling events and translate them into actions. */
  _wireSignaling() {
    const s = this.signaling;

    s.on('welcome', ({ peerId }) => {
      this.peerId = peerId;
    });

    // We just joined. Connect to everyone already here: we are the INITIATOR
    // toward existing peers, so we create the Peer objects now (adding our
    // tracks triggers the offer). Roles are derived from the ids.
    s.on('joined', ({ peerId, peers }) => {
      this.peerId = peerId;
      for (const { peerId: remoteId, displayName } of peers) {
        this.names.set(remoteId, displayName);
        this._createPeer(remoteId);
        this.emit('peer-added', { peerId: remoteId, displayName });
      }
    });

    // Someone joined AFTER us. They initiate toward us, so we just remember
    // their name and wait - their first signal will lazily create the Peer.
    s.on('peer-joined', ({ peer }) => {
      this.names.set(peer.peerId, peer.displayName);
      this.emit('peer-added', { peerId: peer.peerId, displayName: peer.displayName });
    });

    // A relayed WebRTC signal. Create the Peer on first contact if needed.
    s.on('signal', ({ from, data }) => {
      let peer = this.peers.get(from);
      if (!peer) peer = this._createPeer(from);
      peer.signal(data);
    });

    s.on('peer-left', ({ peerId }) => this._removePeer(peerId));

    s.on('error', ({ message }) =>
      this.emit('error', new Error(message || 'Signaling error')),
    );
  }

  /**
   * Decide our Perfect Negotiation role for a given remote peer. The rule is
   * deterministic and yields OPPOSITE roles on the two sides: the peer with the
   * lexicographically larger id is "polite".
   */
  _isPolite(remoteId) {
    return this.peerId > remoteId;
  }

  /** Create (or return existing) Peer for a remote id and wire its events. */
  _createPeer(remoteId) {
    if (this.peers.has(remoteId)) return this.peers.get(remoteId);

    const peer = new Peer({
      peerId: remoteId,
      polite: this._isPolite(remoteId),
      stream: this.localStream,
      config: this.config,
    });
    this.peers.set(remoteId, peer);

    // Relay this peer's outgoing signals to the right remote via the server.
    peer.on('signal', (data) =>
      this.signaling.send({ type: 'signal', to: remoteId, data }),
    );
    peer.on('stream', (stream) =>
      this.emit('peer-stream', { peerId: remoteId, stream, displayName: this.names.get(remoteId) }),
    );
    peer.on('close', () => this._removePeer(remoteId));

    // As soon as the control channel opens, tell this peer our current
    // mute/camera state so their UI shows the right indicators immediately.
    peer.on('channel-open', () =>
      peer.sendData({ kind: 'state', muted: this.isMuted, videoOff: this.isVideoOff }),
    );

    // Control messages from this peer (state updates and chat).
    peer.on('data', (msg) => this._handlePeerData(remoteId, msg));

    return peer;
  }

  /** Send a control message to every connected peer. */
  _broadcast(obj) {
    this.peers.forEach((peer) => peer.sendData(obj));
  }

  /** Route an incoming data-channel message from a peer to the right event. */
  _handlePeerData(remoteId, msg) {
    switch (msg?.kind) {
      case 'state':
        this.emit('peer-state', {
          peerId: remoteId,
          muted: !!msg.muted,
          videoOff: !!msg.videoOff,
        });
        break;
      case 'chat':
        this.emit('chat', {
          peerId: remoteId,
          displayName: this.names.get(remoteId) || 'Guest',
          // Cap length so a malicious peer cannot bypass the input limit and
          // flood the DOM with a huge message.
          text: String(msg.text || '').slice(0, 4096),
          ts: msg.ts || Date.now(),
          self: false,
        });
        break;
    }
  }

  /** Remove and clean up a peer, notifying listeners once. */
  _removePeer(remoteId) {
    const peer = this.peers.get(remoteId);
    if (!peer) return;
    this.peers.delete(remoteId);
    this.names.delete(remoteId);
    peer.close();
    this.emit('peer-removed', { peerId: remoteId });
  }

  // --- Controls -------------------------------------------------------------

  /**
   * Mute or unmute the microphone.
   * @param {boolean} [force] - explicitly set muted (true) / unmuted (false).
   * @returns {boolean} the resulting muted state.
   */
  toggleMute(force) {
    this.isMuted = typeof force === 'boolean' ? force : !this.isMuted;
    // Disabling a track keeps the connection alive but sends silence - this is
    // instant and far cheaper than renegotiating.
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !this.isMuted;
    });
    this.emit('mute-changed', this.isMuted);
    this._broadcast({ kind: 'state', muted: this.isMuted, videoOff: this.isVideoOff });
    return this.isMuted;
  }

  /**
   * Turn the camera off or on.
   * @param {boolean} [force] - explicitly set off (true) / on (false).
   * @returns {boolean} the resulting "video off" state.
   */
  toggleVideo(force) {
    this.isVideoOff = typeof force === 'boolean' ? force : !this.isVideoOff;
    this.localStream?.getVideoTracks().forEach((t) => {
      t.enabled = !this.isVideoOff;
    });
    this.emit('video-changed', this.isVideoOff);
    this._broadcast({ kind: 'state', muted: this.isMuted, videoOff: this.isVideoOff });
    return this.isVideoOff;
  }

  /**
   * Start sharing the screen. Replaces the outgoing camera video on every peer
   * with the screen track, and automatically restores the camera when the user
   * stops sharing from the browser UI.
   * @returns {Promise<MediaStream>} the screen stream.
   */
  async shareScreen() {
    const screen = await getScreenStream();
    const screenTrack = screen.getVideoTracks()[0];
    this.peers.forEach((peer) => peer.replaceTrack('video', screenTrack));

    // When the user clicks the browser's "Stop sharing", revert to the camera.
    screenTrack.addEventListener('ended', () => {
      const cameraTrack = this.localStream?.getVideoTracks()[0];
      if (cameraTrack) this.peers.forEach((peer) => peer.replaceTrack('video', cameraTrack));
    });

    return screen;
  }

  /**
   * Send a chat message to everyone over the peer-to-peer data channels. Also
   * emits a local 'chat' event (self: true) so the sender sees it right away.
   * @param {string} text
   */
  sendChat(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    const ts = Date.now();
    this._broadcast({ kind: 'chat', text: trimmed, ts });
    this.emit('chat', {
      peerId: this.peerId,
      displayName: this.displayName,
      text: trimmed,
      ts,
      self: true,
    });
  }

  // --- Devices --------------------------------------------------------------

  /**
   * List available cameras, microphones, and speakers. Device labels are only
   * filled in after permission is granted, so call this after join().
   * @returns {Promise<{cameras, microphones, speakers}>}
   */
  getDevices() {
    return listDevices();
  }

  /**
   * Switch the active camera. Replaces the outgoing video track on every peer
   * live (no reconnect) and keeps the current camera-off state.
   * @param {string} deviceId
   */
  async setCamera(deviceId) {
    const fresh = await getLocalStream({ video: { deviceId: { exact: deviceId } }, audio: false });
    const track = fresh.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !this.isVideoOff;
    this._swapLocalTrack('video', track);
  }

  /**
   * Switch the active microphone. Replaces the outgoing audio track on every
   * peer live (no reconnect) and keeps the current mute state.
   * @param {string} deviceId
   */
  async setMicrophone(deviceId) {
    const fresh = await getLocalStream({ audio: { deviceId: { exact: deviceId } }, video: false });
    const track = fresh.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !this.isMuted;
    this._swapLocalTrack('audio', track);
  }

  /**
   * Swap one track of the local stream and on all peers, then stop the old one.
   * Reuses the same MediaStream object so a bound <video> updates in place.
   */
  _swapLocalTrack(kind, newTrack) {
    if (!this.localStream) return;
    const [oldTrack] =
      kind === 'video' ? this.localStream.getVideoTracks() : this.localStream.getAudioTracks();
    this.peers.forEach((peer) => peer.replaceTrack(kind, newTrack));
    if (oldTrack) {
      this.localStream.removeTrack(oldTrack);
      oldTrack.stop();
    }
    this.localStream.addTrack(newTrack);
    this.emit('local-stream', this.localStream);
  }

  /** Leave the call: close all peers, stop local media, disconnect. */
  leave() {
    this.signaling.send({ type: 'leave' });
    this.peers.forEach((peer) => peer.close());
    this.peers.clear();
    this.names.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.signaling.close();
    this.emit('left');
  }
}
