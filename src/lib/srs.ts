// Spaced-repetition scheduling logic (SRS step 1, spec 2026-11-20).
// Pure functions only: no storage, no UI, no imports. Storage is step 2.
//
// This file does NOT judge tajwid and does NOT compare makharij. A slip
// is detected by comparing the written word with the word the app heard,
// as TEXT only (word-matching cannot check tajwid).
//
// ALL tunable numbers live in the "Constants" block below. Rana has not
// answered yet, so these values are provisional: change them there, in
// one place, and nothing else in this file needs to change.

// ---- Constants ----------------------------------------------------

/** Review gaps in days, one per stage: day, 3 days, week, 2 weeks, month. */
export const SRS_DEFAULT_INTERVALS_DAYS: readonly number[] = [1, 3, 7, 14, 30];

/** The Nth slip of the SAME letter pair (and every one after it) becomes
 *  a real mistake that enters the review table. Slips before it stay in
 *  the separate slip list. */
export const SRS_SLIP_PROMOTE_AT = 3;

/** Groups of letters that are easily confused. Counting is per UNORDERED
 *  PAIR inside a group (Heiko, 2026-11-20): س/ص/ث gives three counters
 *  (س،ص) (س،ث) (ص،ث); ذ/ز/ظ/ض gives six. س→ص and ص→س share a counter.
 *  The hamza group is special: ع against ANY hamza form (see HAMZA_FORMS). */
export const SRS_CONFUSABLE_GROUPS: readonly (readonly string[])[] = [
  ['خ', 'غ'],
  ['ق', 'ك'],
  ['س', 'ص', 'ث'],
  ['ذ', 'ز', 'ظ', 'ض'],
  ['ح', 'ه'],
  ['ع', 'أ'],
];

/** All hamza shapes count as the letter «أ» (Heiko, 2026-11-20). Plain
 *  alef «ا» is NOT here: it is a long-vowel letter, not a hamza. */
export const HAMZA_FORMS = 'أإآءؤئ';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Phase 6 (4.27): a word is due at the START of its local calendar day,
 *  not 24 rolling hours later (a word reviewed at 23:00 is due the next
 *  morning, not the next night). */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dueAfter(now: number, days: number): number {
  return startOfLocalDay(now + days * DAY_MS);
}

/** Phase 6 (4.15): how many due words one day's review offers at most
 *  (oldest first). The rest stay due for the next days. */
export const SRS_DAILY_LIMIT = 20;

/** Phase 6 (4.13): a slip counter forgets after this many days without the
 *  same letter pair, so three slips months apart are not a pattern. */
export const SRS_SLIP_DECAY_DAYS = 30;

// ---- Scheduling ---------------------------------------------------

/** stage is 1-based: stage k waits intervals[k-1] before the next review. */
export type SrsEntry = { stage: number; due: number };

export type SrsOutcome =
  | { graduated: false; entry: SrsEntry }
  | { graduated: true };

/** Valid = non-empty list of positive finite numbers; anything else falls
 *  back to the defaults (so a bad setting can never break graduation). */
export function sanitizeIntervals(intervals?: readonly number[] | null): readonly number[] {
  if (
    Array.isArray(intervals) && intervals.length > 0 &&
    intervals.every(d => typeof d === 'number' && Number.isFinite(d) && d > 0)
  ) return intervals;
  return SRS_DEFAULT_INTERVALS_DAYS;
}

/** A word that just entered the table: stage 1, due after the first gap. */
export function newEntry(now: number, intervals?: readonly number[] | null): SrsEntry {
  const iv = sanitizeIntervals(intervals);
  return { stage: 1, due: dueAfter(now, iv[0]) };
}

/** Review succeeded: move to the next stage; after the LAST stage the word
 *  graduates (leaves the table; the caller keeps the old log). */
export function scheduleAfterSuccess(
  entry: SrsEntry, now: number, intervals?: readonly number[] | null,
): SrsOutcome {
  const iv = sanitizeIntervals(intervals);
  const stage = Math.min(Math.max(Math.trunc(entry.stage) || 1, 1), iv.length);
  if (stage >= iv.length) return { graduated: true };
  return { graduated: false, entry: { stage: stage + 1, due: dueAfter(now, iv[stage]) } };
}

/** Review failed. Phase 6 (4.14, owner 2026-11-26 §11.10): the word does
 *  not move forward and does not fall back to stage 1. It keeps its stage
 *  and repeats it: the next review is after the first gap (tomorrow), and a
 *  success then moves it on from where it was. Without an entry (old
 *  callers) it is a fresh stage-1 entry. */
export function scheduleAfterFailure(
  now: number, intervals?: readonly number[] | null, entry?: SrsEntry | null,
): SrsEntry {
  const iv = sanitizeIntervals(intervals);
  const stage = entry ? Math.min(Math.max(Math.trunc(entry.stage) || 1, 1), iv.length) : 1;
  return { stage, due: dueAfter(now, iv[0]) };
}

export function isDue(entry: SrsEntry, now: number): boolean {
  return entry.due <= now;
}

// ---- Slip classification (text only) ------------------------------

// Quranic marks, tashkeel, dagger alef, tatweel, bidi marks. Local copy on
// purpose: arabicNormalize would fold the hamza shapes and drop ء BEFORE
// comparing, which would hide the ع/أ pair.
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ‌-‏؜]/g;

function stripMarks(s: string): string {
  return s.replace(MARKS, '');
}

/** Every hamza shape becomes «أ»; other letters stay as they are. */
function canonLetter(ch: string): string {
  return HAMZA_FORMS.includes(ch) ? 'أ' : ch;
}

// letter -> [group index, position in group]
const LETTER_INDEX: ReadonlyMap<string, readonly [number, number]> = (() => {
  const m = new Map<string, readonly [number, number]>();
  SRS_CONFUSABLE_GROUPS.forEach((g, gi) => g.forEach((l, li) => m.set(l, [gi, li] as const)));
  return m;
})();

/** If `spoken` differs from `written` by exactly ONE letter, and the two
 *  letters are different members of the same confusable group, returns the
 *  pair key (e.g. «خ/غ», «س/ث», «ع/أ»); otherwise null. The key does not
 *  depend on direction. Marks are ignored; hamza shapes count as one
 *  letter, so a pure hamza-shape difference is not a slip. */
export function classifySlip(written: string, spoken: string): string | null {
  const a = Array.from(stripMarks(written));
  const b = Array.from(stripMarks(spoken));
  if (a.length === 0 || a.length !== b.length) return null;
  let diffAt = -1;
  for (let i = 0; i < a.length; i++) {
    if (canonLetter(a[i]) === canonLetter(b[i])) continue;
    if (diffAt !== -1) return null; // more than one letter differs
    diffAt = i;
  }
  if (diffAt === -1) return null;
  const la = LETTER_INDEX.get(canonLetter(a[diffAt]));
  const lb = LETTER_INDEX.get(canonLetter(b[diffAt]));
  if (!la || !lb || la[0] !== lb[0]) return null;
  const group = SRS_CONFUSABLE_GROUPS[la[0]];
  const [first, second] = la[1] < lb[1] ? [la[1], lb[1]] : [lb[1], la[1]];
  return `${group[first]}/${group[second]}`;
}

// ---- Slip counter + promotion -------------------------------------

/** pair key -> how many slips of that pair so far (across all words). */
export type SlipCounts = Record<string, number>;

export type SlipResult = {
  /** new counts; the input object is never mutated */
  counts: SlipCounts;
  pair: string;
  /** this pair's count INCLUDING the current slip */
  count: number;
  /** true only for the current slip when count >= SRS_SLIP_PROMOTE_AT */
  promote: boolean;
  /** where THIS slip goes: the separate slip list, or the review table */
  route: 'slip-list' | 'review';
};

/** Count one slip of `pair`. Promotion applies to the 3rd slip and every
 *  one after it; earlier slips are never promoted retroactively (the
 *  result only describes the current slip). The counter keeps counting
 *  after promotion (no reset: the spec says "3rd and after"). */
export function registerSlip(counts: SlipCounts, pair: string): SlipResult {
  const count = (counts[pair] ?? 0) + 1;
  const promote = count >= SRS_SLIP_PROMOTE_AT;
  return {
    counts: { ...counts, [pair]: count },
    pair,
    count,
    promote,
    route: promote ? 'review' : 'slip-list',
  };
}

/** classifySlip + registerSlip. Returns null when the difference is not a
 *  confusable-pair slip (the caller then treats the word as an ordinary
 *  mistake or a pass, per its own rules). */
export function recordSlip(counts: SlipCounts, written: string, spoken: string): SlipResult | null {
  const pair = classifySlip(written, spoken);
  return pair ? registerSlip(counts, pair) : null;
}
