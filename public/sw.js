/* Offline service worker for روابط الذكر الحكيم (v1, hand-written —
   no build plugin, so the existing prebuild icon step is untouched).
   Strategy:
   - App shell (/, /index.html): cached on install; navigations are
     network-first with a cached-shell fallback, so the app still opens
     offline (hash routing means one index.html serves every route).
   - Same-origin JS/CSS: stale-while-revalidate.
   - Mushaf page images (cdn.jsdelivr.net, both sufone + QuranHub):
     cache-first, bounded (only pages the user actually visited — the
     full 604 pages are NEVER prefetched). Cache-first also means a
     visited page opens instantly on later visits. NOTE: <img>
     responses are opaque (ok is false), so the cache rule accepts
     opaque responses — a res.ok-only check would cache nothing.
   - Everything else (Supabase API, storage audio, third-party): network
     only, never cached — auth and fresh data must not go stale.
   A new deploy ships a new file (new cache names on version bump), and
   skipWaiting + clients.claim make the update take effect promptly. */

const SHELL_CACHE = 'quran-shell-v1';
const IMG_CACHE = 'quran-pages-v2';
// Full-download cache (Settings "صفحات المصحف على جهازك"): written
// ONLY by the page's download UI, never by the fetch handler below
// and never trimmed — the 150-entry cap applies to IMG_CACHE only.
// The fetch handler's caches.match searches ALL caches, so pages in
// here are served cache-first automatically. This name MUST stay in
// the activate keep-list, or an update would wipe the user's download.
const FULL_IMG_CACHE = 'quran-pages-full';
// Optional-edition full-download caches (Settings, per edition):
// same rules as FULL_IMG_CACHE — written only by the download UI,
// never trimmed, and keep-listed below so an update never wipes them.
const FULL_IMG_CACHE_TAJWEED = 'quran-pages-full-tajweed';
const FULL_IMG_CACHE_WARSH = 'quran-pages-full-warsh';
const FULL_IMG_CACHE_HAFS = 'quran-pages-full-hafs';
const MAX_IMG_ENTRIES = 150;

async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
      for (const key of keys.slice(0, keys.length - maxEntries)) {
        await cache.delete(key);
      }
    }
  } catch {}
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(['/', '/index.html']))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== IMG_CACHE && k !== FULL_IMG_CACHE && k !== FULL_IMG_CACHE_TAJWEED && k !== FULL_IMG_CACHE_WARSH && k !== FULL_IMG_CACHE_HAFS).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigation (including the SPA's hash routes): network first so a
  // fresh deploy is picked up, cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Mushaf page images: cache-first, bounded. Two rules that matter:
  // (1) <img> requests are no-cors, so their responses are OPAQUE
  // (status 0, ok false) — checking res.ok alone would cache nothing
  // and offline pages could never load; opaque responses ARE
  // cacheable, so they are stored too. (2) A cache failure must
  // never break the image: every cache step is guarded and any
  // failure falls through to a plain network fetch.
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      (async () => {
        try {
          const cached = await caches.match(req);
          if (cached) return cached;
          const res = await fetch(req);
          if (res.ok || res.type === 'opaque') {
            caches.open(IMG_CACHE).then((cache) =>
              cache.put(req, res.clone())
                .then(() => trimCache(IMG_CACHE, MAX_IMG_ENTRIES))
                .catch(() => {})
            ).catch(() => {});
          }
          return res;
        } catch {
          return fetch(req);
        }
      })()
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate. This covers
  // JS/CSS and the icon PNGs (the artwork itself, generated at
  // build time) so the splash and start-page logo also work offline.
  if (url.origin === self.location.origin && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.png'))) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Everything else: network only (no caching).
});
