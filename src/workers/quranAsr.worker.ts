// On-device Quran recognizer (2026-11-08): tarteel-ai/whisper-base-ar-quran
// (Apache-2.0) as ONNX (iqbalaesthetic/Basira) via transformers.js.
// Runs in a worker so the page stays smooth. Audio never leaves the device.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
// ORT runtime from our own origin (public/ort/), not the jsDelivr CDN, so
// the service worker caches it and the ear works offline.
if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = '/ort/';
const MODEL = 'iqbalaesthetic/Basira';

type Asr = (audio: Float32Array, opts?: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
let asr: Asr | null = null;
let backend = '';
let benchMs = 0;

// Device speed check (2026-11-11). A diag from an Intel Mac showed about
// 15s of model time per recited segment, which makes live correction
// useless. Whisper always works on a padded 30s window, so one short run
// is a fair measure of the device. The page uses benchMs to decide whether
// this device can use the on-device ear at all.
const SLOW_MS = 2500;
async function bench(p: Asr): Promise<number> {
  const audio = new Float32Array(16000 * 3);
  for (let i = 0; i < audio.length; i++) audio[i] = (Math.random() - 0.5) * 0.002;
  const t0 = performance.now();
  try { await p(audio, { chunk_length_s: 30, stride_length_s: 5, max_new_tokens: 8 }); }
  catch { await p(new Float32Array(16000 * 3), { chunk_length_s: 30, stride_length_s: 5 }); }
  return Math.round(performance.now() - t0);
}
async function dispose(p: Asr | null) {
  try { await (p as unknown as { dispose?: () => Promise<void> } | null)?.dispose?.(); } catch { /* ignore */ }
}

async function load() {
  if (asr) return;
  const progress = (p: { status?: string; progress?: number; file?: string }) => {
    if (p.status === 'progress') self.postMessage({ type: 'progress', file: p.file, progress: p.progress });
  };
  const hasGpu = typeof (self as unknown as { navigator?: { gpu?: unknown } }).navigator?.gpu !== 'undefined';
  let gpu: Asr | null = null;
  let gpuMs = Infinity;
  if (hasGpu) {
    try {
      gpu = (await pipeline('automatic-speech-recognition', MODEL, { device: 'webgpu', dtype: 'q4', progress_callback: progress })) as unknown as Asr;
      await bench(gpu); // first run pays for shader compilation
      gpuMs = await bench(gpu);
    } catch { await dispose(gpu); gpu = null; gpuMs = Infinity; }
  }
  if (gpu && gpuMs <= SLOW_MS) { asr = gpu; backend = 'webgpu-q4'; benchMs = gpuMs; return; }
  // No GPU, or a GPU slower than the limit (weak integrated graphics):
  // measure the CPU path too and keep whichever is faster.
  let cpu: Asr | null = null;
  let cpuMs = Infinity;
  try {
    cpu = (await pipeline('automatic-speech-recognition', MODEL, { device: 'wasm', dtype: 'q8', progress_callback: progress })) as unknown as Asr;
    await bench(cpu);
    cpuMs = await bench(cpu);
  } catch (err) {
    await dispose(cpu); cpu = null; cpuMs = Infinity;
    if (!gpu) throw err;
  }
  if (cpu && cpuMs <= gpuMs) { await dispose(gpu); asr = cpu; backend = 'wasm-q8'; benchMs = cpuMs; }
  else { await dispose(cpu); asr = gpu; backend = 'webgpu-q4'; benchMs = gpuMs; }
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: 'load' } | { type: 'run'; id: number; audio: Float32Array };
  try {
    if (msg.type === 'load') {
      await load();
      self.postMessage({ type: 'ready', backend, benchMs });
    } else if (msg.type === 'run') {
      await load();
      const t0 = performance.now();
      // The fine-tuned model is Arabic-only and its generation config is not
      // marked multilingual, so no language/task options (they throw).
      const out = await asr!(msg.audio, { chunk_length_s: 30, stride_length_s: 5 });
      const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
      self.postMessage({ type: 'result', id: msg.id, text: text.trim(), ms: Math.round(performance.now() - t0), backend });
    }
  } catch (err) {
    const id = (e.data && (e.data as { id?: number }).id);
    self.postMessage({ type: 'error', id: typeof id === 'number' ? id : undefined, message: String((err as Error)?.message || err), loaded: !!asr });
  }
};
