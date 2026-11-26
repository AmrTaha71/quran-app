// node --test src/lib/goals.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dailyGoals, badges, longestRun, type GoalInput } from './goals.ts';

const base: GoalInput = { testDays: [], wirdDays: [], pageRecitals: [], cleanPages: 0, corpusSize: 0, today: '2026-11-26' };

describe('goals (15.6ب)', () => {
  it('longest run of consecutive days', () => {
    assert.equal(longestRun([]), 0);
    assert.equal(longestRun(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05']), 3);
    assert.equal(longestRun(['2026-02-28', '2026-03-01']), 2);
  });
  it('daily goals read real activity only', () => {
    const g = dailyGoals({ ...base, testDays: [new Date(2026, 10, 26, 9).toISOString()], wirdDays: ['2026-11-25'], pageRecitals: [new Date(2026, 10, 26, 10).getTime()] });
    assert.deepEqual(g.map((x) => x.done), [true, true, false]);
  });
  it('badges: nothing earned on an empty start; a week of activity earns «أسبوع متواصل»', () => {
    assert.ok(badges(base).every((b) => !b.earned));
    const week = Array.from({ length: 7 }, (_, i) => `2026-11-${String(10 + i).padStart(2, '0')}`);
    const b = badges({ ...base, wirdDays: week });
    assert.equal(b.find((x) => x.id === 'week')?.earned, true);
    assert.equal(b.find((x) => x.id === 'month')?.earned, false);
  });
});
