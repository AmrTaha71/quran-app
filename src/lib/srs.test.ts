// Run: node --test src/lib/srs.test.ts   (Node 22, built-in runner; no new deps)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SRS_DEFAULT_INTERVALS_DAYS, SRS_SLIP_PROMOTE_AT,
  sanitizeIntervals, newEntry, scheduleAfterSuccess, scheduleAfterFailure, isDue,
  classifySlip, registerSlip, recordSlip,
} from './srs.ts';
import type { SrsEntry, SlipCounts } from './srs.ts';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date(2023, 10, 14).getTime(); // local midnight: due times are day-aligned (4.27)

describe('constants', () => {
  it('defaults are day, 3 days, week, 2 weeks, month; promote at 3', () => {
    assert.deepEqual([...SRS_DEFAULT_INTERVALS_DAYS], [1, 3, 7, 14, 30]);
    assert.equal(SRS_SLIP_PROMOTE_AT, 3);
  });
});

describe('scheduling', () => {
  it('a new entry is stage 1, due after one day', () => {
    assert.deepEqual(newEntry(T0), { stage: 1, due: T0 + DAY });
  });

  it('success walks the 5 stages, then the word graduates', () => {
    let e: SrsEntry = newEntry(T0);
    const gaps = [3, 7, 14, 30];
    gaps.forEach((g, i) => {
      const r = scheduleAfterSuccess(e, T0, undefined);
      assert.equal(r.graduated, false);
      if (r.graduated) return;
      assert.equal(r.entry.stage, i + 2);
      assert.equal(r.entry.due, T0 + g * DAY);
      e = r.entry;
    });
    assert.equal(e.stage, 5);
    assert.deepEqual(scheduleAfterSuccess(e, T0), { graduated: true });
  });

  it('failure at any stage goes back to stage 1 with the first gap', () => {
    assert.deepEqual(scheduleAfterFailure(T0), { stage: 1, due: T0 + DAY });
  });

  it('custom intervals: graduation follows the list length', () => {
    const iv = [2, 5];
    const e = newEntry(T0, iv);
    assert.equal(e.due, T0 + 2 * DAY);
    const r = scheduleAfterSuccess(e, T0, iv);
    assert.deepEqual(r, { graduated: false, entry: { stage: 2, due: T0 + 5 * DAY } });
    assert.deepEqual(scheduleAfterSuccess({ stage: 2, due: 0 }, T0, iv), { graduated: true });
  });

  it('bad interval lists fall back to the defaults', () => {
    for (const bad of [[], [0], [-1, 3], [1, NaN], null, undefined]) {
      assert.deepEqual([...sanitizeIntervals(bad as number[] | null | undefined)], [1, 3, 7, 14, 30]);
    }
  });

  it('isDue is inclusive of the due moment', () => {
    const e = { stage: 1, due: T0 };
    assert.equal(isDue(e, T0 - 1), false);
    assert.equal(isDue(e, T0), true);
  });
});

describe('classifySlip', () => {
  it('detects each group, ignoring direction and tashkeel', () => {
    assert.equal(classifySlip('غَفَرَ', 'خفر'), 'خ/غ');
    assert.equal(classifySlip('خفر', 'غفر'), 'خ/غ');
    assert.equal(classifySlip('قَلْب', 'كلب'), 'ق/ك');
    assert.equal(classifySlip('سمر', 'ثمر'), 'س/ث');
    assert.equal(classifySlip('صمر', 'ثمر'), 'ص/ث');
    assert.equal(classifySlip('سمر', 'صمر'), 'س/ص');
    assert.equal(classifySlip('ذهب', 'ظهب'), 'ذ/ظ');
    assert.equal(classifySlip('زهب', 'ضهب'), 'ز/ض');
    assert.equal(classifySlip('حمد', 'همد'), 'ح/ه');
  });

  it('س/ص and س/ث are different pairs (separate counters)', () => {
    assert.notEqual(classifySlip('سمر', 'صمر'), classifySlip('سمر', 'ثمر'));
  });

  it('ع against any hamza shape is a slip; plain alef is not', () => {
    for (const h of ['أ', 'إ', 'آ', 'ء', 'ؤ', 'ئ']) {
      assert.equal(classifySlip('عمل', `${h}مل`), 'ع/أ');
      assert.equal(classifySlip(`${h}مل`, 'عمل'), 'ع/أ');
    }
    assert.equal(classifySlip('عمل', 'امل'), null);
  });

  it('a hamza-shape difference alone is not a slip', () => {
    assert.equal(classifySlip('أمر', 'إمر'), null);
  });

  it('returns null for identical, different groups, 2+ letters, or lengths', () => {
    assert.equal(classifySlip('خلق', 'خلق'), null);
    assert.equal(classifySlip('خمر', 'قمر'), null);
    assert.equal(classifySlip('خلق', 'غلك'), null);
    assert.equal(classifySlip('خلق', 'خل'), null);
    assert.equal(classifySlip('', ''), null);
  });
});

describe('registerSlip / recordSlip', () => {
  it('1st and 2nd slips stay in the slip list; 3rd and later are promoted', () => {
    let counts: SlipCounts = {};
    const routes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = registerSlip(counts, 'خ/غ');
      routes.push(r.route);
      assert.equal(r.promote, r.route === 'review');
      assert.equal(r.count, i + 1);
      counts = r.counts;
    }
    assert.deepEqual(routes, ['slip-list', 'slip-list', 'review', 'review', 'review']);
  });

  it('never mutates the input and counts pairs independently', () => {
    const start: SlipCounts = { 'خ/غ': 2 };
    const r = registerSlip(start, 'ق/ك');
    assert.deepEqual(start, { 'خ/غ': 2 });
    assert.deepEqual(r.counts, { 'خ/غ': 2, 'ق/ك': 1 });
    assert.equal(r.route, 'slip-list');
  });

  it('counts the same pair across different words and both directions', () => {
    let counts: SlipCounts = {};
    const a = recordSlip(counts, 'غفر', 'خفر')!; counts = a.counts;
    const b = recordSlip(counts, 'خلق', 'غلق')!; counts = b.counts;
    const c = recordSlip(counts, 'غسل', 'خسل')!;
    assert.deepEqual([a.route, b.route, c.route], ['slip-list', 'slip-list', 'review']);
    assert.equal(c.pair, 'خ/غ');
  });

  it('earlier slips are not rewritten when the 3rd arrives', () => {
    const first = registerSlip({}, 'ق/ك');
    const second = registerSlip(first.counts, 'ق/ك');
    registerSlip(second.counts, 'ق/ك');
    assert.equal(first.route, 'slip-list');
    assert.equal(second.route, 'slip-list');
  });

  it('recordSlip returns null for a non-slip and leaves counts alone', () => {
    assert.equal(recordSlip({}, 'خمر', 'قمر'), null);
  });
});
