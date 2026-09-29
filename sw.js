// Caches the app shell so the app opens without a connection. Shell files are
// served from the cache at once and refreshed in the background, so a new
// deploy shows up on the next open. Bump VERSION when the SHELL list changes.
// GitHub API calls are never touched here; the data layer handles those.
const VERSION = 'v1';
const CACHE = `nexus-shell-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/main.js',
  './src/auth.js',
  './src/config.js',
  './src/github.js',
  './src/session.js',
  './src/tabs.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nexus-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fromCacheThenRefresh(event, request));
});

async function fromCacheThenRefresh(event, request) {
  const cache = await caches.open(CACHE);
  const cached =
    (await cache.match(request, { ignoreSearch: true })) ??
    (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  if (!cached) return network;
  event.waitUntil(network.catch(() => {}));
  return cached;
}
