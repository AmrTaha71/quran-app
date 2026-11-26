// 16.1 (phase 6): grading engine for the written test («اختبار كتابي»).
// The user TYPES a passage from memory; this compares it with the Mushaf
// text of the chosen passage only (nothing before or after it).
//
// - Words are normalized exactly as the tasmee' does (expectedWordList for the
//   Mushaf text, spokenTokens for what was typed), nothing more: real
//   spelling differences are not dropped before comparing.
// - Two words are the same when softWordEq says so in EITHER direction
//   (IMLA_ALT spellings, the aligner's own comparison: no new comparison here).
// - Joined / split words both ways, only for pairs in IMLA_PAIR_ALT: two Mushaf
//   tokens typed as one word («ان با» -> «انبا»), and one Mushaf word typed
//   as the two tokens of a known pair (reverse lookup in the same table).
//   Never a free split of any word.
// - A DP alignment (edit distance on words): a wrong, missing or extra word
//   costs 1; a merged pair covers two slots for free.
// - accuracy = (slots - cost) / slots, slots = Mushaf words of the passage.
// - Allowed mistakes = max(1, ceil(5% of the words)) (WRITTEN_ALLOWED_SHARE,
//   tunable; the final value is a grading-phase decision).
import { IMLA_PAIR_ALT } from './imlaAlt.ts';
import { softWordEq, spokenTokens } from './wordAligner.ts';
import { expectedWordList } from './expectedWords.ts';

export const WRITTEN_ALLOWED_SHARE = 0.05;
export const writtenAllowed = (words: number) => Math.max(1, Math.ceil(words * WRITTEN_ALLOWED_SHARE));

export type WrittenWord = { orig: string; status: 'ok' | 'wrong' | 'missing'; typed?: string };
export type WrittenResult = {
  words: WrittenWord[];
  extras: string[];
  cost: number;
  slots: number;
  accuracy: number;   // 0..1
  allowed: number;
  pass: boolean;
};

const same = (a: string, b: string) => a === b || softWordEq(a, b) || softWordEq(b, a);
const pairJoined = (e1: string, e2: string, t: string) => (IMLA_PAIR_ALT[`${e1} ${e2}`] ?? []).includes(t);
const pairSplit = (e: string, t1: string, t2: string) => (IMLA_PAIR_ALT[`${t1} ${t2}`] ?? []).includes(e);

type Step = 'm' | 's' | 'd' | 'i' | 'j' | 'p'; // match, substitute, delete (missing), insert (extra), joined, split

/** Grade typed words against the Mushaf words (both already normalized). */
export function gradeWrittenWords(expected: readonly string[], typed: readonly string[], origs?: readonly string[]): WrittenResult {
  const n = expected.length, m = typed.length;
  const INF = 1e9;
  const D: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(INF));
  const B: Step[][] = Array.from({ length: n + 1 }, () => new Array<Step>(m + 1).fill('m'));
  // Ties: the path that keeps more words right wins (a missing + an extra
  // word reads better than three shifted wrong words).
  const K: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(-1));
  D[0][0] = 0; K[0][0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const cur = D[i][j];
      if (cur >= INF) continue;
      const relax = (ni: number, nj: number, c: number, s: Step) => {
        if (ni > n || nj > m) return;
        const k = K[i][j] + (s === 'm' ? 1 : s === 'j' ? 2 : s === 'p' ? 1 : 0);
        if (cur + c < D[ni][nj] || (cur + c === D[ni][nj] && k > K[ni][nj])) { D[ni][nj] = cur + c; B[ni][nj] = s; K[ni][nj] = k; }
      };
      if (i < n && j < m) {
        const eq = same(typed[j], expected[i]);
        relax(i + 1, j + 1, eq ? 0 : 1, eq ? 'm' : 's');
      }
      if (i < n) relax(i + 1, j, 1, 'd');
      if (j < m) relax(i, j + 1, 1, 'i');
      if (i + 1 < n && j < m && pairJoined(expected[i], expected[i + 1], typed[j])) relax(i + 2, j + 1, 0, 'j');
      if (i < n && j + 1 < m && pairSplit(expected[i], typed[j], typed[j + 1])) relax(i + 1, j + 2, 0, 'p');
    }
  }
  const words: WrittenWord[] = expected.map((e, k) => ({ orig: origs?.[k] ?? e, status: 'ok' as const }));
  const extras: string[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const s = B[i][j];
    if (s === 'm') { i--; j--; words[i].typed = typed[j]; }
    else if (s === 's') { i--; j--; words[i] = { ...words[i], status: 'wrong', typed: typed[j] }; }
    else if (s === 'd') { i--; words[i] = { ...words[i], status: 'missing' }; }
    else if (s === 'i') { j--; extras.unshift(typed[j]); }
    else if (s === 'j') { i -= 2; j--; words[i].typed = typed[j]; words[i + 1].typed = typed[j]; }
    else { i--; j -= 2; words[i].typed = `${typed[j]} ${typed[j + 1]}`; }
  }
  const cost = D[n][m];
  const slots = n;
  const allowed = writtenAllowed(slots);
  return {
    words, extras, cost, slots,
    accuracy: slots > 0 ? Math.max(0, (slots - cost) / slots) : 0,
    allowed,
    pass: slots > 0 && cost <= allowed,
  };
}

/** Grade what the user typed against the Mushaf text of the passage. */
export function gradeWritten(mushafText: string, typedText: string): WrittenResult {
  const exp = expectedWordList(mushafText);
  return gradeWrittenWords(exp.map((w) => w.norm), spokenTokens(typedText), exp.map((w) => w.orig));
}
