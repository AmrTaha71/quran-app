// 3.23 (2026-11-26): every tuned number of the on-device ears in one place,
// each with where it came from. Change one here only with a new measurement,
// and update earTuning.test.ts in the same commit (the test pins them so a
// change is never silent).

// --- Quran-Lab phoneme alignment (phonemeEar.ts) --------------------------
// Tuned 2026-11-14 on the offline replay set (~28k words of device
// recordings); not re-measured since.
/** Words before / after the pointer the aligner may match. */
export const ALIGN_BACK_WORDS = 15;
export const ALIGN_AHEAD_WORDS = 40;
/** Cost per heard sound skipped before the first expected word. */
export const ALIGN_LEAD_COST = 0.6;
/** An alignment costing more than max(MIN, RATIO * heard length) is rejected. */
export const ALIGN_REJECT_RATIO = 0.45;
export const ALIGN_REJECT_MIN = 3;

// --- Lobby mic check (micCheck.ts) ----------------------------------------
/** RMS above which the mic "heard you". An estimate from signal reasoning,
 *  NOT measured on a device yet — owner device check pending. */
export const MIC_CHECK_RMS_THRESHOLD = 0.015;

// --- Whisper ear speed (quranEar.ts / quranAsr.worker.ts) -----------------
// 2026-11-11: an Intel Mac diag showed ~15 s of model time per segment.
// Whisper always pads to a 30 s window, so one 3 s run measures the device.
export const SLOW_BENCH_MS = 2500;
export const SLOW_SEGMENT_MS = 3000;
/** A «slow device» mark is re-measured after this long (was: forever). */
export const SLOW_MARK_TTL_MS = 30 * 24 * 3600_000;

// 2026-11-12: decoder cap by audio length. ~12 tokens per second of Quran
// recitation (Arabic BPE, measured on the 2026-11-12 diag segments) + 10
// slack; never below 16 nor above 110 (a segment is at most ~7 s).
export const WHISPER_TOKENS_PER_SEC = 12;
export const WHISPER_TOKENS_MIN = 16;
export const WHISPER_TOKENS_MAX = 110;
export function whisperMaxTokens(audioSec: number): number {
  return Math.max(WHISPER_TOKENS_MIN, Math.min(WHISPER_TOKENS_MAX, Math.ceil(audioSec * WHISPER_TOKENS_PER_SEC) + 10));
}

/** The stored slow mark: 'v1:<ms>:<at>' (old 'v1:<ms>' marks are read and
 *  dated on first sight, so they expire too). Returns null when unset,
 *  another version, or expired. */
export function readSlowMark(raw: string | null, now: number, version = 'v1'): { ms: number; at: number; legacy: boolean } | null {
  if (!raw || !raw.startsWith(`${version}:`)) return null;
  const [, ms, at] = raw.split(':');
  if (at === undefined) return { ms: Number(ms) || 0, at: now, legacy: true };
  const t = Number(at);
  if (!Number.isFinite(t) || now - t > SLOW_MARK_TTL_MS) return null;
  return { ms: Number(ms) || 0, at: t, legacy: false };
}
