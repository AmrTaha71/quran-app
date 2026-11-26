// 3.23: pins the ears' tuned numbers — a change must update this test too.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './earTuning.ts';

test('alignment and mic thresholds are the measured/documented values', () => {
  assert.equal(T.ALIGN_BACK_WORDS, 15);
  assert.equal(T.ALIGN_AHEAD_WORDS, 40);
  assert.equal(T.ALIGN_LEAD_COST, 0.6);
  assert.equal(T.ALIGN_REJECT_RATIO, 0.45);
  assert.equal(T.ALIGN_REJECT_MIN, 3);
  assert.equal(T.MIC_CHECK_RMS_THRESHOLD, 0.015);
  assert.equal(T.SLOW_BENCH_MS, 2500);
});

test('whisper token cap', () => {
  assert.equal(T.whisperMaxTokens(0.3), 16);
  assert.equal(T.whisperMaxTokens(3), 46);
  assert.equal(T.whisperMaxTokens(7), 94);
  assert.equal(T.whisperMaxTokens(30), 110);
});

test('slow mark expires; legacy marks are dated on first read', () => {
  const now = 1_800_000_000_000;
  assert.equal(T.readSlowMark(null, now), null);
  assert.equal(T.readSlowMark('v0:3000', now), null);
  assert.deepEqual(T.readSlowMark('v1:3000', now), { ms: 3000, at: now, legacy: true });
  assert.deepEqual(T.readSlowMark(`v1:3000:${now - 1000}`, now), { ms: 3000, at: now - 1000, legacy: false });
  assert.equal(T.readSlowMark(`v1:3000:${now - T.SLOW_MARK_TTL_MS - 1}`, now), null);
});
