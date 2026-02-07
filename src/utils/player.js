// Audio playback controller for ProtoPlayer

const bus = new EventTarget();
const audio = new Audio();

let currentAlbum = null;
let currentTrackIndex = -1;
let fileMap = new Map();

// Expose event bus for external listeners
export const events = bus;

// --- Public API ---

export function setFileMap(map) {
  fileMap = map;
}

export function hasFiles() {
  return fileMap.size > 0;
}

export function loadAlbum(album, startIndex = 0) {
  currentAlbum = album;
  playTrack(startIndex);
}

export function play() {
  if (audio.src) audio.play();
}

export function pause() {
  audio.pause();
}

export function togglePlay() {
  if (audio.paused) play();
  else pause();
}

export function next() {
  if (!currentAlbum) return;
  const nextIdx = currentTrackIndex + 1;
  if (nextIdx < currentAlbum.tracks.length) {
    playTrack(nextIdx);
  } else {
    // End of album — stop
    audio.pause();
    emit('playstate-change', { playing: false });
  }
}

export function prev() {
  if (!currentAlbum) return;
  // If more than 3s in, restart current track; otherwise go to previous
  if (audio.currentTime > 3 && currentTrackIndex >= 0) {
    audio.currentTime = 0;
  } else {
    const prevIdx = currentTrackIndex - 1;
    if (prevIdx >= 0) {
      playTrack(prevIdx);
    } else {
      audio.currentTime = 0;
    }
  }
}

export function seek(fraction) {
  if (!isFinite(audio.duration)) return;
  audio.currentTime = fraction * audio.duration;
}

export function getState() {
  return {
    album: currentAlbum,
    track: currentAlbum?.tracks[currentTrackIndex] ?? null,
    trackIndex: currentTrackIndex,
    playing: !audio.paused,
    currentTime: audio.currentTime,
    duration: audio.duration,
  };
}

// --- Internal ---

let currentBlobURL = null;

function playTrack(index) {
  if (!currentAlbum || index < 0 || index >= currentAlbum.tracks.length) return;

  const track = currentAlbum.tracks[index];
  const file = fileMap.get(track.path);

  if (!file) {
    console.warn(`[player] No file found for path: ${track.path}`);
    return;
  }

  // Revoke previous blob URL
  if (currentBlobURL) {
    URL.revokeObjectURL(currentBlobURL);
    currentBlobURL = null;
  }

  currentTrackIndex = index;
  currentBlobURL = URL.createObjectURL(file);
  audio.src = currentBlobURL;
  audio.play();

  emit('track-change', { album: currentAlbum, track, index });
  emit('playstate-change', { playing: true });
  updateMediaSession(currentAlbum, track);
}

function emit(type, detail) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

// Auto-advance on track end
audio.addEventListener('ended', () => {
  next();
});

// Forward play/pause state changes
audio.addEventListener('play', () => emit('playstate-change', { playing: true }));
audio.addEventListener('pause', () => emit('playstate-change', { playing: false }));

// Throttled timeupdate
let lastTimeEmit = 0;
audio.addEventListener('timeupdate', () => {
  const now = performance.now();
  if (now - lastTimeEmit < 250) return;
  lastTimeEmit = now;
  emit('timeupdate', {
    currentTime: audio.currentTime,
    duration: audio.duration,
  });
});

// --- Media Session API ---

function updateMediaSession(album, track) {
  if (!('mediaSession' in navigator)) return;

  const artwork = [];
  if (album.cover && (album.cover.startsWith('https://') || album.cover.startsWith('data:'))) {
    artwork.push({ src: album.cover, sizes: '512x512', type: 'image/jpeg' });
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: album.artist,
    album: album.title,
    artwork,
  });
}

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => play());
  navigator.mediaSession.setActionHandler('pause', () => pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => prev());
  navigator.mediaSession.setActionHandler('nexttrack', () => next());
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    audio.currentTime = details.seekTime;
  });
}
