// node judge_real.mjs DECODE.jsonl MANIFEST.jsonl OUT.jsonl  (esbuild-bundled with the real app code)
import { readFileSync, appendFileSync } from 'fs';
const ROOT = process.env.APP_ROOT || '.';
(globalThis as any).fetch = async () => ({ json: async () => JSON.parse(readFileSync(`${ROOT}/public/models/quranlab/quran_text2phoneme.json`, 'utf8')) });
const { buildPhonWords, PhonemeStream } = await import('../../src/lib/phonemeEar');
const { expectedWordList } = await import('../../src/lib/expectedWords');
const { refKeySkel } = await import('../../src/lib/quranLabEar');
const dec = new Map<string, any>();
for (const l of readFileSync(process.argv[2], 'utf8').split('\n')) if (l.trim()) { const j = JSON.parse(l); dec.set(j.f, j.chunks); }
const out = process.argv[4];
for (const l of readFileSync(process.argv[3], 'utf8').split('\n')) {
  if (!l.trim()) continue;
  const m = JSON.parse(l); const chunks = dec.get(m.f); if (!chunks) continue;
  const words = expectedWordList(m.text).map(w => ({ ...w, ayahIdx: 0 }));
  if (words.length < 1) continue;
  const pw = await buildPhonWords(words, refKeySkel);
  const ps = new PhonemeStream(pw); const emitted: string[] = [];
  for (const c of chunks) { if (c.length) { const r = ps.pushTimed(c); if (r) emitted.push(r); } }
  const f = ps.finish(); if (f) emitted.push(f);
  const toks = emitted.join(' ').split(/\s+/).filter(Boolean);
  let j = 0; const ok: boolean[] = words.map(() => false); let wrong = 0;
  for (const t of toks) {
    if (t.startsWith('~')) { wrong++; continue; }
    for (let k = j; k < Math.min(words.length, j + 4); k++) if (words[k].norm === t) { ok[k] = true; j = k + 1; break; }
  }
  const errIdx: { i: number; types: string[]; w: string }[] = [];
  for (const [w, types] of Object.entries<string[]>(m.errors || {})) {
    const nn = expectedWordList(w)[0]?.norm; if (!nn) continue;
    const i = words.findIndex(x => x.norm === nn); if (i >= 0) errIdx.push({ i, types, w: nn });
  }
  appendFileSync(out, JSON.stringify({ f: m.f, src: m.src, n: words.length, ok, wrong, errIdx, toks: toks.length, ref: words.map(w => w.norm), em: toks }) + '\n');
}
