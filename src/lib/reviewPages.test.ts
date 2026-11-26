import test from 'node:test';
import assert from 'node:assert/strict';
import { pageStartGlobal, pageOfGlobal, recentReviewRange, manzilReviewRange } from './reviewPages.ts';

test('page table round-trips', () => {
  assert.equal(pageStartGlobal(1), 1);
  assert.equal(pageStartGlobal(2), 8); // al-Baqarah 1
  assert.equal(pageOfGlobal(1), 1);
  assert.equal(pageOfGlobal(8), 2);
  assert.equal(pageOfGlobal(6236), 604);
});

test('recent review follows the page count, not the whole juz', () => {
  // memorized up to the end of page 21 (al-Baqarah up to before 2:135)
  const run = pageStartGlobal(22) - 1;
  const r = recentReviewRange(run, 2)!;
  assert.equal(r.fromPage, 20);
  assert.equal(r.toPage, 21);
  assert.equal(r.startGlobal, pageStartGlobal(20));
  assert.equal(r.endGlobal, run);
  assert.equal(recentReviewRange(0, 2), null);
  assert.equal(recentReviewRange(run, 0), null);
});

test('manzil shows beside the recent review and rotates over the old pages', () => {
  const run = pageStartGlobal(22) - 1; // 21 pages memorized
  const d0 = manzilReviewRange(run, 5, 2, 0)!;
  assert.deepEqual([d0.fromPage, d0.toPage], [1, 5]);
  const d1 = manzilReviewRange(run, 5, 2, 1)!;
  assert.deepEqual([d1.fromPage, d1.toPage], [6, 10]);
  const d3 = manzilReviewRange(run, 5, 2, 3)!;
  assert.deepEqual([d3.fromPage, d3.toPage], [16, 19]); // stops before the recent pages
  const d4 = manzilReviewRange(run, 5, 2, 4)!;
  assert.deepEqual([d4.fromPage, d4.toPage], [1, 5]); // wraps
  // nothing older than the recent range -> no manzil
  assert.equal(manzilReviewRange(pageStartGlobal(3) - 1, 3, 2, 0), null);
});
