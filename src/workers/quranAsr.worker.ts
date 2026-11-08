// On-device Quran recognizer (2026-11-08): tarteel-ai/whisper-base-ar-quran
// (Apache-2.0) as ONNX (iqbalaesthetic/Basira) via transformers.js.
// Runs in a worker so the page stays smooth. Audio never leaves the device.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
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
      const out = await asr!(msg.audio, { language: 'arabic', task: 'transcribe' });
      const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
      self.postMessage({ type: 'result', id: msg.id, text: text.trim(), ms: Math.round(performance.now() - t0), backend });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err as Error)?.message || err) });
  }
};
