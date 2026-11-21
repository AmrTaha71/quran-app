// Run: node --test src/lib/srsStore.test.ts   (Node 22, built-in runner; no new deps)
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  SRS_STORE_KEY, SRS_SLIPS_KEY, MAX_SLIP_LIST,
  wordKey, getReviewEntry, addWord, recordSuccess, recordFailure, getDueWords,
  recordWordSlip, getSlipList, getSlipCounts, readLegacyMistakes,
} from './srsStore.ts';
import { WORD_MISTAKES_KEY } from './wordMistakes.ts';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

// Minimal localStorage stand-in (no library).
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
function uninstall(): void {
  Reflect.deleteProperty(globalThis, 'localStorage');
}
const raw = (k: string): unknown => JSON.parse(ls.map.get(k) as string);

beforeEach(() => { ls = new FakeStorage(); install(ls); });
after(() => uninstall());

describe('review table', () => {
  it('starts empty', () => {
    assert.deepEqual(getDueWords(T0), []);
    assert.equal(getReviewEntry('2:5:3'), null);
  });

  it('addWord stores stage 1 due after a day, under quran-srs-v1', () => {
    const r = addWord(2, 5, 3, 'كلمة', T0);
    assert.deepEqual(r, { added: true, entry: { stage: 1, due: T0 + DAY } });
    assert.deepEqual(raw(SRS_STORE_KEY), { '2:5:3': { s: 1, d: T0 + DAY, o: 'كلمة' } });
    assert.deepEqual(getReviewEntry('2:5:3'), { stage: 1, due: T0 + DAY, word: 'كلمة' });
  });

  it('addWord on a word already in the table changes nothing', () => {
    addWord(2, 5, 3, 'كلمة', T0);
    const r = addWord(2, 5, 3, 'كلمة', T0 + 5 * DAY);
    assert.deepEqual(r, { added: false, entry: { stage: 1, due: T0 + DAY } });
    assert.deepEqual(getReviewEntry('2:5:3'), { stage: 1, due: T0 + DAY, word: 'كلمة' });
  });

  it('getDueWords is inclusive of the due moment and sorted oldest first', () => {
    addWord(3, 1, 1, 'ب', T0 + DAY);       // due T0 + 2d
    addWord(2, 5, 3, 'أ', T0);             // due T0 + 1d
    assert.deepEqual(getDueWords(T0 + DAY - 1), []);
    const due = getDueWords(T0 + DAY);
    assert.deepEqual(due.map(d => d.key), ['2:5:3']);
    assert.deepEqual(due[0], { key: '2:5:3', surah: 2, ayah: 5, wordNo: 3, word: 'أ', stage: 1, due: T0 + DAY });
    assert.deepEqual(getDueWords(T0 + 2 * DAY).map(d => d.key), ['2:5:3', '3:1:1']);
  });

  it('success walks the stages and the word graduates out of the table', () => {
    const key = wordKey(2, 5, 3);
    addWord(2, 5, 3, 'كلمة', T0);
    const gaps = [3, 7, 14, 30];
    gaps.forEach((g, i) => {
      const r = recordSuccess(key, T0);
      assert.deepEqual(r, { graduated: false, entry: { stage: i + 2, due: T0 + g * DAY } });
      assert.deepEqual(getReviewEntry(key), { stage: i + 2, due: T0 + g * DAY, word: 'كلمة' });
    });
    assert.deepEqual(recordSuccess(key, T0), { graduated: true });
    assert.equal(getReviewEntry(key), null);
    assert.deepEqual(raw(SRS_STORE_KEY), {});
  });

  it('failure goes back to stage 1 and keeps the word text', () => {
    const key = wordKey(2, 5, 3);
    addWord(2, 5, 3, 'كلمة', T0);
    recordSuccess(key, T0);
    recordSuccess(key, T0);
    assert.deepEqual(recordFailure(key, T0 + 9 * DAY), { stage: 1, due: T0 + 10 * DAY });
    assert.deepEqual(getReviewEntry(key), { stage: 1, due: T0 + 10 * DAY, word: 'كلمة' });
  });

  it('success/failure on a word not in the table return null and write nothing', () => {
    assert.equal(recordSuccess('9:9:9', T0), null);
    assert.equal(recordFailure('9:9:9', T0), null);
    assert.equal(ls.map.size, 0);
  });

  it('custom intervals are passed through', () => {
    const iv = [2, 5];
    addWord(1, 1, 1, 'ا', T0, iv);
    assert.equal(getReviewEntry('1:1:1')?.due, T0 + 2 * DAY);
    assert.deepEqual(recordSuccess('1:1:1', T0, iv), { graduated: false, entry: { stage: 2, due: T0 + 5 * DAY } });
    assert.deepEqual(recordSuccess('1:1:1', T0, iv), { graduated: true });
  });
});

describe('pronunciation slips and promotion', () => {
  it('slips 1 and 2 stay in the separate list; the review table stays empty', () => {
    const a = recordWordSlip(2, 3, 4, 'غفر', 'خفر', T0);
    const b = recordWordSlip(5, 6, 7, 'خلق', 'غلق', T0 + 1);
    assert.deepEqual(a, { pair: 'خ/غ', count: 1, route: 'slip-list' });
    assert.deepEqual(b, { pair: 'خ/غ', count: 2, route: 'slip-list' });
    assert.deepEqual(getSlipCounts(), { 'خ/غ': 2 });
    assert.deepEqual(getSlipList(), [
      { k: '2:3:4', p: 'خ/غ', w: 'غفر', h: 'خفر', t: T0 },
      { k: '5:6:7', p: 'خ/غ', w: 'خلق', h: 'غلق', t: T0 + 1 },
    ]);
    assert.deepEqual(getDueWords(T0 + 100 * DAY), []);
    assert.equal(ls.map.has(SRS_STORE_KEY), false);
  });

  it('the 3rd slip of the pair enters the review table; the first two stay put', () => {
    recordWordSlip(2, 3, 4, 'غفر', 'خفر', T0);
    recordWordSlip(5, 6, 7, 'خلق', 'غلق', T0);
    const c = recordWordSlip(8, 9, 1, 'غسل', 'خسل', T0);
    assert.deepEqual(c, { pair: 'خ/غ', count: 3, route: 'review', added: true });
    assert.deepEqual(getReviewEntry('8:9:1'), { stage: 1, due: T0 + DAY, word: 'غسل' });
    assert.equal(getReviewEntry('2:3:4'), null);
    assert.equal(getReviewEntry('5:6:7'), null);
    assert.equal(getSlipList().length, 2);
  });

  it('the 4th and later slips are promoted too; an already-tabled word is not reset', () => {
    for (let i = 0; i < 3; i++) recordWordSlip(1, i + 1, 1, 'غفر', 'خفر', T0);
    const d = recordWordSlip(9, 9, 9, 'غفر', 'خفر', T0 + DAY);
    assert.deepEqual(d, { pair: 'خ/غ', count: 4, route: 'review', added: true });
    const again = recordWordSlip(9, 9, 9, 'غفر', 'خفر', T0 + 2 * DAY);
    assert.deepEqual(again, { pair: 'خ/غ', count: 5, route: 'review', added: false });
    assert.equal(getReviewEntry('9:9:9')?.due, T0 + DAY + DAY);
  });

  it('pairs are counted separately: س/ص and س/ث do not mix', () => {
    recordWordSlip(1, 1, 1, 'سمر', 'صمر', T0);
    recordWordSlip(1, 1, 2, 'سمر', 'صمر', T0);
    const r = recordWordSlip(1, 1, 3, 'سمر', 'ثمر', T0);
    assert.deepEqual(r, { pair: 'س/ث', count: 1, route: 'slip-list' });
    assert.deepEqual(getSlipCounts(), { 'س/ص': 2, 'س/ث': 1 });
  });

  it('a non-slip returns null and writes nothing', () => {
    assert.equal(recordWordSlip(1, 1, 1, 'خمر', 'قمر', T0), null);
    assert.equal(ls.map.size, 0);
  });

  it('the slip list keeps only the newest MAX_SLIP_LIST records', () => {
    // seed an over-full list directly, then add one more slip (count 2, so
    // it stays in the list) and check only the newest records survive
    const l = Array.from({ length: MAX_SLIP_LIST + 3 }, (_, i) => ({ k: `1:1:${i + 1}`, p: 'ق/ك', w: 'قلب', h: 'كلب', t: i }));
    ls.map.set(SRS_SLIPS_KEY, JSON.stringify({ c: { 'خ/غ': 1 }, l }));
    recordWordSlip(2, 2, 2, 'غفر', 'خفر', T0);
    const out = getSlipList();
    assert.equal(out.length, MAX_SLIP_LIST);
    assert.equal(out[out.length - 1].k, '2:2:2');
    assert.equal(out[0].t, 4);
  });
});

describe('old log is read only', () => {
  const legacy = JSON.stringify({ '2:5:3': { m: 2, c: 0, t: 1000, o: 'كلمة' } });

  it('readLegacyMistakes lists it; no operation here touches or migrates it', () => {
    ls.map.set(WORD_MISTAKES_KEY, legacy);
    assert.deepEqual(readLegacyMistakes(), [
      { surah: 2, ayah: 5, wordNo: 3, word: 'كلمة', misses: 2, last: 1000 },
    ]);
    addWord(1, 1, 1, 'ا', T0);
    recordSuccess('1:1:1', T0);
    recordFailure('1:1:1', T0);
    for (let i = 0; i < 4; i++) recordWordSlip(1, 1, i + 1, 'غفر', 'خفر', T0);
    getDueWords(T0);
    assert.equal(ls.map.get(WORD_MISTAKES_KEY), legacy);
    assert.equal(getReviewEntry('2:5:3'), null); // no automatic migration
  });
});

describe('empty, broken or unavailable storage never throws', () => {
  it('corrupt JSON and wrong shapes read as empty, and the next write repairs them', () => {
    for (const bad of ['{not json', 'null', '[]', '42', '"x"']) {
      ls.map.set(SRS_STORE_KEY, bad);
      ls.map.set(SRS_SLIPS_KEY, bad);
      assert.deepEqual(getDueWords(T0), []);
      assert.deepEqual(getSlipCounts(), {});
      assert.deepEqual(getSlipList(), []);
      assert.equal(recordSuccess('1:1:1', T0), null);
    }
    ls.map.set(SRS_STORE_KEY, '{oops');
    addWord(1, 1, 1, 'ا', T0);
    assert.deepEqual(raw(SRS_STORE_KEY), { '1:1:1': { s: 1, d: T0 + DAY, o: 'ا' } });
  });

  it('broken records are skipped, good ones kept', () => {
    ls.map.set(SRS_STORE_KEY, JSON.stringify({
      '1:1:1': { s: 2, d: T0, o: 'ا' },
      '1:1:2': { s: 'x', d: T0 },
      '1:1:3': { s: 1 },
      '1:1:4': null,
      'bad-key': { s: 1, d: T0, o: 'ب' },
      '1:1:5': { s: 0, d: T0, o: 'ج' },
      '1:1:6': { s: 1.9, d: T0, o: 7 },
    }));
    assert.deepEqual(getDueWords(T0).map(d => [d.key, d.stage, d.word]), [
      ['1:1:1', 2, 'ا'], ['1:1:6', 1, ''],
    ]);
    ls.map.set(SRS_SLIPS_KEY, JSON.stringify({
      c: { 'خ/غ': 'many', 'ق/ك': -1, 'ح/ه': 2.7 },
      l: [{ k: '1:1:1', p: 'ق/ك', w: 'a', h: 'b', t: 1 }, { k: 1 }, null, 'x'],
    }));
    assert.deepEqual(getSlipCounts(), { 'ح/ه': 2 });
    assert.equal(getSlipList().length, 1);
  });

  it('a full or denied storage does not throw', () => {
    ls.throwOnSet = true;
    assert.doesNotThrow(() => addWord(1, 1, 1, 'ا', T0));
    assert.doesNotThrow(() => recordWordSlip(1, 1, 1, 'غفر', 'خفر', T0));
    ls.throwOnSet = false;
    ls.throwOnGet = true;
    assert.deepEqual(getDueWords(T0), []);
    assert.equal(recordSuccess('1:1:1', T0), null);
    assert.deepEqual(readLegacyMistakes(), []);
  });

  it('no localStorage at all does not throw', () => {
    uninstall();
    assert.doesNotThrow(() => {
      addWord(1, 1, 1, 'ا', T0);
      recordSuccess('1:1:1', T0);
      recordFailure('1:1:1', T0);
      recordWordSlip(1, 1, 1, 'غفر', 'خفر', T0);
      getDueWords(T0);
      getSlipList();
      getSlipCounts();
      readLegacyMistakes();
    });
    assert.deepEqual(getDueWords(T0), []);
  });
});
