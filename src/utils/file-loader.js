// File System Access API integration — folder picker + audio file scanning
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

// All audio formats the browser <audio> element can handle
const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wav', '.webm',
]);

function isAudioFile(name) {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return AUDIO_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

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
  const audioFiles = files.filter(f => isAudioFile(f.name));
  if (audioFiles.length === 0) return null;

  console.log(`[file-loader] Found ${audioFiles.length} audio file(s)`);

  // Build fileMap: path → File
  const fileMap = new Map();

  // Parse metadata + get duration with concurrency limit
  const parsed = (await mapWithLimit(audioFiles, CONCURRENCY, async (file) => {
    try {
      const isMP3 = file.name.toLowerCase().endsWith('.mp3');
      const [tags, duration] = await Promise.all([
        isMP3 ? parseID3(file) : tagsFromPath(file),
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

    const path = file._relativePath || file.name;
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
  if (!window.showDirectoryPicker) return null;
  try {
    const dirHandle = await window.showDirectoryPicker();
    const files = await scanDirectory(dirHandle);
    return { files, dirHandle };
  } catch (e) {
    if (e.name === 'AbortError') return null;
    console.warn('[file-loader] Directory picker failed:', e.message);
    return null;
  }
}

async function scanDirectory(dirHandle) {
  const files = [];

  async function walk(handle, prefix) {
    for await (const entry of handle.values()) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'file' && isAudioFile(entry.name)) {
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
  console.log(`[file-loader] Scanned directory, found ${files.length} audio file(s)`);
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
    .replace(/\.\w+$/i, '') // strip any audio extension
    .replace(/^\d+[\s._-]+/, ''); // strip leading track numbers
}

/**
 * Extract metadata from the file's relative path (folder structure).
 * Handles patterns like:  Artist/Album/01 - Title.flac
 *                          Album/01 Title.m4a
 *                          Title.ogg
 */
function tagsFromPath(file) {
  const path = file._relativePath || file.name;
  const parts = path.split('/');
  const filename = parts[parts.length - 1];

  const title = cleanFilename(filename) || null;
  let artist = null;
  let album = null;
  let track = null;

  // Try to extract track number from filename
  const trackMatch = filename.match(/^(\d+)/);
  if (trackMatch) track = trackMatch[1];

  if (parts.length >= 3) {
    // Artist/Album/Track
    artist = parts[parts.length - 3];
    album = parts[parts.length - 2];
  } else if (parts.length === 2) {
    // Album/Track (or Artist/Track)
    album = parts[0];
  }

  return { title, artist, album, track, picture: null };
}
