// Run: node --test src/lib/srsSettings.test.ts   (Node 22, built-in runner; no new deps)
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  SRS_SETTINGS_KEY, SRS_INTERVAL_MIN_DAYS, SRS_INTERVAL_MAX_DAYS,
  loadSrsIntervals, hasCustomSrsIntervals, parseIntervalInputs,
  saveSrsIntervals, resetSrsIntervals, findOrderViolation, checkIntervalInputs,
} from './srsSettings.ts';
import { SRS_DEFAULT_INTERVALS_DAYS } from './srs.ts';
import { SRS_STORE_KEY } from './srsStore.ts';

const DEFAULTS = [...SRS_DEFAULT_INTERVALS_DAYS];

class FakeStorage {
  map = new Map<string, string>();
  throwOnSet = false;
  throwOnGet = false;
  getItem(k: string): string | null {
    if (this.throwOnGet) throw new Error('denied');
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    if (this.throwOnSet) throw new Error('quota');
    this.map.set(k, String(v));
  }
  removeItem(k: string): void { this.map.delete(k); }
}

let ls: FakeStorage;
function install(s: FakeStorage): void {
  Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });
}
function uninstall(): void { Reflect.deleteProperty(globalThis, 'localStorage'); }

beforeEach(() => { ls = new FakeStorage(); install(ls); });
after(() => uninstall());

describe('loadSrsIntervals', () => {
  it('nothing saved: the defaults', () => {
    assert.deepEqual([...loadSrsIntervals()], DEFAULTS);
    assert.equal(hasCustomSrsIntervals(), false);
  });

  it('a saved valid list is used', () => {
    ls.map.set(SRS_SETTINGS_KEY, JSON.stringify({ iv: [2, 4, 8, 15, 40] }));
    assert.deepEqual([...loadSrsIntervals()], [2, 4, 8, 15, 40]);
    assert.equal(hasCustomSrsIntervals(), true);
  });

  it('empty, corrupt or invalid saved values fall back to the defaults', () => {
    const bad = [
      '', '{not json', 'null', '[]', '42', '"x"', '{}', '{"iv":"x"}', '{"iv":null}',
      '{"iv":[1,2]}',                    // too short
      '{"iv":[1,3,7,14,30,60]}',         // too long
      '{"iv":[1,3,7,14,0]}',             // zero
      '{"iv":[1,3,7,14,-5]}',            // negative
      '{"iv":[1,3,7,14,1.5]}',           // not whole days
      '{"iv":[1,3,7,14,999]}',           // above the maximum
      '{"iv":[1,3,7,14,"30"]}',          // wrong type
      '{"iv":[1,3,7,14,null]}',          // NaN is stored as null
      '{"iv":[5,3,7,14,30]}',            // a stage shorter than the one before
      '{"iv":[1,3,7,14,10]}',
    ];
    for (const b of bad) {
      ls.map.set(SRS_SETTINGS_KEY, b);
      assert.deepEqual([...loadSrsIntervals()], DEFAULTS, `value: ${b}`);
    }
  });

  it('unreadable or missing localStorage gives the defaults, no throw', () => {
    ls.throwOnGet = true;
    assert.deepEqual([...loadSrsIntervals()], DEFAULTS);
    uninstall();
    assert.deepEqual([...loadSrsIntervals()], DEFAULTS);
  });
});

describe('saveSrsIntervals / resetSrsIntervals', () => {
  it('saves a changed list under quran-srs-settings-v1', () => {
    assert.equal(saveSrsIntervals([2, 4, 8, 15, 40]), true);
    assert.deepEqual(JSON.parse(ls.map.get(SRS_SETTINGS_KEY) as string), { iv: [2, 4, 8, 15, 40] });
    assert.deepEqual([...loadSrsIntervals()], [2, 4, 8, 15, 40]);
  });

  it('an invalid list returns false and leaves the saved value alone', () => {
    saveSrsIntervals([2, 4, 8, 15, 40]);
    const before = ls.map.get(SRS_SETTINGS_KEY);
    for (const bad of [[], [1, 2], [0, 3, 7, 14, 30], [1, 3, 7, 14, 366], [1, 3, 7, 14, NaN], [1, 3, 7, 14, 2.5]]) {
      assert.equal(saveSrsIntervals(bad), false);
    }
    assert.equal(ls.map.get(SRS_SETTINGS_KEY), before);
  });

  it('a stage shorter than the one before it is not saved; equal stages are fine', () => {
    saveSrsIntervals([2, 4, 8, 15, 40]);
    const before = ls.map.get(SRS_SETTINGS_KEY);
    assert.equal(saveSrsIntervals([2, 4, 3, 15, 40]), false);
    assert.equal(saveSrsIntervals([5, 3, 7, 14, 30]), false);
    assert.equal(ls.map.get(SRS_SETTINGS_KEY), before);
    assert.equal(saveSrsIntervals([2, 2, 2, 2, 2]), true);
    assert.deepEqual([...loadSrsIntervals()], [2, 2, 2, 2, 2]);
  });

  it('saving exactly the defaults clears the key', () => {
    saveSrsIntervals([2, 4, 8, 15, 40]);
    assert.equal(saveSrsIntervals(DEFAULTS), true);
    assert.equal(ls.map.has(SRS_SETTINGS_KEY), false);
    assert.equal(hasCustomSrsIntervals(), false);
  });

  it('reset removes the key and the defaults apply again', () => {
    saveSrsIntervals([2, 4, 8, 15, 40]);
    assert.equal(resetSrsIntervals(), true);
    assert.equal(ls.map.has(SRS_SETTINGS_KEY), false);
    assert.deepEqual([...loadSrsIntervals()], DEFAULTS);
  });

  it('a full storage returns false and does not throw', () => {
    ls.throwOnSet = true;
    assert.equal(saveSrsIntervals([2, 4, 8, 15, 40]), false);
    assert.deepEqual([...loadSrsIntervals()], DEFAULTS);
    uninstall();
    assert.equal(saveSrsIntervals([2, 4, 8, 15, 40]), false);
    assert.equal(resetSrsIntervals(), false);
  });

  it('never touches the review table or the old log', () => {
    const table = JSON.stringify({ '2:5:3': { s: 3, d: 123, o: 'x' } });
    ls.map.set(SRS_STORE_KEY, table);
    ls.map.set('quran-word-mistakes-v1', '{"a":1}');
    saveSrsIntervals([2, 4, 8, 15, 40]);
    resetSrsIntervals();
    assert.equal(ls.map.get(SRS_STORE_KEY), table);
    assert.equal(ls.map.get('quran-word-mistakes-v1'), '{"a":1}');
  });
});

describe('parseIntervalInputs', () => {
  it('reads Arabic-Indic, Eastern Arabic and Western digits, ignoring spaces', () => {
    assert.deepEqual(parseIntervalInputs(['١', '٣', '٧', '١٤', '٣٠']), [1, 3, 7, 14, 30]);
    assert.deepEqual(parseIntervalInputs(['۲', ' 4 ', '08', '١٥', '٤٠']), [2, 4, 8, 15, 40]);
  });

  it('accepts the range ends', () => {
    const lo = String(SRS_INTERVAL_MIN_DAYS);
    const hi = String(SRS_INTERVAL_MAX_DAYS);
    assert.deepEqual(parseIntervalInputs([lo, lo, lo, lo, hi]), [1, 1, 1, 1, 365]);
  });

  it('empty, text, decimals, negatives, zero, out of range or wrong count give null', () => {
    const ok = ['1', '3', '7', '14', '30'];
    for (const bad of ['', '  ', 'abc', '1.5', '١٫٥', '-3', '0', '٠', '366', '1e2', '٣٠ يوم']) {
      assert.equal(parseIntervalInputs([...ok.slice(0, 4), bad]), null, `field: "${bad}"`);
    }
    assert.equal(parseIntervalInputs(ok.slice(0, 4)), null);
    assert.equal(parseIntervalInputs([...ok, '60']), null);
    assert.equal(parseIntervalInputs([]), null);
  });
});

describe('ordering rule (each stage at least as long as the one before)', () => {
  it('findOrderViolation returns the first stage that breaks the order', () => {
    assert.equal(findOrderViolation([1, 3, 7, 14, 30]), -1);
    assert.equal(findOrderViolation([2, 2, 2, 2, 2]), -1);
    assert.equal(findOrderViolation([1, 3, 2, 14, 30]), 2);
    assert.equal(findOrderViolation([5, 3, 7, 14, 1]), 1);
    assert.equal(findOrderViolation([]), -1);
  });

  it('checkIntervalInputs: ok, format error, or order error with the stage index', () => {
    assert.deepEqual(checkIntervalInputs(['١', '٣', '٧', '١٤', '٣٠']), { ok: true, days: [1, 3, 7, 14, 30] });
    assert.deepEqual(checkIntervalInputs(['1', '3', '3', '14', '30']), { ok: true, days: [1, 3, 3, 14, 30] });
    assert.deepEqual(checkIntervalInputs(['1', '3', '', '14', '30']), { ok: false, reason: 'format' });
    assert.deepEqual(checkIntervalInputs(['1', '3', '2', '14', '30']), { ok: false, reason: 'order', index: 2 });
    assert.deepEqual(checkIntervalInputs(['٣٠', '١٤', '٧', '٣', '١']), { ok: false, reason: 'order', index: 1 });
  });
});
