import { VidStem } from './vidstem.js';

/**
 * VidStem - Drop-in call UI
 * ---------------------------------------------------------------------------
 * A complete, good-looking call interface you can add to any page in a few
 * lines. It renders a responsive video grid plus a control bar (microphone,
 * camera, screen share, leave) and wires itself to the VidStem core.
 *
 * Want a custom look? Skip this file and use `VidStem` directly - every event
 * and control you need is on that class.
 *
 * Usage:
 *   import { VidStemUI } from '/client/src/ui.js';
 *
 *   const ui = new VidStemUI({
 *     container: '#call',                 // CSS selector or HTMLElement
 *     serverUrl: 'ws://localhost:8080',
 *     room: 'demo',
 *     displayName: 'Alice',
 *   });
 *   ui.start();                            // asks for camera/mic, then joins
 *
 * Remember to include the stylesheet once on the page:
 *   <link rel="stylesheet" href="/client/src/vidstem.css">
 */

// Inline Lucide-style icons (stroke-based, 24x24). Inlining keeps the SDK
// dependency-free and avoids an extra network request for an icon font.
const ICON = {
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  micOff: '<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5l-1.5-1.5"/><path d="M15 9.34V4a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>',
  video: '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>',
  videoOff: '<path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2l10 10Z"/><line x1="2" x2="22" y1="2" y2="22"/>',
  screen: '<path d="m9 10 3-3 3 3"/><path d="M12 13V7"/><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M7 21h10"/>',
  leave: '<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="22" x2="2" y1="2" y2="22"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

/** Build an <svg> element from one of the ICON path sets above. */
function svg(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

/** Derive up-to-two-letter initials from a display name, for the avatar. */
function initials(name) {
  return (name || 'Guest')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || 'G';
}

export class VidStemUI {
  /**
   * @param {object} options - same as VidStem, plus:
   * @param {string|HTMLElement} options.container - where to render the UI.
   * @param {boolean} [options.showScreenShare=true]
   */
  constructor(options) {
    this.options = options;
    this.root =
      typeof options.container === 'string'
        ? document.querySelector(options.container)
        : options.container;
    if (!this.root) {
      throw new Error(`VidStemUI: container "${options.container}" was not found.`);
    }

    this.vs = new VidStem(options);
    /** @type {Map<string, HTMLElement>} peerId -> tile element */
    this.tiles = new Map();

    this._build();
    this._wire();
  }

  /** Ask for camera/mic and join the call. Returns the join promise. */
  start() {
    return this.vs.join().catch((err) => this._toast(err.message, 'error'));
  }

  /** Leave the call and remove all remote tiles. */
  leave() {
    this.vs.leave();
  }

  // --- DOM construction -----------------------------------------------------

  _build() {
    this.root.classList.add('vs-root');
    this._unread = 0; // unread chat messages while the panel is closed
    this._sinkId = null; // chosen speaker (output) device, if any

    this.root.innerHTML = `
      <div class="vs-grid" role="list" aria-label="Call participants"></div>
      <div class="vs-toast" role="status" aria-live="polite" hidden></div>

      <div class="vs-menu" hidden role="menu" aria-label="Device settings"></div>

      <aside class="vs-chat" aria-label="Chat">
        <div class="vs-chat-head">
          <span>Chat</span>
          <button class="vs-chat-close" data-action="chat-close" aria-label="Close chat">${svg(ICON.close)}</button>
        </div>
        <div class="vs-chat-list"></div>
        <form class="vs-chat-form">
          <input class="vs-chat-input" type="text" placeholder="Type a message" autocomplete="off" maxlength="2000" />
          <button class="vs-chat-send" type="submit" aria-label="Send message">${svg(ICON.send)}</button>
        </form>
      </aside>

      <div class="vs-bar">
        <button class="vs-btn" data-action="mic"      title="Mute (m)"     aria-label="Mute microphone">${svg(ICON.mic)}</button>
        <button class="vs-btn" data-action="camera"   title="Camera (v)"   aria-label="Turn camera off">${svg(ICON.video)}</button>
        <button class="vs-btn" data-action="screen"   title="Share screen" aria-label="Share screen">${svg(ICON.screen)}</button>
        <button class="vs-btn" data-action="settings" title="Settings"     aria-label="Device settings">${svg(ICON.settings)}</button>
        <button class="vs-btn" data-action="chat"     title="Chat"         aria-label="Toggle chat">${svg(ICON.chat)}<span class="vs-badge" hidden></span></button>
        <button class="vs-btn vs-btn-danger" data-action="leave" title="Leave call" aria-label="Leave call">${svg(ICON.leave)}</button>
      </div>
    `;

    this.grid = this.root.querySelector('.vs-grid');
    this.bar = this.root.querySelector('.vs-bar');
    this.toastEl = this.root.querySelector('.vs-toast');
    this.menu = this.root.querySelector('.vs-menu');
    this.chatList = this.root.querySelector('.vs-chat-list');
    this.chatForm = this.root.querySelector('.vs-chat-form');
    this.chatInput = this.root.querySelector('.vs-chat-input');
    this.badge = this.root.querySelector('.vs-badge');
    this.btn = {
      mic: this.bar.querySelector('[data-action="mic"]'),
      camera: this.bar.querySelector('[data-action="camera"]'),
      screen: this.bar.querySelector('[data-action="screen"]'),
      settings: this.bar.querySelector('[data-action="settings"]'),
      chat: this.bar.querySelector('[data-action="chat"]'),
      leave: this.bar.querySelector('[data-action="leave"]'),
    };

    if (this.options.showScreenShare === false) this.btn.screen.hidden = true;

    // Control bar actions.
    this.btn.mic.addEventListener('click', () => this.vs.toggleMute());
    this.btn.camera.addEventListener('click', () => this.vs.toggleVideo());
    this.btn.screen.addEventListener('click', () => this._onScreenShare());
    this.btn.settings.addEventListener('click', () => this._toggleMenu());
    this.btn.chat.addEventListener('click', () => this._toggleChat());
    this.btn.leave.addEventListener('click', () => this.leave());

    this.root
      .querySelector('[data-action="chat-close"]')
      .addEventListener('click', () => this._toggleChat(false));
    this.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.vs.sendChat(this.chatInput.value);
      this.chatInput.value = '';
    });

    // Close the settings menu when clicking anywhere outside of it.
    this._onDocClick = (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target) && !this.btn.settings.contains(e.target)) {
        this._toggleMenu(false);
      }
    };
    document.addEventListener('click', this._onDocClick);

    // Keyboard shortcuts: m = mute, v = video, Esc = close menus.
    this._onKey = (e) => {
      if (e.key === 'Escape') {
        this._toggleMenu(false);
        this._toggleChat(false);
        return;
      }
      if (e.target.matches('input, textarea')) return;
      if (e.key === 'm') this.vs.toggleMute();
      if (e.key === 'v') this.vs.toggleVideo();
    };
    document.addEventListener('keydown', this._onKey);
  }

  // --- Event wiring ---------------------------------------------------------

  _wire() {
    const vs = this.vs;

    vs.on('local-stream', (stream) => {
      const tile = this._ensureTile('local', this.options.displayName || 'You', { local: true });
      this._attachStream(tile, stream, /* muted */ true);
    });

    vs.on('peer-added', ({ peerId, displayName }) => {
      this._ensureTile(peerId, displayName);
    });

    vs.on('peer-stream', ({ peerId, stream, displayName }) => {
      const tile = this._ensureTile(peerId, displayName);
      this._attachStream(tile, stream, /* muted */ false);
    });

    vs.on('peer-removed', ({ peerId }) => this._removeTile(peerId));

    vs.on('mute-changed', (muted) => {
      this.btn.mic.classList.toggle('vs-active', muted);
      this.btn.mic.innerHTML = svg(muted ? ICON.micOff : ICON.mic);
      this.btn.mic.setAttribute('aria-label', muted ? 'Unmute microphone' : 'Mute microphone');
      this._setTileMuted('local', muted);
    });

    vs.on('video-changed', (off) => {
      this.btn.camera.classList.toggle('vs-active', off);
      this.btn.camera.innerHTML = svg(off ? ICON.videoOff : ICON.video);
      this.tiles.get('local')?.classList.toggle('vs-video-off', off);
    });

    // A remote participant toggled their mic/camera (received over the data
    // channel). Update their tile's muted indicator and camera-off avatar.
    vs.on('peer-state', ({ peerId, muted, videoOff }) => {
      this._setTileMuted(peerId, muted);
      this.tiles.get(peerId)?.classList.toggle('vs-video-off', videoOff);
    });

    // A chat message (from a peer, or our own echoed back with self: true).
    vs.on('chat', (msg) => this._appendChat(msg));

    vs.on('left', () => {
      this.tiles.forEach((tile) => tile.remove());
      this.tiles.clear();
      this.chatList.innerHTML = '';
      this._unread = 0;
      this._updateBadge();
      this._toggleChat(false);
      this._toggleMenu(false);
      this._toast('You left the call.', 'info');
      document.removeEventListener('keydown', this._onKey);
      document.removeEventListener('click', this._onDocClick);
    });

    vs.on('error', (err) => this._toast(err.message, 'error'));
  }

  async _onScreenShare() {
    try {
      await this.vs.shareScreen();
      this.btn.screen.classList.add('vs-active');
    } catch (err) {
      // A user cancelling the picker throws too; only surface real errors.
      if (err?.name !== 'NotAllowedError') this._toast(err.message, 'error');
    }
  }

  // --- Settings menu (device pickers) ---------------------------------------

  /** Open or close the device settings menu. */
  _toggleMenu(force) {
    const show = typeof force === 'boolean' ? force : this.menu.hidden;
    this.menu.hidden = !show;
    this.btn.settings.classList.toggle('vs-active', show);
    if (show) this._renderDevices();
  }

  /** Populate the menu with camera / microphone / speaker dropdowns. */
  async _renderDevices() {
    let devices;
    try {
      devices = await this.vs.getDevices();
    } catch {
      this.menu.innerHTML = '<div class="vs-menu-empty">Could not read devices.</div>';
      return;
    }

    // Speaker switching relies on HTMLMediaElement.setSinkId, which not every
    // browser supports. Hide that row where it would not work.
    const speakerSupported = 'setSinkId' in HTMLMediaElement.prototype;

    const group = (label, kind, list) => {
      if (!list.length) return '';
      const options = list
        .map((d, i) => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || `${label} ${i + 1}`)}</option>`)
        .join('');
      return `<label class="vs-menu-row"><span>${label}</span><select data-select="${kind}">${options}</select></label>`;
    };

    this.menu.innerHTML =
      group('Camera', 'camera', devices.cameras) +
      group('Microphone', 'microphone', devices.microphones) +
      (speakerSupported ? group('Speaker', 'speaker', devices.speakers) : '');

    this.menu.querySelectorAll('select').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        const id = e.target.value;
        if (sel.dataset.select === 'camera') {
          this.vs.setCamera(id).catch((err) => this._toast(err.message, 'error'));
        } else if (sel.dataset.select === 'microphone') {
          this.vs.setMicrophone(id).catch((err) => this._toast(err.message, 'error'));
        } else {
          this._applySinkId(id);
        }
      });
    });
  }

  /** Route call audio to a chosen speaker on every remote video element. */
  _applySinkId(deviceId) {
    this._sinkId = deviceId;
    this.tiles.forEach((tile, id) => {
      if (id === 'local') return; // local tile is muted, no output needed
      const video = tile.querySelector('video');
      if (video?.setSinkId) video.setSinkId(deviceId).catch(() => {});
    });
  }

  // --- Chat -----------------------------------------------------------------

  /** Open or close the chat panel. Opening clears the unread badge. */
  _toggleChat(force) {
    const open = typeof force === 'boolean' ? force : !this.root.classList.contains('vs-chat-open');
    this.root.classList.toggle('vs-chat-open', open);
    this.btn.chat.classList.toggle('vs-active', open);
    if (open) {
      this._unread = 0;
      this._updateBadge();
      this.chatInput?.focus();
    }
  }

  /** Append one message to the chat list, bumping the unread count if hidden. */
  _appendChat({ displayName, text, ts, self }) {
    const row = document.createElement('div');
    row.className = 'vs-msg' + (self ? ' vs-msg-self' : '');
    const time = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    row.innerHTML = `
      <div class="vs-msg-meta">
        <span class="vs-msg-name">${escapeHtml(self ? 'You' : displayName)}</span>
        <span class="vs-msg-time">${time}</span>
      </div>
      <div class="vs-msg-text">${escapeHtml(text)}</div>
    `;
    this.chatList.appendChild(row);
    this.chatList.scrollTop = this.chatList.scrollHeight;

    if (!self && !this.root.classList.contains('vs-chat-open')) {
      this._unread += 1;
      this._updateBadge();
    }
  }

  /** Show or hide the unread counter on the chat button. */
  _updateBadge() {
    this.badge.hidden = this._unread === 0;
    this.badge.textContent = this._unread > 9 ? '9+' : String(this._unread);
  }

  // --- Tile helpers ---------------------------------------------------------

  /** Get the tile for a peer, creating it (with avatar + label) if missing. */
  _ensureTile(id, name, { local = false } = {}) {
    let tile = this.tiles.get(id);
    if (tile) return tile;

    tile = document.createElement('div');
    tile.className = 'vs-tile' + (local ? ' vs-tile-local' : '');
    tile.dataset.peerId = id;
    tile.setAttribute('role', 'listitem');
    tile.innerHTML = `
      <video autoplay playsinline${local ? ' muted' : ''}></video>
      <div class="vs-avatar"><span>${escapeHtml(initials(name))}</span></div>
      <div class="vs-tile-footer">
        <span class="vs-mic-indicator" hidden>${svg(ICON.micOff)}</span>
        <span class="vs-tile-name">${escapeHtml(name)}${local ? ' (you)' : ''}</span>
      </div>
    `;
    this.grid.appendChild(tile);
    this._relayout();
    return tile;
  }

  /** Bind a MediaStream to a tile's <video> element and play it. */
  _attachStream(tile, stream, muted) {
    const video = tile.querySelector('video');
    video.srcObject = stream;
    video.muted = muted;
    // If the user picked a specific speaker, route remote audio to it.
    if (!muted && this._sinkId && video.setSinkId) {
      video.setSinkId(this._sinkId).catch(() => {});
    }
    // Autoplay can be blocked; the Join click is a user gesture so this works,
    // but we still catch to avoid noisy console errors on edge cases.
    video.play().catch(() => {});
  }

  _setTileMuted(id, muted) {
    const indicator = this.tiles.get(id)?.querySelector('.vs-mic-indicator');
    if (indicator) indicator.hidden = !muted;
  }

  _removeTile(id) {
    const tile = this.tiles.get(id);
    if (!tile) return;
    tile.remove();
    this.tiles.delete(id);
    this._relayout();
  }

  /** Tag the grid with its participant count so CSS can pick a nice layout. */
  _relayout() {
    this.grid.dataset.count = String(this.tiles.size);
  }

  // --- Toast/status ---------------------------------------------------------

  _toast(message, kind = 'info') {
    this.toastEl.textContent = message;
    this.toastEl.dataset.kind = kind;
    this.toastEl.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toastEl.hidden = true;
    }, kind === 'error' ? 6000 : 3000);
  }
}

/** Escape user-provided text before inserting it into innerHTML. */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
