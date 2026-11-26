// SRS home card helpers (step 4, spec 2026-11-20 §6). Pure functions only:
// no storage, no React, so the card's text and the "first ayah" choice can be
// tested with node --test. The card itself is src/components/SrsDueCard.tsx.
import type { DueWord } from './srsStore.ts';
import { getGlobalAyahNumber, surahLabel } from './surahs.ts';
import { toArabicIndic } from './numerals.ts';

/** Arabic count phrase: 1 كلمة واحدة، 2 كلمتان، 3..10 كلمات، 11+ كلمة. */
export function dueWordsText(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 1) return 'كلمة واحدة';
  if (n === 2) return 'كلمتان';
  if (n >= 3 && n <= 10) return `${toArabicIndic(n)} كلمات`;
  return `${toArabicIndic(n)} كلمة`;
}

export type DueAyahTarget = {
  surah: number;
  ayah: number;
  /** One ayah = one global number (same value for both ends). */
  startGlobal: number;
  endGlobal: number;
  /** Shown by the test page as the recent-range label. */
  label: string;
};

/** The ayah the card opens: the one holding the oldest due word. `due` is
 *  already sorted oldest first by getDueWords. Null when nothing is due. */
export function firstDueAyah(due: readonly DueWord[]): DueAyahTarget | null {
  const first = due[0];
  if (!first) return null;
  const global = getGlobalAyahNumber(first.surah, first.ayah);
  return {
    surah: first.surah,
    ayah: first.ayah,
    startGlobal: global,
    endGlobal: global,
    label: `مراجعة كلمة: ${surahLabel(first.surah)} — آية ${toArabicIndic(first.ayah)}`,
  };
}

/** Where the card says the first ayah is, e.g. «البقرة (مدنية) — آية ٥». */
export function firstDueAyahText(due: readonly DueWord[]): string | null {
  const t = firstDueAyah(due);
  return t ? `${surahLabel(t.surah)} — آية ${toArabicIndic(t.ayah)}` : null;
}

/** Phase 6 (15.4ب): today's session, built from what is due. Your own
 *  mistakes («أخطائي», most-missed first) come first, then the review words
 *  oldest first, capped at `limit` words. The test page takes ONE range, so
 *  the session is the stretch of ayat (same surah, at most `maxAyahs` long)
 *  around the first item that holds as many of those words as fit.
 *  `words` = how many of the day's words the stretch covers. */
export type DaySession = DueAyahTarget & { words: number; fromMistakes: number };

export function daySession(
  weak: readonly { surah: number; ayah: number }[],
  due: readonly { surah: number; ayah: number }[],
  opts: { limit?: number; maxAyahs?: number } = {},
): DaySession | null {
  const limit = opts.limit ?? 20;
  const maxAyahs = Math.max(1, opts.maxAyahs ?? 10);
  const items = [
    ...weak.map((w) => ({ ...w, mistake: true })),
    ...due.map((d) => ({ ...d, mistake: false })),
  ].slice(0, Math.max(1, limit));
  const first = items[0];
  if (!first) return null;
  let lo = first.ayah;
  let hi = first.ayah;
  let words = 0;
  let fromMistakes = 0;
  for (const it of items) {
    if (it.surah !== first.surah) continue;
    const nlo = Math.min(lo, it.ayah);
    const nhi = Math.max(hi, it.ayah);
    if (nhi - nlo + 1 > maxAyahs) continue;
    lo = nlo; hi = nhi; words++;
    if (it.mistake) fromMistakes++;
  }
  const range = lo === hi ? `آية ${toArabicIndic(lo)}` : `آيات ${toArabicIndic(lo)}–${toArabicIndic(hi)}`;
  return {
    surah: first.surah,
    ayah: lo,
    startGlobal: getGlobalAyahNumber(first.surah, lo),
    endGlobal: getGlobalAyahNumber(first.surah, hi),
    label: `اختبار اليوم: ${surahLabel(first.surah)} — ${range}`,
    words,
    fromMistakes,
  };
}
