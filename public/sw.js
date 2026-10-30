/* Offline service worker for روابط الذكر الحكيم (v2, hand-written —
   no build plugin, so the existing prebuild icon step is untouched).
   Strategy:
   - App shell (/, /index.html): cached on install; navigations are
     network-first with a cached-shell fallback, so the app still opens
     offline (hash routing means one index.html serves every route).
     The navigation handler NEVER caches a non-ok response: caching
     an error page as the shell would poison every offline open.
   - Same-origin JS/CSS/JSON/PNG/SVG: stale-while-revalidate. The
     .json rule covers the bundled mutashabihat data
     (/mutashabihat/*.json), which previously had no offline rule.
   - Mushaf page images (cdn.jsdelivr.net, both sufone + QuranHub):
     cache-first, bounded (only pages the user actually visited — the
     full 604 pages are NEVER prefetched). Cache-first also means a
     visited page opens instantly on later visits. NOTE: <img>
     responses are opaque (ok is false), so the cache rule accepts
     opaque responses — a res.ok-only check would cache nothing.
     Cache keys are CANONICAL (query stripped): the Mushaf retry
     mechanism appends ?sw-retry=1 / ?img-retry=N, and keying on the
     full URL used to fragment the cache (up to 3 entries per page)
     and miss full-download entries (keyed by the plain URL).
   - Everything else (Supabase API, storage audio, third-party): network
     only, never cached — auth and fresh data must not go stale.
   Versioning: SHELL_CACHE is bumped on every SW change (v1 -> v2
   here); activate deletes the old shell cache AND trims the current
   one to the assets the current index.html actually references, so
   stale hashed bundles do not accumulate across deploys. The
   full-download caches (verified + unverified) are NEVER trimmed and
   NEVER deleted here — the keep-list below is load-bearing: dropping
   a name from it wipes that edition's download on the next deploy.
   A new deploy ships a new file (new cache names on version bump), and
   skipWaiting + clients.claim make the update take effect promptly. */

const SHELL_CACHE = 'quran-shell-v2';
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
// Unverified (opaque-only) download caches — see pageDownload.ts:
// opaque pages render offline but are revalidated on the next
// top-up, so they must survive deploys exactly like verified ones.
const FULL_IMG_CACHE_UNVERIFIED = 'quran-pages-full-unverified';
const FULL_IMG_CACHE_TAJWEED_UNVERIFIED = 'quran-pages-full-tajweed-unverified';
const FULL_IMG_CACHE_WARSH_UNVERIFIED = 'quran-pages-full-warsh-unverified';
const FULL_IMG_CACHE_HAFS_UNVERIFIED = 'quran-pages-full-hafs-unverified';
const KEEP_CACHES = new Set([
  SHELL_CACHE, IMG_CACHE,
  FULL_IMG_CACHE, FULL_IMG_CACHE_TAJWEED, FULL_IMG_CACHE_WARSH, FULL_IMG_CACHE_HAFS,
  FULL_IMG_CACHE_UNVERIFIED, FULL_IMG_CACHE_TAJWEED_UNVERIFIED,
  FULL_IMG_CACHE_WARSH_UNVERIFIED, FULL_IMG_CACHE_HAFS_UNVERIFIED,
]);
const MAX_IMG_ENTRIES = 150;

// Assets precached at install: the shell + the artwork itself (the
// app icon IS the artwork — no redraws, these are the shipped files).
// JS/CSS bundle names are hashed per build, so they are discovered
// from the live index.html at install time (see precacheShell) and
// re-discovered at activate time for trimming (see trimShellCache).
const PRECACHE_STATIC = [
  '/', '/index.html', '/manifest.webmanifest',
  'https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/app-icons/icon-192.png', 'https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/app-icons/icon-512.png', 'https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/app-icons/icon-maskable-512.png',
  'https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/app-icons/apple-touch-icon.png', '/quran-icon.svg',
];

function assetPathsFromHtml(html) {
  const paths = [];
  try {
    const re = /(?:src|href)="([^"]+\.(?:js|css))"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const raw = m[1];
      if (raw.startsWith('http')) continue;
      paths.push(raw.startsWith('/') ? raw : '/' + raw);
    }
  } catch {}
  return paths;
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(PRECACHE_STATIC);
  // Bundle JS/CSS: parse the live index.html (hashed names change
  // every build, so they cannot be listed statically). Any failure
  // here is non-fatal — SWR fills the bundles on first use.
  try {
    const res = await fetch('/index.html');
    if (res.ok) {
      const html = await res.text();
      const assets = assetPathsFromHtml(html);
      if (assets.length > 0) await cache.addAll(assets);
    }
  } catch {}
}

// Trim the shell cache to what the CURRENT deploy references:
// the static precache list + the current index.html's bundles +
// bundled mutashabihat JSON (offline feature data, not a bundle).
// Everything else (stale hashed bundles from older deploys) is
// deleted. SAFE DIRECTION: if the live index.html cannot be fetched
// and parsed (offline activate, transient failure), trimming is
// SKIPPED entirely — deleting bundles we cannot re-derive would
// break the offline app, while keeping stale bundles only wastes
// space until the next successful activate. Never throws: a trim
// failure must not break activation.
async function trimShellCache() {
  try {
    const keep = new Set(PRECACHE_STATIC);
    let parsedOk = false;
    try {
      const res = await fetch('/index.html');
      if (res.ok) {
        const assets = assetPathsFromHtml(await res.text());
        if (assets.length > 0) {
          for (const p of assets) keep.add(p);
          parsedOk = true;
        }
      }
    } catch {}
    if (!parsedOk) return;
    const cache = await caches.open(SHELL_CACHE);
    const keys = await cache.keys();
    for (const key of keys) {
      const url = new URL(key.url);
      if (keep.has(url.pathname)) continue;
      if (url.pathname.startsWith('/mutashabihat/')) continue;
      if (url.pathname.endsWith('.json')) continue;
      await cache.delete(key);
    }
  } catch {}
}

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
    precacheShell()
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !KEEP_CACHES.has(k)).map((k) => caches.delete(k))
      ))
      .then(() => trimShellCache())
      .then(() => self.clients.claim())
      .catch(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigation (including the SPA's hash routes): network first so a
  // fresh deploy is picked up, cached shell when offline. Only an
  // ok response is cached as the shell — a 404/500 error page must
  // never become the offline shell (the old code cached any status).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Mushaf page images: cache-first, bounded. Three rules that matter:
  // (1) <img> requests are no-cors, so their responses are OPAQUE
  // (status 0, ok false) — checking res.ok alone would cache nothing
  // and offline pages could never load; opaque responses ARE
  // cacheable, so they are stored too. (2) Cache keys are canonical
  // (query stripped): retry URLs (?sw-retry=1, ?img-retry=N) must hit
  // the same entry as the plain URL, including full-download entries.
  // (3) A cache failure must never break the image: every cache step
  // is guarded and any failure falls through to a plain network fetch.
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      (async () => {
        const cacheKey = new Request(url.origin + url.pathname);
        try {
          const cached = await caches.match(cacheKey);
          if (cached) return cached;
          const res = await fetch(req);
          if (res.ok || res.type === 'opaque') {
            caches.open(IMG_CACHE).then((cache) =>
              cache.put(cacheKey, res.clone())
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
  // JS/CSS, the icon PNGs (the artwork itself, generated at
  // build time) so the splash and start-page logo also work offline,
  // and bundled .json (mutashabihat data) so similar-ayah lookup
  // works offline too. A miss with no cache and no network resolves
  // to a 504 response instead of null (respondWith(null) throws).
  if (url.origin === self.location.origin && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.png') || url.pathname.endsWith('.json') || url.pathname.endsWith('.svg'))) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => cached || new Response('', { status: 504 }));
        return cached || network;
      })
    );
    return;
  }

  // Everything else: network only (no caching).
});
