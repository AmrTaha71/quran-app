// One-tap download of Mushaf page images into Cache Storage, per
// edition (Hafidz pattern). NOTHING downloads on its own: the user
// taps a button per edition. Madinah is the default edition; the
// other editions are strictly optional, and the Settings UI shows
// each edition's size warning before its download starts, so the app
// never weighs the device down with editions the user didn't choose.
//
// Serving needs no SW change: the SW fetch handler serves jsdelivr
// images cache-first from ANY cache, so a page cached here is picked
// up automatically. The full-download caches below are keep-listed in
// the SW activate handler and are NEVER trimmed (unlike the 150-entry
// visited-pages cache).
//
// Sizes measured 2026-10-28 (jsdelivr Content-Length samples):
// madinah ~395KB/page x 604 = ~240MB; tajweed ~122KB x 604 = ~75MB;
// warsh ~360KB x 604 = ~220MB; hafs ~311KB x 603 = ~190MB.
// Hafs has 603 downloadable pages: page 604 exists in the repo but
// jsdelivr answers 403 for it (and the app has no mirror for the
// QuranHub editions), so the app itself cannot show hafs 604 today.
import { MUSHAF_EDITIONS } from './mushafEditions';

export interface EditionDownload {
  id: string;
  name: string;
  pages: number;
  approxMB: number;
}

export const EDITION_DOWNLOADS: EditionDownload[] = [
  { id: 'madinah', name: 'مصحف المدينة المنورة', pages: 604, approxMB: 240 },
  { id: 'tajweed', name: 'مصحف التجويد الملون', pages: 604, approxMB: 75 },
  { id: 'warsh', name: 'مصحف ورش', pages: 604, approxMB: 220 },
  { id: 'hafs', name: 'مصحف حفص (الخط الواسط)', pages: 603, approxMB: 190 },
];

export function editionDownload(id: string): EditionDownload {
  return EDITION_DOWNLOADS.find((e) => e.id === id) ?? EDITION_DOWNLOADS[0];
}

// Madinah keeps the original cache name (shipped 2026-10-28); the
// optional editions each get their own cache so counts, clear, and
// top-up are per edition.
export function editionCacheName(id: string): string {
  return id === 'madinah' ? 'quran-pages-full' : `quran-pages-full-${id}`;
}

export function editionPageUrl(id: string, page: number): string {
  const ed = MUSHAF_EDITIONS.find((e) => e.id === id);
  return ed ? ed.imageUrl(page) : MUSHAF_EDITIONS[0].imageUrl(page);
}

export function pageDownloadSupported(): boolean {
  try {
    return typeof caches !== 'undefined' && 'caches' in window;
  } catch {
    return false;
  }
}

export async function countCachedPages(editionId = 'madinah'): Promise<number> {
  try {
    const cache = await caches.open(editionCacheName(editionId));
    return (await cache.keys()).length;
  } catch {
    return 0;
  }
}

export async function clearCachedPages(editionId = 'madinah'): Promise<void> {
  try {
    await caches.delete(editionCacheName(editionId));
  } catch {}
}

export interface DownloadProgress {
  done: number;
  failed: number[];
}

export async function downloadAllPages(
  editionId: string,
  onProgress: (p: DownloadProgress) => void,
  shouldStop: () => boolean,
): Promise<{ downloaded: number; failed: number[] }> {
  const info = editionDownload(editionId);
  const cache = await caches.open(editionCacheName(editionId));
  const failed: number[] = [];
  let done = 0;
  // 4-way fetch, like the Madinah original: fast enough without
  // flooding the connection (the 2798b81 lesson: floods cause
  // transient failures on fast flips).
  const CONCURRENCY = 4;
  let next = 1;
  const worker = async () => {
    while (next <= info.pages) {
      if (shouldStop()) return;
      const page = next++;
      const url = editionPageUrl(editionId, page);
      try {
        if (await cache.match(url)) {
          done++;
          onProgress({ done, failed: [...failed] });
          continue;
        }
        let res: Response | null = null;
        try {
          // CORS first: a real status lets us refuse error pages
          // (e.g. hafs 604's jsdelivr 403) instead of caching them —
          // a cached error would shadow the page forever.
          res = await fetch(url, { mode: 'cors' });
        } catch {
          // CORS blocked (proxy, odd network): fall back to the
          // original opaque fetch — the image still renders from
          // cache, we just can't inspect its status.
          res = await fetch(url, { mode: 'no-cors' });
        }
        if (res.ok || res.type === 'opaque') {
          await cache.put(url, res);
          done++;
        } else {
          failed.push(page);
          done++;
        }
      } catch {
        failed.push(page);
        done++;
      }
      onProgress({ done, failed: [...failed] });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const keys = await cache.keys();
  return { downloaded: keys.length, failed };
}
