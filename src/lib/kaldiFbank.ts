// Kaldi-compatible log-mel filterbank (2026-11-13) for the Quran-Lab
// zipformer: 16 kHz, 25 ms / 10 ms frames, povey window, preemphasis 0.97,
// DC removal, 512-point FFT, 80 mel bins (20 Hz .. 7600 Hz), log with
// FLT_EPSILON floor, dither 0, snip_edges = false. Matches
// kaldi-native-fbank (validated to < 1e-3 abs on real speech).
//
// Streaming: OnlineFbank.accept(samples) returns every frame whose window
// is complete; finish() returns the tail frames (edge-reflected).

const SR = 16000;
const WIN = 400;
const HOP = 160;
const NFFT = 512;
const NMEL = 80;
const PREEMPH = 0.97;
const EPS = 1.1920929e-7;

const window = (() => {
  const w = new Float64Array(WIN);
  for (let i = 0; i < WIN; i++) w[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1)), 0.85);
  return w;
})();

// Mel filters as [firstBin, weights[]] for the 256 non-Nyquist bins.
const melBanks = (() => {
  const mel = (f: number) => 1127 * Math.log(1 + f / 700);
  const lo = mel(20);
  const hi = mel(SR / 2 - 400);
  const delta = (hi - lo) / (NMEL + 1);
  const binW = SR / NFFT;
  const banks: { start: number; w: Float64Array }[] = [];
  for (let m = 0; m < NMEL; m++) {
    const l = lo + m * delta;
    const c = lo + (m + 1) * delta;
    const r = lo + (m + 2) * delta;
    let start = -1;
    const ws: number[] = [];
    for (let i = 0; i < NFFT / 2; i++) {
      const f = mel(binW * i);
      let w = 0;
      if (f > l && f < r) w = f <= c ? (f - l) / (c - l) : (r - f) / (r - c);
      if (w > 0) {
        if (start < 0) start = i;
        ws[i - start] = w;
      } else if (start >= 0 && ws.length > 0 && i > start + ws.length) break;
    }
    const arr = new Float64Array(ws.length);
    for (let k = 0; k < ws.length; k++) arr[k] = ws[k] ?? 0;
    banks.push({ start: Math.max(0, start), w: arr });
  }
  return banks;
})();

// In-place radix-2 FFT on (re, im), length NFFT.
const bitrev = (() => {
  const r = new Uint16Array(NFFT);
  const bits = Math.log2(NFFT);
  for (let i = 0; i < NFFT; i++) {
    let x = i;
    let y = 0;
    for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; }
    r[i] = y;
  }
  return r;
})();
const twCos = new Float64Array(NFFT / 2);
const twSin = new Float64Array(NFFT / 2);
for (let i = 0; i < NFFT / 2; i++) { twCos[i] = Math.cos((-2 * Math.PI * i) / NFFT); twSin[i] = Math.sin((-2 * Math.PI * i) / NFFT); }
function fft(re: Float64Array, im: Float64Array) {
  for (let i = 0; i < NFFT; i++) {
    const j = bitrev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= NFFT; size <<= 1) {
    const half = size >> 1;
    const step = NFFT / size;
    for (let s = 0; s < NFFT; s += size) {
      for (let k = 0; k < half; k++) {
        const wr = twCos[k * step];
        const wi = twSin[k * step];
        const a = s + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

const re = new Float64Array(NFFT);
const im = new Float64Array(NFFT);
const frame = new Float64Array(WIN);

/** One frame from a sample getter (handles edge reflection). */
function computeFrame(get: (i: number) => number, start: number, out: Float32Array, off: number) {
  let mean = 0;
  for (let i = 0; i < WIN; i++) { frame[i] = get(start + i); mean += frame[i]; }
  mean /= WIN;
  for (let i = 0; i < WIN; i++) frame[i] -= mean;
  for (let i = WIN - 1; i > 0; i--) frame[i] -= PREEMPH * frame[i - 1];
  frame[0] -= PREEMPH * frame[0];
  re.fill(0); im.fill(0);
  for (let i = 0; i < WIN; i++) re[i] = frame[i] * window[i];
  fft(re, im);
  for (let m = 0; m < NMEL; m++) {
    const { start: b0, w } = melBanks[m];
    let e = 0;
    for (let k = 0; k < w.length; k++) {
      const b = b0 + k;
      e += w[k] * (re[b] * re[b] + im[b] * im[b]);
    }
    out[off + m] = Math.log(Math.max(e, EPS));
  }
}

/** Whole-signal fbank: frames = floor((n + HOP/2) / HOP), like Kaldi snip_edges=false. */
export function fbank(x: Float32Array): Float32Array {
  const n = x.length;
  const nf = Math.floor((n + HOP / 2) / HOP);
  const out = new Float32Array(nf * NMEL);
  const get = (i: number) => { let j = i; if (j < 0) j = -j - 1; else if (j >= n) j = 2 * n - 1 - j; return x[j]; };
  for (let f = 0; f < nf; f++) computeFrame(get, f * HOP + HOP / 2 - WIN / 2, out, f * NMEL);
  return out;
}

/** Streaming version: identical frames to fbank() over the same signal. */
export class OnlineFbank {
  private buf = new Float32Array(16000 * 30);
  private n = 0;
  private done = 0;
  accept(samples: Float32Array): Float32Array {
    if (this.n + samples.length > this.buf.length) {
      const nb = new Float32Array(Math.max(this.buf.length * 2, this.n + samples.length));
      nb.set(this.buf.subarray(0, this.n));
      this.buf = nb;
    }
    this.buf.set(samples, this.n);
    this.n += samples.length;
    return this.emit(false);
  }
  finish(): Float32Array { return this.emit(true); }
  private emit(final: boolean): Float32Array {
    const n = this.n;
    const buf = this.buf;
    const get = (i: number) => { let j = i; if (j < 0) j = -j - 1; else if (j >= n) j = 2 * n - 1 - j; return buf[j]; };
    const total = final ? Math.floor((n + HOP / 2) / HOP) : Math.max(0, Math.floor((n - (HOP / 2 + WIN / 2)) / HOP) + 1);
    const count = Math.max(0, total - this.done);
    const out = new Float32Array(count * NMEL);
    for (let k = 0; k < count; k++) {
      const f = this.done + k;
      computeFrame(get, f * HOP + HOP / 2 - WIN / 2, out, k * NMEL);
    }
    this.done += count;
    return out;
  }
}

export const FBANK_DIM = NMEL;
