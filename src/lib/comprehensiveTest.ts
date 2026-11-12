// الاختبار الشامل (2026-11-07): scoring rules, levels, ranges and the
// locally saved results history. 100 points in five parts:
// (old: تسميع 40 · متشابهات 25 · ربط 15 · تجويد 10 · تلاوة 10).
import { SURAH_AYAH_COUNTS, getGlobalAyahNumber } from './surahs';
import { JUZ_STARTS, HIZB_STARTS, QUARTER_STARTS } from './quranBoundaries';

export type TestLevel = 'beginner' | 'intermediate' | 'advanced';
export type RangeScope = 'surah' | 'juz' | 'hizb' | 'quarter';

export const LEVELS: { id: TestLevel; name: string; positions: number; minAyat: number; maxAyat: number; mutQuestions: number }[] = [
  { id: 'beginner', name: 'مبتدئ', positions: 3, minAyat: 4, maxAyat: 5, mutQuestions: 3 },
  { id: 'intermediate', name: 'متوسط', positions: 4, minAyat: 5, maxAyat: 6, mutQuestions: 5 },
  { id: 'advanced', name: 'متقدم', positions: 4, minAyat: 6, maxAyat: 7, mutQuestions: 5 },
];

// 2026-11-11: the test is now recitation only — 4 random places, 10 points
// each, graded by the app (memorisation + fluency). Tajwid and waqf are
// added when the engine can detect them; «الربط» was dropped by the owner.
export const EXAM_POSITIONS = 4;
export const POSITION_MAX = 10;
export const EXAM_MAX = EXAM_POSITIONS * POSITION_MAX;

export const PARTS = [
  { id: 'tasmee', name: 'التسميع', max: EXAM_MAX, kind: 'self' as const },
] as const;

export type PartId = (typeof PARTS)[number]['id'];

export const TOTAL_AYAT = SURAH_AYAH_COUNTS.reduce((a, b) => a + b, 0);

/** Global ayah range [start, end) for a scope and number (1-based). */
export function rangeOf(scope: RangeScope, n: number): { start: number; end: number } {
  if (scope === 'surah') {
    const start = getGlobalAyahNumber(n, 1);
    return { start, end: start + SURAH_AYAH_COUNTS[n - 1] };
  }
  const table = scope === 'juz' ? JUZ_STARTS : scope === 'hizb' ? HIZB_STARTS : QUARTER_STARTS;
  const start = table[n - 1].global;
  const end = n < table.length ? table[n].global : TOTAL_AYAT + 1;
  return { start, end };
}

export function fromGlobal(g: number): { s: number; a: number } {
  let rest = g;
  for (let s = 1; s <= 114; s++) {
    const c = SURAH_AYAH_COUNTS[s - 1];
    if (rest <= c) return { s, a: rest };
    rest -= c;
  }
  return { s: 114, a: SURAH_AYAH_COUNTS[113] };
}

export function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export type SavedResult = {
  date: string; // ISO
  scope: RangeScope;
  num: number;
  level: TestLevel;
  scores: Record<string, number>;
  total: number;
  /** Full mark of this result; results saved before 2026-11-11 are out of 100. */
  max?: number;
  /** Score of each place (0..10). */
  positions?: number[];
  /** Whole test time in seconds. */
  seconds?: number;
  /** False when the test was closed before the last place. */
  completed?: boolean;
};

const RESULTS_KEY = 'quran-comprehensive-results';

export function readResults(): SavedResult[] {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    const arr = raw ? (JSON.parse(raw) as SavedResult[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveResult(r: SavedResult): void {
  const all = [...readResults(), r].slice(-200);
  try { localStorage.setItem(RESULTS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}
