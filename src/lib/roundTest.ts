// Round logic shared by «اختبر نفسك — الترتيل» and «الاختبار الشامل» (W4-E/F).
// One round / position = the reciter says the first 5 words of an ayah, the user
// completes the ayah by voice. Pure functions + the ayah picker; the mic and the
// audio live in components/RoundRecite.tsx.
import { reciterWordTimings } from './juhaniCorr';
import { expectedWordList } from './expectedWords';
import { SURAHS } from './surahs';
import { fromGlobal } from './comprehensiveTest';
import { getQuranTextCache, type CachedTextRow } from './quranTextCache';
import { supabase } from './supabase';
import { createTextLoader } from './quranTextLoader';
import { normalizeVerifyLevel } from './verifyLevel';

/** Most words an ayah starts with as the prompt (shorter ayat use fewer, see promptLenFor). */
export const PROMPT_WORDS = 5;

export type RoundResult = {
  total: number;      // words to complete
  credited: number;   // words said right
  wrong: number[];    // indexes (in the completed part) counted as mistakes (red)
  /** R2: indexes never judged (not heard, not corrected): grey, not a mistake. */
  uncertain?: number[];
  /** R3: indexes the user got wrong and fixed himself: «صححتها بنفسك», not counted. */
  selfFixed?: number[];
  locked: boolean;    // a 2nd mistake closed the position
  corrected: number;  // how many corrections the reciter gave
  promptLen: number;  // words heard before the user started (the prompt + any hints)
  extras: number;     // «اديني كلمتين كمان» requests (each costs HINT_COST of the ayah part)
  /** Words uncovered on the Mushaf frame by the hint button while reciting (WORD_HINT_COST each). */
  hintWords?: number;
  ear: 'lab' | 'browser' | 'manual';
  /** Mistakes that count = words the reciter corrected (+ the one that closed the position).
   *  A word the user fixed himself before the reciter spoke is not one (roundJudge.ts). */
  mistakes?: number;
  /** The level the round ran at was «مبتدئ». */
  beginner?: boolean;
  /** Item 17.6 (b): the user skipped this position with «تجاوز الآية». */
  skipped?: boolean;
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
/** A counted mistake (one the reciter corrected, or that closed the position): a beginner's
 *  ayah gets half of the ayah part (4 of 8) however many such mistakes follow.
 *  Phase 6 (4.25, owner §11.8): any other level no longer drops to 0 on ONE mistake: one
 *  costs half the ayah part (4 of 8); a second one still gives 0. Same for the tarteel
 *  test and the comprehensive test. */
export const BEGINNER_MISTAKE_SHARE = 0.5;
export const ONE_MISTAKE_SHARE = 0.5;
export const SURAH_PART = 2;
function mistakeShare(r: RoundResult): number {
  const m = r.mistakes ?? 0;
  if (r.beginner) return BEGINNER_MISTAKE_SHARE;
  return m === 1 ? ONE_MISTAKE_SHARE : 0;
}
/** Owner rule R2 (2026-11-28, final): grey (uncertain) words always get full credit. More than
 *  GREY_NOTE_OVER in one test only shows GREY_NOTE (the score stays as earned). */
export const GREY_NOTE_OVER = 5;
export const GREY_NOTE = 'كان عندك أكتر من ٥ كلمات ما اتسمعتش كويس، جرّب تاني في مكان هادي بعيد عن الدوشة';
/** Grey words over the played rounds / positions of one test. */
export const greyUsed = (rs: readonly RoundResult[]) => rs.reduce((n, r) => n + (r.skipped ? 0 : r.uncertain?.length ?? 0), 0);
export const greyNote = (rs: readonly RoundResult[]): string | null => (greyUsed(rs) > GREY_NOTE_OVER ? GREY_NOTE : null);
export function tarteelRoundScore(r: RoundResult, surahOk: boolean | null): { completion: number; surah: number; total: number } {
  const greyCredit = r.uncertain?.length ?? 0;
  const share = (r.mistakes ?? 0) > 0 ? mistakeShare(r) : r.total ? Math.min(1, (r.credited + greyCredit) / r.total) : 0;
  const keep = Math.max(0, 1 - hintCost(r));
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
/** Owner 2026-11-28: a hinted word costs 5% (two words 10%), the first letter is free. */
export const WORD_HINT_COST = HINT_COST / HINT_WORDS;
/** 0..1 taken off the ayah part for the hints of one round / position. */
export const hintCost = (r: Pick<RoundResult, 'extras' | 'hintWords'>) => HINT_COST * (r.extras ?? 0) + WORD_HINT_COST * (r.hintWords ?? 0);

/** 17.10: rounds the user skipped are left out of every average. */
export const playedOnly = <T extends { result: RoundResult }>(rs: readonly T[]): T[] => rs.filter((r) => !r.result.skipped);

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
export const positionPerfect = (r: RoundResult) => r.total > 0 && r.credited + (r.uncertain?.length ?? 0) === r.total && !r.locked && r.corrected === 0 && hintCost(r) === 0;

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
// Item 16.8: «متقن» is gone; a stored 'master' reads as «متقدم». `isAdmin` no longer
// changes anything (kept so callers stay unchanged).
export function currentHistoryLevel(): 'beginner' | 'advanced' {
  try {
    const p = JSON.parse(localStorage.getItem('quran-test-settings') || '{}') as { level?: unknown };
    return normalizeVerifyLevel(p.level); // 3.25: same mapping as the test page
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
export function roundCandidates(range: { start: number; end: number }, text: Map<string, string>, corpus: Set<number> | null = null): { tier: 'strict' | 'relaxed'; list: number[] } {
  const { words, grams } = indexOf(text);
  const strict: number[] = [], relaxed: number[] = [];
  for (let g = Math.max(2, range.start); g <= Math.min(6236, range.end); g++) {
    // Item 17.2: with a declared «محفوظي», never an ayah outside it.
    if (corpus && !corpus.has(g)) continue;
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
  corpus: Set<number> | null = null,
): Promise<PickedAyah | null> {
  const { tier, list } = roundCandidates(range, text, corpus);
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

// Cache miss (fresh device / new origin): fetch all ayat once, then write through
// so the next visit (and offline) is served from IndexedDB. Same query shape as
// QuranMushafPage's loader.
async function fetchAllQuranRows(): Promise<CachedTextRow[] | null> {
  const fetched: CachedTextRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('quran_verses')
      .select('id,surah_no,surah_name,ayah_no,ayah_text,ayah_text_clean')
      .order('surah_no', { ascending: true }).order('ayah_no', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data) return null;
    fetched.push(...(data as CachedTextRow[]));
    if (data.length < PAGE) break;
  }
  if (fetched.length < 6000) return null;
  void getQuranTextCache().putRows(fetched);
  return fetched;
}

/** Quran text (key "s:a"): local cache first, network on a miss; null when neither works.
 *  A failure is not remembered, so the next call retries (see quranTextLoader.ts). */
export const loadQuranText = createTextLoader<CachedTextRow>({
  readCache: () => getQuranTextCache().getAll(6000),
  fetchRows: fetchAllQuranRows,
});
