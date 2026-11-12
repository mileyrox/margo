// Margo's service worker: lets the home-screen app open fast and show the app even with a weak connection.
// It never stores money data: anything under /api, sign-in pages and other sites always go to the network.
const VERSION = 'margo-v1';
const SHELL = VERSION + '-shell';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(['./', './manifest.webmanifest', './icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/__clerk')) return;

  // Pages: try the network first so updates show up right away; fall back to the saved app if offline.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      if (response.ok) caches.open(SHELL).then((cache) => cache.put('./', copy));
      return response;
    }).catch(() => caches.match('./')));
    return;
  }

  // Built files have unique names, so a saved copy is always right.
  if (url.pathname.includes('/assets/') || /\.(png|svg|woff2?)$/.test(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok) { const copy = response.clone(); caches.open(VERSION + '-files').then((cache) => cache.put(request, copy)); }
      return response;
    })));
  }
});
