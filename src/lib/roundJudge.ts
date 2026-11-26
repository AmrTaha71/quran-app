// The grading state of ONE round / position, shared by «اختبار الترتيل» and «الاختبار
// الشامل» (both run it through components/RoundRecite.tsx).
//
// What counts as a mistake: a word the reciter had to correct (or one still wrong when the
// ayah is over). A word the user got wrong and then said right again BEFORE the reciter spoke
// is not a mistake, however long he stayed silent in between: the aligner (alignRest ->
// alignWords) skips the stray words, so `matched` shows that word as right.
//
// WHEN the reciter cuts in (first one that holds), counted from a mistake the user has not
// fixed:
//   1. WRONG_WORDS_LIMIT (3) wrong words piled up, or
//   2. the clock of the unfixed mistake is up: MISTAKE_MS (10 s) by default, 15 s, or none
//      in the «end of the ayah» setting (item 16.9; see RoundCutMode below), or
//   3. the ayah is over (its last word was said) or the user pressed «خلصت». A wrong LAST
//      word followed by «خلصت» (ayah unfinished) counts as a mistake, not as missing words.
// The clock starts the first time a wrong word can be seen as wrong (a later word matched)
// and is dropped if the user fixes it before anything above holds. A silence by itself judges
// nothing (the old 1.8 s quiet rule and the «cut in at the last word only» rule are gone).
import { firstMistake } from './roundTest';

/** The reciter corrects the first counted mistake once, in BOTH tests (tarteel and comprehensive):
 *  one rule, one setting. The next counted mistake closes the position. */
export const ROUND_CORRECTIONS = 1;
export const WRONG_WORDS_LIMIT = 3;
export const MISTAKE_MS = 10_000;

// Item 16.9 (2026-11-26): when the reciter cuts in on an unfixed mistake is a user setting:
// 10 s (default, today's behaviour), 15 s, or only at the end of the ayah (no time limit;
// 3 wrong words / the last word / «خلصت» still close it). Own key so the self-test settings
// writer (which rewrites 'quran-test-settings' whole) can never drop it.
export type RoundCutMode = '10s' | '15s' | 'ayah-end';
export const ROUND_CUT_KEY = 'quran-round-cut';
export const ROUND_CUT_DEFAULT: RoundCutMode = '10s';
export const ROUND_CUT_LABEL: Record<RoundCutMode, string> = {
  '10s': 'بعد 10 ثوانٍ', '15s': 'بعد 15 ثانية', 'ayah-end': 'في نهاية الآية',
};
export function loadRoundCutMode(): RoundCutMode {
  try {
    const v = localStorage.getItem(ROUND_CUT_KEY);
    return v === '15s' || v === 'ayah-end' || v === '10s' ? v : ROUND_CUT_DEFAULT;
  } catch { return ROUND_CUT_DEFAULT; }
}
export function saveRoundCutMode(m: RoundCutMode): void {
  try { localStorage.setItem(ROUND_CUT_KEY, m); } catch { /* storage blocked */ }
}
/** Milliseconds of the unfixed-mistake clock for a mode (null = no clock: wait for the ayah end). */
export function roundCutMs(m: RoundCutMode): number | null {
  return m === 'ayah-end' ? null : m === '15s' ? 15_000 : MISTAKE_MS;
}

/** One-shot timer that re-runs the judge when the 10 s of the first unfixed mistake are up. */
export class DeadlineTimer {
  private t: ReturnType<typeof setTimeout> | null = null;
  private run: () => void;
  constructor(run: () => void) { this.run = run; }
  /** (Re)arm for `msLeft`, or just clear when there is no deadline (null). */
  sync(msLeft: number | null): void {
    this.clear();
    if (msLeft !== null) this.t = setTimeout(() => { this.t = null; this.run(); }, Math.max(0, msLeft));
  }
  clear(): void { if (this.t) { clearTimeout(this.t); this.t = null; } }
}

export type JudgeAction =
  /** Nothing decided yet (the user has more to say). */
  | { kind: 'continue' }
  /** A counted mistake with a correction left: the reciter corrects, the user goes on from it. */
  | { kind: 'correct' }
  /** The round is over (all said / said what they could / a mistake with no correction left). */
  | { kind: 'finish'; locked: boolean };

export class RoundState {
  /** Words of the completed part already settled (where the next listening starts). */
  base = 0;
  corrLeft: number;
  got: boolean[];
  /** Indexes (in the completed part) the reciter corrected. */
  mistaken = new Set<number>();
  /** When the still-unfixed mistake at `pendingIdx` was first seen (null = none right now). */
  since: number | null = null;
  /** Item 16.3: absolute index (in the completed part) the clock belongs to. */
  pendingIdx: number | null = null;
  /** Item 16.5: absolute index of the mistake that closed the position (null = not locked). */
  lockedAt: number | null = null;
  /** Item 16.9: clock length (null = no clock, wait for the end of the ayah). */
  readonly mistakeMs: number | null;

  constructor(total: number, corrections: number, mistakeMs: number | null = MISTAKE_MS) {
    this.corrLeft = corrections;
    this.got = new Array<boolean>(total).fill(false);
    this.mistakeMs = mistakeMs;
  }

  /** «اديني كلمتين كمان»: the completed part got shorter, start over. Item 16.6: everything
   *  indexed by the old part goes too; the correction budget stays spent (same position). */
  reset(total: number) {
    this.got = new Array<boolean>(total).fill(false);
    this.base = 0;
    this.since = null;
    this.pendingIdx = null;
    this.mistaken = new Set<number>();
    this.lockedAt = null;
  }

  // Item 16.4: a corrected word the user then says right IS credited; `mistaken` still
  // records the correction for the `mistakes` count.
  private creditUpTo(matched: boolean[], limit: number) {
    for (let k = 0; k < limit && k < matched.length; k++) {
      if (matched[k]) this.got[this.base + k] = true;
    }
  }

  /** Milliseconds until the deadline of the current unfixed mistake (null = no mistake, or
   *  no clock in the 'ayah-end' setting). */
  msUntilDue(now: number): number | null {
    if (this.since === null || this.mistakeMs === null) return null;
    return Math.max(0, this.mistakeMs - (now - this.since));
  }

  /** Judge what the user said (`matched` is relative to the current start). `final` = «خلصت». */
  evaluate(matched: boolean[], allMatched: boolean, final: boolean, now: number = Date.now(), lastWrong = false): JudgeAction {
    let m = firstMistake(matched);
    // Dr. Amr 2026-11-21: the LAST word said was wrong and the user pressed «خلصت» without
    // finishing the ayah: that is a counted mistake (at the first word not matched), not just
    // missing words.
    if (m < 0 && final && lastWrong && !allMatched && matched.length > 0) m = matched.lastIndexOf(true) + 1;
    // Item 16.3: the clock belongs to ONE absolute word index. It is dropped only when that
    // word itself is now right; a mistake at another index starts its own clock.
    if (this.pendingIdx !== null) {
      const rel = this.pendingIdx - this.base;
      const fixed = rel >= 0 && rel < matched.length && matched[rel];
      if (fixed || (m >= 0 && this.base + m !== this.pendingIdx)) { this.since = null; this.pendingIdx = null; }
    }
    if (m >= 0 && this.pendingIdx === null) { this.since = now; this.pendingIdx = this.base + m; }
    if (m >= 0) {
      const last = matched.lastIndexOf(true);
      const wrong = matched.slice(0, last).filter((x) => !x).length;
      const timedOut = this.mistakeMs !== null && this.since !== null && now - this.since >= this.mistakeMs;
      const due = final || last === matched.length - 1 || wrong >= WRONG_WORDS_LIMIT || timedOut;
      if (!due) return { kind: 'continue' };
      this.creditUpTo(matched, m);
      this.since = null;
      this.pendingIdx = null;
      if (this.corrLeft > 0) {
        this.corrLeft -= 1;
        this.mistaken.add(this.base + m);
        this.base += m;
        return { kind: 'correct' };
      }
      this.lockedAt = this.base + m;
      return { kind: 'finish', locked: true }; // no correction left: the position closes
    }
    if (allMatched || final) {
      this.creditUpTo(matched, matched.length);
      return { kind: 'finish', locked: false };
    }
    return { kind: 'continue' };
  }

  /** What goes into the RoundResult. `mistakes` = words the reciter corrected, plus the one
   *  that closed the position. */
  summary(locked: boolean) {
    // Item 16.5: locked -> the shown mistakes are exactly the corrected words plus the one that
    // closed the position; the tail the user never said is neither credited nor a mistake.
    // Not locked -> words not credited, plus every corrected word (16.4 may credit it later,
    // but the reciter still had to correct it).
    let wrong: number[];
    if (locked) {
      const set = new Set<number>(this.mistaken);
      if (this.lockedAt !== null) set.add(this.lockedAt);
      wrong = [...set].sort((a, b) => a - b);
    } else {
      const set = new Set<number>(this.mistaken);
      this.got.forEach((g, i) => { if (!g) set.add(i); });
      wrong = [...set].sort((a, b) => a - b);
    }
    return {
      credited: this.got.filter(Boolean).length,
      wrong,
      locked,
      corrected: this.mistaken.size,
      mistakes: this.mistaken.size + (locked ? 1 : 0),
    };
  }
}
