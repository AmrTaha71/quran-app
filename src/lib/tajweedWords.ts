// Words of an ayah with their tajweed colour runs, for the digital Mushaf page.
// Source: public/tajweed/tajweed-mushaf-image.json ({surah, ayah, text, annotations[{start,end,rule}]},
// end exclusive, offsets into `text`). Word n of an ayah here = word n of public/mushaf-boxes/*.json:
//  - ayah 1 of a surah (not 1, not 9) starts with the basmala (4 words) in this text; the page scans
//    print it as a header, so those 4 words are dropped (tajweedWords.test.ts checks every surah);
//  - a token made only of marks (waqf signs ۚ ۖ ۗ ۙ ۛ, ۞) belongs to its neighbour word, as in the boxes.
// four ayat still differ in count (TAJWEED_MISMATCH): they keep the scan's own words.
export type TajweedAnn = { start: number; end: number; rule: string };
export type WordSeg = { text: string; rule: string | null };
export type DigitalWord = { n: number; segs: WordSeg[] };
export type TajweedAyah = { text: string; annotations: TajweedAnn[] };
export type TajweedMap = Map<string, TajweedAyah>;

const LETTER = /[ء-يٱ-ۓ]/;
export const BASMALA_WORDS = 4; // «بسم الله الرحمن الرحيم»
/** `surah:ayah` whose word count differs from the page boxes (checked by tajweedWords.test.ts). */
export const TAJWEED_MISMATCH = new Set(['2:181', '8:6', '13:37', '37:130']);

export function splitWords(text: string, annotations: TajweedAnn[], surah: number, ayah: number): DigitalWord[] {
  const hasBasmala = ayah === 1 && surah !== 1 && surah !== 9;
  const words: { s: number; e: number }[] = [];
  let pending: number | null = null;
  let tokenNo = 0;
  for (const m of text.matchAll(/\S+/g)) {
    const s = m.index ?? 0, e = s + m[0].length;
    if (hasBasmala && tokenNo++ < BASMALA_WORDS) continue;
    if (!LETTER.test(m[0])) {
      if (words.length) words[words.length - 1].e = e; else if (pending === null) pending = s;
    } else if (pending !== null) { words.push({ s: pending, e }); pending = null; }
    else words.push({ s, e });
  }
  const rules: (string | null)[] = new Array(text.length).fill(null);
  for (const a of annotations) for (let i = Math.max(0, a.start); i < Math.min(text.length, a.end); i++) if (rules[i] === null) rules[i] = a.rule;
  return words.map((w, i) => {
    const segs: WordSeg[] = [];
    for (let k = w.s; k < w.e; k++) {
      const last = segs[segs.length - 1];
      if (last && last.rule === rules[k]) last.text += text[k]; else segs.push({ text: text[k], rule: rules[k] });
    }
    return { n: i + 1, segs };
  });
}

let loading: Promise<TajweedMap | null> | null = null;
export function loadTajweed(): Promise<TajweedMap | null> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL || '/'}tajweed/tajweed-mushaf-image.json`);
      if (!r.ok) return null;
      const rows = (await r.json()) as { surah: number; ayah: number; text: string; annotations: TajweedAnn[] }[];
      const map: TajweedMap = new Map();
      for (const x of rows) map.set(`${x.surah}:${x.ayah}`, { text: x.text, annotations: x.annotations });
      return map;
    } catch { return null; }
  })();
  loading.then((m) => { if (!m) loading = null; });
  return loading;
}

const wordsCache = new Map<string, DigitalWord[] | null>();
/** Words of one ayah, or null when it is unknown / not trustworthy (keep the scan's words). */
export function digitalWordsOf(map: TajweedMap, surah: number, ayah: number): DigitalWord[] | null {
  const key = `${surah}:${ayah}`;
  if (wordsCache.has(key)) return wordsCache.get(key) ?? null;
  const row = TAJWEED_MISMATCH.has(key) ? undefined : map.get(key);
  const out = row ? splitWords(row.text, row.annotations, surah, ayah) : null;
  wordsCache.set(key, out);
  return out;
}
