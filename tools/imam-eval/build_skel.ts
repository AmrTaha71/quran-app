// W5-N1: writes public/models/quranlab/follow-skel.json — the per-word
// consonant skeletons of the whole Mushaf (same builder as run.ts, from
// the app's own phoneme reference), so the page never builds them in the
// browser (~2 s on Node, more on a phone). The page only runs
// buildFollowIndex on it (~0.2 s).
//   npx esbuild tools/imam-eval/build_skel.ts --bundle --platform=node --format=esm --outfile=/tmp/build_skel.mjs
//   APP_ROOT=$PWD node /tmp/build_skel.mjs
// Format: {v:1, verses:[[surah, ayah, "skel skel …"], …]} (words joined by one space).
import { readFileSync, writeFileSync } from 'fs';
const ROOT = process.env.APP_ROOT || '.';
(globalThis as any).fetch = async () => ({ json: async () => JSON.parse(readFileSync(`${ROOT}/public/models/quranlab/quran_text2phoneme.json`, 'utf8')) });
const { buildPhonWords } = await import('../../src/lib/phonemeEar');
const { expectedWordList } = await import('../../src/lib/expectedWords');
const { refKeySkel } = await import('../../src/lib/quranLabEar');

const vj: [number, number, string][] = JSON.parse(readFileSync(`${ROOT}/tools/ear-eval/verses.json`, 'utf8'));
const out: [number, number, string][] = [];
for (let s = 1; s <= 114; s++) {
  const vs = vj.filter((v) => v[0] === s);
  const words: { norm: string; ayahIdx: number }[] = [];
  vs.forEach((v, i) => expectedWordList(v[2]).forEach((w) => words.push({ norm: w.norm, ayahIdx: i })));
  const pw = await buildPhonWords(words, refKeySkel);
  let k = 0;
  vs.forEach((v, i) => {
    const ws: string[] = [];
    while (k < words.length && words[k].ayahIdx === i) { ws.push(pw[k].skel); k++; }
    out.push([v[0], v[1], ws.join(' ')]);
  });
}
writeFileSync(`${ROOT}/public/models/quranlab/follow-skel.json`, JSON.stringify({ v: 1, verses: out }));
console.log('verses', out.length);
