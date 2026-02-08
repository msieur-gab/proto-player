// Cross-platform file picking + multi-format audio metadata extraction
// Uses jsmediatags (loaded via <script> tag) for ID3/MP4/OGG/FLAC parsing

// Supported audio extensions
const AUDIO_EXTS = new Set([
  '.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac', '.wma', '.opus',
]);

function isAudioFile(name) {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && AUDIO_EXTS.has(name.slice(dot).toLowerCase());
}

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

const CONCURRENCY = 10;

// --- Progress reporting ---

let _onProgress = null;

/**
 * Set a callback to receive scan progress updates.
 * Callback shape: ({ scanned, total }) => void
 */
export function onScanProgress(fn) {
  _onProgress = fn;
}

function reportProgress(scanned, total) {
  if (_onProgress) _onProgress({ scanned, total });
}

/**
 * Open a music folder, scan for audio files, extract metadata
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
 * Process files from a native <input type="file"> (mobile path)
 * @param {FileList} fileList
 * @returns {Promise<{ albums, fileMap, dirHandle: null }|null>}
 */
export async function processPickedFiles(fileList) {
  const files = [];
  for (const file of fileList) {
    if (isAudioFile(file.name)) {
      file._relativePath = file.webkitRelativePath || file.name;
      files.push(file);
    }
  }

  console.log(`[file-loader] processPickedFiles: ${files.length} audio out of ${fileList.length} total`);

  if (files.length === 0) return null;

  const result = await processFiles(files);
  if (!result) return null;

  return { albums: result.albums, fileMap: result.fileMap, dirHandle: null };
}

/**
 * Re-scan a stored directory handle without showing picker
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<{ albums, fileMap }|null>}
 */
export async function rescanFolder(dirHandle) {
  const files = await scanDirectory(dirHandle);
  if (!files || files.length === 0) return null;

  return processFiles(files);
}

/**
 * Resolve durations for an album's tracks using fileMap.
 * Called lazily when album detail opens.
 * @param {Array} tracks - [{ title, dur, path }]
 * @param {Map} fileMap
 * @returns {Promise<void>} mutates tracks in place
 */
export async function resolveDurations(tracks, fileMap) {
  const pending = tracks.filter(t => t.dur === '--:--' && fileMap.has(t.path));
  if (pending.length === 0) return;

  await Promise.all(pending.map(async (track) => {
    const file = fileMap.get(track.path);
    if (!file) return;
    const dur = await getDuration(file);
    track.dur = formatDuration(dur);
  }));
}

/**
 * Process an array of File objects into albums + fileMap
 * Tags only — duration is deferred to keep scan fast
 */
async function processFiles(files) {
  const audioFiles = files.filter(f => isAudioFile(f.name));
  if (audioFiles.length === 0) return null;

  const fileMap = new Map();
  const total = audioFiles.length;
  let scanned = 0;

  reportProgress(0, total);

  // Parse tags only (no duration) with concurrency limit
  const parsed = (await mapWithLimit(audioFiles, CONCURRENCY, async (file) => {
    try {
      const tags = await readTags(file);
      return { file, tags };
    } catch (e) {
      console.warn(`[file-loader] skipping ${file.name}:`, e);
      return null;
    } finally {
      scanned++;
      reportProgress(scanned, total);
    }
  })).filter(Boolean);

  // Group by album + artist
  const albumMap = new Map();

  for (const { file, tags } of parsed) {
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
      dur: '--:--',  // deferred — resolved when album detail opens
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

// --- Tag reading via jsmediatags ---

function readTags(file) {
  return new Promise((resolve) => {
    jsmediatags.read(file, {
      onSuccess(result) {
        const t = result.tags || {};
        resolve({
          title: t.title || null,
          artist: t.artist || null,
          album: t.album || null,
          track: t.track || null,
          picture: t.picture || null, // { format, data }
        });
      },
      onError() {
        resolve({ title: null, artist: null, album: null, track: null, picture: null });
      },
    });
  });
}

/**
 * Convert a jsmediatags picture object to a blob URL
 * picture.format = mime type, picture.data = array of byte values
 */
function pictureToURL(picture) {
  if (!picture || !picture.data) return null;
  const bytes = new Uint8Array(picture.data);
  const blob = new Blob([bytes], { type: picture.format || 'image/jpeg' });
  return URL.createObjectURL(blob);
}

// --- File picking ---

async function pickFiles() {
  // Try File System Access API first (desktop Chromium, secure context)
  if (window.showDirectoryPicker) {
    try {
      console.log('[file-loader] Using File System Access API');
      const dirHandle = await window.showDirectoryPicker();
      const files = await scanDirectory(dirHandle);
      console.log(`[file-loader] Found ${files.length} audio file(s)`);
      return { files, dirHandle };
    } catch (e) {
      if (e.name === 'AbortError') return null;
      console.warn('[file-loader] Directory picker failed, using fallback:', e.message);
    }
  }

  // Fallback: <input webkitdirectory> — works on mobile Chrome, Safari, Firefox
  console.log('[file-loader] Using <input webkitdirectory> fallback');
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('multiple', '');
    // No accept attribute — conflicts with webkitdirectory on Android Chrome
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
      if (entry.kind === 'file' && isAudioFile(entry.name)) {
        const file = await entry.getFile();
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
  // Strip audio extension and leading track numbers
  return name
    .replace(/\.(mp3|m4a|wav|ogg|flac|aac|wma|opus)$/i, '')
    .replace(/^\d+[\s._-]+/, '');
}
