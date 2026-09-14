// Service worker template. `vite build` (see the offline plugin in
// vite.config.mjs) fills in the three placeholders below and writes the
// result to dist/sw.js. It is never loaded in development.
//
// Strategy, chosen for a static site that must both work offline and never
// get stuck on an old version:
// - Page loads are network-first: online visitors always get the newest
//   index.html (and through it the newest hashed assets). The cached copy is
//   only used when the network fails or hangs.
// - Everything else from this origin is cache-first. Built assets have a
//   content hash in their filename, so a cached copy can never be stale.
// - A new deploy produces a new BUILD_ID, so the browser sees a changed sw.js
//   on its next update check, precaches the new build in the background,
//   and takes over as soon as that finishes. The page then offers a reload.

const BUILD_ID = '__BUILD_ID__';
// Small enough to download up front, so every tool's UI works offline.
const PRECACHE = __PRECACHE__;
// Every file in the build, including the big WebAssembly engines that are
// only cached the first time a tool actually loads them.
const ALL_FILES = __ALL_FILES__;

const PREFIX = 'woogi-offline-';
const BUILD_CACHE = `${PREFIX}build-${BUILD_ID}`;
const LAZY_CACHE = `${PREFIX}lazy`;
const FONT_CACHE = `${PREFIX}fonts`;
const NAVIGATION_TIMEOUT_MS = 4000;
// The previous build's cache is kept around, so a tab still running the old
// version can lazy-load its chunks after the server has moved on.
const BUILDS_TO_KEEP = 2;

// The app shell is stored under "/", not "/index.html": hosts with pretty URLs
// (Cloudflare's asset server among them) answer /index.html with a redirect to /.
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(BUILD_CACHE);
      const urls = [...new Set(PRECACHE.map((url) => (url === '/index.html' ? SHELL : url)))];
      await Promise.all(
        urls.map(async (url) => {
          // `reload` skips the HTTP cache so a half-updated CDN edge can't sneak an old file in.
          const response = await fetch(new Request(url, { cache: 'reload' }));
          if (!response.ok) throw new Error(`Precache failed for ${url}: ${response.status}`);
          await cache.put(url, await unredirected(response));
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

// A response that came through a redirect can't answer a page navigation: the
// browser rejects it and shows "This site can't be reached". Copying the body
// into a fresh Response drops the redirect flag.
async function unredirected(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers });
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const builds = (await caches.keys()).filter((name) => name.startsWith(`${PREFIX}build-`));
      // caches.keys() is in creation order, so the oldest builds come first.
      const stale = builds.filter((name) => name !== BUILD_CACHE).slice(0, -(BUILDS_TO_KEEP - 1) || undefined);
      await Promise.all(stale.map((name) => caches.delete(name)));

      const known = new Set(ALL_FILES);
      const lazy = await caches.open(LAZY_CACHE);
      for (const request of await lazy.keys()) {
        if (!known.has(new URL(request.url).pathname)) await lazy.delete(request);
      }

      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

async function networkFirstPage(request) {
  const cached = await caches.match(SHELL, { cacheName: BUILD_CACHE });
  const network = fetch(request);
  if (!cached) return network;
  network.catch(() => {}); // a late failure after the timeout wins is expected, not an error
  // A captive portal or a dead connection can hang for a long time; after a
  // few seconds the offline copy is a better answer than a spinner.
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NAVIGATION_TIMEOUT_MS));
  try {
    const response = await Promise.race([network, timeout]);
    return response.ok || response === cached ? response : cached;
  } catch {
    return cached;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  const { pathname } = new URL(request.url);
  if (response.ok && ALL_FILES.includes(pathname)) {
    const clean = await unredirected(response);
    const cache = await caches.open(LAZY_CACHE);
    await cache.put(request, clean.clone());
    return clean;
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      // Stylesheets are requested no-cors, so their responses are opaque (status 0).
      if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached ?? Response.error());
  return cached ?? network;
}
