// File System Access API integration — folder picker + MP3 scanning
import { parseID3, pictureToURL } from './id3-parser.js';

// Simple SVG placeholder for albums without cover art
const PLACEHOLDER_COVER = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
    <rect width="400" height="400" fill="#d5d0c8"/>
    <circle cx="200" cy="180" r="60" fill="none" stroke="#a09889" stroke-width="3"/>
    <circle cx="200" cy="180" r="6" fill="#a09889"/>
    <rect x="140" y="270" width="120" height="6" rx="3" fill="#a09889" opacity="0.5"/>
    <rect x="165" y="290" width="70" height="5" rx="2.5" fill="#a09889" opacity="0.3"/>
  </svg>`
)}`;

const CONCURRENCY = 5;

/**
 * Open a music folder, scan for MP3s, extract metadata
 * @returns {Promise<{ albums, fileMap, dirHandle }|null>}
 */
export async function openMusicFolder() {
  const pickResult = await pickFiles();
  if (!pickResult) return null;

  const { files, dirHandle } = pickResult;
  if (files.length === 0) return null;

  const result = await processFiles(files);
  if (!result) return null;

  return { albums: result.albums, fileMap: result.fileMap, dirHandle };
}

/**
 * Re-scan a stored directory handle without showing picker
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<{ albums, fileMap }|null>}
 */
export async function rescanFolder(dirHandle) {
  const files = await scanDirectory(dirHandle);
  if (!files || files.length === 0) return null;

  // Attach relative paths from handle walk
  return processFiles(files);
}

/**
 * Process an array of File objects into albums + fileMap
 */
async function processFiles(files) {
  // Filter to .mp3 files
  const mp3s = files.filter(f => f.name.toLowerCase().endsWith('.mp3'));
  if (mp3s.length === 0) return null;

  // Build fileMap: path → File
  const fileMap = new Map();

  // Parse ID3 + get duration with concurrency limit
  const parsed = (await mapWithLimit(mp3s, CONCURRENCY, async (file) => {
    try {
      const [tags, duration] = await Promise.all([
        parseID3(file),
        getDuration(file),
      ]);
      return { file, tags, duration };
    } catch (e) {
      console.warn(`[file-loader] skipping ${file.name}:`, e);
      return null;
    }
  })).filter(Boolean);

  // Group by album + artist
  const albumMap = new Map();

  for (const { file, tags, duration } of parsed) {
    const albumKey = `${tags.album || 'Unknown Album'}|||${tags.artist || 'Unknown Artist'}`;

    if (!albumMap.has(albumKey)) {
      albumMap.set(albumKey, {
        albumName: tags.album || 'Unknown Album',
        artistName: tags.artist || 'Unknown Artist',
        picture: null,
        tracks: [],
      });
    }

    const entry = albumMap.get(albumKey);

    if (!entry.picture && tags.picture) {
      entry.picture = tags.picture;
    }

    // Use _relativePath set during scan, or webkitRelativePath for input fallback
    const path = file._relativePath || file.webkitRelativePath || file.name;
    fileMap.set(path, file);

    entry.tracks.push({
      title: tags.title || cleanFilename(file.name),
      dur: formatDuration(duration),
      trackNum: parseTrackNumber(tags.track),
      path,
    });
  }

  // Build result array
  const albums = [];

  for (const entry of albumMap.values()) {
    entry.tracks.sort((a, b) => {
      if (a.trackNum !== b.trackNum) return a.trackNum - b.trackNum;
      return a.title.localeCompare(b.title);
    });

    const cover = entry.picture
      ? pictureToURL(entry.picture)
      : PLACEHOLDER_COVER;

    albums.push({
      title: entry.albumName,
      artist: entry.artistName,
      cover,
      tracks: entry.tracks.map(t => ({ title: t.title, dur: t.dur, path: t.path })),
    });
  }

  albums.sort((a, b) => a.title.localeCompare(b.title));

  return { albums, fileMap };
}

// --- File picking ---

async function pickFiles() {
  // Try File System Access API first (Chromium, secure context only)
  if (window.showDirectoryPicker) {
    try {
      console.log('[file-loader] Using File System Access API');
      const dirHandle = await window.showDirectoryPicker();
      const files = await scanDirectory(dirHandle);
      console.log(`[file-loader] Found ${files.length} file(s)`);
      return { files, dirHandle };
    } catch (e) {
      if (e.name === 'AbortError') return null;
      console.warn('[file-loader] Directory picker failed, using fallback:', e.message);
    }
  }

  // Fallback: <input webkitdirectory>
  console.log('[file-loader] Using <input webkitdirectory> fallback');
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('multiple', '');
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      console.log(`[file-loader] Input returned ${files.length} file(s)`);
      resolve({ files, dirHandle: null });
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

async function scanDirectory(dirHandle) {
  const files = [];

  async function walk(handle, prefix) {
    for await (const entry of handle.values()) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.mp3')) {
        const file = await entry.getFile();
        // Attach relative path for fileMap lookup
        file._relativePath = path;
        files.push(file);
      } else if (entry.kind === 'directory') {
        await walk(entry, path);
      }
    }
  }

  await walk(dirHandle, '');
  return files;
}

// --- Duration via Audio API ---

function getDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';

    audio.addEventListener('loadedmetadata', () => {
      const dur = audio.duration;
      URL.revokeObjectURL(url);
      resolve(isFinite(dur) ? dur : 0);
    }, { once: true });

    audio.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      resolve(0);
    }, { once: true });

    audio.src = url;
  });
}

// --- Helpers ---

async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseTrackNumber(track) {
  if (!track) return 9999;
  const n = parseInt(track, 10);
  return isNaN(n) ? 9999 : n;
}

function cleanFilename(name) {
  if (!name) return 'Unknown Track';
  return name
    .replace(/\.mp3$/i, '')
    .replace(/^\d+[\s._-]+/, ''); // strip leading track numbers
}
