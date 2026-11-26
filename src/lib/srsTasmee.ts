// SRS <-> self-test link (step 5, spec 2026-11-20 §2, §2ب, §3).
// Everything the self-test needs to feed the review table lives here, so
// SelfTestPage.tsx only stores the last verdict of an ayah ("pending") and
// calls flushPending() when the ayah is really finished. No React, no
// grading code: the aligner is untouched; this reads its OUTPUT.
//
// Rules (Hiko, 2026-11-20):
//  - Only the FINAL verdict of an ayah counts. A later grade for the same ayah
//    replaces the pending one, so a word fixed before the verdict is final
//    never reaches the table.
//  - Nothing is recorded when nothing was matched (silent mic, or noise that
//    matched no word: same rule as the old recordAyahWords).
//  - A wrong word that is NOT in the table -> addWord; one that IS -> recordFailure.
//  - A wrong word that looks like a letter-pair slip goes to recordWordSlip
//    first: slips 1 and 2 of a pair stay in the separate list (table untouched),
//    slip 3+ is "review" (ordinary mistake logic + a notice for the user).
//  - recordSuccess for a word that was due at judgement time, in ANY test
//    (phase 6, 4.15: an ordinary test moves due words forward too).
//  - A single isolated wrong word in an ayah (and not a slip) is only marked
//    «مشكوك» the first time; it enters the table when wrong again in a later
//    session (phase 6, 4.5ب). Words already in the table fail as before.
//  - The heard text is never stored by this file; it is only handed to
//    recordWordSlip (which keeps it in the slip list) and shown in the notice.
import {
  addWord, getReviewEntry, recordFailure, recordSuccess, recordWordSlip, wordKey,
  markSuspect, clearSuspect,
} from './srsStore.ts';
import { isDue } from './srs.ts';
import { loadSrsIntervals } from './srsSettings.ts';
import { getGlobalAyahNumber } from './surahs.ts';

/** sessionStorage flag written by SrsDueCard, read once by SelfTestPage. */
export const SRS_REVIEW_SESSION_KEY = 'quran-srs-review-session';

/** What the self-test keeps for the ayah it just graded. */
export type SrsPending = {
  surah: number;
  ayah: number;
  /** position of the ayah in the test (to detect a later manual override) */
  index: number;
  /** the grade this verdict came with (gradeMic's argument) */
  ok: boolean;
  /** when the verdict was made (ms) */
  ts: number;
  words: { orig: string }[];
  matched: boolean[];
  /** aligner output, same arrays `tokens` index into. Absent = no heard text. */
  positions?: number[];
  consumed?: number[];
  tokens?: string[];
  /** how many spoken tokens the whole attempt had */
  spokenCount: number;
};

export type WordOutcome = {
  /** 1-based position in the ayah (same numbering as wordMistakes) */
  wordNo: number;
  orig: string;
  ok: boolean;
  /** the single spoken token standing in for this word, or null */
  heard: string | null;
};

export type SlipNotice = { word: string; heard: string; pair: string; count: number };

export type ApplyResult = {
  added: number;
  failed: number;
  succeeded: number;
  graduated: number;
  /** single isolated mistakes only marked «مشكوك» (4.5ب) */
  suspect: number;
  notices: SlipNotice[];
};

/** The spoken token that stands in for expected word `i`, or null.
 *  Only an ISOLATED wrong word qualifies: its matched neighbours (one side
 *  for the first or last word, phase 6 4.13) and exactly one spoken token
 *  between them. The first word needs the token right before the next match
 *  to be the attempt's first token; the last word needs exactly one token
 *  left after the previous match. Anything else (nothing said, several
 *  tokens, two wrong words in a row) is null. */
export function heardForWord(
  i: number,
  matched: readonly boolean[],
  positions: readonly number[] | undefined,
  consumed: readonly number[] | undefined,
  tokens: readonly string[] | undefined,
): string | null {
  if (!positions || !tokens) return null;
  if (matched[i]) return null;
  const n = matched.length;
  if (i < 0 || i >= n || n < 2) return null;
  const ok = (x: number) => Number.isInteger(x) && x >= 0;
  let gapStart: number;
  let gapEnd: number; // exclusive
  if (i === 0) {
    if (!matched[1]) return null;
    const next = positions[1];
    if (!ok(next)) return null;
    gapStart = 0; gapEnd = next;
  } else if (i === n - 1) {
    if (!matched[i - 1]) return null;
    const prev = positions[i - 1];
    if (!ok(prev)) return null;
    gapStart = prev + Math.max(1, Math.trunc(consumed?.[i - 1] ?? 1));
    gapEnd = tokens.length;
  } else {
    if (!matched[i - 1] || !matched[i + 1]) return null;
    const prev = positions[i - 1];
    const next = positions[i + 1];
    if (!ok(prev) || !ok(next)) return null;
    gapStart = prev + Math.max(1, Math.trunc(consumed?.[i - 1] ?? 1));
    gapEnd = next;
  }
  if (gapEnd - gapStart !== 1) return null;
  const t = tokens[gapStart];
  return typeof t === 'string' && t.length > 0 ? t : null;
}

/** One outcome per word of the ayah, or [] when there is nothing to record
 *  (silent mic, or no word matched at all). */
export function buildOutcomes(p: SrsPending): WordOutcome[] {
  if (p.spokenCount <= 0) return [];
  if (p.words.length === 0 || p.words.length !== p.matched.length) return [];
  if (!p.matched.some(Boolean)) return [];
  return p.words.map((w, i) => ({
    wordNo: i + 1,
    orig: w.orig,
    ok: !!p.matched[i],
    heard: p.matched[i] ? null : heardForWord(i, p.matched, p.positions, p.consumed, p.tokens),
  }));
}

/** Apply the outcomes of one ayah to the review table. `reviewSession` (a test
 *  started from the home card) no longer changes the rules (4.15); kept for callers. */
export function applyOutcomes(
  surah: number, ayah: number, outcomes: readonly WordOutcome[],
  opts: { reviewSession: boolean; now: number },
): ApplyResult {
  const res: ApplyResult = { added: 0, failed: 0, succeeded: 0, graduated: 0, suspect: 0, notices: [] };
  const now = opts.now;
  const iv = loadSrsIntervals();
  // 4.5ب: one wrong word in the whole ayah, with its neighbours right.
  const wrong = outcomes.filter((o) => !o.ok);
  const single = wrong.length === 1 && outcomes.length >= 3 ? wrong[0].wordNo : -1;
  for (const o of outcomes) {
    const key = wordKey(surah, ayah, o.wordNo);
    if (o.ok) {
      clearSuspect(key, now);
      // Double-call guard: the entry is read from storage right here, not from
      // an earlier snapshot. After the first success the word is no longer due
      // (its next gap is at least a day), so recording the same verdict again
      // (e.g. continuous mode grading twice) does nothing.
      const e = getReviewEntry(key);
      if (!e || !isDue(e, now)) continue;
      const out = recordSuccess(key, now, iv);
      if (out) { res.succeeded++; if (out.graduated) res.graduated++; }
      continue;
    }
    const before = getReviewEntry(key);
    if (o.heard !== null) {
      const slip = recordWordSlip(surah, ayah, o.wordNo, o.orig, o.heard, now, iv);
      if (slip) {
        if (slip.route === 'slip-list') continue; // separate list, table untouched
        res.notices.push({ word: o.orig, heard: o.heard, pair: slip.pair, count: slip.count });
        // recordWordSlip already put a new word in the table.
        if (before) { if (recordFailure(key, now, iv)) res.failed++; }
        else if (slip.added) res.added++;
        continue;
      }
    }
    if (before) { if (recordFailure(key, now, iv)) res.failed++; continue; }
    if (o.wordNo === single && markSuspect(key, now) === 'marked') { res.suspect++; continue; }
    if (addWord(surah, ayah, o.wordNo, o.orig, now, iv).added) res.added++;
  }
  return res;
}

/** Does the review session started from the card cover this ayah? */
export function sessionCovers(
  session: { startGlobal: number; endGlobal: number } | null,
  surah: number, ayah: number,
): boolean {
  if (!session) return false;
  const g = getGlobalAyahNumber(surah, ayah);
  return g >= session.startGlobal && g <= session.endGlobal;
}

/** Record one finished ayah. Never throws (the self-test must not break). */
export function flushPending(
  p: SrsPending | null,
  session: { startGlobal: number; endGlobal: number } | null,
): SlipNotice[] {
  if (!p) return [];
  try {
    const outcomes = buildOutcomes(p);
    if (outcomes.length === 0) return [];
    return applyOutcomes(p.surah, p.ayah, outcomes, {
      reviewSession: sessionCovers(session, p.surah, p.ayah),
      now: p.ts,
    }).notices;
  } catch {
    return [];
  }
}

/** The message shown for a third-or-later slip of the same letter pair. */
export function slipNoticeText(n: SlipNotice): string {
  return `تكرر نفس الخطأ أكثر من مرتين — الكلمة الصحيحة: «${n.word}»، والمسموع: «${n.heard}»`;
}
