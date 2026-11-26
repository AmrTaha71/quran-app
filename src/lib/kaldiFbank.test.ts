// 3.21: the streaming fbank that drops old samples must still produce the
// exact frames of the whole-signal fbank().
import test from 'node:test';
import assert from 'node:assert/strict';
import { fbank, OnlineFbank, FBANK_DIM } from './kaldiFbank.ts';

function signal(n: number): Float32Array {
  const x = new Float32Array(n);
  let seed = 7;
  for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; x[i] = Math.sin(i / 37) * 0.3 + ((seed / 0x7fffffff) - 0.5) * 0.1; }
  return x;
}

test('streaming fbank equals whole-signal fbank across trims', () => {
  const x = signal(16000 * 25 + 123); // > 10 s steps: trims happen
  const ref = fbank(x);
  const fb = new OnlineFbank();
  const parts: Float32Array[] = [];
  for (let i = 0; i < x.length; i += 4096) parts.push(fb.accept(x.subarray(i, i + 4096)));
  parts.push(fb.finish());
  const total = parts.reduce((a, p) => a + p.length, 0);
  assert.equal(total, ref.length);
  let o = 0;
  let maxDiff = 0;
  for (const p of parts) { for (let i = 0; i < p.length; i++) maxDiff = Math.max(maxDiff, Math.abs(p[i] - ref[o + i])); o += p.length; }
  assert.ok(maxDiff < 1e-4, `max diff ${maxDiff}`);
  assert.equal(ref.length % FBANK_DIM, 0);
});

test('reset starts a fresh signal', () => {
  const fb = new OnlineFbank();
  fb.accept(signal(16000 * 12));
  fb.reset();
  const x = signal(8000);
  const a = [fb.accept(x), fb.finish()];
  const ref = fbank(x);
  assert.equal(a[0].length + a[1].length, ref.length);
});
