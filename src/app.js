import './components/album-card.js';
import './components/ring-carousel.js';
import './components/album-detail.js';
import './components/player-bar.js';
import { openMusicFolder, rescanFolder } from './utils/file-loader.js';
import { saveLibrary, loadLibrary, saveHandle, loadHandle } from './utils/db.js';
import * as player from './utils/player.js';

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
const rescanBtn = document.querySelector('.rescan-btn');
const installBtn = document.querySelector('.install-btn');
const authBanner = document.querySelector('.auth-banner');
const playerBar = document.querySelector('player-bar');

// State
let albums = [];
let expanded = null;
let storedHandle = null;
let hasRealLibrary = false;
let needsAuthBanner = false;

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
  }, 120);

  // Cleanup after full animation
  setTimeout(() => {
    if (cardEl) cardEl.removeAttribute('expanding');
    expanded = null;
  }, 470);
}

detail.addEventListener('detail-close', collapse);

// --- Track play events from album-detail ---
detail.addEventListener('track-play', (e) => {
  const { album, trackIndex } = e.detail;
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

// --- Folder button ---
folderBtn.addEventListener('click', async () => {
  try {
    const result = await openMusicFolder();
    if (!result) return;

    const { albums: newAlbums, fileMap, dirHandle } = result;
    if (newAlbums.length === 0) return;

    console.log(`[app] Loaded ${newAlbums.length} album(s)`);

    player.setFileMap(fileMap);
    populateCarousel(newAlbums);
    hasRealLibrary = true;

    // Persist to IndexedDB
    saveLibrary(newAlbums).catch(e => console.warn('[app] DB save failed:', e));

    if (dirHandle) {
      storedHandle = dirHandle;
      saveHandle(dirHandle).catch(e => console.warn('[app] Handle save failed:', e));
      rescanBtn.classList.remove('hidden');
      needsAuthBanner = false;
      authBanner.classList.add('hidden');
    }
  } catch (e) {
    console.error('[app] Failed to load music folder:', e);
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
  if (!storedHandle) return;
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
});

async function doRescan(handle) {
  const result = await rescanFolder(handle);
  if (result) {
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

      // Check permission without prompting (queryPermission doesn't require gesture)
      const perm = await handle.queryPermission({ mode: 'read' });
      if (perm === 'granted') {
        console.log('[app] Handle permission already granted, rescanning...');
        await doRescan(handle);
      } else {
        // Need user gesture — show auth banner
        console.log('[app] Handle permission not granted, showing auth banner');
        needsAuthBanner = true;
        authBanner.classList.remove('hidden');
      }
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
