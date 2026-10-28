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
import { normalizeWords, muqattaatLetters, MUQATTAAT_NAME_TO_LETTER } from './arabicNormalize';
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
    // Canonicalize muqatta'at spellings (طاها -> طه، حام -> حم،
    // الاما -> الم): the verse side must meet the heard side in the
    // same canonical form. 1:1 token mapping, so word indices (and
    // therefore lock positions) are unchanged.
    words: v.norm.split(/\s+/).filter(Boolean).map((w) => muqattaatLetters(w) ?? w),
  }));
}

// Heard words, with the same muqatta'at gap closed as in self-test:
// an imam reciting an opening says letter names, so a run of spoken
// letter names collapses to the opening token (ألف لام ميم -> الم),
// and a single spoken variant token canonicalizes the same way
// (طاها -> طه، ياس -> يس). Runs collapse ONLY when they spell a
// genuine opening token — a non-opening run is left alone, token by
// token, so nothing else can merge. Length-1 runs collapse only for
// صاد/قاف/نون: those names never occur as standalone Quranic
// words, while single يا (the vocative particle, يا أيها) and ها
// (ها أنتم) are real words and must never collapse. The 4-word
// lock run itself disambiguates ألم (105:1 ألم تر...) from the 2:1
// opening (الم ذلك...): their second words differ, so no false
// lock is possible there. Known pre-existing limit, unchanged:
// ayahs shorter than 4 words (e.g. 42:1 حم, 42:2 عسق alone) can
// never finals-lock, since findLock needs 4 consecutive words in
// ONE ayah; the interim lock needs 6.
export function heardWords(text: string): string[] {
  const words = normalizeWords(text);
  const out: string[] = [];
  for (let i = 0; i < words.length;) {
    let run = '';
    let k = i;
    for (; k < words.length; k++) {
      const l = MUQATTAAT_NAME_TO_LETTER[words[k]];
      if (!l) break;
      run += l;
    }
    const runLen = k - i;
    if (runLen >= 2) {
      const canon = muqattaatLetters(run);
      if (canon) { out.push(canon); i = k; continue; }
      // Not an opening: fall through and handle words[i] singly.
    } else if (runLen === 1 && (words[i] === 'صاد' || words[i] === 'قاف' || words[i] === 'نون')) {
      out.push(MUQATTAAT_NAME_TO_LETTER[words[i]]);
      i++;
      continue;
    }
    out.push(muqattaatLetters(words[i]) ?? words[i]);
    i++;
  }
  return out;
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

// INTERIM LOCK (2026-10-28, user request: the Mushaf must open on the
// imam's ayah AUTOMATICALLY, mid-ayah — neither waiting for the imam to
// finish the ayah nor for the user to press stop). Live-engine finals
// only land when the imam pauses (usually the ayah end), so finals-only
// matching could not open before the ayah ended. An interim lock fires
// only on a LONG (6+) consecutive run whose exact word sequence occurs
// in exactly ONE ayah of the whole Mushaf: a 6-word unique phrase is
// not an ASR guess artifact, and a shared phrase (e.g. the basmala,
// repeated at every surah) can never interim-lock. Finals keep their
// 4-word rule as the fallback; interim words are never added to the
// finals buffer, so nothing is double-counted.
export const FOLLOW_INTERIM_MIN_WORDS = 6;
export function findInterimLock(heard: string[], ordered: OrderedVerse[]): TrackedPosition | null {
  const window = heard.slice(-20);
  if (window.length < FOLLOW_INTERIM_MIN_WORDS) return null;
  const lock = findLock(window, ordered, FOLLOW_INTERIM_MIN_WORDS);
  if (!lock) return null;
  const ayah = ordered.find((v) => v.surah === lock.surah && v.ayah === lock.ayah);
  if (!ayah) return null;
  const suffix = ayah.words.slice(lock.word - FOLLOW_INTERIM_MIN_WORDS + 1, lock.word + 1);
  if (suffix.length < FOLLOW_INTERIM_MIN_WORDS) return null;
  let count = 0;
  for (const v of ordered) {
    let found = false;
    for (let w = 0; w + FOLLOW_INTERIM_MIN_WORDS <= v.words.length; w++) {
      let ok = true;
      for (let k = 0; k < FOLLOW_INTERIM_MIN_WORDS; k++) {
        if (v.words[w + k] !== suffix[k]) { ok = false; break; }
      }
      if (ok) { found = true; break; }
    }
    if (found) {
      count++;
      if (count > 1) return null;
    }
  }
  return count === 1 ? lock : null;
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
