/// <reference lib="webworker" />
// Quran-Lab zipformer ear (2026-11-13): streaming phoneme recognition in a
// Web Worker. Audio (16 kHz mono, [-1, 1]) -> Kaldi fbank -> chunks of
// 61 frames, shift 48 (0.48 s) -> ONNX with carried states -> greedy CTC.
// The 73 MB model is fetched once and kept in the Cache API.
//
// Messages in:  {type:'load'} | {type:'audio', samples: Float32Array}
//               | {type:'flush'} | {type:'reset'}
// Messages out: {type:'progress', loaded, total} | {type:'ready', backend, loadMs}
//               | {type:'tokens', text, ids, chunkMs, chunks} | {type:'error', message}
import * as ort from 'onnxruntime-web/webgpu';
import { OnlineFbank, FBANK_DIM } from '../lib/kaldiFbank';

const BASE = '/models/quranlab/';
const MODEL_URL = `${BASE}zipformer_p_arabic_v3.int8.onnx`;
const MODEL_CACHE = 'quranlab-model-v1';
const PAD_LOG = Math.log(1e-10);

type StateSpec = { name: string; type: 'float32' | 'int64'; shape: number[] };
type Spec = { T: number; shift: number; blank: number; states: StateSpec[] };

let session: ort.InferenceSession | null = null;
let spec: Spec | null = null;
let tokens: Record<string, string> = {};
let states: Record<string, ort.Tensor> = {};
let fb = new OnlineFbank();
let feats = new Float32Array(0); // pending feature frames (flattened)
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
  const total = Number(res.headers.get('content-length')) || 72705392;
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

function resetStates() {
  if (!spec) return;
  states = {};
  for (const s of spec.states) {
    const n = s.shape.reduce((a, b) => a * b, 1);
    states[s.name] = s.type === 'int64'
      ? new ort.Tensor('int64', new BigInt64Array(n), s.shape)
      : new ort.Tensor('float32', new Float32Array(n), s.shape);
  }
  fb = new OnlineFbank();
  feats = new Float32Array(0);
  prevId = -1;
  chunkNo = 0;
}

async function load() {
  const t0 = performance.now();
  spec = await (await fetch(`${BASE}states.json`)).json();
  tokens = await (await fetch(`${BASE}tokens.json`)).json();
  const model = await fetchModel();
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  resetStates();
  post({ type: 'ready', backend: `wasm x${ort.env.wasm.numThreads}`, loadMs: Math.round(performance.now() - t0) });
}

function appendFeats(f: Float32Array) {
  if (!f.length) return;
  const n = new Float32Array(feats.length + f.length);
  n.set(feats); n.set(f, feats.length);
  feats = n;
}

async function runChunks(final: boolean) {
  if (!session || !spec) return;
  const { T, shift, blank } = spec;
  const frames = () => feats.length / FBANK_DIM;
  const ids: number[] = [];
  const parts: { s: string; t: number }[] = [];
  let text = '';
  let chunks = 0;
  let ms = 0;
  while (frames() >= T || (final && frames() > 0)) {
    let x = feats.subarray(0, T * FBANK_DIM);
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
    feats = feats.slice(used * FBANK_DIM);
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
      else if (m.type === 'audio') { appendFeats(fb.accept(m.samples)); await runChunks(false); }
      else if (m.type === 'flush') { appendFeats(fb.finish()); await runChunks(true); post({ type: 'flushed' }); resetStates(); }
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
};
