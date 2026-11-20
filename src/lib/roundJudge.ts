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
//   2. MISTAKE_MS (10 s) since the first unfixed mistake, or
//   3. the ayah is over (its last word was said) or the user pressed «خلصت».
// The clock starts the first time a wrong word can be seen as wrong (a later word matched)
// and is dropped if the user fixes it before anything above holds. A silence by itself judges
// nothing (the old 1.8 s quiet rule and the «cut in at the last word only» rule are gone).
import { firstMistake } from './roundTest';

/** The reciter corrects the first counted mistake once, in BOTH tests (tarteel and comprehensive):
 *  one rule, one setting. The next counted mistake closes the position. */
export const ROUND_CORRECTIONS = 1;
export const WRONG_WORDS_LIMIT = 3;
export const MISTAKE_MS = 10_000;

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
  /** When the first still-unfixed mistake was seen (null = none right now). */
  since: number | null = null;

  constructor(total: number, corrections: number) {
    this.corrLeft = corrections;
    this.got = new Array<boolean>(total).fill(false);
  }

  /** «اديني كلمتين كمان»: the completed part got shorter, start over. */
  reset(total: number) {
    this.got = new Array<boolean>(total).fill(false);
    this.base = 0;
  }

  private creditUpTo(matched: boolean[], limit: number) {
    for (let k = 0; k < limit && k < matched.length; k++) {
      const idx = this.base + k;
      if (matched[k] && !this.mistaken.has(idx)) this.got[idx] = true;
    }
  }

  /** Milliseconds until the 10 s deadline of the current unfixed mistake (null = no mistake). */
  msUntilDue(now: number): number | null {
    return this.since === null ? null : Math.max(0, MISTAKE_MS - (now - this.since));
  }

  /** Judge what the user said (`matched` is relative to the current start). `final` = «خلصت». */
  evaluate(matched: boolean[], allMatched: boolean, final: boolean, now: number = Date.now()): JudgeAction {
    const m = firstMistake(matched);
    // The clock runs only while a mistake stays unfixed: a fix (the word matches later) drops it.
    if (m < 0) this.since = null;
    else if (this.since === null) this.since = now;
    if (m >= 0) {
      const last = matched.lastIndexOf(true);
      const wrong = matched.slice(0, last).filter((x) => !x).length;
      const due = final || last === matched.length - 1 || wrong >= WRONG_WORDS_LIMIT || now - (this.since ?? now) >= MISTAKE_MS;
      if (!due) return { kind: 'continue' };
      this.creditUpTo(matched, m);
      this.since = null;
      if (this.corrLeft > 0) {
        this.corrLeft -= 1;
        this.mistaken.add(this.base + m);
        this.base += m;
        return { kind: 'correct' };
      }
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
    const wrong: number[] = [];
    this.got.forEach((g, i) => { if (!g) wrong.push(i); });
    return {
      credited: this.got.filter(Boolean).length,
      wrong,
      locked,
      corrected: this.mistaken.size,
      mistakes: this.mistaken.size + (locked ? 1 : 0),
    };
  }
}
