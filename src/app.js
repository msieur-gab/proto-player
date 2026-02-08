import './components/album-card.js';
import './components/ring-carousel.js';
import './components/album-detail.js';
import './components/player-bar.js';
import { openMusicFolder, processPickedFiles, rescanFolder, resolveDurations, onScanProgress } from './utils/file-loader.js';
import { saveLibrary, loadLibrary, saveHandle, loadHandle } from './utils/db.js';
import * as player from './utils/player.js';

// Keep a reference to the current fileMap for lazy duration resolution
let currentFileMap = null;

// --- Scan progress UI ---
const scanProgress = document.querySelector('.scan-progress');
const scanText = document.querySelector('.scan-progress__text');
const scanFill = document.querySelector('.scan-progress__fill');

onScanProgress(({ scanned, total }) => {
  if (scanned === 0) {
    scanProgress.classList.remove('hidden');
    scanFill.style.width = '0%';
    scanText.textContent = `Scanning 0 / ${total} tracks...`;
  } else if (scanned >= total) {
    scanText.textContent = `Found ${total} tracks — building library...`;
    scanFill.style.width = '100%';
    setTimeout(() => scanProgress.classList.add('hidden'), 600);
  } else {
    scanText.textContent = `Scanning ${scanned} / ${total} tracks...`;
    scanFill.style.width = `${(scanned / total * 100).toFixed(1)}%`;
  }
});

// Seeded RNG for reproducible track names
const rng = (seed) => () => (seed = (seed * 16807) % 2147483647, (seed - 1) / 2147483646);
const W1 = ['Morning','Amber','Slow','Glass','Paper','River','Hollow','Dust','Silver','Old'];
const W2 = ['Hour','Ceremony','Walk','Letter','Return','Passage','Dream','Signal','Tide','Bell'];

const DUMMY_ALBUMS = [
  { title: 'Quiet Forms',     artist: 'Kenji Araki',      cover: 'https://picsum.photos/seed/qf9/400' },
  { title: 'Night Tides',     artist: 'Lina Sáez',        cover: 'https://picsum.photos/seed/nt9/400' },
  { title: 'Moss & Stone',    artist: 'Takeshi Murakami',  cover: 'https://picsum.photos/seed/ms9/400' },
  { title: 'Borrowed Light',  artist: 'Ayla Bowen',       cover: 'https://picsum.photos/seed/bl9/400' },
  { title: 'Still Moving',    artist: 'Ren Watanabe',     cover: 'https://picsum.photos/seed/sm9/400' },
  { title: 'Soft Machines',   artist: 'Elara Cole',       cover: 'https://picsum.photos/seed/sc9/400' },
  { title: 'Hollow Ground',   artist: 'Jiro Tanaka',      cover: 'https://picsum.photos/seed/hg9/400' },
  { title: 'Departure Mono',  artist: 'Maren Licht',      cover: 'https://picsum.photos/seed/dm9/400' },
  { title: 'Winter Ritual',   artist: 'Noé Berger',       cover: 'https://picsum.photos/seed/wr9/400' },
  { title: 'Amber Drift',     artist: 'Suki Holm',        cover: 'https://picsum.photos/seed/ad9/400' },
].map((a, i) => {
  const r = rng(i * 73 + 11);
  a.tracks = Array.from({ length: 6 + (r() * 5 | 0) }, () => ({
    title: W1[r() * W1.length | 0] + ' ' + W2[r() * W2.length | 0],
    dur: `${2 + (r() * 4 | 0)}:${String(r() * 60 | 0).padStart(2, '0')}`,
  }));
  return a;
});

// DOM refs
const header = document.querySelector('.header');
const hTitle = document.querySelector('.header__title');
const hSub = document.querySelector('.header__sub');
const carousel = document.querySelector('ring-carousel');
const detail = document.querySelector('album-detail');
const folderBtn = document.querySelector('.folder-btn');
const musicInput = document.getElementById('music-input');
const rescanBtn = document.querySelector('.rescan-btn');
const installBtn = document.querySelector('.install-btn');
const authBanner = document.querySelector('.auth-banner');
const playerBar = document.querySelector('player-bar');
const hasNativePicker = !!window.showDirectoryPicker;

// State
let albums = [];
let expanded = null;
let storedHandle = null;
let hasRealLibrary = false;
let needsAuthBanner = false;

function showToast(message) {
  const toast = document.querySelector('.pwa-toast');
  const span = toast.querySelector('span');
  const btn = toast.querySelector('button');
  span.textContent = message;
  btn.style.display = 'none';
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
    span.textContent = 'App updated';
    btn.style.display = '';
  }, 3000);
}

function populateCarousel(newAlbums) {
  // Collapse detail if open
  if (expanded !== null) {
    const rect = carousel.getCardRect(expanded);
    if (rect) detail.close(rect);
    carousel.removeAttribute('dimmed');
    header.classList.remove('hidden');
    expanded = null;
  }

  albums = newAlbums;
  carousel.setAlbums(albums);

  // Update header with first album
  if (albums.length > 0) {
    hTitle.textContent = albums[0].title;
    hSub.textContent = albums[0].artist;
  }
}

// Header updates on selection change
carousel.addEventListener('selection-changed', (e) => {
  if (albums[e.detail.index]) {
    hTitle.textContent = albums[e.detail.index].title;
    hSub.textContent = albums[e.detail.index].artist;
  }
});

// Expand / Collapse coordination
carousel.addEventListener('card-click', (e) => {
  const i = e.detail.index;
  if (expanded !== null || carousel.dragMoved) return;

  if (carousel.selectedIndex !== i) {
    carousel.rotateTo(i);
    setTimeout(() => expand(i), 500);
  } else {
    expand(i);
  }
});

function expand(i) {
  if (expanded !== null) return;
  expanded = i;

  const rect = carousel.getCardRect(i);
  const cardEl = carousel.getCardElement(i);
  if (cardEl) cardEl.setAttribute('expanding', '');
  carousel.setAttribute('dimmed', '');
  header.classList.add('hidden');
  folderBtn.classList.add('hidden');
  rescanBtn.classList.add('hidden');
  installBtn.classList.add('hidden');
  authBanner.classList.add('hidden');

  const palette = carousel.getPalette(i);
  detail.open(albums[i], palette, rect);

  // Lazy-resolve durations for this album's tracks
  if (currentFileMap && albums[i].tracks.some(t => t.dur === '--:--')) {
    resolveDurations(albums[i].tracks, currentFileMap).then(() => {
      // Re-render track list with actual durations
      if (expanded === i) detail.updateTracks(albums[i].tracks);
    });
  }
}

function collapse() {
  if (expanded === null) return;
  const i = expanded;
  const rect = carousel.getCardRect(i);
  const cardEl = carousel.getCardElement(i);

  detail.close(rect || detail.getBoundingClientRect());

  // Reveal carousel + header when surface starts shrinking back
  setTimeout(() => {
    carousel.removeAttribute('dimmed');
    header.classList.remove('hidden');
    folderBtn.classList.remove('hidden');
    if (storedHandle) rescanBtn.classList.remove('hidden');
    if (window._deferredInstallPrompt) installBtn.classList.remove('hidden');
    if (needsAuthBanner) authBanner.classList.remove('hidden');
  }, 80);

  // Cleanup after full animation
  setTimeout(() => {
    if (cardEl) cardEl.removeAttribute('expanding');
    expanded = null;
  }, 380);
}

detail.addEventListener('detail-close', collapse);

// --- Track play events from album-detail ---
detail.addEventListener('track-play', async (e) => {
  const { album, trackIndex } = e.detail;

  // If fileMap is empty, try to get files back (we're inside a user gesture)
  if (!player.hasFiles()) {
    if (storedHandle) {
      // Desktop: re-request permission on the stored handle
      try {
        const perm = await storedHandle.requestPermission({ mode: 'read' });
        if (perm === 'granted') {
          needsAuthBanner = false;
          authBanner.classList.add('hidden');
          await doRescan(storedHandle);
        } else {
          return;
        }
      } catch (err) {
        console.warn('[app] Permission request failed:', err);
        return;
      }
    } else if (hasRealLibrary) {
      // Mobile: no stored handle — trigger the native file input
      musicInput.click();
      return;
    }
  }

  player.loadAlbum(album, trackIndex);
  detail.setPlayingTrack(trackIndex);
});

// --- Player events → player bar ---
player.events.addEventListener('track-change', (e) => {
  const { album, track, index } = e.detail;
  playerBar.setTrack(track.title, album.artist);

  // Update highlight in album-detail if it's showing the same album
  if (detail._album === album) {
    detail.setPlayingTrack(index);
  }
});

player.events.addEventListener('playstate-change', (e) => {
  playerBar.setPlaying(e.detail.playing);
});

player.events.addEventListener('timeupdate', (e) => {
  playerBar.setProgress(e.detail.currentTime, e.detail.duration);
});

// --- Player bar controls ---
playerBar.addEventListener('bar-toggle', () => player.togglePlay());
playerBar.addEventListener('bar-prev', () => player.prev());
playerBar.addEventListener('bar-next', () => player.next());
playerBar.addEventListener('bar-seek', (e) => player.seek(e.detail.fraction));

// --- Shared folder result handler ---
function handleFolderResult(result) {
  const { albums: newAlbums, fileMap, dirHandle } = result;
  if (newAlbums.length === 0) return;

  console.log(`[app] Loaded ${newAlbums.length} album(s)`);

  currentFileMap = fileMap;
  player.setFileMap(fileMap);
  populateCarousel(newAlbums);
  hasRealLibrary = true;

  saveLibrary(newAlbums).catch(e => console.warn('[app] DB save failed:', e));

  // Clear auth banner after successful load
  needsAuthBanner = false;
  authBanner.classList.add('hidden');

  if (dirHandle) {
    storedHandle = dirHandle;
    saveHandle(dirHandle).catch(e => console.warn('[app] Handle save failed:', e));
    rescanBtn.classList.remove('hidden');
  }
}

// --- Folder button ---
// Desktop: intercept click and use showDirectoryPicker
// Mobile: the <input> inside the <label> triggers natively
if (hasNativePicker) {
  musicInput.style.display = 'none';

  folderBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const result = await openMusicFolder();
      if (!result) return;
      handleFolderResult(result);
    } catch (err) {
      console.error('[app] Failed to load music folder:', err);
    }
  });
}

// Mobile path: the native <input> fires change when user picks files
musicInput.addEventListener('change', async () => {
  if (!musicInput.files || musicInput.files.length === 0) return;

  console.log(`[app] Input picked ${musicInput.files.length} file(s)`);

  try {
    const result = await processPickedFiles(musicInput.files);
    if (!result || result.albums.length === 0) {
      showToast('No audio files found');
      return;
    }
    handleFolderResult(result);
  } catch (e) {
    console.error('[app] Failed to process files:', e);
    showToast('Failed to load music');
  } finally {
    musicInput.value = '';
  }
});

// --- Rescan button ---
rescanBtn.addEventListener('click', async () => {
  if (!storedHandle) return;

  rescanBtn.classList.add('spinning');

  try {
    const result = await rescanFolder(storedHandle);
    if (result) {
      const { albums: newAlbums, fileMap } = result;
      console.log(`[app] Rescanned ${newAlbums.length} album(s)`);

      player.setFileMap(fileMap);
      populateCarousel(newAlbums);
      hasRealLibrary = true;

      saveLibrary(newAlbums).catch(e => console.warn('[app] DB save failed:', e));
    }
  } catch (e) {
    console.error('[app] Rescan failed:', e);
  } finally {
    rescanBtn.classList.remove('spinning');
  }
});

// --- Auth banner ---
authBanner.addEventListener('click', async () => {
  if (storedHandle) {
    // Desktop: re-request permission
    try {
      const perm = await storedHandle.requestPermission({ mode: 'read' });
      if (perm === 'granted') {
        needsAuthBanner = false;
        authBanner.classList.add('hidden');
        await doRescan(storedHandle);
      }
    } catch (e) {
      console.warn('[app] Permission request failed:', e);
    }
  } else {
    // Mobile: no handle to restore — trigger the native file input
    musicInput.click();
  }
});

async function doRescan(handle) {
  const result = await rescanFolder(handle);
  if (result) {
    currentFileMap = result.fileMap;
    player.setFileMap(result.fileMap);
    if (result.albums.length > 0) {
      populateCarousel(result.albums);
      hasRealLibrary = true;
      saveLibrary(result.albums).catch(e => console.warn('[app] DB update failed:', e));
    }
  }
}

// --- Startup sequence ---
async function init() {
  // 1. Try loading cached library from IndexedDB
  try {
    const cached = await loadLibrary();
    if (cached && cached.length > 0) {
      console.log(`[app] Loaded ${cached.length} album(s) from cache`);
      populateCarousel(cached);
      hasRealLibrary = true;
    }
  } catch (e) {
    console.warn('[app] Failed to load cached library:', e);
  }

  // 2. Try loading stored directory handle
  try {
    const handle = await loadHandle();
    if (handle) {
      storedHandle = handle;
      rescanBtn.classList.remove('hidden');

      // queryPermission doesn't trigger a prompt — just checks current state
      const perm = await handle.queryPermission({ mode: 'read' });
      if (perm === 'granted') {
        console.log('[app] Handle permission already granted, rescanning...');
        await doRescan(handle);
      } else {
        console.log('[app] Handle permission not granted, showing auth banner');
        needsAuthBanner = true;
        authBanner.classList.remove('hidden');
      }
    } else if (hasRealLibrary) {
      // Mobile reopen: cached library exists but no handle to restore
      console.log('[app] No stored handle, showing reload banner');
      needsAuthBanner = true;
      authBanner.textContent = 'Tap to reload your music folder';
      authBanner.classList.remove('hidden');
    }
  } catch (e) {
    console.warn('[app] Failed to restore directory handle:', e);
  }

  // 3. If no real library loaded, show dummy data
  if (!hasRealLibrary) {
    populateCarousel(DUMMY_ALBUMS);
  }
}

init();
