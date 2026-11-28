// Run: node --test src/lib/clipLevel.test.ts
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { fadePlan, FADE_START, FADE_MS } from './clipLevel.ts';

it('fade starts at 0.35, ends at 1 after 350 ms', () => {
  const f = fadePlan(2);
  assert.equal(FADE_START, 0.35);
  assert.equal(FADE_MS, 350);
  assert.equal(f.startValue, 0.35);
  assert.equal(f.endValue, 1);
  assert.ok(Math.abs(f.endAt - f.startAt - 0.35) < 1e-9);
  assert.equal(f.startAt, 2);
});
