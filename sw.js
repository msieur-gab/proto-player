const CACHE_NAME = 'proto-player-v13';

const APP_SHELL = [
  './',
  'index.html',
  'icon.svg',
  'manifest.json',
  'vendor/dexie.mjs',
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
  'src/utils/metadata.js',
  'src/utils/palette.js',
  'src/utils/ring-math.js',
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

// Fetch — cache-first for same-origin GET only
self.addEventListener('fetch', (e) => {
  const { request } = e;

  if (request.method !== 'GET') return;
  if (request.url.startsWith('blob:')) return;
  if (request.url.startsWith('chrome-extension:')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
