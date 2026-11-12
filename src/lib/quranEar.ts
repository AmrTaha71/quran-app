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

const EAR_READY_KEY = 'quran-ear-ready';

// Device too slow for the on-device ear (2026-11-11): set from the
// worker's speed check at load, or after two recited segments in a row
// that each took the model more than SLOW_SEGMENT_MS. The value carries a
// version so a faster build can re-measure every device.
const EAR_SLOW_KEY = 'quran-ear-slow';
const EAR_SLOW_VERSION = 'v1';
const SLOW_BENCH_MS = 2500;
const SLOW_SEGMENT_MS = 3000;
let slowStreak = 0;

export function earIsSlow(): boolean {
  try { return (localStorage.getItem(EAR_SLOW_KEY) || '').startsWith(`${EAR_SLOW_VERSION}:`); } catch { return false; }
}
function markEarSlow(ms: number): void {
  try { localStorage.setItem(EAR_SLOW_KEY, `${EAR_SLOW_VERSION}:${Math.round(ms)}`); } catch { /* ignore */ }
}
function clearEarSlow(): void {
  slowStreak = 0;
  try { localStorage.removeItem(EAR_SLOW_KEY); } catch { /* ignore */ }
}
function browserEarUsable(): boolean {
  try {
    const w = window as any;
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition) && navigator.onLine !== false;
  } catch { return false; }
}

/** The on-device ear is the default once it has loaded on this device;
 *  an explicit choice in the card wins (2026-11-09) — except on a device
 *  measured too slow for it, where the browser's ear is used whenever it
 *  is available and online (2026-11-11). */
export function getEar(): EarKind {
  try {
    if (earIsSlow() && browserEarUsable()) return 'browser';
    const v = localStorage.getItem(EAR_KEY);
    if (v === 'model' || v === 'browser') return v;
    return localStorage.getItem(EAR_READY_KEY) === '1' ? 'model' : 'browser';
  } catch { return 'browser'; }
}
export function setEar(k: EarKind): void {
  // Choosing the on-device ear again asks for a fresh measurement.
  if (k === 'model') clearEarSlow();
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
      if (m.type === 'ready') { readyBackend = m.backend; if (typeof m.benchMs === 'number') { if (m.benchMs > SLOW_BENCH_MS) markEarSlow(m.benchMs); else clearEarSlow(); } try { localStorage.setItem(EAR_READY_KEY, '1'); } catch { /* ignore */ } off(); resolve(m.backend); }
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

/** Transcribes a whole recorded blob on the device (no upload, no cost).
 *  Decodes it, mixes to mono, resamples to 16 kHz; the worker chunks long
 *  audio itself. Returns null when decoding or the model fails. */
export async function transcribeBlob(blob: Blob): Promise<string | null> {
  try {
    await loadEar();
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new Ctx();
    try {
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      const mono = new Float32Array(decoded.length);
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const data = decoded.getChannelData(c);
        for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
      }
      const pcm = downsample(mono, decoded.sampleRate);
      const r = await transcribe(pcm);
      return r?.text ?? null;
    } finally {
      void ctx.close().catch(() => undefined);
    }
  } catch {
    return null;
  }
}

// ---- SpeechRecognition look-alike -------------------------------------
const TARGET_RATE = 16000;
const SILENCE_END_MS = 300;
const MAX_SEGMENT_S = 7;
const SOFT_SEGMENT_S = 4;
const SOFT_SILENCE_MS = 160;
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

// One mic stream shared across sessions (2026-11-12): reopening the mic
// after every correction cost time and the first word of the resumed
// recitation was lost. Tracks stop 20s after the last session ends.
let micStream: MediaStream | null = null;
let micTimer: ReturnType<typeof setTimeout> | null = null;
async function getMicStream(): Promise<MediaStream> {
  if (micTimer) { clearTimeout(micTimer); micTimer = null; }
  if (micStream && micStream.getAudioTracks().some((t) => t.readyState === 'live')) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  return micStream;
}
function releaseMicStreamLater() {
  if (micTimer) clearTimeout(micTimer);
  micTimer = setTimeout(() => {
    micTimer = null;
    try { micStream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    micStream = null;
  }, 20000);
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
  private segRms: number[] = [];
  // Pre-roll (2026-11-12): the last quiet chunks before speech starts, so a
  // soft first letter (the و of «والذين») is not cut off.
  private pre: Float32Array[] = [];
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
      this.stream = await getMicStream();
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
      for (const p of this.pre) { this.seg.push(p); this.segRms.push(rms); this.segSamples += p.length; }
      this.pre = [];
      this.onspeechstart?.();
    }
    if (!this.inSpeech) {
      this.pre.push(downsample(buf, rate));
      if (this.pre.length > 3) this.pre.shift();
    }
    if (this.inSpeech) {
      const ds = downsample(buf, rate);
      this.seg.push(ds);
      this.segRms.push(rms);
      this.segSamples += ds.length;
      this.silenceMs = loud ? 0 : this.silenceMs + chunkMs;
      // 2026-11-12 (Fable): every forced 7s cut in the diag files fell in
      // the middle of a word and the model garbled it («وما أنزل» ->
      // «وما منزلم», «رزقناهم» -> «رزقنا | أهم»). Now: after 4s a shorter
      // pause is enough to cut; at the hard limit the cut goes to the
      // quietest moment of the last ~1.7s and the audio after it starts
      // the next segment, so no word is split.
      const longRun = this.segSamples >= SOFT_SEGMENT_S * TARGET_RATE;
      if (this.silenceMs >= SILENCE_END_MS || (longRun && this.silenceMs >= SOFT_SILENCE_MS)) {
        this.flushSegment();
      } else if (this.segSamples >= MAX_SEGMENT_S * TARGET_RATE) {
        const n = this.segRms.length;
        let cut = n - 1;
        let min = Infinity;
        for (let i = Math.max(1, n - 20); i < n - 1; i++) if (this.segRms[i] < min) { min = this.segRms[i]; cut = i; }
        this.flushSegment(cut);
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

  private flushSegment(cutAt?: number) {
    const whole = cutAt == null || cutAt >= this.seg.length - 1;
    const parts = whole ? this.seg : this.seg.slice(0, cutAt! + 1);
    const rest = whole ? [] : this.seg.slice(cutAt! + 1);
    const restRms = whole ? [] : this.segRms.slice(cutAt! + 1);
    let n = 0;
    for (const p of parts) n += p.length;
    this.seg = rest;
    this.segRms = restRms;
    this.segSamples = rest.reduce((a, p) => a + p.length, 0);
    this.inSpeech = rest.length > 0;
    this.silenceMs = 0;
    if (n < MIN_SEGMENT_S * TARGET_RATE) return;
    const audio = new Float32Array(n);
    let o = 0;
    for (const p of parts) { audio.set(p.subarray(0, Math.min(p.length, n - o)), o); o += p.length; if (o >= n) break; }
    this.inflight++;
    // Keep results in order: chain each transcription.
    this.queue = this.queue.then(async () => {
      // A session that already ended must not keep the shared worker busy:
      // its queued segments used to run to the end (about 15s each on a slow
      // device) while the NEXT session's audio waited behind them and never
      // came back (diag 2026-11-11: 42s of recitation, no result).
      if (this.ended) { this.inflight--; return; }
      const r = await transcribe(audio);
      this.inflight--;
      if (r) { slowStreak = r.ms > SLOW_SEGMENT_MS ? slowStreak + 1 : 0; if (slowStreak >= 2) markEarSlow(r.ms); }
      let text = (r?.text || '').trim();
      // Known Whisper hallucinations on noise/silence: never feed them in.
      if (/اشترك|القناة|ترجمة|موسيقى|شكرا للمشاهدة|subscribe/i.test(text)) text = '';
      if (text && !this.ended) {
        const alt = { transcript: text, confidence: 1 };
        const result: any = [alt];
        result.isFinal = true;
        result.length = 1;
        // ms/backend/audioMs: how long the model took, for the diag file.
        this.onresult?.({ resultIndex: 0, results: [result], ms: r?.ms, backend: readyBackend, audioMs: Math.round((n / TARGET_RATE) * 1000) });
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
    releaseMicStreamLater();
    try { void this.ctx?.close(); } catch { /* ignore */ }
    this.node = null; this.src = null; this.stream = null; this.ctx = null;
  }

  private finishEnd() {
    if (this.ended) return;
    this.ended = true;
    setTimeout(() => { this.onaudioend?.(); this.onend?.(); }, 0);
  }
}
