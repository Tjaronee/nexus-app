// Caches the app shell so the app opens without a connection. Online, shell
// files come fresh from the network (bypassing the HTTP cache, so a deploy
// shows at once and all files are from the same deploy); offline, or when the
// network is too slow, the cached copy is used. Bump VERSION when the SHELL
// list changes. GitHub API calls are never touched here; the data layer
// handles those.
const VERSION = 'v5';
const CACHE = `nexus-shell-${VERSION}`;
const NETWORK_TIMEOUT_MS = 3000;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/main.js',
  './src/auth.js',
  './src/config.js',
  './src/data/model.js',
  './src/data/ops.js',
  './src/data/store.js',
  './src/github.js',
  './src/session.js',
  './src/tabs.js',
  './src/taken.js',
  './src/taken-view.js',
  './src/quick-add.js',
  './src/quick-add-view.js',
  './src/dom.js',
  './src/markdown.js',
  './src/detail.js',
  './src/detail-view.js',
  './src/markdown-view.js',
  './src/text.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))),
  );
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
  event.respondWith(networkThenCache(event, request));
});

async function networkThenCache(event, request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request, { cache: 'no-cache' }).then((response) => {
    if (response.ok) event.waitUntil(cache.put(request, response.clone()));
    return response;
  });
  network.catch(() => {}); // A late failure after we answered from cache is fine.
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  const response = await Promise.race([network, timeout]).catch(() => undefined);
  if (response) return response;
  const cached =
    (await cache.match(request, { ignoreSearch: true })) ??
    (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
  return cached ?? network;
}
