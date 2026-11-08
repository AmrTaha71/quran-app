// On-device Quran ear for recitation (2026-11-08).
// One shared worker running tarteel-ai/whisper-base-ar-quran (see
// src/workers/quranAsr.worker.ts). QuranModelRecognition mimics the
// browser SpeechRecognition object (start/stop/abort + onresult/onend/
// onerror...), so the continuous-recitation code keeps its exact flow
// and only swaps `new SR()` for `new QuranModelRecognition()`.
// Audio is cut into segments at short pauses (energy VAD, forced cut at
// 6s); each segment is transcribed on the device and delivered as one
// FINAL result. The expected ayah text is never given to the model.

export const EAR_KEY = 'quran-ear';
export type EarKind = 'model' | 'browser';

export function getEar(): EarKind {
  try { return localStorage.getItem(EAR_KEY) === 'model' ? 'model' : 'browser'; } catch { return 'browser'; }
}
export function setEar(k: EarKind): void {
  try { localStorage.setItem(EAR_KEY, k); } catch { /* ignore */ }
}

// ---- shared worker ---------------------------------------------------
type Listener = (m: any) => void;
let worker: Worker | null = null;
let readyBackend = '';
let loadPromise: Promise<string> | null = null;
const listeners = new Set<Listener>();
const pending = new Map<number, (r: { text: string; ms: number } | null) => void>();
let nextId = 1;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/quranAsr.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'result' && pending.has(m.id)) {
      pending.get(m.id)!({ text: m.text, ms: m.ms });
      pending.delete(m.id);
    } else if (m.type === 'error' && typeof m.id === 'number' && pending.has(m.id)) {
      pending.get(m.id)!(null);
      pending.delete(m.id);
    }
    listeners.forEach((l) => l(m));
  };
  return worker;
}

export function onEarMessage(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function earBackend(): string { return readyBackend; }

/** Loads the model once (downloads the first time, then from cache). */
export function loadEar(): Promise<string> {
  if (readyBackend) return Promise.resolve(readyBackend);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<string>((resolve, reject) => {
    const off = onEarMessage((m) => {
      if (m.type === 'ready') { readyBackend = m.backend; off(); resolve(m.backend); }
      else if (m.type === 'error' && m.id === undefined) { off(); loadPromise = null; reject(new Error(m.message)); }
    });
    getWorker().postMessage({ type: 'load' });
  });
  return loadPromise;
}

export function transcribe(audio: Float32Array): Promise<{ text: string; ms: number } | null> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage({ type: 'run', id, audio }, [audio.buffer]);
  });
}

// ---- SpeechRecognition look-alike -------------------------------------
const TARGET_RATE = 16000;
const SILENCE_END_MS = 300;
const MAX_SEGMENT_S = 7;
const KEEPALIVE_MS = 400;
const MIN_SEGMENT_S = 0.35;

function downsample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_RATE) return new Float32Array(input);
  const ratio = fromRate / TARGET_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

export class QuranModelRecognition {
  lang = 'ar';
  continuous = true;
  interimResults = true;
  maxAlternatives = 1;
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  onaudioend: (() => void) | null = null;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  onnomatch: (() => void) | null = null;
  onsoundstart: (() => void) | null = null;
  onsoundend: (() => void) | null = null;

  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private seg: Float32Array[] = [];
  private segSamples = 0;
  private inSpeech = false;
  private silenceMs = 0;
  private noiseFloor = 0.005;
  private speechLevel = 0;
  private lastKeepalive = 0;
  private stopped = false;
  private ended = false;
  private inflight = 0;
  private queue: Promise<void> = Promise.resolve();

  start(): void {
    void this.begin();
  }

  private async begin() {
    try {
      await loadEar();
      if (this.stopped) { this.finishEnd(); return; }
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.stopped) { this.release(); this.finishEnd(); return; }
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();
      if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.node = this.ctx.createScriptProcessor(4096, 1, 1);
      const rate = this.ctx.sampleRate;
      this.node.onaudioprocess = (ev) => this.onAudio(ev.inputBuffer.getChannelData(0), rate);
      this.src.connect(this.node);
      this.node.connect(this.ctx.destination);
      this.onstart?.();
      this.onaudiostart?.();
    } catch (err) {
      const name = (err as { name?: string })?.name || '';
      this.onerror?.({ error: name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture', message: String((err as Error)?.message || err) });
      this.release();
      this.finishEnd();
    }
  }

  private onAudio(buf: Float32Array, rate: number) {
    if (this.stopped) return;
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const chunkMs = (buf.length / rate) * 1000;
    // Start threshold from the room noise; once speaking, a pause is a drop
    // well below the reciter's own level (AGC keeps between-word noise
    // above a fixed floor, so a fixed threshold never saw a pause).
    const startThreshold = Math.max(0.012, this.noiseFloor * 3);
    const pauseThreshold = Math.max(startThreshold * 0.8, this.speechLevel * 0.3);
    const loud = rms > (this.inSpeech ? pauseThreshold : startThreshold);
    if (loud) this.speechLevel = this.speechLevel === 0 ? rms : this.speechLevel * 0.9 + rms * 0.1;
    if (!this.inSpeech && !loud) {
      // Track the room's noise floor while quiet.
      this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
    }
    if (loud && !this.inSpeech) {
      this.inSpeech = true;
      this.silenceMs = 0;
      this.onspeechstart?.();
    }
    if (this.inSpeech) {
      this.seg.push(downsample(buf, rate));
      this.segSamples += Math.floor(buf.length / (rate / TARGET_RATE));
      this.silenceMs = loud ? 0 : this.silenceMs + chunkMs;
      if (this.silenceMs >= SILENCE_END_MS || this.segSamples >= MAX_SEGMENT_S * TARGET_RATE) {
        this.flushSegment();
      }
    }
    this.keepalive();
  }

  // While he is reciting or a segment is being transcribed, send an empty
  // interim result: the page re-arms its "silence -> prompt the next word"
  // timer on every result, and without interims (this ear only has finals)
  // that timer fired in the middle of fluent recitation.
  private keepalive() {
    if (!(this.inSpeech || this.inflight > 0)) return;
    const now = Date.now();
    if (now - this.lastKeepalive < KEEPALIVE_MS) return;
    this.lastKeepalive = now;
    const alt = { transcript: '', confidence: 0 };
    const result: any = [alt];
    result.isFinal = false;
    this.onresult?.({ resultIndex: 0, results: [result] });
  }

  private flushSegment() {
    const parts = this.seg;
    const n = this.segSamples;
    this.seg = [];
    this.segSamples = 0;
    this.inSpeech = false;
    this.silenceMs = 0;
    if (n < MIN_SEGMENT_S * TARGET_RATE) return;
    const audio = new Float32Array(n);
    let o = 0;
    for (const p of parts) { audio.set(p.subarray(0, Math.min(p.length, n - o)), o); o += p.length; if (o >= n) break; }
    this.inflight++;
    // Keep results in order: chain each transcription.
    this.queue = this.queue.then(async () => {
      const r = await transcribe(audio);
      this.inflight--;
      let text = (r?.text || '').trim();
      // Known Whisper hallucinations on noise/silence: never feed them in.
      if (/اشترك|القناة|ترجمة|موسيقى|شكرا للمشاهدة|subscribe/i.test(text)) text = '';
      if (text && !this.ended) {
        const alt = { transcript: text, confidence: 1 };
        const result: any = [alt];
        result.isFinal = true;
        result.length = 1;
        this.onresult?.({ resultIndex: 0, results: [result] });
      }
      if (this.stopped && this.inflight === 0) this.finishEnd();
    });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.inSpeech) this.flushSegment();
    this.release();
    if (this.inflight === 0) this.finishEnd();
  }

  abort(): void {
    if (this.stopped && this.ended) return;
    this.stopped = true;
    this.release();
    this.finishEnd();
  }

  private release() {
    try { this.node?.disconnect(); } catch { /* ignore */ }
    try { this.src?.disconnect(); } catch { /* ignore */ }
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { void this.ctx?.close(); } catch { /* ignore */ }
    this.node = null; this.src = null; this.stream = null; this.ctx = null;
  }

  private finishEnd() {
    if (this.ended) return;
    this.ended = true;
    setTimeout(() => { this.onaudioend?.(); this.onend?.(); }, 0);
  }
}
