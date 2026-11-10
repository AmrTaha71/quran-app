// Juhani 3-word correction windows (spec Rev. 3).
//
// STATUS: NOT COMPILED, NOT RUN. Written against the real
// refWordUnits.ts / hadr.ts / SelfTestPage.tsx text, never executed.
// Muse verifies with tsc + a device test before merging.
//
// WHAT THIS MODULE IS: retrieval, not generation. A correction is
// Juhani's hadr recitation (lib/hadr.ts surah file) played by SEEKING
// to the 3-word window containing the mistaken word and stopping at
// the window end. Nothing is stored per window: the generated
// manifest holds PER-WORD timings only; windows are derived here, via
// refUnitForWord (the ONE window scheme: overlapping 3-word windows,
// even starts 0,2,4..., mistaken word preferably in the middle, then
// last, then first, final window truncated at the ayah end).
//
// SAFETY CONTRACT (never relaxed):
//  - isJuhaniCorrEnabled() is the only gate. It returns false unless
//    the ayah is in the generated manifest (QA-passed), its surah file
//    passed the range probe, AND the manifest word count equals the
//    app's own word count for that ayah. False => the caller uses the
//    existing generated path. Never a silent wrong window.
//  - A misaligned window plays cleanly and teaches the WRONG words, so
//    nothing low-confidence ever enters the manifest (see
//    tools/juhani-align). This module also re-validates shape at runtime.

import { refUnitForWord } from './refWordUnits';
import { hadrAudioUrl } from './hadr';
import { JUHANI_RANGE_OK_SURAHS_JUZ30 } from './juhaniManifestJuz30';
import { CORR_TIMING_RUNS } from './corrTimingCoverage';
import { getGlobalAyahNumber } from './surahs';

// ------------------------------------------------------------------
// Correction timing setting (replaces the 2-10s stepper).
// ------------------------------------------------------------------

export type CorrDelayMode = '1s' | '3s' | '5s' | 'ayah-end';

export const CORR_DELAY_MODES: CorrDelayMode[] = ['1s', '3s', '5s', 'ayah-end'];

export const CORR_DELAY_MODE_LABEL: Record<CorrDelayMode, string> = {
  '1s': 'بعد ثانية',
  '3s': 'بعد 3 ثوانٍ',
  '5s': 'بعد 5 ثوانٍ',
  'ayah-end': 'في نهاية الآية',
};

export const CORR_DELAY_MODE_DEFAULT: CorrDelayMode = '1s';

/** Stored value -> mode. Numeric legacy values (the old corrDelay
 *  stepper, clamped 2..10): 1-2 -> '1s', 3 -> '3s', 4+ -> '5s'.
 *  Missing / invalid -> '3s'. */
export function migrateCorrDelayMode(raw: unknown): CorrDelayMode {
  if (raw === '1s' || raw === '3s' || raw === '5s' || raw === 'ayah-end') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.round(raw);
    if (n < 1) return CORR_DELAY_MODE_DEFAULT;
    if (n <= 2) return '1s';
    if (n === 3) return '3s';
    return '5s';
  }
  return CORR_DELAY_MODE_DEFAULT;
}

/** The numeric seconds that the rest of SelfTestPage still reads as
 *  `corrDelay` (window length, countdown, continuous stall threshold,
 *  recorder/diag schema). 'ayah-end' maps to 3: it is the grace window
 *  for the paths that still need one (see correctionWindowSeconds). */
export function corrDelaySeconds(mode: CorrDelayMode): number {
  switch (mode) {
    case '1s': return 1;
    case '5s': return 5;
    default: return 3;
  }
}

/** Ayah complete with errors in 'ayah-end' mode: just enough time for
 *  the buzz to be heard before the correction. */
export const AYAH_END_COMPLETE_WAIT_S = 1;
/** Ayah NOT complete (quiet gap) in 'ayah-end' mode: the old grace. */
export const AYAH_END_GRACE_S = 3;

/** Length of the self-correction window that opens on a detected
 *  mistake. Only 'ayah-end' + a Juhani-enabled ayah changes anything:
 *  complete ayah -> 1s, incomplete -> 3s. Every other case returns the
 *  user's base seconds, i.e. exactly today's behaviour. */
export function correctionWindowSeconds(
  mode: CorrDelayMode,
  baseSeconds: number,
  juhaniEnabled: boolean,
  ayahComplete: boolean,
): number {
  if (mode !== 'ayah-end' || !juhaniEnabled) return baseSeconds;
  return ayahComplete ? AYAH_END_COMPLETE_WAIT_S : AYAH_END_GRACE_S;
}

// ------------------------------------------------------------------
// Manifest lookup + gate.
// ------------------------------------------------------------------

/** Max correction segments per ayah (D2). The rest stay red on screen. */
export const MAX_JUHANI_SEGMENTS = 3;

/** Shortest believable window (seconds). Anything shorter is an
 *  alignment artefact and must not be played. */
const MIN_WINDOW_S = 0.12;

const rangeOkSurahs = new Set<number>(JUHANI_RANGE_OK_SURAHS_JUZ30);

const key = (surah: number, ayah: number): string => `${surah}:${ayah}`;

/** Flat per-word timings [s0,e0,s1,e1,...] in seconds, or null. */
// ------------------------------------------------------------------
// Ready-made correction reciters (2026-11-08). Word timings from
// cpfair/quran-align (CC BY 4.0), for EveryAyah per-ayah recordings,
// whole Quran. Files: public/corr-timings/<folder>.json, map
// "surah:ayah" -> flat [s0,e0,s1,e1,...] seconds within the AYAH file.
// When one is active it replaces the Juhani juz-30 manifest everywhere
// (timings, enable check, audio URL), so the rest of the correction
// engine is unchanged.
// ------------------------------------------------------------------
export const CORR_RECITERS: { folder: string; name: string }[] = [
  { folder: 'Minshawy_Murattal_128kbps', name: 'المنشاوي (مرتل)' },
  { folder: 'Husary_64kbps', name: 'الحصري (مرتل)' },
  { folder: 'Abdul_Basit_Murattal_64kbps', name: 'عبد الباسط (مرتل)' },
  { folder: 'Alafasy_128kbps', name: 'العفاسي' },
  { folder: 'Mohammad_al_Tablaway_128kbps', name: 'الطبلاوي' },
  { folder: 'Saood_ash-Shuraym_128kbps', name: 'الشريم' },
  { folder: 'Abu_Bakr_Ash-Shaatree_128kbps', name: 'الشاطري' },
  { folder: 'Hani_Rifai_192kbps', name: 'هاني الرفاعي' },
];
export const CORR_RECITER_KEY = 'quran-corr-reciter';
export const CORR_RECITER_DEFAULT = 'Minshawy_Murattal_128kbps';

let activeCorr: { folder: string; map: Record<string, number[]> } | null = null;
let loadingFolder: string | null = null;
// Loaded timing maps, kept per reciter (2026-11-10): switching reciter
// (the user's choice, or a split range that changes reciter per ayah)
// re-activates a loaded map at once instead of refetching ~880 KB and
// leaving the first ayahs after the switch with no word timings.
const corrMaps = new Map<string, Record<string, number[]>>();

export function getCorrReciter(): string {
  try {
    const v = localStorage.getItem(CORR_RECITER_KEY);
    if (v && CORR_RECITERS.some((r) => r.folder === v)) return v;
  } catch { /* ignore */ }
  return CORR_RECITER_DEFAULT;
}

/** Loads (once) and activates the chosen reciter's timings. */
export async function loadCorrReciter(folder: string = getCorrReciter()): Promise<void> {
  if (activeCorr?.folder === folder || loadingFolder === folder) return;
  const cached = corrMaps.get(folder);
  if (cached) { activeCorr = { folder, map: cached }; return; }
  loadingFolder = folder;
  try {
    const res = await fetch(`/corr-timings/${folder}.json`);
    if (!res.ok) { if (loadingFolder === folder) activeCorr = { folder, map: {} }; return; }
    const map = (await res.json()) as Record<string, number[]>;
    corrMaps.set(folder, map);
    if (loadingFolder === folder) activeCorr = { folder, map };
  } catch { /* offline: whole-ayah fallback still uses this reciter */ } finally {
    if (loadingFolder === folder) loadingFolder = null;
  }
}

export function setCorrReciter(folder: string): void {
  try { localStorage.setItem(CORR_RECITER_KEY, folder); } catch { /* ignore */ }
  const cached = corrMaps.get(folder);
  activeCorr = cached ? { folder, map: cached } : null;
  if (!cached) void loadCorrReciter(folder);
}

/** Load several reciters' timings ahead of a test whose range changes
 *  reciter part-way, so no switch waits on the network. */
export function preloadCorrTimings(folders: string[]): void {
  for (const f of folders) {
    if (corrMaps.has(f)) continue;
    void fetch(`/corr-timings/${f}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => { if (m && !corrMaps.has(f)) corrMaps.set(f, m as Record<string, number[]>); })
      .catch(() => { /* offline: loadCorrReciter retries on switch */ });
  }
}

// ---- Stand-in reciter for the few untimed ayahs (owner, 2026-11-10) ----
// Every reciter's timing file lacks a handful of ayahs (9 to 26 of 6236).
// For exactly those ayahs the correction comes from the first other
// reciter (list order) who has word timings for the ayah, so the reciter
// still hears three words, not the whole ayah. No ayah is untimed for
// every reciter, so a stand-in always exists.
function hasTimingRun(folder: string, g: number): boolean {
  const runs = CORR_TIMING_RUNS[folder];
  if (!runs) return false;
  for (const [a, b] of runs) if (a <= g && g <= b) return true;
  return false;
}
/** The reciter whose file and timings serve this ayah when `chosen` is
 *  the user's reciter: `chosen` itself, or its stand-in for an untimed ayah. */
export function corrSourceFolder(chosen: string, surah: number, ayah: number): string {
  const g = getGlobalAyahNumber(surah, ayah);
  if (hasTimingRun(chosen, g)) return chosen;
  for (const r of CORR_RECITERS) if (r.folder !== chosen && hasTimingRun(r.folder, g)) return r.folder;
  return chosen;
}
/** Stand-in reciters a test over these ayahs will need: load their
 *  timings before the test instead of at the first mistake. */
export function preloadCorrStandIns(ayahs: { surah_no: number; ayah_no: number }[]): void {
  const chosen = getCorrReciter();
  const need = new Set<string>();
  for (const a of ayahs) {
    const f = corrSourceFolder(chosen, a.surah_no, a.ayah_no);
    if (f !== chosen) need.add(f);
  }
  if (need.size > 0) preloadCorrTimings(Array.from(need));
}

/** EveryAyah per-ayah file of the correction reciter for this ayah (the
 *  chosen one, or his stand-in for an ayah he has no timings for). */
export function corrAyahUrl(surah: number, ayah: number): string {
  const p3 = (n: number) => String(n).padStart(3, '0');
  return `https://everyayah.com/data/${corrSourceFolder(getCorrReciter(), surah, ayah)}/${p3(surah)}${p3(ayah)}.mp3`;
}

function timingsFor(surah: number, ayah: number): number[] | null {
  // The audio is ALWAYS the chosen reciter's per-ayah file (corrAyahUrl),
  // so only that reciter's own timings may cut it. Before this guard
  // (2026-11-10), while the timing file was still loading — at startup,
  // right after a reciter switch, or after a failed fetch — the Juhani
  // surah-file timings were applied to another reciter's per-ayah file:
  // the wrong words, or silence, in Juz 30. No timings now means the
  // caller's whole-ayah fallback, in the right voice.
  const chosen = getCorrReciter();
  const src = corrSourceFolder(chosen, surah, ayah);
  if (src !== chosen) {
    // Untimed ayah for the chosen reciter: the stand-in's timings (the
    // URL is the stand-in's file too, see corrAyahUrl).
    const m = corrMaps.get(src);
    if (!m) { preloadCorrTimings([src]); return null; }
    return m[key(surah, ayah)] ?? null;
  }
  if (activeCorr && activeCorr.folder === chosen) return activeCorr.map[key(surah, ayah)] ?? null;
  return null;
}

/** Ayah-level gate: the timing row must have exactly one [start,end]
 *  pair per app word, all finite. Ordering is checked per WINDOW
 *  (windowShapeOk), so one bad pair elsewhere in a long ayah no longer
 *  throws away every good window of that ayah (2026-11-10). */
function timingsShapeOk(t: number[], wordCount: number): boolean {
  if (t.length !== wordCount * 2) return false;
  for (let i = 0; i < t.length; i++) {
    const v = t[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return false;
  }
  return true;
}

/** A word longer than this is an alignment failure, not a word. */
const MAX_WORD_S = 15;

/** Words start..end (inclusive) are in order, each of positive and
 *  plausible length. */
function windowShapeOk(t: number[], start: number, end: number): boolean {
  let prev = start > 0 ? t[2 * start - 1] : 0;
  // The previous word's end may legitimately equal this start.
  if (!(prev <= t[2 * start] + 0.001)) prev = t[2 * start];
  for (let w = start; w <= end; w++) {
    const a = t[2 * w];
    const b = t[2 * w + 1];
    if (a + 0.001 < prev) return false;
    if (!(b > a) || b - a > MAX_WORD_S) return false;
    prev = b;
  }
  return true;
}

/** True only when a Juhani window may be served for this ayah.
 *  `wordCount` is the APP's word count for the ayah (the length of
 *  expectedWordList), so numbering parity is enforced at runtime too. */
export function isJuhaniCorrEnabled(surah: number, ayah: number, wordCount: number): boolean {
  if (!activeCorr && !rangeOkSurahs.has(surah)) return false;
  const t = timingsFor(surah, ayah);
  if (!t) return false;
  return timingsShapeOk(t, wordCount);
}

/** Per-ayah Juhani file (same AlQuranCloud edition as the hadr surah
 *  file), by global ayah number 1..6236. Used when an ayah has no
 *  word timings: the whole ayah plays in Juhani's voice instead of a
 *  generated voice (2026-11-08). */
export function juhaniAyahUrl(globalAyah: number): string {
  return `https://cdn.islamic.network/quran/audio/128/ar.abdullahawadaljuhani/${globalAyah}.mp3`;
}

/** Whole-file plan for a per-ayah file: one segment from 0 to the end
 *  (the player also stops on `ended`). */
export function wholeAyahPlan(wordCount: number): JuhaniPlan {
  return { segments: [{ start: 0, end: Math.max(0, wordCount - 1), tStart: 0, tEnd: 120 }], truncated: false };
}

export function juhaniSurahUrl(surah: number): string {
  return hadrAudioUrl(surah);
}

/** Start time (seconds in the surah file) of an ayah's first word,
 *  or null when the ayah has no manifest timings. Warm-up only:
 *  callers must still gate playback on isJuhaniCorrEnabled. */
export function juhaniAyahStartTime(surah: number, ayah: number): number | null {
  const t = timingsFor(surah, ayah);
  if (!t || t.length === 0) return null;
  return t[0];
}

// ------------------------------------------------------------------
// Window planning (pure).
// ------------------------------------------------------------------

export interface WordSpan {
  /** 0-based, inclusive, within the ayah (same indexing as refUnitForWord). */
  start: number;
  end: number;
}

export interface JuhaniSegment extends WordSpan {
  tStart: number; // seconds in the audio file
  tEnd: number;
  /** Silence after this segment before the next one (default
   *  SEGMENT_GAP_MS). Short when the cut is the reciter's own pause. */
  gapAfterMs?: number;
}

const PRE_ROLL_S = 0.06;
const LAST_WORD_TAIL_S = 1.5;
const PAUSE_SPLIT_S = 0.7;
const INNER_PAUSE_GAP_MS = 220;

export interface JuhaniPlan {
  segments: JuhaniSegment[];
  /** True when more than MAX_JUHANI_SEGMENTS spans were needed. */
  truncated: boolean;
}

/** One refUnitForWord window per mistaken word, merged when they
 *  overlap or touch (adjacent mistakes -> ONE union window). */
export function mergedWordSpans(wordCount: number, wrongIdx: number[]): WordSpan[] {
  if (wordCount <= 0) return [];
  const uniq = Array.from(new Set(wrongIdx.filter((i) => Number.isInteger(i) && i >= 0 && i < wordCount)));
  uniq.sort((a, b) => a - b);
  const out: WordSpan[] = [];
  for (const w of uniq) {
    const u = refUnitForWord(wordCount, w);
    if (u.end < u.start) continue;
    const last = out[out.length - 1];
    if (last && u.start <= last.end + 1) {
      last.end = Math.max(last.end, u.end);
    } else {
      out.push({ start: u.start, end: u.end });
    }
  }
  return out;
}

/** Plan the correction audio for one ayah. Returns null when Juhani
 *  must not be used (gate fails, or any segment is implausible), so
 *  the caller falls back to the generated path as a whole. */
export function planJuhaniWindows(
  surah: number,
  ayah: number,
  wordCount: number,
  wrongIdx: number[],
): JuhaniPlan | null {
  if (!isJuhaniCorrEnabled(surah, ayah, wordCount)) return null;
  const t = timingsFor(surah, ayah);
  if (!t) return null;
  const spans = mergedWordSpans(wordCount, wrongIdx);
  if (spans.length === 0) return null;
  const truncated = spans.length > MAX_JUHANI_SEGMENTS;
  const used = spans.slice(0, MAX_JUHANI_SEGMENTS);
  const segments: JuhaniSegment[] = [];
  for (const s of used) {
    if (!windowShapeOk(t, s.start, s.end)) return null;
    if (!(t[2 * s.end + 1] - t[2 * s.start] >= MIN_WINDOW_S)) return null;
    // Cut the window wherever the reciter himself pauses inside it (a
    // breath, a waqf, sometimes followed by a repeat): playing straight
    // through made a 3-word correction last 10+ seconds for the slow
    // murattal reciters. Each piece plays, then a short beat instead of
    // the long silence.
    let from = s.start;
    for (let w = s.start; w <= s.end; w++) {
      const lastOfSpan = w === s.end;
      const pauseAfter = !lastOfSpan && t[2 * (w + 1)] - t[2 * w + 1] > PAUSE_SPLIT_S;
      if (!lastOfSpan && !pauseAfter) continue;
      // Pre-roll: the dataset's word starts are late as often as early
      // (mean error ~70ms), and a late start clips the first consonant.
      const tStart = Math.max(0, t[2 * from] - PRE_ROLL_S);
      // The ayah's last word runs to the end of the file (the player
      // stops on `ended`), so its final madd is never cut.
      const tEnd = w === wordCount - 1 ? t[2 * w + 1] + LAST_WORD_TAIL_S : t[2 * w + 1];
      segments.push({ start: from, end: w, tStart, tEnd, ...(pauseAfter ? { gapAfterMs: INNER_PAUSE_GAP_MS } : {}) });
      from = w + 1;
    }
  }
  return { segments, truncated };
}

// ------------------------------------------------------------------
// Range player: one reusable <audio>, polled stop, rate-aware.
// ------------------------------------------------------------------

/** The window end must be accurate to ~±50ms with NO audible spill
 *  into the next word. `timeupdate` (~250ms) is far too coarse, so the
 *  stop is a 10ms poll with a small lead that covers poll latency +
 *  pause latency. media-time latency scales with playbackRate, hence
 *  the per-rate term. THESE TWO NUMBERS ARE QA-TUNABLE: ear-check
 *  window END edges (even-indexed words sit LAST in their window) at
 *  0.8 / 1.0 / 1.25 / 1.5 and adjust. */
const POLL_MS = 10;
const END_LEAD_BASE_S = 0.02;
const END_LEAD_PER_RATE_S = 0.01;
const LOAD_TIMEOUT_MS = 8000;
const SEEK_TIMEOUT_MS = 6000;
const SEGMENT_SLACK_MS = 6000;
/** Silence between two correction segments in one plan. Segments in
 *  a plan are non-adjacent by construction (mergedWordSpans merges
 *  touching windows), so without a gap two far-apart corrections
 *  sound like one continuous phrase. 800ms is unmistakably a break
 *  (a hadr inter-word gap is ~100-200ms) yet short. FIX B. */
const SEGMENT_GAP_MS = 800;

export interface JuhaniPlayArgs {
  url: string;
  segments: { tStart: number; tEnd: number; gapAfterMs?: number }[];
  rate: number;
  onStart?: () => void;
  onDone: () => void;
  /** Called AT MOST once, only when the audio could not be heard
   *  (load/seek/play failure). The caller must then fall back. */
  onFail: (reason: string) => void;
}

export interface JuhaniPlayer {
  /** Call inside a user gesture (the mic-start tap): iOS only lets an
   *  element play later from a timer if it was started by a gesture.
   *  Optionally warms the surah file's audio at `warmTime` (the ayah's
   *  first-word time) afterwards, so the first correction seek is fast. */
  unlock: (prewarmUrl?: string, warmTime?: number) => void;
  prewarm: (url: string, warmTime?: number) => void;
  play: (args: JuhaniPlayArgs) => void;
  stop: () => void;
  dispose: () => void;
}

function silentWavUrl(): string {
  // 0.1s of 8-bit mono silence, built at runtime (no base64 blob).
  const n = 800;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export function createJuhaniPlayer(): JuhaniPlayer {
  let el: HTMLAudioElement | null = null;
  let token = 0;
  let busy = false;
  let unlocked = false;
  let silentUrl: string | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const ensure = (): HTMLAudioElement => {
    if (!el) {
      el = new Audio();
      el.preload = 'metadata';
      try { (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true; } catch { /* ignore */ }
    }
    return el;
  };

  const clearTimers = () => {
    if (poll) { clearInterval(poll); poll = null; }
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
  };
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
    return t;
  };

  const applyRate = (a: HTMLAudioElement, rate: number) => {
    try {
      a.playbackRate = rate;
      a.preservesPitch = true;
      (a as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
    } catch { /* ignore */ }
  };

  const detach = (a: HTMLAudioElement) => {
    a.onloadedmetadata = null;
    a.onseeked = null;
    a.onerror = null;
    a.onplaying = null;
  };

  const stop = () => {
    token++;
    busy = false;
    clearTimers();
    if (el) {
      detach(el);
      try { el.pause(); } catch { /* ignore */ }
    }
  };

  const prewarm = (url: string, warmTime?: number) => {
    try {
      if (busy) return;
      const a = ensure();
      if (a.src !== url) {
        a.src = url;
        a.preload = 'auto';
        a.load();
      }
      // Warm the buffer at the ayah: once metadata is ready, seek the
      // paused element to the ayah's first word so the bytes around the
      // correction windows are fetched during the recitation, not at
      // expiry. One-shot; cleared by stop()/detach() (a.onloadedmetadata).
      if (warmTime != null && Number.isFinite(warmTime) && warmTime >= 0) {
        const seekWarm = () => {
          try {
            if (busy) return;
            if (a.src !== url) return;
            if (Math.abs(a.currentTime - warmTime) < 0.005) return;
            a.currentTime = warmTime;
          } catch { /* ignore */ }
        };
        if (a.readyState >= 1) {
          seekWarm();
        } else {
          a.onloadedmetadata = () => { a.onloadedmetadata = null; seekWarm(); };
        }
      }
    } catch { /* ignore */ }
  };

  const unlock = (prewarmUrl?: string, warmTime?: number) => {
    try {
      if (busy) return;
      const a = ensure();
      if (unlocked) { if (prewarmUrl) prewarm(prewarmUrl, warmTime); return; }
      if (!silentUrl) silentUrl = silentWavUrl();
      a.muted = true;
      a.src = silentUrl;
      const p = a.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          try { a.pause(); } catch { /* ignore */ }
          a.muted = false;
          unlocked = true;
          if (prewarmUrl) prewarm(prewarmUrl, warmTime);
        }).catch(() => { a.muted = false; });
      }
    } catch { /* ignore */ }
  };

  const play = (args: JuhaniPlayArgs) => {
    stop();
    const my = ++token;
    busy = true;
    const a = ensure();
    a.muted = false;
    const segs = args.segments;
    let i = 0;
    let started = false;
    let ended = false;
    let guard: ReturnType<typeof setTimeout> | null = null;

    const alive = () => my === token && !ended;
    const fail = (reason: string) => {
      if (!alive()) return;
      ended = true;
      stop();
      args.onFail(reason);
    };
    const finish = () => {
      if (!alive()) return;
      ended = true;
      busy = false;
      clearTimers();
      detach(a);
      try { a.pause(); } catch { /* ignore */ }
      args.onDone();
    };

    const seekTo = (t: number, cb: () => void) => {
      let settled = false;
      const go = () => { if (settled || !alive()) return; settled = true; a.onseeked = null; cb(); };
      if (Math.abs(a.currentTime - t) < 0.005) { go(); return; }
      a.onseeked = go;
      later(() => { if (!settled) fail('seek-timeout'); }, SEEK_TIMEOUT_MS);
      try { a.currentTime = t; } catch { fail('seek-failed'); }
    };

    const playSegment = () => {
      if (!alive()) return;
      if (i >= segs.length) { finish(); return; }
      const seg = segs[i];
      seekTo(seg.tStart, () => {
        if (!alive()) return;
        applyRate(a, args.rate);
        a.onplaying = () => { applyRate(a, args.rate); };
        const pr = a.play();
        const onPlayStarted = () => {
          if (!alive()) return;
          if (!started) { started = true; try { args.onStart?.(); } catch { /* ignore */ } }
          const lead = END_LEAD_BASE_S + END_LEAD_PER_RATE_S * a.playbackRate;
          poll = setInterval(() => {
            if (!alive()) return;
            if (a.currentTime >= seg.tEnd - lead || a.ended) {
              if (poll) { clearInterval(poll); poll = null; }
              if (guard) { clearTimeout(guard); timers.delete(guard); guard = null; }
              try { a.pause(); } catch { /* ignore */ }
              i++;
              if (i >= segs.length) finish();
              else later(playSegment, seg.gapAfterMs ?? SEGMENT_GAP_MS);
            }
          }, POLL_MS);
          // Whole-segment guard: media time / rate + slack.
          guard = later(() => { fail('segment-timeout'); }, ((seg.tEnd - seg.tStart) / Math.max(0.25, args.rate)) * 1000 + SEGMENT_SLACK_MS);
        };
        if (pr && typeof pr.then === 'function') {
          pr.then(onPlayStarted, (e: unknown) => fail('play-rejected:' + ((e as { name?: string })?.name || 'error')));
        } else {
          onPlayStarted();
        }
      });
    };

    const begin = () => {
      if (!alive()) return;
      if (a.readyState >= 1 && a.src === args.url) { playSegment(); return; }
      a.onloadedmetadata = () => { a.onloadedmetadata = null; playSegment(); };
      a.onerror = () => fail('load-error');
      later(() => { if (a.readyState < 1) fail('load-timeout'); }, LOAD_TIMEOUT_MS);
      // Do not restart a load that prewarm already has in flight for
      // this same file: load() again throws the fetched bytes away and
      // the correction starts later, not sooner.
      const sameSrc = a.src === args.url;
      if (!sameSrc) a.src = args.url;
      a.preload = 'auto';
      if (!sameSrc || a.error || a.networkState === 3 /* NETWORK_NO_SOURCE */) a.load();
    };
    begin();
  };

  const dispose = () => {
    stop();
    if (el) {
      try { el.removeAttribute('src'); el.load(); } catch { /* ignore */ }
      el = null;
    }
    if (silentUrl) { try { URL.revokeObjectURL(silentUrl); } catch { /* ignore */ } silentUrl = null; }
    unlocked = false;
  };

  return { unlock, prewarm, play, stop, dispose };
}

/** Raw word timings of any reciter (TV khatma highlight). Cached per folder. */
const rawTimingCache = new Map<string, Promise<Record<string, number[]> | null>>();
export function reciterWordTimings(folder: string, surah: number, ayah: number): Promise<number[] | null> {
  let pr = rawTimingCache.get(folder);
  if (!pr) {
    pr = fetch(`/corr-timings/${folder}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    rawTimingCache.set(folder, pr);
  }
  return pr.then((m) => (m ? m[key(surah, ayah)] ?? null : null));
}
export function reciterAyahUrl(folder: string, surah: number, ayah: number): string {
  const p3 = (n: number) => String(n).padStart(3, '0');
  return `https://everyayah.com/data/${folder}/${p3(surah)}${p3(ayah)}.mp3`;
}
