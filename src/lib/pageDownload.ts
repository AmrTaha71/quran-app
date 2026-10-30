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
// VERIFIED vs UNVERIFIED (opaque-poison fix, 2026-10-28): an opaque
// response (mode: 'no-cors') carries no status, so an error page
// fetched opaquely is indistinguishable from a real page image. The
// old code cached opaque responses in the main cache and the top-up
// then treated them as "already downloaded" forever — a poisoned
// error page could never heal. Now:
//   - CORS-ok responses go in the edition's main cache (verified).
//   - Opaque responses go in a SEPARATE `<cache>-unverified` cache:
//     the image still renders offline (the SW serves from any cache),
//     but the page is NOT counted as downloaded and the next top-up
//     revalidates it with a CORS fetch. A CORS success promotes it
//     to the verified cache; a confirmed 4xx deletes the unverified
//     copy (a confirmed error must not shadow the page); a 5xx keeps
//     it (transient failure, the copy may still be a good image).
//   - Legacy poison repair: an opaque entry found in the MAIN cache
//     (written by the old code) is moved to the unverified cache on
//     the next top-up run instead of being trusted, so old poison
//     heals the same way. countCachedPages counts VERIFIED pages
//     only, so a legacy user's counter may dip until the next top-up
//     revalidates — that dip is honest, not a regression.
//   - The unverified caches are keep-listed in public/sw.js alongside
//     the verified ones, so a deploy never wipes them either.
//
// Sizes measured 2026-10-28 (jsdelivr Content-Length samples):
// madinah ~395KB/page x 604 = ~240MB; tajweed ~122KB x 604 = ~75MB;
// warsh ~360KB x 604 = ~220MB.
// Hafs (was ~311KB x 603 = ~190MB) is NOT listed: page 604 exists
// in the repo but jsdelivr answers 403 for it (and the app has no
// mirror for the QuranHub editions), so the edition is incomplete —
// and per the user's decision (2026-10-31) an incomplete Mushaf is
// not displayed at all. Do NOT re-add it without a verified
// page-604 source. The Mushaf image-error block still names hafs
// 604 defensively.
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
  // No hafs entry: hidden per the 2026-10-31 decision (see header).
];

// Hafs page 604: confirmed jsdelivr 403, no mirror (SYNTHESIS V8
// still open on 403-vs-missing, but either way the app cannot serve
// it today). Referenced defensively by the Mushaf error copy only.
export const HAFS_UNAVAILABLE_PAGE = 604;

export function editionDownload(id: string): EditionDownload {
  return EDITION_DOWNLOADS.find((e) => e.id === id) ?? EDITION_DOWNLOADS[0];
}

// Madinah keeps the original cache name (shipped 2026-10-28); the
// optional editions each get their own cache so counts, clear, and
// top-up are per edition.
export function editionCacheName(id: string): string {
  return id === 'madinah' ? 'quran-pages-full' : `quran-pages-full-${id}`;
}

// Unverified (opaque-only) cache for an edition. Keep-listed in
// public/sw.js — NEVER let the SW activate handler delete these,
// or unverified pages would vanish on deploy like verified ones must not.
export function editionUnverifiedCacheName(id: string): string {
  return `${editionCacheName(id)}-unverified`;
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

// VERIFIED pages only (see header). Unverified pages still render
// offline via the SW, but counting them as "downloaded" is exactly
// the poison bug this file fixes.
export async function countCachedPages(editionId = 'madinah'): Promise<number> {
  try {
    const cache = await caches.open(editionCacheName(editionId));
    return (await cache.keys()).length;
  } catch {
    return 0;
  }
}

// True when ANY edition has any cached page (verified or not) —
// used by the offline banner to pick honest copy ("your downloaded
// pages are available" vs "only pages you visited before").
export async function hasAnyFullDownload(): Promise<boolean> {
  try {
    for (const ed of EDITION_DOWNLOADS) {
      for (const name of [editionCacheName(ed.id), editionUnverifiedCacheName(ed.id)]) {
        const cache = await caches.open(name);
        if ((await cache.keys()).length > 0) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// Clear removes BOTH caches: leaving unverified copies behind would
// keep serving images the user just asked to delete.
export async function clearCachedPages(editionId = 'madinah'): Promise<void> {
  try {
    await caches.delete(editionCacheName(editionId));
  } catch {}
  try {
    await caches.delete(editionUnverifiedCacheName(editionId));
  } catch {}
}

// ---- Storage preflight + quota ------------------------------------

// Per-fetch timeout: a hung fetch must not pin the run (and must not
// pin the stop button — see the AbortController wiring in
// downloadAllPages). 20 s is generous for a ~400 KB page image even
// on a slow connection, and short enough that 4 parallel workers
// cannot stall the run for minutes.
export const PAGE_FETCH_TIMEOUT_MS = 20000;

// Margin applied to the edition size in the preflight: the estimate
// is approximate (edition sizes are sampled averages) and the device
// needs headroom for the browser's own bookkeeping.
export const STORAGE_PREFLIGHT_MARGIN = 1.15;

export interface StorageEstimate {
  supported: boolean;
  // null when the API exists but reports no usable numbers.
  quotaMB: number | null;
  usageMB: number | null;
  freeMB: number | null;
  // null when navigator.storage.persist is unavailable.
  persisted: boolean | null;
}

export async function estimateDownloadStorage(): Promise<StorageEstimate> {
  const empty: StorageEstimate = { supported: false, quotaMB: null, usageMB: null, freeMB: null, persisted: null };
  try {
    const storage = navigator.storage;
    if (!storage?.estimate) return empty;
    const est = await storage.estimate();
    let persisted: boolean | null = null;
    try {
      if (typeof storage.persisted === 'function') persisted = await storage.persisted();
    } catch { /* ignore: persisted stays null */ }
    const quotaMB = typeof est.quota === 'number' ? est.quota / 1048576 : null;
    const usageMB = typeof est.usage === 'number' ? est.usage / 1048576 : null;
    const freeMB = quotaMB !== null && usageMB !== null ? Math.max(0, quotaMB - usageMB) : null;
    return { supported: true, quotaMB, usageMB, freeMB, persisted };
  } catch {
    return empty;
  }
}

export interface SpaceCheck {
  status: 'ok' | 'low' | 'unknown';
  neededMB: number;
  freeMB: number | null;
  persisted: boolean | null;
}

// Preflight for one edition's (remaining) download. `alreadyCached`
// is the verified count so a top-up is judged on what is left, not
// the full edition size. 'unknown' (no estimate API / no numbers)
// must NOT refuse the download — it only means we cannot judge.
export async function checkDownloadSpace(
  editionId: string,
  alreadyCached = 0,
): Promise<SpaceCheck> {
  const info = editionDownload(editionId);
  const remaining = Math.max(0, info.pages - alreadyCached);
  const neededMB = Math.ceil((info.approxMB * remaining) / info.pages * STORAGE_PREFLIGHT_MARGIN);
  const est = await estimateDownloadStorage();
  if (!est.supported || est.freeMB === null) {
    return { status: 'unknown', neededMB, freeMB: est.freeMB, persisted: est.persisted };
  }
  return {
    status: est.freeMB < neededMB ? 'low' : 'ok',
    neededMB,
    freeMB: est.freeMB,
    persisted: est.persisted,
  };
}

// Best-effort request for persistent storage. Returns the RESULT
// (true = granted, false = denied, null = API unavailable) instead
// of ignoring it like the old code did — the Settings UI surfaces it.
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    const storage = navigator.storage as any;
    if (typeof storage?.persist !== 'function') return null;
    return await storage.persist();
  } catch {
    return null;
  }
}

export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: unknown }).name;
  const code = (e as { code?: unknown }).code;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

// ---- Download -------------------------------------------------------

export interface DownloadProgress {
  done: number;
  failed: number[];
  // Pages cached opaquely this run (render offline, NOT counted as
  // downloaded, revalidated on the next run).
  unverified: number[];
}

export interface DownloadResult {
  // Verified pages in the cache at the end of the run.
  downloaded: number;
  failed: number[];
  unverified: number[];
  // True when the run was cut short by storage exhaustion: the UI
  // must show the distinct "device storage full" message, not the
  // generic retry message, and must NOT present this as complete.
  quotaExceeded: boolean;
  // True when the user stopped the run (flag or abort signal).
  aborted: boolean;
}

function fetchWithTimeout(
  url: string,
  mode: RequestMode,
  runSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onRunAbort = () => ctrl.abort();
  if (runSignal) {
    if (runSignal.aborted) ctrl.abort();
    else runSignal.addEventListener('abort', onRunAbort, { once: true });
  }
  return fetch(url, { mode, signal: ctrl.signal }).finally(() => {
    clearTimeout(timer);
    if (runSignal) runSignal.removeEventListener('abort', onRunAbort);
  });
}

export async function downloadAllPages(
  editionId: string,
  onProgress: (p: DownloadProgress) => void,
  shouldStop: () => boolean,
  opts?: { signal?: AbortSignal },
): Promise<DownloadResult> {
  const info = editionDownload(editionId);
  const cache = await caches.open(editionCacheName(editionId));
  const unverifiedCache = await caches.open(editionUnverifiedCacheName(editionId));
  const failed: number[] = [];
  const unverified: number[] = [];
  let done = 0;
  // Shared abort state: quota exhaustion aborts the whole run
  // immediately (not after the remaining pages fail one by one), and
  // the caller's signal (Settings stop button) aborts in-flight
  // fetches at once instead of waiting for them to finish.
  let quotaExceeded = false;
  const stopped = () => shouldStop() || quotaExceeded || !!opts?.signal?.aborted;
  const report = () => onProgress({ done, failed: [...failed], unverified: [...unverified] });
  // 4-way fetch, like the Madinah original: fast enough without
  // flooding the connection (the 2798b81 lesson: floods cause
  // transient failures on fast flips).
  const CONCURRENCY = 4;
  let next = 1;
  const worker = async () => {
    while (next <= info.pages) {
      if (stopped()) return;
      const page = next++;
      const url = editionPageUrl(editionId, page);
      try {
        const existing = await cache.match(url);
        if (existing) {
          if (existing.type !== 'opaque' && existing.ok) {
            // Verified good page: top-up skips it.
            done++;
            report();
            continue;
          }
          // LEGACY POISON: an opaque entry in the verified cache
          // (written by the old code) is never trusted. Move it to
          // the unverified cache and revalidate below.
          try { await cache.delete(url); } catch {}
          try { await unverifiedCache.put(url, existing); } catch {}
        }
        let res: Response | null = null;
        let corsErrored = false;
        try {
          // CORS first: a real status lets us refuse error pages
          // (e.g. hafs 604's jsdelivr 403) instead of caching them —
          // a cached error would shadow the page forever.
          res = await fetchWithTimeout(url, 'cors', opts?.signal, PAGE_FETCH_TIMEOUT_MS);
        } catch (e) {
          // A stop/timeout abort is not a page failure: exit without
          // recording it, so "stopped" never looks like "failed".
          if (opts?.signal?.aborted || shouldStop()) return;
          corsErrored = true;
          void e;
        }
        if (stopped()) return;
        if (res) {
          if (res.ok) {
            try {
              await cache.put(url, res);
            } catch (e) {
              if (isQuotaError(e)) { quotaExceeded = true; return; }
              throw e;
            }
            try { await unverifiedCache.delete(url); } catch {}
            done++;
          } else {
            // Confirmed error status: never cached, never counted.
            // A 4xx is definitive, so drop any unverified copy that
            // might be the same error page; a 5xx is transient, so
            // keep an unverified copy (it may still be a good image).
            if (res.status >= 400 && res.status < 500) {
              try { await unverifiedCache.delete(url); } catch {}
            }
            failed.push(page);
            done++;
          }
        } else if (corsErrored) {
          // CORS blocked (proxy, odd network): fall back to the
          // opaque fetch — the image still renders from cache, but
          // it goes to the UNVERIFIED cache only and is revalidated
          // on the next run. It is never counted as downloaded.
          try {
            const opaque = await fetchWithTimeout(url, 'no-cors', opts?.signal, PAGE_FETCH_TIMEOUT_MS);
            if (stopped()) return;
            try {
              await unverifiedCache.put(url, opaque);
            } catch (e) {
              if (isQuotaError(e)) { quotaExceeded = true; return; }
              throw e;
            }
            unverified.push(page);
            done++;
          } catch (e) {
            if (opts?.signal?.aborted || shouldStop()) return;
            if (isQuotaError(e)) { quotaExceeded = true; return; }
            failed.push(page);
            done++;
          }
        }
      } catch (e) {
        if (opts?.signal?.aborted || shouldStop()) return;
        if (isQuotaError(e)) { quotaExceeded = true; return; }
        failed.push(page);
        done++;
      }
      report();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const keys = await cache.keys();
  return {
    downloaded: keys.length,
    failed,
    unverified,
    quotaExceeded,
    aborted: shouldStop() || !!opts?.signal?.aborted,
  };
}
