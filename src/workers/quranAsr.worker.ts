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

async function load() {
  if (asr) return;
  const progress = (p: { status?: string; progress?: number; file?: string }) => {
    if (p.status === 'progress') self.postMessage({ type: 'progress', file: p.file, progress: p.progress });
  };
  const hasGpu = typeof (self as unknown as { navigator?: { gpu?: unknown } }).navigator?.gpu !== 'undefined';
  if (hasGpu) {
    try {
      asr = (await pipeline('automatic-speech-recognition', MODEL, { device: 'webgpu', dtype: 'q4', progress_callback: progress })) as unknown as Asr;
      backend = 'webgpu-q4';
      return;
    } catch { asr = null; }
  }
  asr = (await pipeline('automatic-speech-recognition', MODEL, { device: 'wasm', dtype: 'q8', progress_callback: progress })) as unknown as Asr;
  backend = 'wasm-q8';
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: 'load' } | { type: 'run'; id: number; audio: Float32Array };
  try {
    if (msg.type === 'load') {
      await load();
      self.postMessage({ type: 'ready', backend });
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
