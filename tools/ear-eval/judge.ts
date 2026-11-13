// node judge.mjs DECODE.jsonl MANIFEST.jsonl OUT.jsonl   (built with esbuild from the real app code)
import { readFileSync, appendFileSync } from 'fs';
const ROOT = process.env.APP_ROOT || '.';
(globalThis as any).fetch = async () => ({ json: async () => JSON.parse(readFileSync(`${ROOT}/public/models/quranlab/quran_text2phoneme.json`, 'utf8')) });
const { buildPhonWords, PhonemeStream } = await import('../../src/lib/phonemeEar');
const { expectedWordList } = await import('../../src/lib/expectedWords');
const { refKeySkel } = await import('../../src/lib/quranLabEar');
const verses: [number, number, string][] = JSON.parse(readFileSync(`${ROOT}/tools/ear-eval/verses.json`, 'utf8'));
const vt = new Map(verses.map(v => [`${v[0]}:${v[1]}`, v[2]]));
const dec = new Map<string, any>();
for (const l of readFileSync(process.argv[2], 'utf8').split('\n')) if (l.trim()) { const j = JSON.parse(l); dec.set(j.f, j.chunks); }
const out = process.argv[4];
for (const l of readFileSync(process.argv[3], 'utf8').split('\n')) {
  if (!l.trim()) continue;
  const m = JSON.parse(l); // {f, surah, a1, a2, mut?:{i,norm}}
  const chunks = dec.get(m.f); if (!chunks) continue;
  const words: { norm: string; ayahIdx: number }[] = [];
  for (let a = m.a1; a <= m.a2; a++) for (const w of expectedWordList(vt.get(`${m.surah}:${a}`) || '')) words.push({ norm: w.norm, ayahIdx: a - m.a1 });
  const CONF: Record<string, string[]> = { 'ن': ['م'], 'ي': ['و', 'ن'], 'و': ['ي'], 'ص': ['س'], 'س': ['ص', 'ث'], 'ف': ['ق'], 'ق': ['ك', 'ف'], 'ك': ['ق'], 'ذ': ['د', 'ز'], 'د': ['ذ', 'ض'], 'ت': ['ط', 'د'], 'ط': ['ت'], 'ح': ['ه', 'خ'], 'ه': ['ح'], 'ع': ['ا'], 'غ': ['خ'], 'خ': ['غ', 'ح'], 'ض': ['د', 'ظ'], 'ظ': ['ز', 'ض'], 'ث': ['س', 'ت'], 'ز': ['ذ'], 'ب': ['ف'], 'ر': ['ل'], 'ل': ['ر'], 'م': ['ن'] };
  let seed = 7; for (const ch of m.f) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const list: any[] = [null];
  for (let k = 0; k < (m.nmut || 0); k++) {
    for (let tries = 0; tries < 20; tries++) {
      const i = Math.floor(rnd() * words.length); const nw = words[i].norm; if (nw.length < 3) continue;
      const p = Math.floor(rnd() * nw.length); const alts = CONF[nw[p]]; if (!alts) continue;
      const r = alts[Math.floor(rnd() * alts.length)];
      list.push({ i, norm: nw.slice(0, p) + r + nw.slice(p + 1), type: nw[p] + '>' + r + (p === nw.length - 1 ? '#end' : '') }); break;
    }
  }
  for (const mut of list) {
  const ref = words.map(w => ({ ...w }));
  if (mut) ref[mut.i].norm = mut.norm;
  const pw = await buildPhonWords(ref, refKeySkel);
  const ps = new PhonemeStream(pw);
  const emitted: string[] = [];
  for (const c of chunks) { if (c.length) { const r = ps.pushTimed(c); if (r) emitted.push(r); } }
  const f = ps.finish(); if (f) emitted.push(f);
  const toks = emitted.join(' ').split(/\s+/).filter(Boolean);
  let j = 0; const ok: boolean[] = ref.map(() => false); let wrong = 0;
  for (const t of toks) {
    if (t.startsWith('~')) { wrong++; continue; }
    for (let k = j; k < Math.min(ref.length, j + 4); k++) if (ref[k].norm === t) { ok[k] = true; j = k + 1; break; }
  }
  const row: any = { f: m.f, n: ref.length, okN: ok.filter(Boolean).length, wrong, mut: mut ? mut.type : null };
  if (mut) row.mutAccepted = ok[mut.i];
  appendFileSync(out, JSON.stringify(row) + '\n');
  }
}
