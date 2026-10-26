// Follow-the-imam tracking ("الحق الإمام"): match heard words against the
// Quran text (normalized, so IndoPak/Uthmani/imla'i spellings all match)
// and walk forward with the recitation.
//
// Two phases:
//  1. LOCK — find the ayah containing a run of >= 4 consecutive heard
//     words, preferring runs that end closest to the most recent word
//     (the imam's current position), then longer runs.
//  2. TRACK — once locked, Taraweeh recitation proceeds in order, so the
//     tracker only walks forward through the current ayah and the next
//     few ayahs, tolerating ASR drops (a heard word may skip up to 2
//     expected words) and extra words. If it stops matching for several
//     chunks, the caller falls back to a fresh lock.
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

export function findLock(heard: string[], ordered: OrderedVerse[], minRun = 4): TrackedPosition | null {
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
