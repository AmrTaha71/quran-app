// listenOffline.ts — per-surah offline audio downloads for the
// "استمع للقرآن" (Listen to Quran) feature.
//
// STORAGE:
// - Audio clips live in IndexedDB database 'quran-listen-offline'
//   (version 1), object store 'clips' with keyPath 'key', values
//   { key, blob }. This is deliberately a DIFFERENT database from
//   the sibling text cache ('quran-text-cache') so the two stores
//   can never collide or be wiped together.
// - Download metadata lives in localStorage under
//   'quran-listen-downloads' (JSON array of DownloadedSurah). Meta
//   is written ONLY on full download success, so meta presence
//   implies completeness — isSurahDownloaded trusts meta alone.
//
// WHY IndexedDB + blob URLs (not the Cache API):
// - The Cache API stores Responses keyed by Request URL; it is
//   designed for fetch interception via a service worker, which this
//   app does not run. IndexedDB gives us explicit per-clip keys,
//   explicit deletion by prefix, and explicit byte accounting —
//   everything the UI needs (badge, size, delete) without a worker.
// - Blob URLs are picked for playback because the playback engine
//   already plays from a plain URL string on a single audio
//   element: resolveListenUrl returns either a blob: URL (cached)
//   or the network URL, and the engine needs no other change.
//   A blob URL also keeps working while the app is backgrounded,
//   since it is just an in-memory object URL, not a fetch.
// - Real-device caveats (NOT provable here): Safari blob-URL
//   playback from IDB blobs and IDB durability under iOS storage
//   pressure must be verified on a real iPhone/iPad; see NOTES.
//
// FAILURE DISCIPLINE (mirrors quranTextCache.ts):
// - Read paths degrade gracefully and never break playback:
//   getCachedClipUrl never throws; resolveListenUrl falls back to
//   the network URL on any cache miss or failure.
// - Write paths surface errors honestly: downloadSurah throws on
//   any clip failure (after rolling back its own partial work)
//   and writes NO meta, so the UI never shows a badge for a
//   half-downloaded surah.
//
// NODE-TESTABILITY: IndexedDB is resolved LAZILY at call time via
// globalThis.indexedDB (never at import time), fetch is injectable
// (fetchFn defaults to globalThis.fetch), and all pure helpers
// (clipKey, formatApproxSize, meta parse/validate) need no DOM.
// No Supabase, no React in this module.

import { RECITERS } from './reciters';
import { SURAH_AYAH_COUNTS } from './surahs';

export interface DownloadedSurah {
  surah: number;
  reciter: string;
  count: number;
  bytes: number;
  downloadedAt: number;
}

const DB_NAME = 'quran-listen-offline';
const DB_VERSION = 1;
const STORE_NAME = 'clips';
const META_KEY = 'quran-listen-downloads';

/** Download failure message surfaced to the UI (single message). */
export const DOWNLOAD_FAILED_MESSAGE =
  'تعذر تحميل السورة — تحقق من الاتصال وحاول تاني';

export function clipKey(reciterId: string, surah: number, ayah: number): string {
  return `listen-clip:${reciterId}:${surah}:${ayah}`;
}

function clipPrefix(reciterId: string, surah: number): string {
  return `listen-clip:${reciterId}:${surah}:`;
}

export function formatApproxSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return 'حجم غير معروف';
  }
  if (bytes < 1024 * 1024) {
    return `≈ ${Math.round(bytes / 1024)} ك.ب`;
  }
  return `≈ ${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

// --- Download metadata (localStorage, repo pattern: try/catch, swallow) ---

export function isValidDownloadedSurah(entry: unknown): entry is DownloadedSurah {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Partial<DownloadedSurah>;
  return (
    typeof e.surah === 'number' &&
    Number.isFinite(e.surah) &&
    typeof e.reciter === 'string' &&
    e.reciter.length > 0 &&
    typeof e.count === 'number' &&
    Number.isFinite(e.count) &&
    typeof e.bytes === 'number' &&
    Number.isFinite(e.bytes) &&
    typeof e.downloadedAt === 'number' &&
    Number.isFinite(e.downloadedAt)
  );
}

/** Pure meta parser: invalid entries are dropped; any failure → []. */
export function parseDownloadedSurahs(raw: string | null): DownloadedSurah[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidDownloadedSurah);
  } catch {
    return [];
  }
}

function readMeta(): DownloadedSurah[] {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) return [];
    return parseDownloadedSurahs(storage.getItem(META_KEY));
  } catch {
    return [];
  }
}

function writeMeta(entries: DownloadedSurah[]): void {
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  if (!storage) return;
  storage.setItem(META_KEY, JSON.stringify(entries));
}

function upsertMeta(meta: DownloadedSurah): void {
  try {
    const entries = readMeta().filter(
      (e) => !(e.surah === meta.surah && e.reciter === meta.reciter),
    );
    entries.push(meta);
    writeMeta(entries);
  } catch {
    // Meta write failure must not mask a successful download, but
    // without meta the surah would not count as downloaded — so
    // rethrow: the caller (downloadSurah) treats this as failure
    // and rolls back, keeping meta and blobs consistent.
    throw new Error(DOWNLOAD_FAILED_MESSAGE);
  }
}

function removeMeta(reciterId: string, surah: number): void {
  try {
    const entries = readMeta().filter(
      (e) => !(e.surah === surah && e.reciter === reciterId),
    );
    writeMeta(entries);
  } catch {
    // Best-effort: delete path swallows failures.
  }
}

export function listDownloadedSurahs(): DownloadedSurah[] {
  return readMeta();
}

// --- IndexedDB helpers (resolved lazily at call time) ---

interface StoredClip {
  key: string;
  blob: Blob;
}

function getIDB(): IDBFactory {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) throw new Error('indexedDB unavailable');
  return idb;
}

function openDB(): Promise<IDBDatabase> {
  const idb = getIDB();
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getClip(key: string): Promise<StoredClip | undefined> {
  const db = await openDB();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    return await requestToPromise(
      tx.objectStore(STORE_NAME).get(key) as IDBRequest<StoredClip | undefined>,
    );
  } finally {
    db.close();
  }
}

async function putClip(clip: StoredClip): Promise<void> {
  const db = await openDB();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(STORE_NAME).put(clip));
  } finally {
    db.close();
  }
}

async function deleteClip(key: string): Promise<void> {
  const db = await openDB();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(STORE_NAME).delete(key));
  } finally {
    db.close();
  }
}

async function listClipKeys(): Promise<string[]> {
  const db = await openDB();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const keys = await requestToPromise(
      tx.objectStore(STORE_NAME).getAllKeys() as IDBRequest<unknown[]>,
    );
    return keys.filter((k): k is string => typeof k === 'string');
  } finally {
    db.close();
  }
}

// --- Reciter / surah resolution ---

function findReciter(reciterId: string) {
  return RECITERS.find((r) => r.id === reciterId);
}

function ayahCount(surah: number): number {
  if (!Number.isInteger(surah) || surah < 1 || surah > SURAH_AYAH_COUNTS.length) {
    return 0;
  }
  return SURAH_AYAH_COUNTS[surah - 1];
}

function defaultFetch(): typeof fetch {
  const f = (globalThis as { fetch?: typeof fetch }).fetch;
  if (!f) throw new Error('fetch unavailable');
  return f;
}

// --- Contract ---

/**
 * HEAD each ayah URL for the surah and sum Content-Length.
 * If ANY HEAD fails or lacks a usable Content-Length, returns
 * { bytes: null, count } — the UI then shows 'حجم غير معروف'
 * and still allows download with live progress. Never downloads
 * bodies on the estimate path.
 */
export async function estimateSurahSize(
  reciterId: string,
  surah: number,
  fetchFn: typeof fetch = defaultFetch(),
): Promise<{ bytes: number | null; count: number }> {
  const count = ayahCount(surah);
  const reciter = findReciter(reciterId);
  if (count === 0 || !reciter) return { bytes: null, count };
  try {
    const sizes = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const url = reciter.audioUrl(surah, i + 1);
        const res = await fetchFn(url, { method: 'HEAD' });
        if (!res.ok) return null;
        const len = res.headers.get('content-length');
        if (len === null) return null;
        const n = Number(len);
        if (!Number.isFinite(n) || n < 0) return null;
        return n;
      }),
    );
    if (sizes.some((s) => s === null)) return { bytes: null, count };
    return {
      bytes: (sizes as number[]).reduce((a, b) => a + b, 0),
      count,
    };
  } catch {
    return { bytes: null, count };
  }
}

/**
 * Download one surah, per-surah and user-initiated ONLY — no
 * whole-Quran download, no synthetic audio, no pre-generation.
 * Clips already stored (by key) are skipped, so re-running after
 * a failure resumes rather than restarting. bytes in the returned
 * meta = sum of ACTUAL stored blob sizes (including resumed clips).
 * On ANY clip failure: blobs stored during THIS run are deleted,
 * NO meta is written, and the Arabic download error is thrown.
 */
export async function downloadSurah(
  reciterId: string,
  surah: number,
  onProgress?: (done: number, total: number) => void,
  fetchFn: typeof fetch = defaultFetch(),
): Promise<DownloadedSurah> {
  const count = ayahCount(surah);
  const reciter = findReciter(reciterId);
  if (count === 0 || !reciter) throw new Error(DOWNLOAD_FAILED_MESSAGE);
  const storedThisRun: string[] = [];
  let bytes = 0;
  try {
    for (let ayah = 1; ayah <= count; ayah++) {
      const key = clipKey(reciterId, surah, ayah);
      const existing = await getClip(key);
      if (existing && existing.blob) {
        bytes += existing.blob.size;
      } else {
        const res = await fetchFn(reciter.audioUrl(surah, ayah));
        if (!res.ok) throw new Error(DOWNLOAD_FAILED_MESSAGE);
        const blob = await res.blob();
        await putClip({ key, blob });
        storedThisRun.push(key);
        bytes += blob.size;
      }
      onProgress?.(ayah, count);
    }
  } catch {
    // Roll back ONLY this run's blobs; pre-existing (resumed) clips
    // are left alone so a later retry can still resume from them.
    for (const key of storedThisRun) {
      try {
        await deleteClip(key);
      } catch {
        // Best-effort rollback; the thrown error below is the signal.
      }
    }
    throw new Error(DOWNLOAD_FAILED_MESSAGE);
  }
  const meta: DownloadedSurah = {
    surah,
    reciter: reciterId,
    count,
    bytes,
    downloadedAt: Date.now(),
  };
  // Meta is written ONLY on full success. A meta-write failure
  // leaves blobs without meta (invisible to the UI, resumable by
  // a retry) rather than a badge for an unrecorded download.
  upsertMeta(meta);
  return meta;
}

/**
 * Best-effort: deletes all clips for this surah+reciter and
 * removes the meta entry. Failures are swallowed, but the meta
 * entry is still removed so the UI stops showing the badge.
 */
export async function deleteDownloadedSurah(
  reciterId: string,
  surah: number,
): Promise<void> {
  const prefix = clipPrefix(reciterId, surah);
  try {
    const keys = await listClipKeys();
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      try {
        await deleteClip(key);
      } catch {
        // Best-effort per clip.
      }
    }
  } catch {
    // Best-effort overall; meta removal below still runs.
  }
  removeMeta(reciterId, surah);
}

/** True iff a meta entry exists for this surah+reciter. */
export async function isSurahDownloaded(
  reciterId: string,
  surah: number,
): Promise<boolean> {
  return readMeta().some((e) => e.surah === surah && e.reciter === reciterId);
}

/**
 * The playback integration point. A cached blob is preferred
 * (online or offline); otherwise the reciter's network URL.
 * The playback engine receives this function as its URL resolver;
 * this module must NOT import the engine (no circular import).
 */
export async function resolveListenUrl(
  reciterId: string,
  surah: number,
  ayah: number,
): Promise<string> {
  const cached = await getCachedClipUrl(reciterId, surah, ayah);
  if (cached !== null) return cached;
  const reciter = findReciter(reciterId);
  if (!reciter) throw new Error(`Unknown reciter: ${reciterId}`);
  return reciter.audioUrl(surah, ayah);
}

/**
 * IDB get by clipKey; returns a blob URL when a blob is found
 * and URL.createObjectURL exists, else null. NEVER throws — a
 * cache miss must never break playback.
 */
export async function getCachedClipUrl(
  reciterId: string,
  surah: number,
  ayah: number,
): Promise<string | null> {
  try {
    const stored = await getClip(clipKey(reciterId, surah, ayah));
    if (!stored || !stored.blob) return null;
    const urlObj = (globalThis as { URL?: typeof URL }).URL;
    if (!urlObj || typeof urlObj.createObjectURL !== 'function') return null;
    return urlObj.createObjectURL(stored.blob);
  } catch {
    return null;
  }
}
