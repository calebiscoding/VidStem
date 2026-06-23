import { Emitter } from './emitter.js';

/**
 * VidStem - Peer connection
 * ---------------------------------------------------------------------------
 * Wraps ONE direct browser-to-browser WebRTC connection (RTCPeerConnection) to
 * a single remote participant. In a group call we create one Peer per remote
 * participant - a "mesh". Your camera/mic flow directly to each peer; the
 * server is not in the media path.
 *
 * We use the "Perfect Negotiation" pattern: the modern, glare-free way to set
 * up and renegotiate WebRTC. Both sides may try to negotiate at the same time
 * (for example when both add their tracks at once). To resolve that cleanly,
 * each side is assigned a role:
 *
 *   - "polite"   peers yield (roll back their own offer) on a collision
 *   - "impolite" peers ignore the collision and barge ahead
 *
 * The two roles are derived deterministically from the peer ids (see
 * vidstem.js -> _isPolite), so both browsers always pick opposite roles
 * without any extra coordination. This same machinery makes later
 * renegotiation (e.g. starting a screen share) "just work".
 *
 * Reference:
 * https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
 *
 * A small data channel rides alongside the media on the same connection. We
 * use it for tiny JSON control messages (mute/camera state, chat). Because it
 * is peer to peer, the server is not involved in any of that either.
 *
 * Emitted events:
 *   'signal'       -> (data) deliver this to the remote peer via the server
 *   'stream'       -> (MediaStream) the remote participant's media is ready
 *   'connected'    -> the direct connection is established
 *   'channel-open' -> the data channel is ready to send/receive
 *   'data'         -> (object) a JSON message arrived on the data channel
 *   'close'        -> the connection ended (emitted once)
 */
export class Peer extends Emitter {
  /**
   * @param {object} opts
   * @param {string} opts.peerId            - the remote peer's id
   * @param {boolean} opts.polite           - perfect-negotiation role
   * @param {MediaStream} [opts.stream]     - local media to send
   * @param {RTCConfiguration} opts.config  - ICE servers, etc.
   */
  constructor({ peerId, polite, stream, config }) {
    super();
    this.peerId = peerId;
    this.polite = polite;

    // Perfect-negotiation bookkeeping.
    this._makingOffer = false;
    this._ignoreOffer = false;
    this._closed = false;

    const pc = new RTCPeerConnection(config);
    this.pc = pc;
    // We funnel all incoming remote tracks into one MediaStream that the app
    // can bind straight to a <video> element.
    this.remoteStream = new MediaStream();

    // A pre-negotiated data channel for control messages (mute state, chat).
    // "negotiated: true" with a fixed id means BOTH peers open the same channel
    // with no extra handshake, which is exactly what a symmetric mesh wants.
    const channel = pc.createDataChannel('vidstem', { negotiated: true, id: 0 });
    this.channel = channel;
    channel.onopen = () => this.emit('channel-open');
    channel.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // ignore anything that is not our JSON
      }
      this.emit('data', msg);
    };

    // Add our local tracks. Doing so fires 'negotiationneeded', which kicks
    // off the offer/answer handshake below.
    if (stream) {
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
    }

    // --- Outgoing signaling -------------------------------------------------
    pc.onnegotiationneeded = async () => {
      try {
        this._makingOffer = true;
        // No-arg setLocalDescription() lets the browser create the right kind
        // of description (offer/answer) for the current state.
        await pc.setLocalDescription();
        this.emit('signal', { description: pc.localDescription });
      } catch (err) {
        console.error('[VidStem] negotiation failed:', err);
      } finally {
        this._makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      // A null candidate means "end of candidates"; nothing to relay.
      if (candidate) this.emit('signal', { candidate });
    };

    // --- Incoming media -----------------------------------------------------
    pc.ontrack = ({ track }) => {
      this.remoteStream.addTrack(track);
      this.emit('stream', this.remoteStream);
    };

    // --- Connection lifecycle ----------------------------------------------
    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          this.emit('connected');
          break;
        case 'failed':
          // Try an ICE restart before giving up (handles network changes).
          pc.restartIce?.();
          break;
        case 'closed':
          this._emitClose();
          break;
      }
    };
  }

  /**
   * Apply an incoming signal (offer, answer, or ICE candidate) from the remote
   * peer. This is the receiving half of Perfect Negotiation.
   * @param {{description?: RTCSessionDescriptionInit, candidate?: RTCIceCandidateInit}} data
   */
  async signal(data) {
    const pc = this.pc;
    try {
      if (data.description) {
        // A collision happens if the remote sends an offer while we are also
        // mid-offer (or otherwise not "stable").
        const offerCollision =
          data.description.type === 'offer' &&
          (this._makingOffer || pc.signalingState !== 'stable');

        this._ignoreOffer = !this.polite && offerCollision;
        if (this._ignoreOffer) return; // impolite peer wins - ignore their offer

        // Setting a remote offer while we have a local offer triggers an
        // implicit rollback in modern browsers, so the polite peer yields.
        await pc.setRemoteDescription(data.description);

        if (data.description.type === 'offer') {
          await pc.setLocalDescription(); // creates the answer
          this.emit('signal', { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          // If we deliberately ignored an offer, its candidates will fail to
          // apply - that is expected, so swallow only in that case.
          if (!this._ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error('[VidStem] failed to apply signal:', err);
    }
  }

  /**
   * Replace an outgoing track of a given kind without renegotiating from
   * scratch. Handy for switching camera, or swapping camera <-> screen share.
   * @param {'audio'|'video'} kind
   * @param {MediaStreamTrack|null} newTrack
   */
  replaceTrack(kind, newTrack) {
    const sender = this.pc.getSenders().find((s) => s.track?.kind === kind);
    if (sender) sender.replaceTrack(newTrack);
  }

  /**
   * Send a small JSON control message over the data channel. Does nothing if
   * the channel is not open yet, so callers never need to check.
   * @param {object} obj
   */
  sendData(obj) {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify(obj));
    }
  }

  /** Tear down the connection. Safe to call multiple times. */
  close() {
    try {
      this.pc.close();
    } catch {
      /* already closed */
    }
    this._emitClose();
  }

  /** Emit 'close' at most once, regardless of how teardown was triggered. */
  _emitClose() {
    if (this._closed) return;
    this._closed = true;
    this.emit('close');
  }
}
