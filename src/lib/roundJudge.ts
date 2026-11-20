// The grading state of ONE round / position, shared by «اختبار الترتيل» and «الاختبار
// الشامل» (both run it through components/RoundRecite.tsx).
//
// What counts as a mistake: a word the reciter had to correct. A word the user got wrong
// and then said right again BEFORE the reciter spoke is not a mistake: the aligner
// (alignRest -> alignWords) already skips the stray words, so `matched` shows that word as
// right and firstMistake() never sees it. Only `matched` words still wrong at «خلصت» / the
// quiet timer reach this class, and the reciter plays right after, so the order
// "wrong word -> right word -> reciter" is exactly what the aligner sees.
import { firstMistake } from './roundTest';

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

  /** Judge what the user said (`matched` is relative to the current start). */
  evaluate(matched: boolean[], allMatched: boolean, final: boolean): JudgeAction {
    const m = firstMistake(matched);
    if (m >= 0) {
      this.creditUpTo(matched, m);
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
