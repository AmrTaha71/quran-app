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
import { QURANLAB_MODEL_CACHE, QURANLAB_MODEL_URL } from './earModelCache';
import { publishMicLevel } from './micLevel';

export const EAR_LAB_KEY = 'quran-ear-lab';
// W4-B (2026-11-19, decision 6): the device ear is now the DEFAULT. The old
// key stays readable: '1' = on, absent = on (new default), '0' = turned off
// on purpose (ear-lab page). It is only USED once the model is ready, see
// earLabUsable(); until then the test falls back to the browser ear.
export function earLabOn(): boolean { try { return localStorage.getItem(EAR_LAB_KEY) !== '0'; } catch { return false; } }
export function setEarLab(on: boolean): void { try { localStorage.setItem(EAR_LAB_KEY, on ? '1' : '0'); } catch { /* ignore */ } }

// One-time consent for the ~100 MB first download (asked once, then automatic).
export const EAR_DL_CONSENT_KEY = 'quran-ear-dl-consent-v1';
export function earDownloadConsented(): boolean { try { return localStorage.getItem(EAR_DL_CONSENT_KEY) === '1'; } catch { return false; } }
export function setEarDownloadConsent(): void { try { localStorage.setItem(EAR_DL_CONSENT_KEY, '1'); } catch { /* ignore */ } }

/** Load state of the model in this tab (for the download card + ear choice). */
export type EarLabState = { status: 'idle' | 'loading' | 'ready' | 'error'; loaded: number; total: number };
let earState: EarLabState = { status: 'idle', loaded: 0, total: 0 };
const earSubs = new Set<() => void>();
function setEarState(next: Partial<EarLabState>): void {
  earState = { ...earState, ...next };
  for (const cb of [...earSubs]) { try { cb(); } catch { /* ignore */ } }
}
export function getEarLabState(): EarLabState { return earState; }
export function subscribeEarLab(cb: () => void): () => void { earSubs.add(cb); return () => { earSubs.delete(cb); }; }
/** A live session failed to load the model: use the browser ear for the
 *  rest of this tab (no error loops); the card offers a retry. */
export function markEarLabFailed(): void { setEarState({ status: 'error' }); }
/** Use the device ear for a test now? Only when it is on AND loaded. */
export function earLabUsable(): boolean { return earLabOn() && earState.status === 'ready'; }
/** 3.3: may a session with NO browser ear start the device ear now? Only
 *  when it is loaded/loading, already downloaded, or agreed to and on
 *  Wi-Fi. Otherwise the caller shows the download card first, so a test
 *  never pulls ~100 MB (over mobile data) by surprise. */
export function earLabMayStart(): boolean {
  if (earLabUsable()) return true;
  if (!earLabOn() || !earDownloadConsented() || earState.status === 'error') return false;
  return earState.status === 'loading' || modelWasCached || !earOnMobileData();
}
/** 3.3: the message when a test needs the device ear and it is not here yet. */
export const EAR_NEEDS_DOWNLOAD_MSG = 'أذن الجهاز محتاجة تتحمّل مرة واحدة (حوالي ١٠٠ ميجا) — حمّلها من بطاقة «أذن الجهاز»، أو قيّم يدوي';
/** Is the model file already in the Cache API (downloaded before)? */
export async function earModelCached(): Promise<boolean> {
  try {
    const cache = await caches.open(QURANLAB_MODEL_CACHE);
    modelWasCached = !!(await cache.match(QURANLAB_MODEL_URL));
    return modelWasCached;
  } catch { return false; }
}

const TARGET = 16000;
const softSkeleton = (w: string) => w.replace(/ة/g, 'ه').replace(/(?<=.)ا(?=.)/g, '').replace(/يي+/g, 'ي').replace(/لل+/g, 'ل');
export const refKeySkel = (k: string) => expectedWordList(k).map((w) => softSkeleton(w.norm)).join('');

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let listener: ((m: any) => void) | null = null;
// 3.10: 40 s for a cached model; 90 s for the first, uncached load. Progress
// and stage messages from the worker re-arm it, so a slow phone compiling
// WASM is not killed while it still works.
const LOAD_TIMEOUT_MS = 40000;
const FIRST_LOAD_TIMEOUT_MS = 90000;
let modelWasCached = false;

// Surah 68 log (2026-11-14): after every correction the mic restarted from zero
// and the first ~0.7 s of the next ayah was lost («ودّوا» never heard, «فستبصر»
// clipped). Keep the stream + context alive for a while after a session ends so
// the next start (same test) attaches to a ready, already-flowing mic.
// 2026-11-14 (b): a spoken correction can run 20 s+, and a dropped keep forced
// a cold getUserMedia right when the user starts talking again.
const KEEP_MS = 60000;
let keep: { stream: MediaStream; ctx: AudioContext; timer: ReturnType<typeof setTimeout> } | null = null;
function closeKeep() {
  if (!keep) return;
  clearTimeout(keep.timer);
  try { keep.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
  try { void keep.ctx.close(); } catch { /* ignore */ }
  keep = null;
}
function takeKeep(): { stream: MediaStream; ctx: AudioContext } | null {
  if (!keep) return null;
  const k = keep;
  clearTimeout(k.timer);
  keep = null;
  const live = k.stream.getAudioTracks().some((t) => t.readyState === 'live' && !t.muted) && k.ctx.state !== 'closed';
  if (!live) {
    try { k.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { void k.ctx.close(); } catch { /* ignore */ }
    return null;
  }
  return { stream: k.stream, ctx: k.ctx };
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', closeKeep);
// Know early whether the model is on the device (earLabMayStart, timeouts).
if (typeof window !== 'undefined') void earModelCached();
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
      setEarState({ status: 'loading' });
      // W4-B: a slow first download (~100 MB) must not hit the 40 s load
      // timeout while bytes still arrive: each progress message re-arms it.
      let timer = setTimeout(() => {}, 0);
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { if (worker === w0) resetWorker(); listener = prev; setEarState({ status: 'error' }); rej(new Error('model-load-timeout')); }, modelWasCached ? LOAD_TIMEOUT_MS : FIRST_LOAD_TIMEOUT_MS);
      };
      arm();
      w0.onerror = () => { clearTimeout(timer); if (worker === w0) resetWorker(); setEarState({ status: 'error' }); rej(new Error('worker-error')); };
      listener = (m) => {
        if (m.type === 'progress') { arm(); if (m.loaded != null) setEarState({ loaded: Number(m.loaded) || 0, total: Number(m.total) || 0 }); }
        else if (m.type === 'ready') { clearTimeout(timer); listener = prev; setEarState({ status: 'ready' }); res(); }
        else if (m.type === 'error') { clearTimeout(timer); if (worker === w0) resetWorker(); setEarState({ status: 'error' }); rej(new Error(m.message)); }
      };
      w0.postMessage({ type: 'load' });
    });
    ready.catch(() => {});
  }
  return ready!.then(() => worker!);
}
/** W4-P: Wi-Fi only when the browser says so. Cellular, saveData or an unknown
 *  connection (no navigator.connection, e.g. Safari; or no `type`) count as
 *  mobile data: the ~100 MB download then needs an explicit tap every time. */
export function earOnMobileData(): boolean {
  const c = (typeof navigator === 'undefined' ? undefined : (navigator as unknown as { connection?: { type?: string; saveData?: boolean } }).connection);
  if (!c) return true;
  if (c.saveData === true || c.type === 'cellular') return true;
  return !(c.type === 'wifi' || c.type === 'ethernet');
}
/** Start loading the model ahead of time. A cached model always loads (no
 *  download). A real download starts only after an explicit confirm
 *  (`confirmed`), or on Wi-Fi after the one-time consent. Anything else is a
 *  silent no-op, so no caller can pull 100 MB over mobile data unasked. */
export function preloadEarLab(confirmed = false): void {
  void earModelCached().then((cached) => {
    if (!cached && !confirmed && !(earDownloadConsented() && !earOnMobileData())) return;
    return getWorker().then(() => undefined);
  }).catch(() => {});
}

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

// Keyed by the words' content, not the array identity: ayah mode builds a new
// array on every (re)start, so every resume after a correction rebuilt it.
const wordCache = new Map<string, Promise<PhonWord[]>>();
function wordsKey(expected: { norm: string; ayahIdx: number }[]): string {
  let k = String(expected.length);
  for (const w of expected) k += '|' + w.ayahIdx + ':' + w.norm;
  return k;
}

export class QuranLabRecognition {
  lang = 'ar';
  continuous = true;
  interimResults = true;
  maxAlternatives = 1;
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  /** Fires when the microphone permission is granted (the model may still be loading). */
  onmicgranted: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  onaudioend: (() => void) | null = null;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  onnomatch: (() => void) | null = null;
  onsoundstart: (() => void) | null = null;
  onsoundend: (() => void) | null = null;
  /** W5-N2: every decoded chunk's timed phoneme parts ({s, t: audio s}). */
  onparts: ((parts: { s: string; t: number }[]) => void) | null = null;

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
  /** Optional timing hook (ms since start()): the page logs it to its diag. */
  diag: ((label: string, ms: number) => void) | null = null;
  private t0 = 0;
  private seenFrame = false;
  private seenSound = false;
  private mark(label: string) { try { this.diag?.(label, Math.round(performance.now() - this.t0)); } catch { /* ignore */ } }

  /** `expected`: the range's words (SelfTestPage contExpected). The
   *  stream starts aligning at `startWord` (the first word not yet said). */
  constructor(private expected: { norm: string; ayahIdx: number }[], private startWord = 0) {}

  start(): void {
    // iPad Safari only lets an AudioContext run if it is created/resumed inside
    // the tap that started the test. Created after the awaits in begin() it
    // stays «suspended» on repeat recordings: the mic light is on, no audio
    // reaches the model, and the page waits for a first word forever.
    this.t0 = performance.now();
    const kept = takeKeep();
    this.mark(kept ? 'start-kept' : 'start-cold');
    if (kept) {
      this.ctx = kept.ctx;
      void this.ctx.resume().catch(() => {});
      this.streamP = Promise.resolve(kept.stream);
      void this.begin();
      return;
    }
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();
      void this.ctx.resume().catch(() => {});
    } catch { this.ctx = null; }
    // Ask for the microphone NOW (inside the tap): after a long model load the
    // gesture is gone and iOS may never show the prompt / return a stream.
    try {
      this.streamP = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
      this.streamP.then(() => { if (!this.stopped) this.onmicgranted?.(); }).catch(() => {});
    } catch { this.streamP = null; }
    void this.begin();
  }

  private async begin() {
    try {
      // W5-N2: no expected words = phoneme tap (follow-the-imam): no
      // PhonemeStream, the raw timed parts go to onparts instead.
      let words: Promise<PhonWord[]> | null = null;
      if (this.expected.length) {
        const wk = wordsKey(this.expected);
        words = wordCache.get(wk) ?? null;
        if (!words) {
          const built = buildPhonWords(this.expected, refKeySkel);
          words = built;
          if (wordCache.size > 12) wordCache.clear();
          wordCache.set(wk, built);
          built.catch(() => { if (wordCache.get(wk) === built) wordCache.delete(wk); });
        }
      }
      const [w, pw] = await Promise.all([getWorker(), words]);
      if (this.stopped) { this.finishEnd(); return; }
      if (pw) {
        this.ps = new PhonemeStream(pw);
        this.ps.pointer = this.startWord;
      }
      listener = (m) => this.onWorker(m);
      w.postMessage({ type: 'reset' });
      this.stream = await (this.streamP ?? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } }));
      if (this.stopped) { this.release(); this.finishEnd(); return; }
      this.mark('stream-ready');
      this.attach(w);
      this.mark('attached');
      this.onstart?.();
      this.onaudiostart?.();
      this.watch(w);
    } catch (err) {
      const name = (err as { name?: string })?.name || '';
      const msg = String((err as Error)?.message || err);
      const loadFail = /model-load-timeout|worker-error|load|fetch|network/i.test(msg) && name !== 'NotAllowedError';
      // 3.8: a model that will not load is not a network problem for the
      // user (the files are local after the first download): own code.
      this.onerror?.({ error: name === 'NotAllowedError' ? 'not-allowed' : loadFail ? 'model-load' : 'audio-capture', message: msg });
      this.release();
      this.finishEnd();
    }
  }

  private maxRms = 0;
  private retries = 0;

  /** Wire the current stream + context into the worker. */
  private attach(w: Worker) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!this.ctx) this.ctx = new AC();
    const ctx = this.ctx!;
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    ctx.onstatechange = () => { if (!this.stopped && ctx.state !== 'running') void ctx.resume().catch(() => {}); };
    this.src = ctx.createMediaStreamSource(this.stream!);
    this.node = ctx.createScriptProcessor(4096, 1, 1);
    const rate = ctx.sampleRate;
    this.node.onaudioprocess = (ev) => {
      if (this.stopped) return;
      this.frames++;
      const ch = ev.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < ch.length; i += 8) sum += ch[i] * ch[i];
      const rms = Math.sqrt(sum / (ch.length / 8));
      publishMicLevel(rms);
      if (rms > this.maxRms) this.maxRms = rms;
      if (!this.seenFrame) { this.seenFrame = true; this.mark('first-frame'); }
      if (!this.seenSound && rms > 1e-5) { this.seenSound = true; this.mark('first-signal'); }
      const s = downsample(ch, rate);
      w.postMessage({ type: 'audio', samples: s }, [s.buffer]);
    };
    this.frames = 0;
    this.maxRms = 0;
    this.src.connect(this.node);
    this.node.connect(ctx.destination);
  }

  /** The mic light can be on while no sound arrives (iOS audio-session
   *  glitch, ~half of the starts; also right after a spoken correction).
   *  2026-11-14 (b): checked fast. At 0.7 s: no audio callbacks at all, or a
   *  dead track -> rebuild at once. At 1.8 s: still pure digital silence or a
   *  muted track -> rebuild. Up to 2 rebuilds, then report. (Was one check at
   *  2.2 s per round: a dead mic could cost ~6 s.) */
  private watch(w: Worker) {
    const check = (final: boolean) => {
      if (this.stopped) return;
      const track = this.stream?.getAudioTracks()[0];
      const noFrames = this.frames === 0;
      const trackDead = !track || track.readyState !== 'live';
      const dead = noFrames || trackDead || (final && (this.maxRms < 1e-6 || !!track?.muted));
      if (!dead) { if (!final) setTimeout(() => check(true), 1100); return; }
      this.mark(`dead-${final ? 'late' : 'early'}${noFrames ? '-noframes' : trackDead ? '-track' : '-silent'}`);
      if (this.retries >= 2) {
        this.onerror?.({ error: 'audio-capture', message: 'no-audio-signal' });
        return;
      }
      this.retries++;
      void this.rebuild(w);
    };
    setTimeout(() => check(false), 700);
  }

  private async rebuild(w: Worker) {
    try {
      try { this.node?.disconnect(); } catch { /* ignore */ }
      try { this.src?.disconnect(); } catch { /* ignore */ }
      try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
      try { await this.ctx?.close(); } catch { /* ignore */ }
      this.ctx = null; this.node = null; this.src = null;
      await new Promise((r) => setTimeout(r, 120));
      if (this.stopped) return;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: this.retries < 2, noiseSuppression: false, autoGainControl: true } });
      if (this.stopped) { this.release(); return; }
      this.seenFrame = false; this.seenSound = false;
      this.mark(`rebuilt-${this.retries}`);
      this.attach(w);
      this.watch(w);
    } catch (err) {
      const name = (err as { name?: string })?.name || '';
      this.onerror?.({ error: name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture', message: String((err as Error)?.message || err) });
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
      if (this.onparts && !this.stopped && Array.isArray(m.parts) && m.parts.length) {
        try { this.onparts(m.parts); } catch { /* the page's handler must not kill the ear */ }
      }
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
      this.onerror?.({ error: 'model-load', message: m.message });
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
    if (this.node) this.node.onaudioprocess = null;
    // A capture that delivered real sound is parked for the next start.
    const healthy = this.stream && this.ctx && this.frames > 0 && this.maxRms > 1e-6
      && this.stream.getAudioTracks().some((t) => t.readyState === 'live') && this.ctx.state !== 'closed';
    if (healthy) {
      closeKeep();
      const stream = this.stream!, ctx = this.ctx!;
      keep = { stream, ctx, timer: setTimeout(closeKeep, KEEP_MS) };
    } else {
      try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
      try { void this.streamP?.then((st) => st.getTracks().forEach((t) => t.stop())).catch(() => {}); } catch { /* ignore */ }
      try { void this.ctx?.close(); } catch { /* ignore */ }
    }
    this.node = null; this.src = null; this.stream = null; this.ctx = null;
  }

  private finishEnd() {
    if (this.ended) return;
    this.ended = true;
    setTimeout(() => { this.onaudioend?.(); this.onend?.(); }, 0);
  }
}

/** W5-N2 (2026-11-19): the ear with no expected text, for follow-the-imam.
 *  Same worker, same mic path (stream asked inside the tap, iOS keep/
 *  rebuild logic, error names) as the tasmee' ear; it only hands each
 *  chunk's timed phoneme parts to `onparts` (→ ImamFollower.pushPhonemes). */
export class QuranLabPhonemeTap extends QuranLabRecognition {
  constructor() { super([]); }
}

/** W5-N2: drop the parked mic (kept 60 s for the next tasmee' start) so a
 *  stopped follow session does not leave the mic light on. */
export function releaseEarMic(): void { closeKeep(); }
