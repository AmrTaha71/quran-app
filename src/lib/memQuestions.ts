// 15.9 (phase 6): new memorization question types, generated from the Mushaf
// text of the user's range (and only his «محفوظي» when he declared one):
// next ayah, previous ayah, the missing word, order the ayat, how a page
// starts, how a juz starts. Multiple choice (order = tap in order). Pure:
// the caller passes the ayat and the text, so this is unit-tested.
export type PoolAyah = { g: number; s: number; a: number; text: string };

export type ChoiceQ = {
  kind: 'next' | 'prev' | 'missing' | 'page' | 'juz';
  prompt: string;
  /** the ayah text shown with the prompt (missing: with «……» in the gap) */
  shown?: string;
  options: string[];
  answer: number;
  /** where the answer is, for the result list («البقرة ٥») */
  ref: { s: number; a: number };
};
export type OrderQ = { kind: 'order'; prompt: string; items: string[]; /** items[order[k]] is the k-th ayah */ order: number[]; ref: { s: number; a: number } };
export type MemQ = ChoiceQ | OrderQ;

export const QUESTION_KINDS: { id: MemQ['kind']; label: string }[] = [
  { id: 'next', label: 'الآية التالية' },
  { id: 'prev', label: 'الآية السابقة' },
  { id: 'missing', label: 'الكلمة الناقصة' },
  { id: 'order', label: 'رتّب الآيات' },
  { id: 'page', label: 'بدايات الصفحات' },
  { id: 'juz', label: 'بدايات الأجزاء' },
];

type Rng = () => number;
const words = (t: string) => t.split(/\s+/).filter(Boolean);
const head = (t: string, n = 7) => { const w = words(t); return w.slice(0, n).join(' ') + (w.length > n ? ' …' : ''); };
function shuffle<T>(xs: T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** right answer + up to 3 different distractors, shuffled; null when fewer than 2 distinct options. */
function choices(right: string, others: string[], rng: Rng): { options: string[]; answer: number } | null {
  const seen = new Set([right]);
  const d: string[] = [];
  for (const o of shuffle(others, rng)) { if (!seen.has(o)) { seen.add(o); d.push(o); } if (d.length === 3) break; }
  if (d.length === 0) return null;
  const options = shuffle([right, ...d], rng);
  return { options, answer: options.indexOf(right) };
}
const pick = <T,>(xs: T[], rng: Rng): T | undefined => xs[Math.floor(rng() * xs.length)];

/** `pool`: the range's ayat in Mushaf order. `pageStarts`: global number of the
 *  first ayah of each page (index = page-1); `juzStarts` likewise per juz.
 *  `textOf(g)` gives any ayah's text (distractors for page/juz may come from
 *  outside the range). */
export function makeQuestion(
  kind: MemQ['kind'], pool: PoolAyah[],
  ctx: { pageStarts: number[]; juzStarts: number[]; textOf: (g: number) => string | undefined },
  rng: Rng = Math.random,
): MemQ | null {
  if (pool.length === 0) return null;
  const byG = new Map(pool.map((p) => [p.g, p]));
  const others = (skip: number) => pool.filter((p) => p.g !== skip).map((p) => head(p.text));
  if (kind === 'next' || kind === 'prev') {
    const step = kind === 'next' ? 1 : -1;
    const cands = pool.filter((p) => { const o = byG.get(p.g + step); return o && o.s === p.s; });
    const p = pick(cands, rng);
    if (!p) return null;
    const o = byG.get(p.g + step)!;
    const c = choices(head(o.text), others(o.g).filter((x) => x !== head(p.text)), rng);
    if (!c) return null;
    return { kind, prompt: kind === 'next' ? 'إيه الآية اللي بعد دي؟' : 'إيه الآية اللي قبل دي؟', shown: p.text, ...c, ref: { s: o.s, a: o.a } };
  }
  if (kind === 'missing') {
    const cands = pool.filter((p) => words(p.text).length >= 4);
    const p = pick(cands, rng);
    if (!p) return null;
    const w = words(p.text);
    const k = 1 + Math.floor(rng() * (w.length - 1));
    const right = w[k];
    const bag = pool.flatMap((x) => words(x.text)).filter((x) => x !== right && x.length > 1);
    const c = choices(right, bag, rng);
    if (!c) return null;
    const shown = [...w.slice(0, k), '……', ...w.slice(k + 1)].join(' ');
    return { kind, prompt: 'إيه الكلمة الناقصة؟', shown, ...c, ref: { s: p.s, a: p.a } };
  }
  if (kind === 'order') {
    const cands = pool.filter((p) => [1, 2].every((d) => byG.get(p.g + d)?.s === p.s));
    const p = pick(cands, rng);
    if (!p) return null;
    const run = [p, byG.get(p.g + 1)!, byG.get(p.g + 2)!].map((x) => head(x.text, 9));
    const idx = shuffle([0, 1, 2], rng);
    const items = idx.map((i) => run[i]);
    return { kind, prompt: 'رتّب الآيات دي (دوس عليها بالترتيب)', items, order: [0, 1, 2].map((k) => idx.indexOf(k)), ref: { s: p.s, a: p.a } };
  }
  const starts = kind === 'page' ? ctx.pageStarts : ctx.juzStarts;
  const inRange = starts.map((g, i) => ({ g, n: i + 1 })).filter((x) => byG.has(x.g));
  const t = pick(inRange, rng);
  if (!t) return null;
  const p = byG.get(t.g)!;
  const near = starts.map((g, i) => ({ g, n: i + 1 })).filter((x) => x.n !== t.n && Math.abs(x.n - t.n) <= (kind === 'page' ? 6 : 4));
  const otherTexts = near.map((x) => ctx.textOf(x.g)).filter((x): x is string => !!x).map((x) => head(x, 6));
  const c = choices(head(p.text, 6), otherTexts, rng);
  if (!c) return null;
  return { kind, prompt: kind === 'page' ? `الصفحة ${t.n} بتبدأ بإيه؟` : `الجزء ${t.n} بيبدأ بإيه؟`, ...c, ref: { s: p.s, a: p.a } };
}
