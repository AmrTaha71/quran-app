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
import { JUHANI_TIMINGS_JUZ30, JUHANI_RANGE_OK_SURAHS_JUZ30 } from './juhaniManifestJuz30';

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
function timingsFor(surah: number, ayah: number): number[] | null {
  const t = JUHANI_TIMINGS_JUZ30[key(surah, ayah)];
  return t ?? null;
}

function timingsShapeOk(t: number[], wordCount: number): boolean {
  if (t.length !== wordCount * 2) return false;
  let prev = 0;
  for (let i = 0; i < t.length; i++) {
    const v = t[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return false;
    if (v < prev) return false; // starts/ends must be non-decreasing
    prev = v;
  }
  for (let w = 0; w < wordCount; w++) {
    if (t[2 * w + 1] <= t[2 * w]) return false; // each word has positive length
  }
  return true;
}

/** True only when a Juhani window may be served for this ayah.
 *  `wordCount` is the APP's word count for the ayah (the length of
 *  expectedWordList), so numbering parity is enforced at runtime too. */
export function isJuhaniCorrEnabled(surah: number, ayah: number, wordCount: number): boolean {
  if (!rangeOkSurahs.has(surah)) return false;
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
  tStart: number; // seconds in the surah file
  tEnd: number;
}

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
    const tStart = t[2 * s.start];
    const tEnd = t[2 * s.end + 1];
    if (!(tEnd - tStart >= MIN_WINDOW_S)) return null;
    segments.push({ start: s.start, end: s.end, tStart, tEnd });
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
  segments: { tStart: number; tEnd: number }[];
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
              else later(playSegment, SEGMENT_GAP_MS);
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
      if (a.src !== args.url) a.src = args.url;
      a.preload = 'auto';
      a.load();
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
