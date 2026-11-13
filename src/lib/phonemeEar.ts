// Phoneme → words (2026-11-13). The Quran-Lab model writes what it hears
// as a phonetic script with no word boundaries. This module aligns each
// heard segment to the expected words of the range and turns it back
// into words, so the existing tasmee' logic (breath restarts, last
// reading, isti'adha/basmala, reciter correction) works unchanged:
//  - a word whose sounds match → its expected text (counts as correct);
//  - a word with a wrong, extra or substituted letter → the heard sounds
//    (never equal to the word → counted as a mistake);
//  - a word not heard at all → nothing (the word aligner sees it missing).
// Comparison is on consonant skeletons: short vowels and madd lengths are
// ignored (madd ʿāriḍ / munfaṣil lengths are all valid), and one dropped
// letter in a word of 3+ letters is tolerated (breath cut). A substituted
// or added letter is never tolerated (Dr. Amr's rule).

export type PhonWord = { norm: string; skel: string };

const REF_URL = '/models/quranlab/quran_text2phoneme.json';

/** Phonetic script → skeleton: no short vowels or marks, madd letters
 *  folded to their base letter, every run collapsed to one letter. */
export function phonSkel(s: string): string {
  const t = s
    .replace(/[ً-ْـڇؙ۪ۜ\s]/g, '')
    .replace(/ۥ/g, 'و')
    .replace(/ۦ/g, 'ي')
    .replace(/ں/g, 'ن')
    .replace(/ٲ/g, 'ا')
    .replace(/۾/g, 'م');
  return t.replace(/(.)\1+/g, '$1');
}

/** Normalised text word → rough skeleton (only used to locate words
 *  inside the phonetic script; the phonetic script is the reference). */
function textSkel(norm: string): string {
  return norm
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/ى/g, 'ا')
    .replace(/ة/g, 'ت')
    .replace(/(.)\1+/g, '$1');
}

const softSkeleton = (w: string) => w.replace(/ة/g, 'ه').replace(/(?<=.)ا(?=.)/g, '').replace(/يي+/g, 'ي').replace(/لل+/g, 'ل');

let refIndex: Promise<Map<string, string>> | null = null;
let refNormalize: ((key: string) => string) | null = null;

/** Loads the reference once. `keySkel` must turn a diacritised key into
 *  the same word-skeleton string the page builds from its ayah words. */
export function loadPhonemeRef(keySkel: (key: string) => string): Promise<Map<string, string>> {
  refNormalize = keySkel;
  if (!refIndex) {
    refIndex = fetch(REF_URL).then((r) => r.json()).then((obj: Record<string, string>) => {
      const m = new Map<string, string>();
      for (const [k, v] of Object.entries(obj)) {
        const s = keySkel(k);
        if (!m.has(s)) m.set(s, v);
      }
      return m;
    });
  }
  return refIndex;
}

/** Edit-distance alignment of two strings; returns, for each char of b,
 *  the index in a it aligns to (or the previous one for insertions). */
function alignMap(a: string, b: string): number[] {
  const n = a.length, m = b.length;
  const d: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) { d.push(new Uint16Array(m + 1)); d[i][0] = i; }
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  const map = new Array<number>(m).fill(0);
  let i = n, j = m;
  while (j > 0) {
    if (i > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { map[j - 1] = i - 1; i--; j--; }
    else if (d[i][j] === d[i][j - 1] + 1) { map[j - 1] = Math.max(0, i - 1); j--; }
    else i--;
  }
  return map;
}

/** Phonetic skeleton for every expected word of the range. Ayah texts are
 *  covered by reference entries (waqf segments); where none matches, the
 *  word's own text skeleton is used. */
export async function buildPhonWords(words: { norm: string; ayahIdx: number }[], keySkel: (key: string) => string): Promise<PhonWord[]> {
  const ref = await loadPhonemeRef(keySkel);
  const wordSk = words.map((w) => softSkeleton(w.norm));
  const out: PhonWord[] = words.map((w) => ({ norm: w.norm, skel: phonSkel(textSkel(w.norm)) }));
  let i = 0;
  while (i < words.length) {
    // Longest run of words starting at i that is a reference entry.
    let found = -1;
    let acc = '';
    for (let j = i; j < Math.min(words.length, i + 60); j++) {
      acc += wordSk[j];
      if (ref.has(acc)) found = j;
    }
    if (found < 0) { i++; continue; }
    const phon = ref.get(wordSk.slice(i, found + 1).join(''))!;
    const ps = phonSkel(phon);
    // Map the phonetic skeleton chars onto the words of the run.
    let txt = '';
    const owner: number[] = [];
    for (let j = i; j <= found; j++) {
      const t = phonSkel(textSkel(words[j].norm));
      for (let k = 0; k < t.length; k++) owner.push(j);
      txt += t;
    }
    const map = alignMap(txt, ps);
    const parts: string[] = Array.from({ length: found - i + 1 }, () => '');
    for (let k = 0; k < ps.length; k++) parts[(owner[map[k]] ?? found) - i] += ps[k];
    for (let j = i; j <= found; j++) out[j] = { norm: words[j].norm, skel: parts[j - i].replace(/(.)\1+/g, '$1') || out[j].skel };
    i = found + 1;
  }
  return out;
}

type Aligned = { cost: number; owner: Int32Array; firstW: number; lastW: number; per: Map<number, WordAl> };
type WordAl = { bad: number; del: number; len: number; heard: string; touched: boolean; first: boolean; pre: string };

/** Semi-global alignment of heard skeleton H to the words near `pointer`.
 *  owner[i] = word index of heard letter i (-1 = before the first word). */
function alignHeard(H: string, words: PhonWord[], pointer: number): Aligned | null {
  const lo = Math.max(0, pointer - 15);
  const hi = Math.min(words.length, pointer + 40);
  if (lo >= hi || !H.length) return null;
  let E = '';
  const colWord: number[] = [];
  const isBoundary: number[] = [];
  for (let w = lo; w < hi; w++) {
    isBoundary[E.length] = 1;
    for (const c of words[w].skel) { colWord.push(w); E += c; }
  }
  const n = H.length, m = E.length;
  isBoundary[m] = 1;
  const LEAD = 0.6;
  const INF = 1e9;
  const d: Float32Array[] = [];
  const bt: Uint8Array[] = [];
  for (let i = 0; i <= n; i++) { d.push(new Float32Array(m + 1).fill(INF)); bt.push(new Uint8Array(m + 1)); }
  for (let j = 0; j <= m; j++) if (isBoundary[j]) {
    const w = j < m ? colWord[j] : hi;
    for (let i = 0; i <= n; i++) {
      const c = i * LEAD + 0.02 * Math.abs(w - pointer);
      if (c < d[i][j]) { d[i][j] = c; bt[i][j] = 3; }
    }
  }
  for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
    if (i > 0 && j > 0) { const c = d[i - 1][j - 1] + (H[i - 1] === E[j - 1] ? 0 : 1); if (c < d[i][j]) { d[i][j] = c; bt[i][j] = 0; } }
    if (i > 0) { const c = d[i - 1][j] + 1; if (c < d[i][j]) { d[i][j] = c; bt[i][j] = 1; } }
    if (j > 0) { const c = d[i][j - 1] + 1; if (c < d[i][j]) { d[i][j] = c; bt[i][j] = 2; } }
  }
  let bestJ = -1, best = INF;
  for (let j = 1; j <= m; j++) if (isBoundary[j] && d[n][j] < best) { best = d[n][j]; bestJ = j; }
  if (bestJ < 0) return null;
  const per: Aligned['per'] = new Map();
  const get = (w: number) => { let x = per.get(w); if (!x) { x = { bad: 0, del: 0, len: words[w].skel.length, heard: '', touched: false, first: false, pre: '' }; per.set(w, x); } return x; };
  const owner = new Int32Array(n).fill(-1);
  let i = n, j = bestJ, lastCol = bestJ - 1;
  while (i > 0 || j > 0) {
    const b = bt[i][j];
    if (b === 3) break;
    if (b === 0) { const w = colWord[j - 1]; const x = get(w); x.heard = H[i - 1] + x.heard; x.touched = true; if (H[i - 1] !== E[j - 1]) x.bad++; else if (isBoundary[j - 1]) x.first = true; owner[i - 1] = w; lastCol = j - 1; i--; j--; }
    else if (b === 1) {
      // Extra heard letter. Between two words (j on a word boundary) it is
      // a separate extra sound, kept apart from the word that follows;
      // inside a word it is that word's added letter.
      const w = colWord[Math.max(0, Math.min(m - 1, lastCol))];
      const x = get(w);
      if (isBoundary[j] && j < m) x.pre = H[i - 1] + x.pre;
      else if (isBoundary[j] && j === m) { /* trailing extra after the last word: ignore */ }
      else { x.heard = H[i - 1] + x.heard; x.bad++; x.touched = true; }
      owner[i - 1] = w; i--;
    }
    else { get(colWord[j - 1]).del++; lastCol = j - 1; j--; }
  }
  return { cost: best, owner, firstW: j < m ? colWord[j] : hi - 1, lastW: colWord[bestJ - 1], per };
}

const MUQATTAAT = new Set(['الم', 'المص', 'الر', 'المر', 'كهيعص', 'طه', 'طسم', 'طس', 'يس', 'ص', 'حم', 'عسق', 'ق', 'ن']);

function judge(words: PhonWord[], w: number, x: WordAl | undefined): string | null {
  if (!x || !x.touched) return null; // not heard → missing
  const pre = x.pre.length >= 5 ? `~${x.pre} ` : '';
  // No wrong or added letter: dropped letters are the ear missing quiet
  // sounds (or a breath cut), tolerated up to half the word as long as
  // the word's first letter was heard.
  // A leading hamza is often too soft to hear after a pause (أولئك), so
  // its absence alone does not cost the word its first letter.
  // Same for a leading «و»: after a pause the ear often loses it («والذين» → «للذين»).
  const firstOk = x.first || ((words[w].skel[0] === 'ء' || words[w].skel[0] === 'و' || words[w].skel[0] === 'ا') && x.heard[0] === words[w].skel[1]);
  // Disjoint letters (الم، حم، طسم…) are spelled out, not words: the ear garbles them often.
  if (MUQATTAAT.has(words[w].norm) && x.touched) return pre + words[w].norm;
  // One extra glide (ء ي و) inside a word is the ear's vowel spilling over («هدى» → «هءد», «هيد»).
  if (x.heard.length === words[w].skel.length + 1) {
    for (let k = 0; k < x.heard.length; k++) {
      if ('ءيو'.includes(x.heard[k]) && x.heard.slice(0, k) + x.heard.slice(k + 1) === words[w].skel) return pre + words[w].norm;
    }
  }
  // Word-final ى (alif maqsura: ترى، هدى، الأعلى) is the same sound as ا; the
  // reference may spell it ي, so a final ا/ي swap is not a mistake.
  { const sk0 = words[w].skel, h0 = x.heard;
    if (h0.length === sk0.length && sk0.length >= 3 && h0.slice(0, -1) === sk0.slice(0, -1)
        && 'اي'.includes(h0[h0.length - 1]) && 'اي'.includes(sk0[sk0.length - 1])) return pre + words[w].norm; }
  // «فيه هدى»: two ه in a row, the ear hears the second as ء (seen in four recordings).
  if (x.bad === 1 && x.del === 0 && w > 0 && words[w].skel[0] === 'ه' && words[w - 1].skel.endsWith('ه')
      && x.heard.length === words[w].skel.length && x.heard[0] === 'ء' && x.heard.slice(1) === words[w].skel.slice(1)) return pre + words[w].norm;
  if (x.bad === 0 && (x.del === 0 || (x.len >= 3 && firstOk && x.del <= Math.max(1, Math.floor(x.len / 2))))) return pre + words[w].norm;
  if (x.bad === 0 && x.heard.length * 2 <= x.len) return pre ? pre.trim() : null; // mostly cut: treat as not heard
  // A false start glued to a word (restart after a breath, «رزقناهم يقـ…»
  // then «ينفقون»): the whole word was heard; the fragment is not a mistake
  // in the word. A fragment before it is kept apart like any extra sound.
  const sk = words[w].skel, h = x.heard;
  if (sk.length >= 3 && h.length > sk.length) {
    if (h.startsWith(sk)) { const t = h.slice(sk.length); return (pre + words[w].norm + (t.length > 4 ? ` ~${t}` : '')); }
    const tail = h.endsWith(sk) ? sk : sk[0] === 'ء' && h.endsWith(sk.slice(1)) ? sk.slice(1) : '';
    if (tail) { const t = h.slice(0, h.length - tail.length); return pre + (t.length >= 5 ? `~${t} ` : '') + words[w].norm; }
  }
  return `${pre}~${x.heard}`;
}

/** Streaming phonemes → words. push() the decoded text as it arrives;
 *  it returns the words that are settled (every aligned word except the
 *  last one, which may still be growing). finish() settles the rest. */
export class PhonemeStream {
  private buf = '';
  pointer = 0;
  constructor(private words: PhonWord[]) {}
  private tbuf: number[] = []; // audio time (s) of every letter in buf
  private lastT = 0;
  push(raw: string): string { return this.pushTimed([{ s: raw, t: this.lastT }]); }
  /** Same as push, but every decoded token carries its audio time. */
  pushTimed(parts: { s: string; t: number }[]): string {
    for (const p of parts) {
      this.lastT = p.t;
      for (const ch of phonSkel(p.s)) {
        if (this.buf.length && this.buf[this.buf.length - 1] === ch) continue;
        this.buf += ch; this.tbuf.push(p.t);
      }
    }
    return this.step(false);
  }
  finish(): string { const t = this.step(true); this.buf = ''; this.tbuf = []; return t; }
  private step(final: boolean): string {
    const H = this.buf;
    if (H.length < 2) return '';
    const a = alignHeard(H, this.words, this.pointer);
    if (!a || a.cost > Math.max(3, 0.45 * H.length)) {
      // Nothing sensible: keep a short tail only, so noise cannot grow forever.
      if (H.length > 40) { this.buf = H.slice(-12); this.tbuf = this.tbuf.slice(-12); }
      if (final) { this.buf = ''; this.tbuf = []; }
      return '';
    }
    const upto = final ? a.lastW : a.lastW - 1;
    // A short sound can match a word far away by chance («هدى لـ» ≈ «هدى من»
    // in the next ayah). Never jump ahead on a few letters: wait for more.
    if (!final && a.firstW - this.pointer > 2 && H.length < 10) return '';
    // 2026-11-13: a short run of letters that exactly matches a word several
    // words ahead («ارجع» of the next ayah after «تفاوت», when «فارجع» lost its
    // ف) is not evidence he skipped them. A jump of more than 3 words needs
    // at least 12 aligned letters, whether or not this is the final flush.
    if (a.firstW - this.pointer > 3) {
      let owned = 0;
      for (let i = 0; i < a.owner.length; i++) if (a.owner[i] >= a.firstW) owned++;
      if (owned < 12) return '';
    }
    if (upto < a.firstW) return '';
    const out: string[] = [];
    // Audio span of every word the ear did hear (first / last letter time).
    const span = new Map<number, { a: number; b: number }>();
    for (let i = 0; i < H.length; i++) {
      const w = a.owner[i]; const t = this.tbuf[i];
      if (w < 0 || t === undefined) continue;
      const e = span.get(w);
      if (!e) span.set(w, { a: t, b: t }); else { if (t < e.a) e.a = t; if (t > e.b) e.b = t; }
    }
    for (let w = a.firstW; w <= upto; w++) {
      let t = judge(this.words, w, a.per.get(w));
      // 2026-11-13: ONE word the ear never heard between two heard words: if the
      // silent gap between its neighbours is long enough to have held the word,
      // the model missed a quiet word («طباقا» once in four reads); he did not
      // skip it. A real skip leaves only a short gap.
      if (!t && span.get(w - 1) && span.get(w + 1) && !span.has(w)) {
        const gap = span.get(w + 1)!.a - span.get(w - 1)!.b;
        if (gap >= 0.25 + 0.1 * this.words[w].skel.length) t = this.words[w].norm;
      }
      if (t) out.push(t);
    }
    // Carry the heard letters of the words not committed yet.
    let cut = H.length;
    for (let i = 0; i < H.length; i++) if (a.owner[i] > upto) { cut = i; break; }
    this.buf = final ? '' : H.slice(cut);
    this.tbuf = final ? [] : this.tbuf.slice(cut);
    this.pointer = upto + 1;
    return out.join(' ');
  }
}
