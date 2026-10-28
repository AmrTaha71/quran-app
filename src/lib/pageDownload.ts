// One-tap full download of the Madinah Mushaf pages onto the device
// (the Hafidz pattern): after this, every flip is a local read —
// instant on any connection, even offline. The service worker's fetch
// handler already serves jsdelivr images cache-first from ANY cache
// (caches.match searches all caches), so pages stored here are picked
// up automatically; the worker never writes to this cache and never
// trims it (unlike the 150-entry visited-pages cache).
import { MUSHAF_EDITIONS } from './mushafEditions';

export const FULL_IMG_CACHE = 'quran-pages-full';
export const TOTAL_DL_PAGES = 604;

const MADINAH_URL = (MUSHAF_EDITIONS.find((e) => e.id === 'madinah') || MUSHAF_EDITIONS[0]).imageUrl;

export function pageDownloadSupported(): boolean {
  try {
    return typeof caches !== 'undefined' && 'caches' in window;
  } catch {
    return false;
  }
}

export async function countCachedPages(): Promise<number> {
  try {
    const cache = await caches.open(FULL_IMG_CACHE);
    const urls = new Set((await cache.keys()).map((k) => k.url));
    let n = 0;
    for (let p = 1; p <= TOTAL_DL_PAGES; p++) {
      if (urls.has(MADINAH_URL(p))) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

export async function clearCachedPages(): Promise<void> {
  try {
    await caches.delete(FULL_IMG_CACHE);
  } catch {}
}

export interface DownloadProgress {
  done: number;
  total: number;
  failed: number[];
}

// Fetch every missing page (4 at a time — fast enough without
// flooding the connection, the lesson from the preload flood) and
// store it. Already-cached pages are skipped, so stopping and
// resuming is free, and a top-up after storage eviction only fetches
// what's missing. Responses are opaque (no-cors, like <img>), which
// the Cache API stores fine; progress counts pages, not bytes.
export async function downloadAllPages(
  onProgress: (p: DownloadProgress) => void,
  shouldStop: () => boolean,
): Promise<{ downloaded: number; failed: number[] }> {
  const cache = await caches.open(FULL_IMG_CACHE);
  const existing = new Set((await cache.keys()).map((k) => k.url));
  const missing: number[] = [];
  for (let p = 1; p <= TOTAL_DL_PAGES; p++) {
    if (!existing.has(MADINAH_URL(p))) missing.push(p);
  }
  const failed: number[] = [];
  let done = TOTAL_DL_PAGES - missing.length;
  onProgress({ done, total: TOTAL_DL_PAGES, failed });
  let idx = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (idx < missing.length) {
      if (shouldStop()) return;
      const p = missing[idx++];
      try {
        const res = await fetch(MADINAH_URL(p), { mode: 'no-cors' });
        await cache.put(MADINAH_URL(p), res);
        done++;
      } catch {
        failed.push(p);
      }
      onProgress({ done, total: TOTAL_DL_PAGES, failed: [...failed] });
    }
  });
  await Promise.all(workers);
  return { downloaded: done, failed };
}
