// Round logic shared by «اختبر نفسك — الترتيل» and «الاختبار الشامل» (W4-E/F).
// One round / position = the reciter says the first 5 words of an ayah, the user
// completes the ayah by voice. Pure functions + the ayah picker; the mic and the
// audio live in components/RoundRecite.tsx.
import { reciterWordTimings } from './juhaniCorr';
import { expectedWordList } from './expectedWords';
import { SURAHS } from './surahs';
import { fromGlobal } from './comprehensiveTest';
import { getQuranTextCache, type CachedTextRow } from './quranTextCache';

/** Most words an ayah starts with as the prompt (shorter ayat use fewer, see promptLenFor). */
export const PROMPT_WORDS = 5;

export type RoundResult = {
  total: number;      // words to complete
  credited: number;   // words said right
  wrong: number[];    // indexes (in the completed part) not credited
  locked: boolean;    // a 2nd mistake closed the position
  corrected: number;  // how many corrections the reciter gave
  promptLen: number;  // words heard before the user started (the prompt + any hints)
  extras: number;     // «اديني كلمتين كمان» requests (each costs HINT_COST of the ayah part)
  ear: 'lab' | 'browser' | 'manual';
};

export type PickedAyah = {
  surah: number; ayah: number; folder: string;
  words: { orig: string; norm: string }[];
  timings: number[];
  /** Words the reciter says first. */
  promptLen: number;
  /** Very short range: relaxed picking (no uniqueness check). */
  relaxed?: boolean;
};

/** First word the user got wrong WHILE later words were heard (a skipped /
 *  different word). Trailing unmatched words are «not said yet», not a mistake. */
export function firstMistake(matched: boolean[]): number {
  const last = matched.lastIndexOf(true);
  for (let i = 0; i < last; i++) if (!matched[i]) return i;
  return -1;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** W4-J: a round / position is out of 10: 8 for completing the ayah itself (by the share
 *  of words right) + 2 for naming the surah. When the range is a single surah the
 *  surah question is skipped (surahOk = null) and the ayah carries all 10. */
export const AYAH_PART = 8;
export const SURAH_PART = 2;
export function tarteelRoundScore(r: RoundResult, surahOk: boolean | null): { completion: number; surah: number; total: number } {
  const share = r.total ? r.credited / r.total : 0;
  const keep = Math.max(0, 1 - HINT_COST * (r.extras ?? 0));
  const completion = r1((surahOk === null ? AYAH_PART + SURAH_PART : AYAH_PART) * share * keep);
  const surah = surahOk ? SURAH_PART : 0;
  return { completion, surah, total: r1(completion + surah) };
}
/** 0..1 share of a round / position (round total / 10). */
export const roundFrac = (r: RoundResult, surahOk: boolean | null) => tarteelRoundScore(r, surahOk).total / 10;

/** Oral mutashabihat question: 8 for the ayat said, 2 for the surah names (per ayah
 *  found), 0..1. Each «كلمتين كمان» hint takes HINT_COST of the ayat part. */
export function oralFraction(found: number, total: number, surahRight: number, hints = 0): number {
  if (total <= 0) return 0;
  const keep = Math.max(0, 1 - HINT_COST * hints);
  return (AYAH_PART / 10) * (found / total) * keep + (SURAH_PART / 10) * (surahRight / total);
}

/** W4-L: «اديني كلمتين كمان» costs 10% of the ayah part (8 of 10) per request. */
export const HINT_COST = 0.1;
export const HINT_WORDS = 2;
export const MAX_HINTS = 3;

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
export const positionPerfect = (r: RoundResult) => r.total > 0 && r.credited === r.total && !r.locked && r.corrected === 0 && r.extras === 0;

/** 4 surah tiles (the right one + 3 others), shuffled. The others come from `pool`
 *  (the surahs of the range) when it has enough, else from the whole Quran. */
export function surahTiles(correct: number, pool?: number[]): number[] {
  const set = new Set<number>([correct]);
  const from = pool && pool.length >= 4 ? pool : null;
  while (set.size < 4) set.add(from ? from[Math.floor(Math.random() * from.length)] : 1 + Math.floor(Math.random() * 114));
  return [...set].map((s) => ({ s, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.s);
}
/** Surahs touched by a global ayah range [start, end] (inclusive), and whether it is ONE surah. */
export function surahsOfRange(range: { start: number; end: number }): number[] {
  const a = fromGlobal(range.start).s, b = fromGlobal(range.end).s;
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
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

/** Words of an ayah to say as the prompt: 5, fewer for short ayat (always leaves >= 3
 *  words to complete). 0 = the ayah is too short for the strict rule. */
export const promptLenFor = (wordCount: number) => (wordCount >= 6 ? Math.min(PROMPT_WORDS, wordCount - 3) : 0);
/** Relaxed rule for very short ranges (e.g. surah 112): half the ayah is the prompt. */
const relaxedPromptLen = (wordCount: number) => (wordCount >= 4 ? Math.max(2, Math.floor(wordCount / 2)) : 0);

type TextIndex = { words: ({ orig: string; norm: string }[] | null)[]; grams: Map<number, Map<string, number>> };
const indexCache = new WeakMap<Map<string, string>, TextIndex>();

/** Per-ayah word lists + how many times every 3/4/5-word run occurs in the WHOLE
 *  Quran text. Built once per text map (~80k runs). */
function indexOf(text: Map<string, string>): TextIndex {
  const hit = indexCache.get(text);
  if (hit) return hit;
  const words: TextIndex['words'] = [null];
  const grams = new Map<number, Map<string, number>>([[3, new Map()], [4, new Map()], [5, new Map()]]);
  for (let g = 1; g <= 6236; g++) {
    const p = fromGlobal(g);
    const t = text.get(`${p.s}:${p.a}`);
    const w = t ? expectedWordList(t) : null;
    words.push(w);
    if (!w) continue;
    const norms = w.map((x) => x.norm);
    for (const [n, m] of grams) {
      for (let i = 0; i + n <= norms.length; i++) { const k = norms.slice(i, i + n).join(' '); m.set(k, (m.get(k) ?? 0) + 1); }
    }
  }
  const idx = { words, grams };
  indexCache.set(text, idx);
  return idx;
}

/** Ayat of [start, end] (global, inclusive) that make a good position.
 *  W4-K criterion: the ayah has >= 6 words and the words said as the prompt
 *  (5, or fewer in a short ayah) appear NOWHERE else in the Quran, so the
 *  user can tell which ayah it is and continue it. Never the basmala (1:1).
 *  A range with no such ayah (e.g. surah 112) falls back to the relaxed tier:
 *  any ayah of >= 4 words, half of it as the prompt. */
export function roundCandidates(range: { start: number; end: number }, text: Map<string, string>): { tier: 'strict' | 'relaxed'; list: number[] } {
  const { words, grams } = indexOf(text);
  const strict: number[] = [], relaxed: number[] = [];
  for (let g = Math.max(2, range.start); g <= Math.min(6236, range.end); g++) {
    const w = words[g];
    if (!w) continue;
    const n = promptLenFor(w.length);
    if (n >= 3 && grams.get(n)?.get(w.slice(0, n).map((x) => x.norm).join(' ')) === 1) strict.push(g);
    if (relaxedPromptLen(w.length) > 0) relaxed.push(g);
  }
  return strict.length > 0 ? { tier: 'strict', list: strict } : { tier: 'relaxed', list: relaxed };
}

/** A timing row is usable when it has exactly one finite, increasing [start,end] pair per
 *  word for the prompt and the words a «كلمتين كمان» hint can add. */
function timingsOk(t: number[] | null, wordCount: number, promptLen: number): t is number[] {
  if (!t || t.length !== wordCount * 2) return false;
  let prev = 0;
  const upto = Math.min(wordCount, promptLen + 2 * MAX_HINTS);
  for (let i = 0; i < upto; i++) {
    const a = t[2 * i], b = t[2 * i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || a + 0.001 < prev || b - a > 15) return false;
    prev = b;
  }
  return Number.isFinite(t[2 * (wordCount - 1) + 1]);
}

/** Random usable ayah from roundCandidates() that has timings for its reciter. */
export async function pickRoundAyah(
  range: { start: number; end: number },
  folderAt: (g: number) => string,
  text: Map<string, string>,
  avoid: Set<number>,
): Promise<PickedAyah | null> {
  const { tier, list } = roundCandidates(range, text);
  const pool = list.filter((g) => !avoid.has(g));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const words = indexOf(text).words;
  for (const g of pool.slice(0, 80)) {
    const w = words[g];
    if (!w) continue;
    const promptLen = tier === 'strict' ? promptLenFor(w.length) : relaxedPromptLen(w.length);
    const folder = folderAt(g);
    if (!folder) continue;
    const p = fromGlobal(g);
    const timings = await reciterWordTimings(folder, p.s, p.a);
    if (!timingsOk(timings, w.length, promptLen)) continue;
    avoid.add(g);
    return { surah: p.s, ayah: p.a, folder, words: w, timings, promptLen, relaxed: tier === 'relaxed' };
  }
  return null;
}

let textMap: Promise<Map<string, string> | null> | null = null;
/** Quran text (key "s:a") from the local cache; null when it is not available. Loaded once. */
export function loadQuranText(): Promise<Map<string, string> | null> {
  if (!textMap) {
    textMap = getQuranTextCache().getAll(6000).then((rows: CachedTextRow[] | null) => {
      if (!rows) return null;
      const m = new Map<string, string>();
      for (const r of rows) m.set(`${r.surah_no}:${r.ayah_no}`, r.ayah_text);
      return m;
    }).catch(() => null);
  }
  return textMap;
}
