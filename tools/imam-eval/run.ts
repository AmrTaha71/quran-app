// Follow-the-imam live simulation (W5-M).  Bundle with esbuild, then:
//   node run.mjs eval DEC.jsonl MANIFEST.jsonl OUT.json   — metrics per clip + totals
//   node run.mjs trace DEC.jsonl                          — what the follower hears/locks (to name unlabeled clips)
// DEC.jsonl comes from tools/ear-eval/decode.py: the same streaming Quran-Lab ear
// as the app, one chunk per 0.48 s of audio, every phoneme with its audio time.
// A chunk is "delivered" to the follower when its audio window has ended
// (chunk ci covers frames ci*48 .. ci*48+61 → (ci*48+61)/100 s) plus PROC_S.
// Env: PROC_S (default 0.08 s model time per chunk), OPT='{"minLockLetters":14,...}'.
import { readFileSync, writeFileSync, existsSync } from 'fs';
const ROOT = process.env.APP_ROOT || '.';
(globalThis as any).fetch = async () => ({ json: async () => JSON.parse(readFileSync(`${ROOT}/public/models/quranlab/quran_text2phoneme.json`, 'utf8')) });
const { buildPhonWords } = await import('../../src/lib/phonemeEar');
const { expectedWordList } = await import('../../src/lib/expectedWords');
const { refKeySkel } = await import('../../src/lib/quranLabEar');
const { buildFollowIndex, ImamFollower, followSkel, alignWindow, istiadhaVerse } = await import('../../src/lib/imamFollow');
type FollowVerse = import('../../src/lib/imamFollow').FollowVerse;

const PROC_S = +(process.env.PROC_S ?? 0.08);
// START_S: the user taps «start» this many seconds into the clip (mid-recitation).
const START_S = +(process.env.START_S ?? 0);
const OPT = process.env.OPT ? JSON.parse(process.env.OPT) : {};

// ---- Mushaf index (skeletons from the app's own phoneme reference) ----
const CACHE = process.env.IDX_CACHE || '/tmp/imam/follow-index.json';
let verses: FollowVerse[];
if (existsSync(CACHE)) verses = JSON.parse(readFileSync(CACHE, 'utf8'));
else {
  const vj: [number, number, string][] = JSON.parse(readFileSync(`${ROOT}/tools/ear-eval/verses.json`, 'utf8'));
  verses = [];
  for (let s = 1; s <= 114; s++) {
    const vs = vj.filter((v) => v[0] === s);
    const words: { norm: string; ayahIdx: number }[] = [];
    vs.forEach((v, i) => expectedWordList(v[2]).forEach((w) => words.push({ norm: w.norm, ayahIdx: i })));
    const pw = await buildPhonWords(words, refKeySkel);
    let k = 0;
    vs.forEach((v, i) => {
      const ws: { norm: string; skel: string }[] = [];
      while (k < words.length && words[k].ayahIdx === i) { ws.push(pw[k]); k++; }
      verses.push({ surah: v[0], ayah: v[1], words: ws });
    });
  }
  writeFileSync(CACHE, JSON.stringify(verses));
}
const t0 = Date.now();
const ist = istiadhaVerse(verses);
const idx = buildFollowIndex(ist ? [ist, ...verses] : verses);
const idxMs = Date.now() - t0;
const gOf = new Map<string, number>(); // "s:a" -> first global word
idx.words.forEach((w, g) => { const k = `${w.surah}:${w.ayah}`; if (!gOf.has(k)) gOf.set(k, g); });
const wname = (g: number) => { const w = idx.words[g]; return w ? `${w.surah}:${w.ayah}:${w.word + 1}` : '-'; };

type Part = { s: string; t: number };
const mode = process.argv[2];
const dec = new Map<string, Part[][]>();
for (const l of readFileSync(process.argv[3], 'utf8').split('\n')) if (l.trim()) { const j = JSON.parse(l); dec.set(j.f, j.chunks); }
const arrival = (ci: number) => (ci * 48 + 61) / 100 + PROC_S;

if (mode === 'trace') {
  for (const [f, chunks] of dec) {
    const fl = new ImamFollower(idx, OPT);
    let last = '';
    console.log('==', f, chunks.length * 0.48, 's');
    chunks.forEach((c, ci) => {
      const st = fl.pushPhonemes(c);
      const k = `${st.status} ${st.pos ? `${st.pos.surah}:${st.pos.ayah}` : ''}`;
      if (k !== last) { console.log(arrival(ci).toFixed(1), k, st.rate.toFixed(2)); last = k; }
    });
  }
  process.exit(0);
}

// ---- truth: offline alignment of the whole clip to its known text ----
function truthOnsets(chunks: Part[][], gs: number[]) {
  let R = ''; const rOwn: number[] = [];
  for (const g of gs) {
    const w = idx.words[g];
    for (const c of verses.find((v) => v.surah === w.surah && v.ayah === w.ayah)!.words[w.word].skel) {
      if (R.length && R[R.length - 1] === c) continue; R += c; rOwn.push(g);
    }
  }
  let H = ''; const HT: number[] = [];
  for (const c of chunks) for (const p of c) for (const ch of followSkel(p.s)) { if (H.length && H[H.length - 1] === ch) continue; H += ch; HT.push(p.t); }
  const n = H.length, m = R.length;
  // Global over the text, heard letters may be skipped (ta'awwudh, breaths) at 0.6.
  const D: Float32Array[] = []; const B: Uint8Array[] = [];
  for (let i = 0; i <= n; i++) { D.push(new Float32Array(m + 1)); B.push(new Uint8Array(m + 1)); }
  for (let j = 1; j <= m; j++) { D[0][j] = j; B[0][j] = 2; }
  for (let i = 1; i <= n; i++) { D[i][0] = i * 0.6; B[i][0] = 1; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    let c = D[i - 1][j - 1] + (H[i - 1] === R[j - 1] ? 0 : 1), b = 0;
    const ci = D[i - 1][j] + 0.6; if (ci < c) { c = ci; b = 1; }
    const cd = D[i][j - 1] + 1; if (cd < c) { c = cd; b = 2; }
    D[i][j] = c; B[i][j] = b;
  }
  // free trailing heard letters
  let bi = n, best = Infinity; for (let i = 0; i <= n; i++) if (D[i][m] + (n - i) * 0.3 < best) { best = D[i][m] + (n - i) * 0.3; bi = i; }
  const on = new Map<number, number>(); const matched = new Map<number, number>();
  let i = bi, j = m;
  while (i > 0 && j > 0) {
    const b = B[i][j];
    if (b === 0) { const g = rOwn[j - 1]; on.set(g, Math.min(on.get(g) ?? 1e9, HT[i - 1])); if (H[i - 1] === R[j - 1]) matched.set(g, (matched.get(g) ?? 0) + 1); i--; j--; }
    else if (b === 1) i--; else j--;
  }
  return { onset: gs.map((g) => on.get(g) ?? NaN), rate: best / m, matchedWords: gs.filter((g) => (matched.get(g) ?? 0) > 0).length };
}

const out: any[] = [];
for (const l of readFileSync(process.argv[4], 'utf8').split('\n')) {
  if (!l.trim()) continue;
  const m = JSON.parse(l); const chunks = dec.get(m.f); if (!chunks) continue;
  if (!m.segs.length) {
    // Negative clip (speech, adhan): any lock is a false lock.
    const fl = new ImamFollower(idx, OPT); let fol = 0, firstLock: string | null = null;
    chunks.forEach((c, ci) => { const st = fl.pushPhonemes(c); if (st.status === 'following') { fol++; if (!firstLock && st.pos) firstLock = `${arrival(ci).toFixed(1)}s ${wname(st.pos.g)}`; } });
    out.push({ id: m.id, src: m.src, negative: true, dur: +(chunks.length * 0.48).toFixed(1), falseLock: !!firstLock, firstLock, followingSec: +(fol * 0.48).toFixed(1) });
    continue;
  }
  const gs: number[] = [];
  for (const [s, a1, a2] of m.segs) for (let a = a1; a <= a2; a++) { const g0 = gOf.get(`${s}:${a}`)!; const v = verses.find((x) => x.surah === s && x.ayah === a)!; for (let k = 0; k < v.words.length; k++) gs.push(g0 + k); }
  const tr = truthOnsets(chunks, gs);
  // fill missing onsets by interpolation (monotone)
  const on = tr.onset.slice();
  for (let k = 0; k < on.length; k++) if (isNaN(on[k])) { let a = k - 1; while (a >= 0 && isNaN(on[a])) a--; let b = k + 1; while (b < on.length && isNaN(on[b])) b++; const ta = a >= 0 ? on[a] : (b < on.length ? on[b] : 0); const tb = b < on.length ? on[b] : ta; on[k] = ta + (tb - ta) * (k - a) / Math.max(1, b - a); }
  for (let k = 1; k < on.length; k++) if (on[k] < on[k - 1]) on[k] = on[k - 1];
  // truth "word being recited" at time τ: index k of last onset <= τ
  const k0 = on.findIndex((x) => x >= START_S); // first word recited after the tap
  if (k0 < 0) continue;
  const truthAt = (tau: number) => { let k = -1; for (let q = 0; q < on.length; q++) if (on[q] <= tau) k = q; else break; return k; };

  const fl = new ImamFollower(idx, OPT);
  const trace: { tau: number; status: string; g: number }[] = [];
  let stepMs = 0;
  chunks.forEach((c, ci) => { if (ci * 0.48 < START_S) return; const a = Date.now(); const st = fl.pushPhonemes(c); stepMs = Math.max(stepMs, Date.now() - a); trace.push({ tau: arrival(ci), status: st.status, g: st.pos ? st.pos.g : -1 }); });
  // drain: audio after the last chunk is silence; nothing more arrives.
  const first = trace.find((x) => x.status === 'following');
  const firstOnset = on[k0];
  const r: any = { id: m.id, src: m.src, words: gs.length, dur: +(chunks.length * 0.48).toFixed(1), truthRate: +tr.rate.toFixed(2), truthMatched: tr.matchedWords, maxStepMs: stepMs };
  if (!first) { r.locked = false; out.push(r); continue; }
  const kAt = truthAt(first.tau);
  const kPos = gs.indexOf(first.g);
  r.locked = true;
  r.lockT = +(first.tau - firstOnset).toFixed(2); // seconds after the imam's first word
  r.lockWords = kAt + 1 - k0; // words recited between the tap and the lock
  r.lockOk = kPos >= 0 && Math.abs(kPos - kAt) <= 3;
  r.lockAt = wname(first.g); r.truthAtLock = wname(gs[Math.max(0, kAt)]);
  // per-chunk accuracy after the first lock, only while the imam is inside the text
  let n = 0, exact = 0, near1 = 0, lagOk = 0, searching = 0, wrongPlace = 0;
  const lastOn = on[on.length - 1] + 1.5;
  for (const x of trace) {
    if (x.tau < first.tau || x.tau > lastOn) continue;
    const k = truthAt(x.tau); if (k < 0) continue;
    n++;
    if (x.status !== 'following') { searching++; continue; }
    const kp = gs.indexOf(x.g);
    if (kp < 0) { wrongPlace++; continue; }
    if (kp === k) exact++;
    if (Math.abs(kp - k) <= 1) near1++;
    const kLag = truthAt(x.tau - 1.0);
    if (kp >= Math.max(0, kLag) - 0 && kp <= k + 1) lagOk++;
  }
  Object.assign(r, { samples: n, exact: +(exact / n).toFixed(3), near1: +(near1 / n).toFixed(3), lag1s: +(lagOk / n).toFixed(3), searching: +(searching / n).toFixed(3), wrongPlace: +(wrongPlace / n).toFixed(3) });
  // latency: word k (after lock) first highlighted (pos >= k, still inside text, within +2) minus its onset
  const lats: number[] = []; let never = 0;
  for (let k = kAt + 1; k < gs.length; k++) {
    const hit = trace.find((x) => x.tau >= on[k] - 0.5 && x.status === 'following' && (() => { const kp = gs.indexOf(x.g); return kp >= k && kp <= k + 2; })());
    if (!hit) { never++; continue; }
    lats.push(Math.max(0, hit.tau - on[k]));
  }
  lats.sort((a, b) => a - b);
  const q = (p: number) => lats.length ? +lats[Math.min(lats.length - 1, Math.floor(p * lats.length))].toFixed(2) : null;
  Object.assign(r, { latMean: lats.length ? +(lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(2) : null, latMed: q(0.5), latP90: q(0.9), wordsNever: never, wordsAfterLock: gs.length - kAt - 1 });
  // losts / relocks during the clip
  let losts = 0, relocks = 0, badRelock = 0; const searchGaps: number[] = []; let lostAt = -1;
  for (let i = 1; i < trace.length; i++) {
    if (trace[i - 1].status === 'following' && trace[i].status === 'searching') { losts++; lostAt = trace[i].tau; }
    if (trace[i - 1].status === 'searching' && trace[i].status === 'following' && trace[i].tau > first.tau) {
      relocks++; if (lostAt >= 0) searchGaps.push(+(trace[i].tau - lostAt).toFixed(2));
      const k = truthAt(trace[i].tau); const kp = gs.indexOf(trace[i].g);
      if (kp < 0 || Math.abs(kp - k) > 3) badRelock++;
    }
  }
  Object.assign(r, { losts, relocks, badRelock, searchGaps });
  out.push(r);
}
const N = out.filter((r) => r.negative);
const L = out.filter((r) => r.locked);
const avg = (k: string, rows = L) => +(rows.reduce((a, r) => a + (r[k] ?? 0), 0) / Math.max(1, rows.length)).toFixed(3);
const allLat: number[] = [];
const totals = {
  clips: out.length - N.length, negatives: N.length, falseLocksOnNegatives: N.filter((r) => r.falseLock).length, negativeSec: +N.reduce((a, r) => a + r.dur, 0).toFixed(0), locked: L.length, lockOk: L.filter((r) => r.lockOk).length,
  lockTmean: avg('lockT'), lockWordsMean: avg('lockWords'),
  exact: avg('exact'), near1: avg('near1'), lag1s: avg('lag1s'), searching: avg('searching'), wrongPlace: avg('wrongPlace'),
  latMean: avg('latMean', L.filter((r) => r.latMean !== null)), latMed: avg('latMed', L.filter((r) => r.latMed !== null)), latP90: avg('latP90', L.filter((r) => r.latP90 !== null)),
  wordsNever: L.reduce((a, r) => a + r.wordsNever, 0), wordsAfterLock: L.reduce((a, r) => a + r.wordsAfterLock, 0),
  searchGapMean: (() => { const g = L.flatMap((r) => r.searchGaps); return g.length ? +(g.reduce((a: number, b: number) => a + b, 0) / g.length).toFixed(2) : null; })(),
  losts: L.reduce((a, r) => a + r.losts, 0), relocks: L.reduce((a, r) => a + r.relocks, 0), badRelock: L.reduce((a, r) => a + r.badRelock, 0),
  procS: PROC_S, opt: OPT, indexBuildMs: idxMs, indexLetters: idx.letters.length, maxStepMs: Math.max(0, ...out.filter((r) => !r.negative).map((r) => r.maxStepMs)),
};
void allLat; void alignWindow;
writeFileSync(process.argv[5], JSON.stringify({ totals, clips: out }, null, 1));
for (const r of out) console.log(JSON.stringify(r));
console.log('TOTALS', JSON.stringify(totals));
