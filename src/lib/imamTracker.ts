// Follow-the-imam tracking ("الحق الإمام"): match heard words against the
// Quran text (normalized, so IndoPak/Uthmani/imla'i spellings all match)
// and walk forward with the recitation.
//
// MERGED follow-auto spec (2026-10-27, base 20fbad1): the user taps
// الحق الإمام then ابدأ الاستماع and nothing else. Two constants
// govern the lock, and BOTH engines read these same two — no per-engine
// numbers, no duplicates (trigger + live + whisper roles merged):
//  - FOLLOW_TRIGGER_WORDS = 5: normalized words CAPTURED (cumulative
//    buffer in onFollowFinal) before ANY search runs. Top of the user's
//    4–5 range: safer now that the confirmation step is gone, because a
//    false lock now yanks the page with no user veto.
//  - FOLLOW_LOCK_MIN_WORDS = 4: CONSECUTIVE matching words inside those
//    5 captured words needed to name an ayah (findLock minRun). The 1
//    word of slack tolerates one ASR error / extra word.
// There is NO confirmation card and NO tracking after a lock: on lock,
// search and recording stop by themselves and the page opens fullscreen
// with the ayah highlighted (searchHighlight, the manual-jump mechanism).
// advanceTracking is kept exported for a possible future tracking mode
// but is NOT called by the merged flow.
export const FOLLOW_TRIGGER_WORDS = 5;
export const FOLLOW_LOCK_MIN_WORDS = 4;
import { normalizeWords } from './arabicNormalize';
import type { VerseIndexEntry } from './searchIndex';

export interface TrackedPosition {
  surah: number;
  ayah: number;
  /** Index (0-based) of the last matched word inside the ayah's normalized words. */
  word: number;
}

export interface OrderedVerse {
  surah: number;
  ayah: number;
  words: string[];
}

export function buildOrderedVerses(verses: VerseIndexEntry[]): OrderedVerse[] {
  const sorted = [...verses].sort((a, b) => a.surah_no - b.surah_no || a.ayah_no - b.ayah_no);
  return sorted.map((v) => ({
    surah: v.surah_no,
    ayah: v.ayah_no,
    words: v.norm.split(/\s+/).filter(Boolean),
  }));
}

export function heardWords(text: string): string[] {
  return normalizeWords(text);
}

export function findLock(heard: string[], ordered: OrderedVerse[], minRun = FOLLOW_LOCK_MIN_WORDS): TrackedPosition | null {
  if (heard.length < minRun) return null;
  let best: { pos: TrackedPosition; end: number; run: number } | null = null;
  for (const v of ordered) {
    if (v.words.length === 0) continue;
    for (let h = 0; h + minRun <= heard.length; h++) {
      for (let w = 0; w < v.words.length; w++) {
        if (v.words[w] !== heard[h]) continue;
        let run = 0;
        while (
          h + run < heard.length &&
          w + run < v.words.length &&
          v.words[w + run] === heard[h + run]
        ) {
          run++;
        }
        if (run >= minRun) {
          const end = h + run;
          if (!best || end > best.end || (end === best.end && run > best.run)) {
            best = { pos: { surah: v.surah, ayah: v.ayah, word: w + run - 1 }, end, run };
          }
        }
      }
    }
  }
  return best?.pos ?? null;
}

export function advanceTracking(
  pos: TrackedPosition,
  heard: string[],
  ordered: OrderedVerse[],
  lookaheadAyahs = 12,
): TrackedPosition | null {
  const idx = ordered.findIndex((v) => v.surah === pos.surah && v.ayah === pos.ayah);
  if (idx < 0) return null;
  const upcoming: { vi: number; wi: number }[] = [];
  for (let k = idx; k < Math.min(ordered.length, idx + 1 + lookaheadAyahs); k++) {
    const start = k === idx ? pos.word + 1 : 0;
    for (let w = start; w < ordered[k].words.length; w++) upcoming.push({ vi: k, wi: w });
  }
  if (upcoming.length === 0) return null;
  let u = 0;
  let last: { vi: number; wi: number } | null = null;
  for (const hw of heard) {
    // Only the next 3 expected words are candidates: a wider window let a
    // common word (e.g. "الله") jump the tracker into a later ayah that
    // merely shares it. Two skipped words still cover ordinary ASR drops;
    // anything worse falls back to a fresh lock via the caller's miss count.
    let found = -1;
    for (let j = u; j < Math.min(upcoming.length, u + 3); j++) {
      if (ordered[upcoming[j].vi].words[upcoming[j].wi] === hw) {
        found = j;
        break;
      }
    }
    if (found >= 0) {
      last = upcoming[found];
      u = found + 1;
    }
    // Otherwise the word is an ASR error or an extra word — ignore it and
    // keep the expected position; do not jump backwards.
  }
  if (!last) return null;
  const v = ordered[last.vi];
  return { surah: v.surah, ayah: v.ayah, word: last.wi };
}
