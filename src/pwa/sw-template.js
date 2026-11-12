/* AirFx service worker. Generated at build time from src/pwa/sw-template.js:
 * __VERSION__ and __PRECACHE__ are filled in by vite.config.ts.
 *
 * - The app shell (HTML, scripts, styles, icons) is cached when installed, so
 *   AirFx opens offline and loads instantly.
 * - Runtime files for AI and tracking (large WebAssembly) are cached the first
 *   time they are used.
 * - Account, project and storage requests always go to the network.
 * - A new version waits until the user chooses to reload (the app shows a notice).
 */
const VERSION = '__VERSION__';
const SHELL = `airfx-shell-${VERSION}`;
const RUNTIME = 'airfx-runtime-v1';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('airfx-shell-') && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

const isRuntimeAsset = (url) =>
  (url.origin === self.location.origin && (url.pathname.startsWith('/ort/') || url.pathname.startsWith('/mediapipe/'))) ||
  (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/onnxruntime-web@'));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pages: network first, so a fresh deploy is seen at once; offline, the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(req); }
      catch { return (await caches.match('/index.html', { cacheName: SHELL, ignoreVary: true })) ?? Response.error(); }
    })());
    return;
  }

  // Built assets have content hashes in their names: cache first.
  if (url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
    // ignoreVary: module scripts are requested with an Origin header the cached copy was not.
    event.respondWith((async () => (await caches.match(req, { ignoreVary: true })) ?? fetch(req))());
    return;
  }

  // AI and tracking runtimes: cache after first use.
  if (isRuntimeAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
  }
  // Everything else (the AirFx server, model downloads with their own cache) goes to the network.
});
