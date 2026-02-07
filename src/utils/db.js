// Dexie.js persistence layer for ProtoPlayer
import Dexie from 'https://unpkg.com/dexie@4/dist/dexie.mjs';

const db = new Dexie('ProtoPlayerDB');

db.version(1).stores({
  albums: '++id, title, artist',
  tracks: '++id, albumId, trackNum',
  config: 'key',
});

/**
 * Save library to IndexedDB
 * @param {Array} albums — [{ title, artist, cover (blob/data URL), tracks: [{ title, dur, path }] }]
 */
export async function saveLibrary(albums) {
  await db.transaction('rw', db.albums, db.tracks, async () => {
    await db.albums.clear();
    await db.tracks.clear();

    for (const album of albums) {
      // Convert cover blob URL or data URL to ArrayBuffer for storage
      let coverData = null;
      let coverMime = null;

      if (album.cover && !album.cover.startsWith('data:image/svg+xml')) {
        try {
          const resp = await fetch(album.cover);
          coverData = await resp.arrayBuffer();
          coverMime = resp.headers.get('content-type') || 'image/jpeg';
        } catch (e) {
          console.warn('[db] Could not store cover art:', e);
        }
      }

      const albumId = await db.albums.add({
        title: album.title,
        artist: album.artist,
        coverData,
        coverMime,
      });

      const trackRows = album.tracks.map((t, i) => ({
        albumId,
        title: t.title,
        dur: t.dur,
        trackNum: i + 1,
        path: t.path || null,
      }));

      await db.tracks.bulkAdd(trackRows);
    }
  });
}

/**
 * Load library from IndexedDB
 * @returns {Promise<Array|null>} — same shape as file-loader output, or null if empty
 */
export async function loadLibrary() {
  const albumRows = await db.albums.toArray();
  if (albumRows.length === 0) return null;

  const allTracks = await db.tracks.toArray();

  // Group tracks by albumId
  const tracksByAlbum = new Map();
  for (const t of allTracks) {
    if (!tracksByAlbum.has(t.albumId)) tracksByAlbum.set(t.albumId, []);
    tracksByAlbum.get(t.albumId).push(t);
  }

  const albums = albumRows.map(row => {
    // Convert stored ArrayBuffer back to blob URL
    let cover;
    if (row.coverData) {
      const blob = new Blob([row.coverData], { type: row.coverMime || 'image/jpeg' });
      cover = URL.createObjectURL(blob);
    } else {
      cover = placeholderCover();
    }

    const tracks = (tracksByAlbum.get(row.id) || [])
      .sort((a, b) => a.trackNum - b.trackNum)
      .map(t => ({ title: t.title, dur: t.dur, path: t.path }));

    return { title: row.title, artist: row.artist, cover, tracks };
  });

  albums.sort((a, b) => a.title.localeCompare(b.title));
  return albums;
}

/**
 * Store a FileSystemDirectoryHandle for persistence across sessions
 */
export async function saveHandle(dirHandle) {
  await db.config.put({ key: 'dirHandle', value: dirHandle });
}

/**
 * Retrieve stored FileSystemDirectoryHandle (or null)
 */
export async function loadHandle() {
  const row = await db.config.get('dirHandle');
  return row ? row.value : null;
}

/**
 * Wipe albums + tracks (for full rescan)
 */
export async function clearLibrary() {
  await db.transaction('rw', db.albums, db.tracks, async () => {
    await db.albums.clear();
    await db.tracks.clear();
  });
}

function placeholderCover() {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
      <rect width="400" height="400" fill="#d5d0c8"/>
      <circle cx="200" cy="180" r="60" fill="none" stroke="#a09889" stroke-width="3"/>
      <circle cx="200" cy="180" r="6" fill="#a09889"/>
      <rect x="140" y="270" width="120" height="6" rx="3" fill="#a09889" opacity="0.5"/>
      <rect x="165" y="290" width="70" height="5" rx="2.5" fill="#a09889" opacity="0.3"/>
    </svg>`
  )}`;
}
