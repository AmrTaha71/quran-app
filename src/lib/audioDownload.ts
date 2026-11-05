// audioDownload.ts — opt-in offline audio downloads for the
// "استمع للقرآن" material that streams today: tafsir clips
// (King Fahd Complex recording, via TAFSIR_AUDIO_BASE) and the
// Juhani hadr surah files (cdn.islamic.network, also the voice
// of the self-test corrections). Per-surah granularity ONLY —
// a full khatma is ~500MB-1GB and a single Juhani Baqarah file
// is ~96MB, so the user downloads a little at a time.
//
// STORAGE: Cache API, two caches (keep-listed in public/sw.js —
// NEVER let the SW activate handler delete them, or a deploy
// would wipe the user's downloads). The SW fetch handler serves
// these URLs cache-first (with Range support for media seeking),
// so playback needs NO code change: the audio elements keep
// asking for the same URLs and get the cached file offline.
// Streamed audio is NEVER stored here: the SW only SERVES what
// the download UI wrote; it never caches a streamed response.
//
// CORS (verified by live fetch, 2026-11-05):
// - Tafsir host (Supabase storage) sends Access-Control-Allow-Origin: *,
//   so a CORS fetch works, res.ok is checkable, and HEAD gives a
//   real Content-Length for an exact size estimate.
// - cdn.islamic.network sends NO Access-Control-Allow-Origin on
//   either the ayah-audio or the surah-file path, so a CORS fetch
//   is rejected outright. The Juhani file is therefore fetched
//   with mode 'no-cors' and stored opaque (same discipline as
//   pageDownload's unverified Mushaf pages): no status is
//   checkable, so the download is VERIFIED afterwards by probing
//   the cached copy's audio metadata — an error page has no
//   playable duration, so a bad download is deleted, never kept.
//   Size is estimated from that same duration probe (128kbps
//   ≈ 16KB/s); exact bytes are counted only when the response
//   body is readable during the download.
//
// DISCIPLINE (mirrors listenOffline.ts / pageDownload.ts):
// - Nothing downloads on its own: every download is a user tap.
// - Meta is written ONLY on full success, so meta presence
//   implies completeness — isAudioDownloaded trusts meta alone.
// - A failed run keeps whatever it already cached (resume on
//   retry skips cached URLs) but writes NO meta.
// - Read paths never throw: a cache miss degrades to "not
//   downloaded", never to a broken UI.
// - Self-test LIVE recognition still needs internet (honest
//   boundary — the mic pipeline is Apple's servers in a web
//   app). Downloads cover listening + Juhani corrections only.

import { tafsirClipUrl, tafsirConfigured } from './threeModeListen';
import { juhaniSurahUrl } from './juhaniCorr';
import { SURAH_AYAH_COUNTS } from './surahs';
import {
  estimateDownloadStorage,
  requestPersistentStorage,
  isQuotaError,
  STORAGE_PREFLIGHT_MARGIN,
} from './pageDownload';
import { formatApproxSize } from './listenOffline';

export type AudioDownloadKind = 'tafsir' | 'juhani';

export interface AudioDownloadMeta {
  kind: AudioDownloadKind;
  surah: number;
  /** Clips for tafsir (ayah count), 1 for a Juhani surah file. */
  count: number;
  /** Exact bytes when known; null when only an estimate exists. */
  bytes: number | null;
  downloadedAt: number;
}

/** Cache names — MUST match the constants in public/sw.js. */
export const AUDIO_TAFSIR_CACHE = 'quran-audio-tafsir';
export const AUDIO_JUHANI_CACHE = 'quran-audio-juhani';

const META_KEY = 'quran-audio-downloads';

export const AUDIO_DOWNLOAD_FAILED_MESSAGE =
  'تعذر تحميل الصوت — تحقق من الاتصال وحاول تاني';
export const AUDIO_QUOTA_MESSAGE =
  'مساحة جهازك لا تكفي — فضّي مساحة وحاول تاني';

/** 128kbps = 16,000 bytes per second of audio. */
const JUHANI_BYTES_PER_SECOND = 16000;
/** Per-clip fetch timeout (small files, same as Mushaf pages). */
const CLIP_FETCH_TIMEOUT_MS = 20000;
/** Juhani single-file download has no per-fetch timeout: a 96MB
 *  file legitimately takes minutes on a slow connection, and the
 *  caller passes an AbortSignal for the stop button instead. */
const AUDIO_PROBE_TIMEOUT_MS = 10000;

export function audioDownloadSupported(): boolean {
  try {
    return typeof caches !== 'undefined' && 'caches' in window;
  } catch {
    return false;
  }
}

function cacheName(kind: AudioDownloadKind): string {
  return kind === 'tafsir' ? AUDIO_TAFSIR_CACHE : AUDIO_JUHANI_CACHE;
}

function ayahCount(surah: number): number {
  if (!Number.isInteger(surah) || surah < 1 || surah > SURAH_AYAH_COUNTS.length) return 0;
  return SURAH_AYAH_COUNTS[surah - 1];
}

export function tafsirSurahUrls(surah: number): string[] {
  if (!tafsirConfigured()) return [];
  const count = ayahCount(surah);
  const urls: string[] = [];
  for (let ayah = 1; ayah <= count; ayah++) {
    const url = tafsirClipUrl(surah, ayah);
    if (url) urls.push(url);
  }
  return urls;
}

export function juhaniSurahFileUrl(surah: number): string {
  return juhaniSurahUrl(surah);
}

// --- Metadata (localStorage, repo pattern: try/catch, swallow) ---

export function isValidAudioDownloadMeta(entry: unknown): entry is AudioDownloadMeta {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Partial<AudioDownloadMeta>;
  return (
    (e.kind === 'tafsir' || e.kind === 'juhani') &&
    typeof e.surah === 'number' &&
    Number.isFinite(e.surah) &&
    typeof e.count === 'number' &&
    Number.isFinite(e.count) &&
    (typeof e.bytes === 'number' || e.bytes === null) &&
    typeof e.downloadedAt === 'number' &&
    Number.isFinite(e.downloadedAt)
  );
}

export function parseAudioDownloads(raw: string | null): AudioDownloadMeta[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidAudioDownloadMeta);
  } catch {
    return [];
  }
}

function readMeta(): AudioDownloadMeta[] {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) return [];
    return parseAudioDownloads(storage.getItem(META_KEY));
  } catch {
    return [];
  }
}

function writeMeta(entries: AudioDownloadMeta[]): void {
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  if (!storage) return;
  storage.setItem(META_KEY, JSON.stringify(entries));
}

function upsertMeta(meta: AudioDownloadMeta): void {
  try {
    const entries = readMeta().filter(
      (e) => !(e.kind === meta.kind && e.surah === meta.surah),
    );
    entries.push(meta);
    writeMeta(entries);
  } catch {
    // A meta-write failure must not leave a badge for an
    // unrecorded download — rethrow so the caller rolls back.
    throw new Error(AUDIO_DOWNLOAD_FAILED_MESSAGE);
  }
}

function removeMeta(kind: AudioDownloadKind, surah: number): void {
  try {
    const entries = readMeta().filter(
      (e) => !(e.kind === kind && e.surah === surah),
    );
    writeMeta(entries);
  } catch {
    // Best-effort: delete path swallows failures.
  }
}

export function listAudioDownloads(): AudioDownloadMeta[] {
  return readMeta();
}

export function isAudioDownloaded(kind: AudioDownloadKind, surah: number): boolean {
  return readMeta().some((e) => e.kind === kind && e.surah === surah);
}

/** Sum of the KNOWN sizes only; null sizes contribute 0. */
export function audioDownloadsTotalBytes(): number {
  return readMeta().reduce((sum, e) => sum + (e.bytes ?? 0), 0);
}

export function audioDownloadsHaveUnknownSize(): boolean {
  return readMeta().some((e) => e.bytes === null);
}

// --- Helpers ---------------------------------------------------------

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

/**
 * Audio metadata probe (same pattern as threeModePlayback's
 * private probeAudioMetadata, local here so this module stays
 * independent): duration in seconds, or null when the file is
 * not playable audio. Used to verify a Juhani download (the
 * opaque response carries no status) and to estimate its size.
 * The probe goes through the SW when it controls the page, so
 * it verifies the CACHED copy, not just the network file.
 */
export function probeAudioDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    let el: HTMLAudioElement | null = null;
    let done = false;
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      try {
        if (el) {
          el.removeAttribute('src');
          el.load();
        }
      } catch { /* ignore */ }
      resolve(v);
    };
    try {
      el = new Audio();
      el.preload = 'metadata';
      el.addEventListener('loadedmetadata', () => {
        const d = el?.duration;
        finish(typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null);
      });
      el.addEventListener('error', () => finish(null));
      el.src = url;
    } catch {
      finish(null);
      return;
    }
    setTimeout(() => finish(null), AUDIO_PROBE_TIMEOUT_MS);
  });
}

// --- Size estimates (HEAD / probe — never downloads bodies) -------

export interface AudioSizeEstimate {
  bytes: number | null;
  count: number;
}

/**
 * Tafsir: HEAD each clip (CORS works on the Supabase host) and
 * sum Content-Length. Any failed HEAD → bytes null (UI shows
 * 'حجم غير معروف' and still allows download with live progress).
 */
export async function estimateTafsirSurah(
  surah: number,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<AudioSizeEstimate> {
  const urls = tafsirSurahUrls(surah);
  if (urls.length === 0) return { bytes: null, count: 0 };
  try {
    const sizes = await Promise.all(
      urls.map(async (url) => {
        const res = await fetchFn(url, { method: 'HEAD' });
        if (!res.ok) return null;
        const len = res.headers.get('content-length');
        if (len === null) return null;
        const n = Number(len);
        return Number.isFinite(n) && n >= 0 ? n : null;
      }),
    );
    if (sizes.some((s) => s === null)) return { bytes: null, count: urls.length };
    return {
      bytes: (sizes as number[]).reduce((a, b) => a + b, 0),
      count: urls.length,
    };
  } catch {
    return { bytes: null, count: urls.length };
  }
}

/**
 * Juhani: no CORS on islamic.network, so no readable HEAD.
 * Estimate from the audio duration instead (128kbps ≈ 16KB/s).
 */
export async function estimateJuhaniSurah(surah: number): Promise<AudioSizeEstimate> {
  const seconds = await probeAudioDuration(juhaniSurahFileUrl(surah));
  if (seconds === null) return { bytes: null, count: 1 };
  return { bytes: Math.round(seconds * JUHANI_BYTES_PER_SECOND), count: 1 };
}

// --- Space preflight (reuses the Mushaf download's estimator) -----

export interface AudioSpaceCheck {
  status: 'ok' | 'low' | 'unknown';
  neededMB: number;
  freeMB: number | null;
  persisted: boolean | null;
}

/** `alreadyBytes` is the size of the part already cached (0 for
 *  a fresh download) so a resume/top-up is judged on what is
 *  left, not the full size. 'unknown' never refuses a download. */
export async function checkAudioDownloadSpace(
  neededBytes: number | null,
  alreadyBytes = 0,
): Promise<AudioSpaceCheck> {
  const neededMB = Math.ceil(
    (Math.max(0, (neededBytes ?? 0) - alreadyBytes) / 1048576) * STORAGE_PREFLIGHT_MARGIN,
  );
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

export { requestPersistentStorage };

/** Human size for the UI — shared formatter from listenOffline. */
export function formatAudioSize(bytes: number | null): string {
  return formatApproxSize(bytes);
}

// --- Downloads -------------------------------------------------------

export interface AudioDownloadProgress {
  done: number;
  total: number;
}

function quotaOrFailed(e: unknown): Error {
  return new Error(isQuotaError(e) ? AUDIO_QUOTA_MESSAGE : AUDIO_DOWNLOAD_FAILED_MESSAGE);
}

/**
 * Download one surah's tafsir clips. Resumes: clips already in
 * the cache are skipped. 4-way fetch, like the Mushaf download.
 * On ANY failure: partial clips stay cached for resume, NO meta
 * is written, and the Arabic error is thrown.
 */
export async function downloadTafsirSurah(
  surah: number,
  onProgress?: (p: AudioDownloadProgress) => void,
  opts?: { signal?: AbortSignal },
): Promise<AudioDownloadMeta> {
  const urls = tafsirSurahUrls(surah);
  if (urls.length === 0) throw new Error(AUDIO_DOWNLOAD_FAILED_MESSAGE);
  const cache = await caches.open(cacheName('tafsir'));
  const stopped = () => !!opts?.signal?.aborted;
  let done = 0;
  let bytes = 0;
  let bytesKnown = true;
  const report = () => onProgress?.({ done, total: urls.length });
  const CONCURRENCY = 4;
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      if (stopped()) return;
      const url = urls[next++];
      const existing = await cache.match(url);
      if (existing) {
        // Resumed clip: count its stored size when readable.
        const len = existing.headers.get('content-length');
        const n = len === null ? NaN : Number(len);
        if (Number.isFinite(n) && n >= 0) bytes += n;
        else bytesKnown = false;
        done++;
        report();
        continue;
      }
      let res: Response;
      try {
        res = await fetchWithTimeout(url, 'cors', opts?.signal, CLIP_FETCH_TIMEOUT_MS);
      } catch (e) {
        if (stopped()) return;
        throw e;
      }
      if (stopped()) return;
      if (!res.ok) throw new Error(AUDIO_DOWNLOAD_FAILED_MESSAGE);
      const len = res.headers.get('content-length');
      const n = len === null ? NaN : Number(len);
      if (Number.isFinite(n) && n >= 0) bytes += n;
      else bytesKnown = false;
      try {
        await cache.put(url, res);
      } catch (e) {
        if (stopped()) return;
        throw quotaOrFailed(e);
      }
      done++;
      report();
    }
  };
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  } catch (e) {
    if (stopped()) throw new Error(AUDIO_DOWNLOAD_FAILED_MESSAGE);
    throw quotaOrFailed(e);
  }
  if (stopped()) throw new Error(AUDIO_DOWNLOAD_FAILED_MESSAGE);
  const meta: AudioDownloadMeta = {
    kind: 'tafsir',
    surah,
    count: urls.length,
    bytes: bytesKnown ? bytes : null,
    downloadedAt: Date.now(),
  };
  upsertMeta(meta);
  return meta;
}

/**
 * Download one Juhani surah file. islamic.network sends no CORS
 * headers, so the fetch is mode 'no-cors' (opaque): the response
 * carries no status, so after storing it the cached copy is
 * VERIFIED by probing its audio duration — an error page has no
 * playable duration, so a bad download is deleted, never kept.
 * Exact bytes are counted only when the response body is
 * readable during the download; otherwise the meta size comes
 * from the duration probe (≈16KB/s at 128kbps).
 */
export async function downloadJuhaniSurah(
  surah: number,
  onProgress?: (p: AudioDownloadProgress) => void,
  opts?: { signal?: AbortSignal },
): Promise<AudioDownloadMeta> {
  const url = juhaniSurahFileUrl(surah);
  const cache = await caches.open(cacheName('juhani'));
  const stopped = () => !!opts?.signal?.aborted;
  onProgress?.({ done: 0, total: 1 });
  const existing = await cache.match(url);
  let bytes: number | null = null;
  if (!existing) {
    let res: Response;
    try {
      // No timeout: a 96MB file legitimately takes minutes on a
      // slow connection; the caller's AbortSignal is the stop.
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      if (opts?.signal) {
        if (opts.signal.aborted) ctrl.abort();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        res = await fetch(url, { mode: 'no-cors', signal: ctrl.signal });
      } finally {
        if (opts?.signal) opts.signal.removeEventListener('abort', onAbort);
      }
    } catch (e) {
      if (stopped()) throw new Error(AUDIO_DOWNLOAD_FAILED_MESSAGE);
      throw quotaOrFailed(e);
    }
    if (stopped()) throw new Error(AUDIO_DOWNLOAD_FAILED_MESSAGE);
    // Count exact bytes when the body is readable, and store a
    // fresh Response built from the bytes (keeps real headers
    // for the SW's Range slicing). When the body is unreadable
    // (opaque), store the response as-is — the SW still serves
    // it whole to the audio element. The clone is taken BEFORE
    // any body read: a failed stream leaves the original
    // disturbed, so the fallback put uses the pristine clone.
    const resForPut = res.clone();
    let stored = false;
    try {
      if (res.body) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          if (stopped()) throw new Error(AUDIO_DOWNLOAD_FAILED_MESSAGE);
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            total += value.length;
          }
        }
        bytes = total;
        await cache.put(
          url,
          new Response(new Blob(chunks as BlobPart[], { type: 'audio/mpeg' }), {
            headers: { 'Content-Type': 'audio/mpeg' },
          }),
        );
        stored = true;
      }
    } catch (e) {
      if (stopped()) throw new Error(AUDIO_DOWNLOAD_FAILED_MESSAGE);
      // Streaming read failed: fall through to the plain put of
      // the pristine clone below (a fresh fetch is NOT attempted
      // — retry resumes from the stored copy).
      void e;
      stored = false;
    }
    if (!stored) {
      try {
        await cache.put(url, resForPut);
      } catch (e) {
        if (stopped()) throw new Error(AUDIO_DOWNLOAD_FAILED_MESSAGE);
        throw quotaOrFailed(e);
      }
    }
    onProgress?.({ done: 1, total: 1 });
  }
  // Verify the cached copy is real audio (see header). The probe
  // goes through the SW, so it checks the cached bytes.
  const seconds = await probeAudioDuration(url);
  if (stopped()) throw new Error(AUDIO_DOWNLOAD_FAILED_MESSAGE);
  if (seconds === null || seconds <= 0) {
    try { await cache.delete(url); } catch { /* best-effort */ }
    throw new Error(AUDIO_DOWNLOAD_FAILED_MESSAGE);
  }
  if (bytes === null) bytes = Math.round(seconds * JUHANI_BYTES_PER_SECOND);
  const meta: AudioDownloadMeta = {
    kind: 'juhani',
    surah,
    count: 1,
    bytes,
    downloadedAt: Date.now(),
  };
  upsertMeta(meta);
  return meta;
}

/**
 * Best-effort: deletes the cached files for this kind+surah and
 * removes the meta entry. Failures are swallowed, but the meta
 * entry is still removed so the UI stops showing the badge.
 */
export async function deleteAudioDownload(
  kind: AudioDownloadKind,
  surah: number,
): Promise<void> {
  try {
    const cache = await caches.open(cacheName(kind));
    if (kind === 'tafsir') {
      for (const url of tafsirSurahUrls(surah)) {
        try { await cache.delete(url); } catch { /* best-effort */ }
      }
    } else {
      try { await cache.delete(juhaniSurahFileUrl(surah)); } catch { /* best-effort */ }
    }
  } catch {
    // Best-effort overall; meta removal below still runs.
  }
  removeMeta(kind, surah);
}
