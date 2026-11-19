// Round logic shared by «اختبر نفسك — الترتيل» and «الاختبار الشامل» (W4-E/F).
// One round / position = the reciter says the first 5 words of an ayah, the user
// completes the ayah by voice. Pure functions + the ayah picker; the mic and the
// audio live in components/RoundRecite.tsx.
import { reciterWordTimings } from './juhaniCorr';
import { expectedWordList } from './expectedWords';
import { SURAHS } from './surahs';
import { fromGlobal } from './comprehensiveTest';

export const PROMPT_WORDS = 5;
/** 5 prompt words + at least 2 to complete (shorter ayat are skipped). */
export const MIN_AYAH_WORDS = PROMPT_WORDS + 2;

export type RoundResult = {
  total: number;      // words to complete
  credited: number;   // words said right
  wrong: number[];    // indexes (in the completed part) not credited
  locked: boolean;    // a 2nd mistake closed the position
  corrected: number;  // how many corrections the reciter gave
  ear: 'lab' | 'browser' | 'manual';
};

export type PickedAyah = {
  surah: number; ayah: number; folder: string;
  words: { orig: string; norm: string }[];
  timings: number[];
};

/** First word the user got wrong WHILE later words were heard (a skipped /
 *  different word). Trailing unmatched words are «not said yet», not a mistake. */
export function firstMistake(matched: boolean[]): number {
  const last = matched.lastIndexOf(true);
  for (let i = 0; i < last; i++) if (!matched[i]) return i;
  return -1;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Tarteel round: 7 for completing the ayah (by the share of words right) + 3 for the surah. */
export function tarteelRoundScore(r: RoundResult, surahOk: boolean): { completion: number; surah: number; total: number } {
  const completion = r1(7 * (r.total ? r.credited / r.total : 0));
  const surah = surahOk ? 3 : 0;
  return { completion, surah, total: r1(completion + surah) };
}

/** Final /40 = average of the rounds (each /10) x 4. */
export function tarteelFinal(roundTotals: number[]): number {
  if (roundTotals.length === 0) return 0;
  return r1((roundTotals.reduce((a, b) => a + b, 0) / roundTotals.length) * 4);
}

/** W4-I: the comprehensive recitation part is ALWAYS out of 40; the user picks how many
 *  positions it has and the 40 is shared equally between them. */
export const COMP_TOTAL = 40;
export const COMP_COUNT_OPTIONS = [5, 10, 15, 20, 25, 30, 40, 50];
export const COMP_COUNT_DEFAULT = 5;
export const positionMax = (n: number) => r1(COMP_TOTAL / Math.max(1, n));
/** Points of ONE position out of positionMax(n), from its 0..1 share. */
export const positionScore = (frac: number, n: number) => r1(positionMax(n) * frac);
/** The part's final /40 = 40 x the mean share of the positions that were played. */
export function positionsFinal(fracs: number[]): number {
  return fracs.length ? r1(COMP_TOTAL * (fracs.reduce((a, b) => a + b, 0) / fracs.length)) : 0;
}
export const positionPerfect = (r: RoundResult) => r.total > 0 && r.credited === r.total && !r.locked && r.corrected === 0;

/** 4 surah tiles (the right one + 3 other random surahs), shuffled. */
export function surahTiles(correct: number): number[] {
  const set = new Set<number>([correct]);
  while (set.size < 4) set.add(1 + Math.floor(Math.random() * 114));
  return [...set].map((s) => ({ s, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.s);
}
export const surahNameOnly = (n: number) => SURAHS.find((s) => s.no === n)?.name ?? '';

/** Level the grading ran at (the tasmee' setting), for the score log. */
export function currentHistoryLevel(isAdmin: boolean): 'beginner' | 'advanced' | 'master' {
  try {
    const p = JSON.parse(localStorage.getItem('quran-test-settings') || '{}') as { level?: unknown };
    const v = p.level;
    if (v === 'master' || v === 'متقن') return isAdmin ? 'master' : 'advanced';
    if (v === 'advanced' || v === 'intermediate' || v === 'متقدم' || v === 'متوسط') return 'advanced';
  } catch { /* ignore */ }
  return 'beginner';
}

export const arNum = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 1 });

/** A timing row is usable when it has exactly one finite, increasing [start,end] pair per word. */
function timingsOk(t: number[] | null, wordCount: number): t is number[] {
  if (!t || t.length !== wordCount * 2) return false;
  let prev = 0;
  for (let i = 0; i < PROMPT_WORDS; i++) {
    const a = t[2 * i], b = t[2 * i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || a + 0.001 < prev || b - a > 15) return false;
    prev = b;
  }
  return Number.isFinite(t[2 * (wordCount - 1) + 1]);
}

/** Random ayah inside [start, end] (global, inclusive) that has >= 7 words and
 *  usable word timings for the reciter of that ayah. Never the basmala (1:1). */
export async function pickRoundAyah(
  range: { start: number; end: number },
  folderAt: (g: number) => string,
  text: Map<string, string>,
  avoid: Set<number>,
): Promise<PickedAyah | null> {
  const span = range.end - range.start + 1;
  for (let tries = 0; tries < 60; tries++) {
    const g = range.start + Math.floor(Math.random() * span);
    if (g === 1) continue;
    if (avoid.has(g) && span > avoid.size + 3) continue;
    const p = fromGlobal(g);
    const t = text.get(`${p.s}:${p.a}`);
    if (!t) continue;
    const words = expectedWordList(t);
    if (words.length < MIN_AYAH_WORDS) continue;
    const folder = folderAt(g);
    if (!folder) continue;
    const timings = await reciterWordTimings(folder, p.s, p.a);
    if (!timingsOk(timings, words.length)) continue;
    avoid.add(g);
    return { surah: p.s, ayah: p.a, folder, words, timings };
  }
  return null;
}
