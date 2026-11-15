const CACHE_NAME = 'pb-gestao-shell-v2';
const ASSETS = [
  '.',
  'index.html',
  'styles.css',
  'pb-integration.css',
  'app.js',
  'pb-api.js',
  'pb-integration.js',
  'manifest.webmanifest',
  'icons/icon-192.svg',
  'icons/icon-512.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
    .then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin ||
      /^\/(api|auth)(\/|$)/.test(url.pathname)) return;
  event.respondWith(
    fetch(event.request).catch(async (error) => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      throw error;
    })
  );
});