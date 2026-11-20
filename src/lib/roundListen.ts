// roundListen.ts — the listening logic of one round position (RoundRecite), kept out of
// the component so it can be tested with a fake recognizer in plain Node (no React, no DOM).
import type { Rec, RecEvent } from './speechResults.ts';

export const QUIET_MS = 1800;
/** After «خلصت» we wait this long for the engine's own `end` before grading anyway. */
export const STOP_GRACE_MS = 2500;

export type AlignFn = (expected: string[], spokenText: string) => { matched: boolean[]; allMatched: boolean };

/** Grade what was said against the words AFTER the prompt (`start` = ayah index of the first one).
 *
 *  Aligned two ways, the better one wins (ties -> rest only):
 *   - rest only: right when the user says just the rest. A transcript that also contains the
 *     prompt (speaker -> mic, or the user repeating it) leaves extra words in front.
 *   - the whole ayah, then the part before `start` is cut off: absorbs those prompt words so
 *     they neither shift the rest nor count. But when the user says only the rest, the aligner
 *     often latches the first spoken word onto an EARLIER occurrence of the same word in the
 *     prompt and loses the rest (real data: 509 of 4017 ayat with 8+ words, e.g. 2:23 0/15).
 *  Either alone breaks real ayat (rest only: 65 with the prompt spoken; whole ayah: 509 without);
 *  best-of gets all 4017 right in both cases. `matched[k]` is the word at ayah index `start + k`. */
export function alignRest(fullNorms: string[], start: number, spokenText: string, align: AlignFn): { matched: boolean[]; allMatched: boolean } {
  const rest = align(fullNorms.slice(start), spokenText).matched;
  const cut = align(fullNorms, spokenText).matched.slice(start);
  const count = (m: boolean[]) => m.reduce((n, v) => n + (v ? 1 : 0), 0);
  const matched = count(cut) > count(rest) ? cut : rest;
  return { matched, allMatched: matched.length > 0 && matched.every(Boolean) };
}

export type ListenOpts = {
  rec: Rec;
  kind: 'lab' | 'browser';
  readResults: (e: RecEvent, finals: string) => { finals: string; interim: string };
  /** True for an event without any transcript (the keepalive). */
  isEmptyEvent: (e: RecEvent) => boolean;
  /** The page is in its «listening» phase (quiet timer / restarts only run then). */
  isListening: () => boolean;
  /** Finals or interim text changed (never fired for an empty keepalive): refresh the live counter. */
  onText: (text: string) => void;
  /** No new speech for QUIET_MS while listening: evaluate(false). */
  onQuiet: () => void;
  /** The browser engine ended by itself and `start()` threw: log + show it. */
  onRestartError: (err: unknown) => void;
  quietMs?: number;
  graceMs?: number;
};

export class ListenSession {
  finals = '';
  interim = '';
  private active = true;
  private quietT: ReturnType<typeof setTimeout> | null = null;
  private graceT: ReturnType<typeof setTimeout> | null = null;
  private o: ListenOpts;
  constructor(o: ListenOpts) { this.o = o; }

  text(): string { return `${this.finals} ${this.interim}`.trim(); }

  attach(): void {
    const { rec } = this.o;
    rec.onresult = (e) => {
      if (!this.active) return;
      // The device ear sends an EMPTY result as a keepalive every ~1.5 s. It says nothing about
      // speech: it must not clear the interim text, refresh the live counter or restart the
      // quiet timer (it used to restart it, so the 1.8 s timer never fired in a silence).
      if (this.o.isEmptyEvent(e)) return;
      const r = this.o.readResults(e, this.finals);
      const changed = r.finals !== this.finals || r.interim !== this.interim;
      this.finals = r.finals;
      this.interim = r.interim;
      if (!changed) return; // same text again (e.g. an identical interim repeat)
      this.o.onText(this.text());
      if (!this.o.isListening()) return;
      this.armQuiet();
    };
    // The browser engine ends by itself after a silence: keep it open while we wait.
    rec.onend = () => {
      if (this.o.kind === 'browser' && this.active && this.o.isListening()) {
        try { rec.start(); } catch (err) { this.o.onRestartError(err); }
      }
    };
  }

  private armQuiet(): void {
    this.clearQuiet();
    this.quietT = setTimeout(() => { this.quietT = null; if (this.active) this.o.onQuiet(); }, this.o.quietMs ?? QUIET_MS);
  }
  private clearQuiet(): void { if (this.quietT) { clearTimeout(this.quietT); this.quietT = null; } }

  /** Stop listening without grading. */
  abort(): void {
    this.active = false;
    this.clearQuiet();
    if (this.graceT) { clearTimeout(this.graceT); this.graceT = null; }
    const { rec } = this.o;
    rec.onresult = null; rec.onend = null; rec.onerror = null;
    try { rec.abort(); } catch { /* ignore */ }
  }

  /** «خلصت»: flush the engine, then call `grade` exactly once: when its `end` arrives, or after
   *  `graceMs` if it never does. Results that arrive in between still count. */
  stopAndGrade(grade: (via: 'end' | 'timeout') => void): void {
    this.clearQuiet();
    let done = false;
    const go = (via: 'end' | 'timeout') => {
      if (done) return;
      done = true;
      if (this.graceT) { clearTimeout(this.graceT); this.graceT = null; }
      this.active = false;
      grade(via);
    };
    this.o.rec.onend = () => go('end');
    this.graceT = setTimeout(() => go('timeout'), this.o.graceMs ?? STOP_GRACE_MS);
    try { this.o.rec.stop(); } catch { /* the grace timer still grades */ }
  }
}
