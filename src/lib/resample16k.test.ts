// 3.16: the 16 kHz resampler keeps speech-band tones and removes what would alias.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Downsampler, downsampleTo16k } from './resample16k.ts';

const tone = (hz: number, rate: number, n: number) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));
const rms = (x: Float32Array, from = 0) => { let s = 0; for (let i = from; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length - from)); };

for (const rate of [48000, 44100]) {
  test(`${rate}: 1 kHz passes, length ~ n/ratio`, () => {
    const x = tone(1000, rate, rate);
    const y = downsampleTo16k(x, rate);
    assert.ok(Math.abs(y.length - 16000) < 40, `len ${y.length}`);
    assert.ok(Math.abs(rms(y, 200) - Math.SQRT1_2) < 0.03, `rms ${rms(y, 200)}`);
  });
  test(`${rate}: 12 kHz (above the new Nyquist) is removed`, () => {
    const y = downsampleTo16k(tone(12000, rate, rate), rate);
    assert.ok(rms(y, 200) < 0.05, `rms ${rms(y, 200)}`);
  });
  test(`${rate}: chunked == one-shot`, () => {
    const x = tone(700, rate, 20000);
    const one = downsampleTo16k(x, rate);
    const d = new Downsampler(rate);
    const parts: number[] = [];
    for (let i = 0; i < x.length; i += 4096) parts.push(...d.process(x.subarray(i, i + 4096)));
    assert.equal(parts.length, one.length);
    let m = 0; for (let i = 0; i < one.length; i++) m = Math.max(m, Math.abs(parts[i] - one[i]));
    assert.ok(m < 1e-3, `diff ${m}`); // phase quantization may round differently at a chunk edge
  });
}
test('16 kHz passes through unchanged', () => {
  const x = tone(500, 16000, 1000);
  assert.deepEqual(downsampleTo16k(x, 16000), x);
});
