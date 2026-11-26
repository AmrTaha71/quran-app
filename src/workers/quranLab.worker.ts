/// <reference lib="webworker" />
// Quran-Lab zipformer ear (2026-11-13): streaming phoneme recognition in a
// Web Worker. Audio (16 kHz mono, [-1, 1]) -> Kaldi fbank -> chunks of
// 61 frames, shift 48 (0.48 s) -> ONNX with carried states -> greedy CTC.
// The model (72,705,392 bytes) is fetched once and kept in the Cache API.
// With the ONNX runtime (.wasm ~22 MB) and the phoneme reference (~4.6 MB)
// the first download is ~100 MB — see EAR_DOWNLOAD_MB.
//
// Messages in:  {type:'load'} | {type:'audio', samples: Float32Array}
//               | {type:'flush'} | {type:'reset'} | {type:'unload'}
// Messages out: {type:'progress', loaded, total} | {type:'ready', backend, loadMs}
//               | {type:'tokens', text, ids, chunkMs, chunks} | {type:'error', message}
import * as ort from 'onnxruntime-web/webgpu';
import { OnlineFbank, FBANK_DIM } from '../lib/kaldiFbank';
import { QURANLAB_BASE as BASE, QURANLAB_MODEL_URL as MODEL_URL, QURANLAB_MODEL_CACHE as MODEL_CACHE, QURANLAB_MODEL_CACHE_PREFIX as MODEL_CACHE_PREFIX } from '../lib/earModelCache';
const PAD_LOG = Math.log(1e-10);

type StateSpec = { name: string; type: 'float32' | 'int64'; shape: number[] };
type Spec = { T: number; shift: number; blank: number; states: StateSpec[] };

let session: ort.InferenceSession | null = null;
let spec: Spec | null = null;
let tokens: Record<string, string> = {};
let states: Record<string, ort.Tensor> = {};
const fb = new OnlineFbank();
// 3.21: pending feature frames (flattened) in a buffer that grows by 1.5x;
// featLen floats are live. Was a fresh copy of everything on every chunk.
let featBuf = new Float32Array(0);
let featLen = 0;
let prevId = -1;
let busy = Promise.resolve();
let chunkNo = 0; // chunks decoded since reset: gives every token an audio time

ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
  ? Math.max(1, Math.min(4, ((self as unknown as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 2) - 1))
  : 1;

function post(m: unknown) { (self as unknown as Worker).postMessage(m); }

async function fetchModel(): Promise<ArrayBuffer> {
  try {
    const cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(MODEL_URL);
    if (hit) return await hit.arrayBuffer();
  } catch { /* no Cache API: plain fetch */ }
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`model ${res.status}`);
  // 3.19: no content-length -> total 0 (the card shows «جارٍ التحميل…» with
  // no percent) instead of a hardcoded size that can go stale.
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  let lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    if (loaded - lastPost > 1_000_000) { lastPost = loaded; post({ type: 'progress', loaded, total }); }
  }
  const buf = new Uint8Array(loaded);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  try {
    const cache = await caches.open(MODEL_CACHE);
    await cache.put(MODEL_URL, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch { /* quota: run uncached */ }
  return buf.buffer;
}

/** 3.7: a new model ships under a new cache name (QURANLAB_MODEL_VERSION);
 *  the old version's cache is deleted here so two models never sit on the
 *  device together. */
async function dropStaleModelCaches() {
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(MODEL_CACHE_PREFIX) && k !== MODEL_CACHE).map((k) => caches.delete(k)));
  } catch { /* no Cache API */ }
}

function resetStates() {
  if (!spec) return;
  states = {};
  for (const s of spec.states) {
    const n = s.shape.reduce((a, b) => a * b, 1);
    states[s.name] = s.type === 'int64'
      ? new ort.Tensor('int64', new BigInt64Array(n), s.shape)
      : new ort.Tensor('float32', new Float32Array(n), s.shape);
  }
  fb.reset();
  featLen = 0;
  prevId = -1;
  chunkNo = 0;
}

/** 3.6: the two small JSON files beside the model. Checked (a 404 used to
 *  surface as a bare SyntaxError from .json()) and kept in the model cache
 *  so they are not fetched again on every load. */
async function fetchJson<T>(name: string): Promise<T> {
  const url = `${BASE}${name}`;
  let cache: Cache | null = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(url);
    if (hit) return await hit.json() as T;
  } catch { cache = null; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name} ${res.status}`);
  const text = await res.text();
  const data = JSON.parse(text) as T;
  try { await cache?.put(url, new Response(text, { headers: { 'content-type': 'application/json' } })); } catch { /* quota */ }
  return data;
}

async function load() {
  const t0 = performance.now();
  void dropStaleModelCaches();
  // 3.10: a stage message before each silent step re-arms the page's load
  // timeout (JSON files, then WASM compile + session create on slow phones).
  post({ type: 'progress', stage: 'states' });
  spec = await fetchJson<Spec>('states.json');
  tokens = await fetchJson<Record<string, string>>('tokens.json');
  const model = await fetchModel();
  post({ type: 'progress', stage: 'session' });
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  resetStates();
  post({ type: 'ready', backend: `wasm x${ort.env.wasm.numThreads}`, loadMs: Math.round(performance.now() - t0) });
}

function appendFeats(f: Float32Array) {
  if (!f.length) return;
  if (featLen + f.length > featBuf.length) {
    const nb = new Float32Array(Math.max(Math.ceil(featBuf.length * 1.5), featLen + f.length));
    nb.set(featBuf.subarray(0, featLen));
    featBuf = nb;
  }
  featBuf.set(f, featLen);
  featLen += f.length;
}

async function runChunks(final: boolean) {
  if (!session || !spec) return;
  const { T, shift, blank } = spec;
  const frames = () => featLen / FBANK_DIM;
  const ids: number[] = [];
  const parts: { s: string; t: number }[] = [];
  let text = '';
  let chunks = 0;
  let ms = 0;
  while (frames() >= T || (final && frames() > 0)) {
    let x = featBuf.subarray(0, Math.min(T * FBANK_DIM, featLen));
    if (frames() < T) {
      const pad = new Float32Array(T * FBANK_DIM).fill(PAD_LOG);
      pad.set(x);
      x = pad;
    }
    const feeds: Record<string, ort.Tensor> = { x: new ort.Tensor('float32', new Float32Array(x), [1, T, FBANK_DIM]), ...states };
    const t0 = performance.now();
    const out = await session.run(feeds);
    ms += performance.now() - t0;
    chunks++;
    const thisChunk = chunkNo; chunkNo++;
    for (const s of spec.states) states[s.name] = out[`new_${s.name}`];
    const lp = out.log_probs;
    const [, nf, v] = lp.dims as number[];
    const d = lp.data as Float32Array;
    for (let t = 0; t < nf; t++) {
      let best = 0;
      let bv = -Infinity;
      for (let k = 0; k < v; k++) { const val = d[t * v + k]; if (val > bv) { bv = val; best = k; } }
      if (best !== prevId && best !== blank) {
        ids.push(best); const tk = tokens[String(best)] ?? ''; text += tk;
        // audio time in seconds (10 ms input frames, `shift` of them per chunk)
        parts.push({ s: tk, t: (thisChunk * shift + ((t + 0.5) / nf) * shift) * 0.01 });
      }
      prevId = best;
    }
    const used = Math.min(shift, frames());
    featBuf.copyWithin(0, used * FBANK_DIM, featLen);
    featLen -= used * FBANK_DIM;
    if (final && frames() < T - shift) break;
  }
  if (chunks) post({ type: 'tokens', text, ids, parts, chunkMs: Math.round(ms / chunks), chunks });
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  busy = busy.then(async () => {
    try {
      if (m.type === 'load') await load();
      else if (m.type === 'reset') resetStates();
      else if (m.type === 'unload') {
        // 3.13: give the ONNX session's memory back (idle, or the Whisper ear
        // is about to load). The next 'load' reads the model from the cache.
        const s0 = session;
        session = null; spec = null; states = {}; featLen = 0; featBuf = new Float32Array(0);
        await s0?.release();
        post({ type: 'unloaded' });
      }
      else if (m.type === 'audio') { appendFeats(fb.accept(m.samples)); await runChunks(false); }
      else if (m.type === 'flush') { appendFeats(fb.finish()); await runChunks(true); post({ type: 'flushed' }); resetStates(); }
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
};
