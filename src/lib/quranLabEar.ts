// The new ear in the recitation test (2026-11-13): Quran-Lab zipformer
// (streaming phonemes) + PhonemeStream (phonemes → expected words).
// Same interface as the browser SpeechRecognition / QuranModelRecognition,
// so SelfTestPage's continuous mode uses it unchanged: every settled word
// arrives as a final result whose transcript is the word's text (heard
// right) or the heard sounds prefixed with «~» (heard wrong).
// Turned on per device with the «quran-ear-lab» flag (ear-lab page or
// the ear card in Settings); off → the old ear, exactly as before.
import { buildPhonWords, PhonemeStream, type PhonWord } from './phonemeEar';
import { expectedWordList } from './expectedWords';

export const EAR_LAB_KEY = 'quran-ear-lab';
export function earLabOn(): boolean { try { return localStorage.getItem(EAR_LAB_KEY) === '1'; } catch { return false; } }
export function setEarLab(on: boolean): void { try { if (on) localStorage.setItem(EAR_LAB_KEY, '1'); else localStorage.removeItem(EAR_LAB_KEY); } catch { /* ignore */ } }

const TARGET = 16000;
const softSkeleton = (w: string) => w.replace(/ة/g, 'ه').replace(/(?<=.)ا(?=.)/g, '').replace(/يي+/g, 'ي').replace(/لل+/g, 'ل');
export const refKeySkel = (k: string) => expectedWordList(k).map((w) => softSkeleton(w.norm)).join('');

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let listener: ((m: any) => void) | null = null;
const LOAD_TIMEOUT_MS = 40000;
function resetWorker() {
  try { worker?.terminate(); } catch { /* ignore */ }
  worker = null; ready = null; listener = null;
}
function getWorker(): Promise<Worker> {
  if (!worker) {
    worker = new Worker(new URL('../workers/quranLab.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => listener?.(e.data);
    // A failed or hung load used to stay cached forever: the red mic showed,
    // nothing was heard, and every later tap hit the same dead promise.
    const w0 = worker;
    ready = new Promise<void>((res, rej) => {
      const prev = listener;
      const timer = setTimeout(() => { if (worker === w0) resetWorker(); listener = prev; rej(new Error('model-load-timeout')); }, LOAD_TIMEOUT_MS);
      w0.onerror = () => { clearTimeout(timer); if (worker === w0) resetWorker(); rej(new Error('worker-error')); };
      listener = (m) => {
        if (m.type === 'ready') { clearTimeout(timer); listener = prev; res(); }
        else if (m.type === 'error') { clearTimeout(timer); if (worker === w0) resetWorker(); rej(new Error(m.message)); }
      };
      w0.postMessage({ type: 'load' });
    });
    ready.catch(() => {});
  }
  return ready!.then(() => worker!);
}
/** Start downloading / loading the model ahead of time. */
export function preloadEarLab(): void { void getWorker().catch(() => {}); }

function downsample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET) return new Float32Array(input);
  const ratio = fromRate / TARGET;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const s = Math.floor(i * ratio);
    const e = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = s; j < e; j++) sum += input[j];
    out[i] = sum / Math.max(1, e - s);
  }
  return out;
}

const wordCache = new WeakMap<object, Promise<PhonWord[]>>();

export class QuranLabRecognition {
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
  private streamP: Promise<MediaStream> | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private ps: PhonemeStream | null = null;
  private stopped = false;
  private ended = false;
  private heardAny = false;
  private lastKeepalive = 0;
  private frames = 0;

  /** `expected`: the range's words (SelfTestPage contExpected). The
   *  stream starts aligning at `startWord` (the first word not yet said). */
  constructor(private expected: { norm: string; ayahIdx: number }[], private startWord = 0) {}

  start(): void {
    // iPad Safari only lets an AudioContext run if it is created/resumed inside
    // the tap that started the test. Created after the awaits in begin() it
    // stays «suspended» on repeat recordings: the mic light is on, no audio
    // reaches the model, and the page waits for a first word forever.
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();
      void this.ctx.resume().catch(() => {});
    } catch { this.ctx = null; }
    // Ask for the microphone NOW (inside the tap): after a long model load the
    // gesture is gone and iOS may never show the prompt / return a stream.
    try {
      this.streamP = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
      this.streamP.catch(() => {});
    } catch { this.streamP = null; }
    void this.begin();
  }

  private async begin() {
    try {
      let words = wordCache.get(this.expected);
      if (!words) { words = buildPhonWords(this.expected, refKeySkel); wordCache.set(this.expected, words); }
      const [w, pw] = await Promise.all([getWorker(), words]);
      if (this.stopped) { this.finishEnd(); return; }
      this.ps = new PhonemeStream(pw);
      this.ps.pointer = this.startWord;
      listener = (m) => this.onWorker(m);
      w.postMessage({ type: 'reset' });
      this.stream = await (this.streamP ?? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } }));
      if (this.stopped) { this.release(); this.finishEnd(); return; }
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.node = this.ctx.createScriptProcessor(4096, 1, 1);
      const rate = this.ctx.sampleRate;
      this.node.onaudioprocess = (ev) => {
        if (this.stopped) return;
        this.frames++;
        const s = downsample(ev.inputBuffer.getChannelData(0), rate);
        w.postMessage({ type: 'audio', samples: s }, [s.buffer]);
      };
      this.frames = 0;
      this.src.connect(this.node);
      const ctxRef = this.ctx;
      setTimeout(() => { if (!this.stopped && this.frames === 0) { void ctxRef?.resume().catch(() => {}); } }, 1200);
      this.node.connect(this.ctx.destination);
      this.onstart?.();
      this.onaudiostart?.();
    } catch (err) {
      const name = (err as { name?: string })?.name || '';
      const msg = String((err as Error)?.message || err);
      const loadFail = /model-load-timeout|worker-error|load|fetch|network/i.test(msg) && name !== 'NotAllowedError';
      this.onerror?.({ error: name === 'NotAllowedError' ? 'not-allowed' : loadFail ? 'network' : 'audio-capture', message: msg });
      this.release();
      this.finishEnd();
    }
  }

  private emit(text: string) {
    if (!text || this.ended) return;
    const alt = { transcript: text, confidence: 1 };
    const result: any = [alt];
    result.isFinal = true;
    result.length = 1;
    this.onresult?.({ resultIndex: 0, results: [result], backend: 'quranlab' });
  }

  private onWorker(m: any) {
    if (m.type === 'tokens') {
      if (m.text && !this.heardAny) { this.heardAny = true; this.onspeechstart?.(); }
      if (this.ps && m.text) {
        this.emit(Array.isArray(m.parts) ? this.ps.pushTimed(m.parts) : this.ps.push(m.text));
        // The last aligned word stays pending until more speech arrives, so
        // the final word of an ayah («السعير») never settled and was marked
        // missing. After a short quiet spell, settle it.
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => { this.idleTimer = null; if (this.ps && !this.stopped) this.emit(this.ps.finish()); }, 750);
      }
      // Keep the page's no-result watchdog quiet while audio flows.
      const now = Date.now();
      if (now - this.lastKeepalive > 1500) {
        this.lastKeepalive = now;
        const r: any = [{ transcript: '', confidence: 0 }];
        r.isFinal = false;
        this.onresult?.({ resultIndex: 0, results: [r] });
      }
    } else if (m.type === 'flushed') {
      if (!this.stopped) return; // reply to the previous session's flush
      if (this.ps) this.emit(this.ps.finish());
      this.finishEnd();
    } else if (m.type === 'error') {
      this.onerror?.({ error: 'network', message: m.message });
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.release();
    if (worker && this.ps) worker.postMessage({ type: 'flush' });
    else this.finishEnd();
  }

  abort(): void {
    if (this.stopped && this.ended) return;
    this.stopped = true;
    this.release();
    worker?.postMessage({ type: 'reset' });
    this.finishEnd();
  }

  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  private release() {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    try { this.node?.disconnect(); } catch { /* ignore */ }
    try { this.src?.disconnect(); } catch { /* ignore */ }
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { void this.streamP?.then((st) => st.getTracks().forEach((t) => t.stop())).catch(() => {}); } catch { /* ignore */ }
    try { void this.ctx?.close(); } catch { /* ignore */ }
    this.node = null; this.src = null; this.stream = null; this.ctx = null;
  }

  private finishEnd() {
    if (this.ended) return;
    this.ended = true;
    setTimeout(() => { this.onaudioend?.(); this.onend?.(); }, 0);
  }
}
