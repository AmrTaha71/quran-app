// 3.16 (2026-11-26): mic audio -> 16 kHz for the on-device ears, with a real
// low-pass in front. The old downsample() averaged boxes of samples, which
// lets sound above 8 kHz (sibilants, hiss) fold back into the band the
// model hears. This is a windowed-sinc filter evaluated at each output
// point, streaming: it keeps the tail of the previous chunk, so chunk edges
// are seamless. Pure function of its input; no DOM.
export const TARGET_RATE = 16000;

const PHASES = 64; // fractional positions, quantized

export class Downsampler {
  private readonly ratio: number;
  private readonly half: number; // taps on each side
  private readonly table: Float32Array[]; // [phase][2*half]
  private hist = new Float32Array(0); // last 2*half input samples
  private pos = 0; // next output position, in input samples, relative to hist start

  readonly fromRate: number;
  constructor(fromRate: number) {
    this.fromRate = fromRate;
    this.ratio = fromRate / TARGET_RATE;
    // Cutoff a little under the new Nyquist, in cycles per INPUT sample.
    const fc = (0.45 * TARGET_RATE) / fromRate;
    this.half = Math.max(4, Math.ceil(6 * this.ratio));
    this.table = [];
    for (let p = 0; p < PHASES; p++) {
      const frac = p / PHASES;
      const h = new Float32Array(2 * this.half);
      let sum = 0;
      for (let k = 0; k < 2 * this.half; k++) {
        // tap k sits at input index floor(t) - half + 1 + k; d = its distance from t
        const d = (k - this.half + 1) - frac;
        const x = 2 * fc * d;
        const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
        const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / this.half); // Hann
        const v = Math.abs(d) >= this.half ? 0 : 2 * fc * sinc * w;
        h[k] = v; sum += v;
      }
      for (let k = 0; k < h.length; k++) h[k] /= sum || 1; // unity gain at DC
      this.table.push(h);
    }
    this.hist = new Float32Array(2 * this.half);
    this.pos = this.half; // first output centred after the (silent) history
  }

  process(input: Float32Array): Float32Array {
    if (this.fromRate === TARGET_RATE) return new Float32Array(input);
    const x = new Float32Array(this.hist.length + input.length);
    x.set(this.hist); x.set(input, this.hist.length);
    const out: number[] = [];
    let t = this.pos;
    const H = this.half;
    while (Math.floor(t) + H < x.length) {
      const i0 = Math.floor(t);
      const ph = Math.min(PHASES - 1, Math.round((t - i0) * PHASES));
      const h = this.table[ph];
      const base = i0 - H + 1;
      let acc = 0;
      for (let k = 0; k < h.length; k++) { const j = base + k; if (j >= 0) acc += h[k] * x[j]; }
      out.push(acc);
      t += this.ratio;
    }
    // Keep the last 2*half samples; shift t to the new origin.
    const keep = Math.min(x.length, 2 * H);
    const shift = x.length - keep;
    this.hist = x.slice(shift);
    if (this.hist.length < 2 * H) { const h2 = new Float32Array(2 * H); h2.set(this.hist, 2 * H - this.hist.length); this.hist = h2; t += 2 * H - keep; }
    this.pos = t - shift;
    return Float32Array.from(out);
  }
}

/** One-shot (whole buffer) version, e.g. a recorded blob. */
export function downsampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  return new Downsampler(fromRate).process(input);
}
