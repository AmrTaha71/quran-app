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
