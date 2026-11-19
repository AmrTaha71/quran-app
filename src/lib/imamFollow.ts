// Continuous follow-the-imam core (W5-M, 2026-11-19). Pure: no React, no DOM.
//
// imamTracker.ts LOCKS once on 5 heard words and stops. This module keeps
// going: after the first lock it walks forward with the imam letter by
// letter, so the highlight moves with the voice, and re-locks by itself
// when it gets lost (a jump to a similar ayah, a new surah, noise).
//
// It works on CONSONANT SKELETONS, the same alphabet the Quran-Lab ear
// writes (phonemeEar.phonSkel): the ear has no word boundaries, so the
// whole Mushaf is one long letter string and every letter knows its word.
//  - search  : 4-letter grams vote for candidate places in the Mushaf;
//              the best few are aligned (edit distance, free start/end)
//              against the heard letters. A lock needs enough letters, a
//              low error rate and a clear margin over the next-best
//              DIFFERENT place (a repeated phrase such as the basmala
//              never locks on its own; it waits for more letters).
//  - follow  : each new chunk re-aligns the last heard letters against a
//              short window around the current place; the end of that
//              alignment is the letter (→ word) being recited now.
//  - lost    : a run of bad alignments drops back to search, keeping the
//              old place as a prior (a candidate just ahead of it wins
//              ties: the imam usually goes on, not back).
// Input is either the ear's timed phoneme parts (pushPhonemes) or plain
// heard words from a text recognizer (pushWords); both become letters.
//
// Measured offline with tools/imam-eval (report: plan/imam-tracking-report.md).

export type FollowWord = { norm: string; skel: string };
export interface FollowVerse { surah: number; ayah: number; words: FollowWord[] }

export interface FollowIndex {
  /** Every word of the Mushaf, in order. */
  words: { surah: number; ayah: number; word: number; start: number; end: number }[];
  /** All word skeletons joined (runs collapsed across word joins). */
  letters: string;
  /** Word (index into words) that owns each letter. */
  owner: Int32Array;
  /** Letter positions sorted by their 4-letter gram code (see gramAt). */
  gramPos: Int32Array;
  gramKey: Float64Array;
  /** Per word: letter index where its surah ends (exclusive). */
  surahEnd: Int32Array;
}

// Gram code: 4 letters packed as a number (letters are BMP code points).
function gramCode(s: string, i: number): number {
  return ((s.charCodeAt(i) * 65536 + s.charCodeAt(i + 1)) * 65536 + s.charCodeAt(i + 2)) * 65536 + s.charCodeAt(i + 3);
}
/** Positions in the Mushaf letters where H[i..i+4) occurs (empty if none). */
function gramHits(idx: FollowIndex, H: string, i: number): { from: number; to: number } {
  const k = gramCode(H, i);
  const K = idx.gramKey;
  let lo = 0, hi = K.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (K[mid] < k) lo = mid + 1; else hi = mid; }
  const from = lo;
  hi = K.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (K[mid] <= k) lo = mid + 1; else hi = mid; }
  return { from, to: lo };
}

const GRAM = 4;

/** Phonetic script → skeleton (same rules as phonemeEar.phonSkel). */
export function followSkel(s: string): string {
  const t = s
    .replace(/[ً-ْـڇؙ۪ۜ\s]/g, '')
    .replace(/ۥ/g, 'و')
    .replace(/ۦ/g, 'ي')
    .replace(/ں/g, 'ن')
    .replace(/ٲ/g, 'ا')
    .replace(/۾/g, 'م');
  return t.replace(/(.)\1+/g, '$1');
}

/** Normalised text word → rough skeleton (for text recognizers' words). */
export function textWordSkel(norm: string): string {
  return followSkel(norm
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/ى/g, 'ا')
    .replace(/ة/g, 'ت'));
}

/** `verses` in Mushaf order. Entries with surah 0 are non-Quran openings
 *  (the isti'adha): the search recognises them and skips them, so «أعوذ
 *  بالله من الشيطان الرجيم» never locks onto 16:98. Put them first. */
export function buildFollowIndex(verses: FollowVerse[]): FollowIndex {
  const words: FollowIndex['words'] = [];
  const chars: string[] = []; // (string += then indexing re-flattens: O(n²))
  const own: number[] = [];
  for (const v of verses) {
    v.words.forEach((w, wi) => {
      const g = words.length;
      const start = chars.length;
      for (const c of w.skel) {
        if (chars.length && chars[chars.length - 1] === c) continue;
        chars.push(c); own.push(g);
      }
      words.push({ surah: v.surah, ayah: v.ayah, word: wi, start, end: chars.length });
    });
  }
  const letters = chars.join('');
  const surahEnd = new Int32Array(words.length);
  for (let g = words.length - 1; g >= 0; g--) {
    surahEnd[g] = g + 1 < words.length && words[g + 1].surah === words[g].surah ? surahEnd[g + 1] : words[g].end;
  }
  const n = Math.max(0, letters.length - GRAM + 1);
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i++) keys[i] = gramCode(letters, i);
  const gramPos = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => keys[a] - keys[b] || a - b);
  const gramKey = new Float64Array(n);
  for (let i = 0; i < n; i++) gramKey[i] = keys[gramPos[i]];
  return { words, letters, owner: Int32Array.from(own), gramPos, gramKey, surahEnd };
}

/** The isti'adha as a surah-0 entry, built from 16:98's own skeletons
 *  («...بالله من الشيطان الرجيم») with «أعوذ» in front. */
export function istiadhaVerse(verses: FollowVerse[]): FollowVerse | null {
  const v = verses.find((x) => x.surah === 16 && x.ayah === 98);
  if (!v || v.words.length < 4) return null;
  return { surah: 0, ayah: 0, words: [{ norm: 'اعوذ', skel: textWordSkel('اعوذ') }, ...v.words.slice(-4)] };
}

// ---- alignment ---------------------------------------------------------
// Cheap edits the ear makes on correct recitation: soft alef/hamza, the
// madd hamza it adds, ta marbuta read as ت, nun/mim in ikhfa'/iqlab.
const SOFT = 'اءوي';
function subCost(h: string, e: string): number {
  if (h === e) return 0;
  if (SOFT.includes(h) && SOFT.includes(e)) return 0.5;
  if ((h === 'ت' && e === 'ه') || (h === 'ه' && e === 'ت')) return 0.5;
  if ((h === 'ن' && e === 'م') || (h === 'م' && e === 'ن')) return 0.5;
  return 1;
}
const insCost = (h: string) => (SOFT.includes(h) ? 0.5 : 1); // heard letter not in text
const delCost = (e: string) => (SOFT.includes(e) || e === 'ل' || e === 'ن' ? 0.5 : 1); // text letter not heard

export interface AlignResult { cost: number; start: number; end: number }
/** Heard H (all of it) against Q[lo, hi) with free start and end in Q.
 *  `endPenalty(j)` is added for an alignment ending at letter j (exclusive end). */
export function alignWindow(H: string, Q: string, lo: number, hi: number, endPenalty?: (j: number) => number): AlignResult | null {
  lo = Math.max(0, lo); hi = Math.min(Q.length, hi);
  const n = H.length, m = hi - lo;
  if (!n || m <= 0) return null;
  let prev = new Float32Array(m + 1);
  let cur = new Float32Array(m + 1);
  let prevS = new Int32Array(m + 1);
  let curS = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) { prev[j] = 0; prevS[j] = j; }
  for (let i = 1; i <= n; i++) {
    const h = H[i - 1];
    cur[0] = prev[0] + insCost(h); curS[0] = 0;
    for (let j = 1; j <= m; j++) {
      const e = Q[lo + j - 1];
      let c = prev[j - 1] + subCost(h, e); let s = prevS[j - 1];
      const ci = prev[j] + insCost(h); if (ci < c) { c = ci; s = prevS[j]; }
      const cd = cur[j - 1] + delCost(e); if (cd < c) { c = cd; s = curS[j - 1]; }
      cur[j] = c; curS[j] = s;
    }
    [prev, cur] = [cur, prev]; [prevS, curS] = [curS, prevS];
  }
  let best = Infinity, bj = -1;
  for (let j = 1; j <= m; j++) {
    const c = prev[j] + (endPenalty ? endPenalty(lo + j) : 0);
    if (c < best) { best = c; bj = j; }
  }
  if (bj < 0) return null;
  return { cost: best, start: lo + prevS[bj], end: lo + bj };
}

// ---- follower ----------------------------------------------------------
export interface FollowOptions {
  /** Heard letters needed before a first lock (≈ 3 words). */
  minLockLetters: number;
  /** Most heard letters a search looks at. */
  maxSearchLetters: number;
  /** Highest error rate (cost / letters) for a lock. */
  maxLockRate: number;
  /** Margin over the next-best different place: max(abs, rel × letters). */
  lockMarginAbs: number;
  lockMarginRel: number;
  /** Heard letters re-aligned on every follow step. */
  followTail: number;
  /** Follow window ahead of the current letter. */
  followAhead: number;
  /** A follow step with error rate above this is "bad". */
  badRate: number;
  /** Heard letters in bad steps in a row before declaring lost. */
  lostLetters: number;
}
export const DEFAULT_FOLLOW_OPTIONS: FollowOptions = {
  minLockLetters: 10,
  maxSearchLetters: 60,
  maxLockRate: 0.3,
  lockMarginAbs: 2,
  lockMarginRel: 0.1,
  followTail: 24,
  followAhead: 50,
  badRate: 0.35,
  lostLetters: 14,
};

export type FollowStatus = 'searching' | 'following';
export interface FollowPosition { surah: number; ayah: number; word: number; /** index into index.words */ g: number }
export interface FollowState {
  status: FollowStatus;
  /** Word being recited now (null before the first lock). */
  pos: FollowPosition | null;
  /** Error rate of the last alignment (0 = perfect). */
  rate: number;
  locks: number;
  losts: number;
  /** Audio time (s) of the heard letter the position comes from. */
  heardT: number;
  /** While searching on a repeated phrase (mutashabihat, e.g. 26:2 = 28:2):
   *  the two best places, so a page can hint «26 or 28?». Empty otherwise. */
  candidates: { surah: number; ayah: number }[];
}

export class ImamFollower {
  private H = '';
  private HT: number[] = [];
  private status: FollowStatus = 'searching';
  private posL = -1; // letter index of the last aligned heard letter
  private searchFrom = 0; // index in H where the current search buffer starts
  private badRun = 0;
  private prior = -1;
  private rate = 0;
  private locks = 0;
  private losts = 0;
  private sinceStep = 0;
  private cands: { surah: number; ayah: number }[] = [];
  readonly opt: FollowOptions;
  constructor(private idx: FollowIndex, opt: Partial<FollowOptions> = {}) {
    this.opt = { ...DEFAULT_FOLLOW_OPTIONS, ...opt };
  }

  reset(): void {
    this.H = ''; this.HT = []; this.status = 'searching'; this.posL = -1; this.searchFrom = 0;
    this.badRun = 0; this.prior = -1; this.rate = 0; this.locks = 0; this.losts = 0; this.sinceStep = 0; this.cands = [];
  }

  /** The ear's timed phoneme parts ({s: phonetic text, t: audio seconds}). */
  pushPhonemes(parts: { s: string; t: number }[]): FollowState {
    for (const p of parts) this.addLetters(followSkel(p.s), p.t);
    return this.step();
  }

  /** Words from a text recognizer (normalised or not), heard at tSeconds. */
  pushWords(words: string[] | string, tSeconds: number): FollowState {
    const ws = typeof words === 'string' ? words.split(/\s+/).filter(Boolean) : words;
    for (const w of ws) this.addLetters(textWordSkel(w.replace(/[^ء-ي]/g, '')), tSeconds);
    return this.step();
  }

  /** One entry point: phoneme parts or words. */
  push(input: { s: string; t: number }[] | string[] | string, tSeconds = 0): FollowState {
    if (Array.isArray(input) && input.length && typeof input[0] !== 'string') return this.pushPhonemes(input as { s: string; t: number }[]);
    return this.pushWords(input as string[] | string, tSeconds);
  }

  state(): FollowState {
    const g = this.posL >= 0 ? this.idx.owner[Math.min(this.posL, this.idx.owner.length - 1)] : -1;
    const w = g >= 0 ? this.idx.words[g] : null;
    return {
      status: this.status,
      pos: w ? { surah: w.surah, ayah: w.ayah, word: w.word, g } : null,
      rate: this.rate,
      locks: this.locks,
      losts: this.losts,
      heardT: this.HT.length ? this.HT[this.HT.length - 1] : 0,
      candidates: this.status === 'searching' ? this.cands : [],
    };
  }

  private addLetters(sk: string, t: number) {
    for (const c of sk) {
      if (this.H.length && this.H[this.H.length - 1] === c) continue;
      this.H += c; this.HT.push(t); this.sinceStep++;
    }
    // Keep the buffers bounded (search never needs more than maxSearchLetters).
    const keep = Math.max(this.opt.maxSearchLetters, this.opt.followTail) + 40;
    if (this.H.length > keep * 2) {
      const cut = this.H.length - keep;
      this.H = this.H.slice(cut); this.HT = this.HT.slice(cut);
      this.searchFrom = Math.max(0, this.searchFrom - cut);
    }
  }

  private step(): FollowState {
    if (this.sinceStep === 0) return this.state();
    const fresh = this.sinceStep;
    this.sinceStep = 0;
    if (this.status === 'following') this.follow(fresh);
    if (this.status === 'searching') this.search();
    return this.state();
  }

  private follow(fresh: number) {
    const Q = this.idx.letters;
    const tail = this.H.slice(-this.opt.followTail);
    const expect = this.posL + 1 + fresh;
    const lo = this.posL + 1 - (tail.length - fresh) - 12;
    // The window stops at the end of the surah: what follows a surah is
    // a basmala and ANY surah (in prayer, after al-Fatiha), never simply
    // the next one in the Mushaf, so a surah change always goes through
    // a fresh search.
    const sEnd = this.idx.surahEnd[this.idx.owner[this.posL]];
    const hi = Math.min(sEnd, this.posL + 1 + fresh * 2 + this.opt.followAhead);
    const atEnd = this.posL >= sEnd - 3;
    const r = alignWindow(tail, Q, lo, hi, (j) => 0.04 * Math.abs(j - expect) / 2);
    if (!r) return;
    this.rate = r.cost / tail.length;
    if (this.rate > this.opt.badRate) {
      this.badRun += fresh;
      if (this.badRun >= (atEnd ? Math.ceil(this.opt.lostLetters / 2) : this.opt.lostLetters)) {
        this.status = 'searching'; this.losts++;
        this.prior = this.posL;
        this.searchFrom = Math.max(0, this.H.length - this.badRun);
        this.badRun = 0;
      }
      return;
    }
    this.badRun = 0;
    const end = r.end - 1;
    // Never step back on a little evidence (a short sound matching an
    // earlier word); a real repeat re-aligns cleanly over many letters.
    if (end < this.posL - 2 && !(this.rate < 0.15 && this.posL - end >= 6)) return;
    this.posL = end;
  }

  private search() {
    const o = this.opt;
    const Q = this.idx.letters;
    let H = this.H.slice(this.searchFrom);
    if (H.length > o.maxSearchLetters) { H = H.slice(-o.maxSearchLetters); }
    if (H.length < o.minLockLetters) return;
    // Votes per diagonal bucket.
    const votes = new Map<number, number>();
    for (let i = 0; i + GRAM <= H.length; i++) {
      const { from, to } = gramHits(this.idx, H, i);
      if (to <= from || to - from > 4000) continue;
      for (let k = from; k < to; k++) {
        const b = Math.floor((this.idx.gramPos[k] - i) / 8);
        votes.set(b, (votes.get(b) ?? 0) + 1);
      }
    }
    const cands = [...votes.entries()].filter((e) => e[1] >= 2).sort((a, b) => b[1] - a[1]).slice(0, 16);
    const res: AlignResult[] = [];
    for (const [b] of cands) {
      const d = b * 8;
      const r = alignWindow(H, Q, d - 16, d + H.length + 24);
      if (r && !res.some((x) => Math.abs(x.end - r.end) <= 12)) res.push(r);
      else if (r) {
        const k = res.findIndex((x) => Math.abs(x.end - r.end) <= 12);
        if (r.cost < res[k].cost) res[k] = r;
      }
    }
    if (!res.length) return;
    // A place just ahead of the prior (where it was lost) wins near-ties.
    const adj = (r: AlignResult) => r.cost - (this.prior >= 0 && r.end > this.prior - 20 && r.end < this.prior + 400 ? 1.5 : 0);
    res.sort((a, b) => adj(a) - adj(b));
    const best = res[0];
    const second = res.find((x) => Math.abs(x.end - best.end) > 20);
    const rate = best.cost / H.length;
    this.rate = rate;
    const margin = Math.max(o.lockMarginAbs, o.lockMarginRel * H.length);
    if (rate > o.maxLockRate) return;
    this.cands = [];
    if (second && adj(second) - adj(best) < margin) {
      // Ambiguous (a repeated phrase): wait for more letters.
      const at = (r: AlignResult) => { const w = this.idx.words[this.idx.owner[Math.max(0, r.end - 1)]]; return { surah: w.surah, ayah: w.ayah }; };
      const a = at(best), b = at(second);
      if (a.surah > 0 && b.surah > 0 && !(a.surah === 1 && a.ayah === 1)) this.cands = [a, b];
      return;
    }
    const bw = this.idx.words[this.idx.owner[Math.max(0, best.end - 1)]];
    if (bw.surah === 0 || (bw.surah === 1 && bw.ayah === 1)) {
      // The isti'adha (not Quran text) or a basmala alone (said before
      // every surah, so it names no place): drop it and keep listening.
      this.searchFrom = this.H.length;
      return;
    }
    this.status = 'following';
    this.posL = best.end - 1;
    this.locks++;
    this.badRun = 0;
    this.prior = -1;
  }
}
