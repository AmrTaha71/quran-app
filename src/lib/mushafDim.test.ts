// Run: node --test src/lib/mushafDim.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inDimWindow } from './mushafDim.ts';

const at = (h: number, m = 0) => new Date(2026, 10, 26, h, m);

test('5.14: dim window is 21:00 until sunrise', () => {
  assert.equal(inDimWindow(at(20, 59), 5 * 60 + 40), false);
  assert.equal(inDimWindow(at(21, 0), 5 * 60 + 40), true);
  assert.equal(inDimWindow(at(3, 0), 5 * 60 + 40), true);
  assert.equal(inDimWindow(at(5, 41), 5 * 60 + 40), false);
  assert.equal(inDimWindow(at(12, 0), 5 * 60 + 40), false);
});

test('5.14: no cached sunrise falls back to 06:00', () => {
  assert.equal(inDimWindow(at(5, 59), null), true);
  assert.equal(inDimWindow(at(6, 0), null), false);
});
