import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyAccuracy } from './weeklyAccuracy.ts';
import type { TestHistoryEntry } from './testHistory.ts';

const now = Date.parse('2026-11-26T12:00:00Z');
const e = (daysAgo: number, score: number, extra: Partial<TestHistoryEntry> = {}): TestHistoryEntry => ({
  ts: new Date(now - daysAgo * 86400000).toISOString(), level: 'beginner', score, correct: 1, attempted: 1,
  completed: true, mode: 'ayah', ear: 'lab', label: 'x', ...extra,
});

test('weekly buckets average finished ear-graded tasmee only', () => {
  const w = weeklyAccuracy([e(1, 80), e(2, 60), e(9, 90), e(3, 10, { completed: false }), e(4, 5, { ear: 'manual' }), e(5, 1, { kind: 'tarteel' }), e(60, 50)], 4, now);
  assert.deepEqual(w.map((p) => p.avg), [null, null, 90, 70]);
  assert.deepEqual(w.map((p) => p.n), [0, 0, 1, 2]);
});
