const CACHE_NAME = 'proto-player-v1';

const DEXIE_CDN = 'https://unpkg.com/dexie@4/dist/dexie.mjs';

const APP_SHELL = [
  './',
  'index.html',
  'icon.svg',
  'manifest.json',
  'src/styles/player.css',
  'src/app.js',
  'src/components/album-card.js',
  'src/components/album-detail.js',
  'src/components/player-bar.js',
  'src/components/ring-carousel.js',
  'src/utils/player.js',
  'src/utils/db.js',
  'src/utils/file-loader.js',
  'src/utils/id3-parser.js',
  'src/utils/palette.js',
  'src/utils/ring-math.js',
  DEXIE_CDN,
];

// Install — precache app shell (don't skipWaiting — let the page control when to activate)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
  );
});

// Listen for skip-waiting message from the page
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch — cache-first for same-origin GET, network-only for everything else
self.addEventListener('fetch', (e) => {
  const { request } = e;

  // Skip non-GET, blob:, and chrome-extension: URLs
  if (request.method !== 'GET') return;
  if (request.url.startsWith('blob:')) return;
  if (request.url.startsWith('chrome-extension:')) return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCachedCDN = request.url.startsWith(DEXIE_CDN);

  if (!isSameOrigin && !isCachedCDN) return;

  e.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
