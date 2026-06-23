/**
 * VidStem - Media helpers
 * ---------------------------------------------------------------------------
 * Thin, friendly wrappers around the browser media APIs (getUserMedia,
 * getDisplayMedia, enumerateDevices). Keeping them here makes the core easy to
 * read and makes future features (screen share, device pickers, virtual
 * backgrounds) easy to slot in.
 */

/**
 * Sensible default capture settings: 720p video plus echo-cancelled,
 * noise-suppressed audio (so calls sound good without any tuning).
 * @type {MediaStreamConstraints}
 */
export const DEFAULT_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: 'user',
  },
};

/**
 * Request the user's camera and microphone.
 * @param {MediaStreamConstraints} [constraints]
 * @returns {Promise<MediaStream>}
 * @throws {Error} a human-readable error if access fails or is denied.
 */
export async function getLocalStream(constraints = DEFAULT_CONSTRAINTS) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not support camera/microphone access (getUserMedia).');
  }
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    throw friendlyMediaError(err);
  }
}

/**
 * Request a screen-share stream. Useful for a future "Share screen" button -
 * the returned video track can replace the camera track on each peer via
 * `Peer.replaceTrack('video', track)`.
 * @returns {Promise<MediaStream>}
 */
export async function getScreenStream() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('This browser does not support screen sharing (getDisplayMedia).');
  }
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
}

/**
 * List available input/output devices. Labels are only populated AFTER the
 * user has granted permission at least once, so call this after getLocalStream.
 * @returns {Promise<{cameras: MediaDeviceInfo[], microphones: MediaDeviceInfo[], speakers: MediaDeviceInfo[]}>}
 */
export async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: devices.filter((d) => d.kind === 'videoinput'),
    microphones: devices.filter((d) => d.kind === 'audioinput'),
    speakers: devices.filter((d) => d.kind === 'audiooutput'),
  };
}

/**
 * Translate the cryptic DOMException names from getUserMedia into messages a
 * real user can act on.
 * @param {DOMException|Error} err
 * @returns {Error}
 */
function friendlyMediaError(err) {
  switch (err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new Error('Camera/microphone permission was denied. Please allow access and try again.');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new Error('No camera or microphone was found on this device.');
    case 'NotReadableError':
    case 'TrackStartError':
      return new Error('Your camera or microphone is already in use by another application.');
    case 'OverconstrainedError':
      return new Error('No device matches the requested quality. Try lowering the video constraints.');
    default:
      return new Error(`Could not access media devices: ${err.message || err.name}`);
  }
}
