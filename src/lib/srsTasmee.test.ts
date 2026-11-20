// Run: node --test src/lib/srsTasmee.test.ts   (Node 22, built-in runner; no new deps)
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  heardForWord, buildOutcomes, applyOutcomes, flushPending, sessionCovers, slipNoticeText,
  type SrsPending, type WordOutcome,
} from './srsTasmee.ts';
import { getReviewEntry, addWord, getSlipList, getSlipCounts, wordKey } from './srsStore.ts';
import { SRS_SETTINGS_KEY } from './srsSettings.ts';
import { getGlobalAyahNumber } from './surahs.ts';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

class FakeStorage {
  map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.has(k) ? (this.map.get(k) as string) : null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
}
let ls: FakeStorage;
beforeEach(() => {
  ls = new FakeStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
});
after(() => { Reflect.deleteProperty(globalThis, 'localStorage'); });

// 5 expected words; spoken tokens are given directly, positions as the aligner
// would report them (-1 = unmatched).
const T = (s: string) => s.split(' ');

describe('heardForWord', () => {
  const matched = [true, true, false, true, true];
  const positions = [0, 1, -1, 3, 4];
  const consumed = [1, 1, 1, 1, 1];
  it('isolated wrong word with exactly one token in the gap -> that token', () => {
    assert.equal(heardForWord(2, matched, positions, consumed, T('a b غلق d e')), 'غلق');
  });
  it('two tokens in the gap -> null', () => {
    assert.equal(heardForWord(2, matched, [0, 1, -1, 4, 5], consumed, T('a b x y d e')), null);
  });
  it('zero tokens in the gap (forgotten) -> null', () => {
    assert.equal(heardForWord(2, matched, [0, 1, -1, 2, 3], consumed, T('a b d e')), null);
  });
  it('first and last word are never candidates', () => {
    assert.equal(heardForWord(0, [false, true, true], [-1, 1, 2], [1, 1, 1], T('x a b')), null);
    assert.equal(heardForWord(2, [true, true, false], [0, 1, -1], [1, 1, 1], T('a b x')), null);
  });
  it('two wrong words in a row -> null for both', () => {
    const m = [true, false, false, true];
    const p = [0, -1, -1, 3];
    assert.equal(heardForWord(1, m, p, [1, 1, 1, 1], T('a x y d')), null);
    assert.equal(heardForWord(2, m, p, [1, 1, 1, 1], T('a x y d')), null);
  });
  it('the previous match span (a joined word) is skipped before the gap', () => {
    // word 1 matched tokens 1..2 (consumed 2); the gap is token 3 only.
    assert.equal(heardForWord(2, matched, [0, 1, -1, 4, 5], [1, 2, 1, 1, 1], T('a b1 b2 غلق d e')), 'غلق');
  });
  it('a matched word returns null; missing aligner data returns null', () => {
    assert.equal(heardForWord(1, matched, positions, consumed, T('a b x d e')), null);
    assert.equal(heardForWord(2, matched, undefined, undefined, undefined), null);
  });
});

const pend = (over: Partial<SrsPending>): SrsPending => ({
  surah: 2, ayah: 5, index: 0, ok: false, ts: T0,
  words: [{ orig: 'خلق' }, { orig: 'ربك' }, { orig: 'نور' }],
  matched: [true, false, true],
  positions: [0, -1, 2], consumed: [1, 1, 1], tokens: T('خلق x نور'),
  spokenCount: 3, ...over,
});

describe('buildOutcomes', () => {
  it('silent mic -> nothing', () => {
    assert.deepEqual(buildOutcomes(pend({ spokenCount: 0 })), []);
  });
  it('nothing matched -> nothing (same as the old log)', () => {
    assert.deepEqual(buildOutcomes(pend({ matched: [false, false, false] })), []);
  });
  it('one outcome per word, 1-based, heard only for the isolated wrong word', () => {
    const o = buildOutcomes(pend({}));
    assert.deepEqual(o.map(x => [x.wordNo, x.ok, x.heard]), [[1, true, null], [2, false, 'x'], [3, true, null]]);
  });
  it('length mismatch -> nothing', () => {
    assert.deepEqual(buildOutcomes(pend({ matched: [true, false] })), []);
  });
});

const out = (wordNo: number, orig: string, ok: boolean, heard: string | null = null): WordOutcome =>
  ({ wordNo, orig, ok, heard });
const S2_5 = { surah: 2, ayah: 5 };

describe('applyOutcomes: ordinary mistakes', () => {
  it('wrong word not in the table -> addWord (stage 1, first gap)', () => {
    const r = applyOutcomes(S2_5.surah, S2_5.ayah, [out(3, 'نور', false)], { reviewSession: false, now: T0 });
    assert.equal(r.added, 1);
    assert.deepEqual(getReviewEntry(wordKey(2, 5, 3)), { stage: 1, due: T0 + DAY, word: 'نور' });
  });
  it('wrong word already in the table -> recordFailure (back to stage 1)', () => {
    addWord(2, 5, 3, 'نور', T0 - 40 * DAY);
    ls.map.set('quran-srs-v1', JSON.stringify({ '2:5:3': { s: 4, d: T0 + 5 * DAY, o: 'نور' } }));
    const r = applyOutcomes(2, 5, [out(3, 'نور', false)], { reviewSession: false, now: T0 });
    assert.equal(r.failed, 1);
    assert.equal(r.added, 0);
    assert.deepEqual(getReviewEntry(wordKey(2, 5, 3)), { stage: 1, due: T0 + DAY, word: 'نور' });
  });
  it('a candidate that is not a letter-pair slip is an ordinary mistake', () => {
    const r = applyOutcomes(2, 5, [out(2, 'ربك', false, 'مالك')], { reviewSession: false, now: T0 });
    assert.equal(r.added, 1);
    assert.equal(r.notices.length, 0);
    assert.equal(getSlipList().length, 0);
  });
  it('correct words are ignored outside a review session', () => {
    addWord(2, 5, 1, 'خلق', T0 - 2 * DAY);
    const before = getReviewEntry(wordKey(2, 5, 1));
    const r = applyOutcomes(2, 5, [out(1, 'خلق', true)], { reviewSession: false, now: T0 });
    assert.equal(r.succeeded, 0);
    assert.deepEqual(getReviewEntry(wordKey(2, 5, 1)), before);
  });
});

describe('applyOutcomes: slips', () => {
  it('slips 1 and 2 of a pair stay in the list; slip 3 enters the table with a notice', () => {
    let r = applyOutcomes(2, 5, [out(1, 'خلق', false, 'غلق')], { reviewSession: false, now: T0 });
    assert.equal(r.notices.length, 0);
    assert.equal(getReviewEntry(wordKey(2, 5, 1)), null);
    r = applyOutcomes(3, 7, [out(1, 'خير', false, 'غير')], { reviewSession: false, now: T0 });
    assert.equal(r.notices.length, 0);
    assert.equal(getReviewEntry(wordKey(3, 7, 1)), null);
    assert.equal(getSlipList().length, 2);
    assert.equal(getSlipCounts()['خ/غ'], 2);
    r = applyOutcomes(4, 9, [out(1, 'خوف', false, 'غوف')], { reviewSession: false, now: T0 });
    assert.equal(r.notices.length, 1);
    assert.deepEqual(r.notices[0], { word: 'خوف', heard: 'غوف', pair: 'خ/غ', count: 3 });
    assert.equal(r.added, 1);
    assert.deepEqual(getReviewEntry(wordKey(4, 9, 1)), { stage: 1, due: T0 + DAY, word: 'خوف' });
    // the first two were not promoted after the fact
    assert.equal(getReviewEntry(wordKey(2, 5, 1)), null);
  });
  it('a slip 3+ on a word already in the table -> notice and recordFailure', () => {
    for (const [s, w, h] of [[2, 'خلق', 'غلق'], [3, 'خير', 'غير']] as const) {
      applyOutcomes(s, 5, [out(1, w, false, h)], { reviewSession: false, now: T0 });
    }
    ls.map.set('quran-srs-v1', JSON.stringify({ '4:9:1': { s: 3, d: T0 + 2 * DAY, o: 'خوف' } }));
    const r = applyOutcomes(4, 9, [out(1, 'خوف', false, 'غوف')], { reviewSession: false, now: T0 });
    assert.equal(r.notices.length, 1);
    assert.equal(r.failed, 1);
    assert.equal(getReviewEntry(wordKey(4, 9, 1))?.stage, 1);
  });
  it('the notice text names the right word and the heard text', () => {
    const t = slipNoticeText({ word: 'خوف', heard: 'غوف', pair: 'خ/غ', count: 3 });
    assert.ok(t.includes('تكرر نفس الخطأ أكثر من مرتين'));
    assert.ok(t.includes('خوف') && t.includes('غوف'));
  });
});

describe('applyOutcomes: review session successes', () => {
  it('a due word said right moves to the next stage', () => {
    ls.map.set('quran-srs-v1', JSON.stringify({ '2:5:1': { s: 1, d: T0 - 1000, o: 'خلق' } }));
    const r = applyOutcomes(2, 5, [out(1, 'خلق', true)], { reviewSession: true, now: T0 });
    assert.equal(r.succeeded, 1);
    assert.deepEqual(getReviewEntry(wordKey(2, 5, 1)), { stage: 2, due: T0 + 3 * DAY, word: 'خلق' });
  });
  it('a word that is not due yet is left alone', () => {
    ls.map.set('quran-srs-v1', JSON.stringify({ '2:5:1': { s: 1, d: T0 + DAY, o: 'خلق' } }));
    const r = applyOutcomes(2, 5, [out(1, 'خلق', true)], { reviewSession: true, now: T0 });
    assert.equal(r.succeeded, 0);
    assert.equal(getReviewEntry(wordKey(2, 5, 1))?.stage, 1);
  });
  it('a word not in the table is left alone', () => {
    const r = applyOutcomes(2, 5, [out(1, 'خلق', true)], { reviewSession: true, now: T0 });
    assert.equal(r.succeeded, 0);
    assert.equal(getReviewEntry(wordKey(2, 5, 1)), null);
  });
  it('success at the last stage graduates the word', () => {
    ls.map.set('quran-srs-v1', JSON.stringify({ '2:5:1': { s: 5, d: T0 - 1, o: 'خلق' } }));
    const r = applyOutcomes(2, 5, [out(1, 'خلق', true)], { reviewSession: true, now: T0 });
    assert.equal(r.graduated, 1);
    assert.equal(getReviewEntry(wordKey(2, 5, 1)), null);
  });
  it('the user gaps from settings are used on every call', () => {
    ls.map.set(SRS_SETTINGS_KEY, JSON.stringify({ iv: [2, 4, 8, 16, 32] }));
    applyOutcomes(2, 5, [out(3, 'نور', false)], { reviewSession: false, now: T0 });
    assert.equal(getReviewEntry(wordKey(2, 5, 3))?.due, T0 + 2 * DAY);
  });
});

describe('flushPending / sessionCovers', () => {
  const range = { startGlobal: getGlobalAyahNumber(2, 5), endGlobal: getGlobalAyahNumber(2, 5) };
  it('sessionCovers is true only for ayahs inside the card range', () => {
    assert.equal(sessionCovers(range, 2, 5), true);
    assert.equal(sessionCovers(range, 2, 6), false);
    assert.equal(sessionCovers(null, 2, 5), false);
  });
  it('an all-right verdict (which replaces a wrong one) records no new word', () => {
    const first = pend({});                                  // verdict 1: word 2 wrong
    const second = pend({ ok: true, matched: [true, true, true], positions: undefined, tokens: undefined });
    assert.deepEqual(flushPending(second, null), []);       // replaces `first`; first is never flushed
    assert.equal(getReviewEntry(wordKey(2, 5, 2)), null);
    assert.ok(first.matched.includes(false));                // (first would have added word 2)
  });
  it('the final wrong verdict is recorded once at its judgement time', () => {
    flushPending(pend({}), null);
    assert.deepEqual(getReviewEntry(wordKey(2, 5, 2)), { stage: 1, due: T0 + DAY, word: 'ربك' });
  });
  it('a silent attempt records nothing; null pending records nothing', () => {
    assert.deepEqual(flushPending(pend({ spokenCount: 0, matched: [false, false, false] }), null), []);
    assert.deepEqual(flushPending(null, null), []);
    assert.equal(getReviewEntry(wordKey(2, 5, 2)), null);
  });
  it('success only counts for the ayah inside the card session', () => {
    ls.map.set('quran-srs-v1', JSON.stringify({ '2:5:1': { s: 1, d: T0 - 1, o: 'خلق' } }));
    flushPending(pend({ ok: true, matched: [true, true, true] }), null);
    assert.equal(getReviewEntry(wordKey(2, 5, 1))?.stage, 1);          // normal test: no success
    flushPending(pend({ ok: true, matched: [true, true, true] }), range);
    assert.equal(getReviewEntry(wordKey(2, 5, 1))?.stage, 2);          // card session: success
  });
  it('never throws, even if storage is unavailable', () => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    assert.doesNotThrow(() => flushPending(pend({}), null));
  });
});

describe('double call guard (the same final verdict recorded twice)', () => {
  const range = { startGlobal: getGlobalAyahNumber(2, 5), endGlobal: getGlobalAyahNumber(2, 5) };
  const rightVerdict = (ts: number) => pend({ ok: true, ts, matched: [true, true, true] });

  it('a due word does not move two stages when the same success arrives twice', () => {
    ls.map.set('quran-srs-v1', JSON.stringify({ '2:5:1': { s: 1, d: T0 - 1000, o: 'خلق' } }));
    flushPending(rightVerdict(T0), range);
    flushPending(rightVerdict(T0 + 40), range); // second call, a few ms later (as in continuous mode)
    assert.deepEqual(getReviewEntry(wordKey(2, 5, 1)), { stage: 2, due: T0 + 3 * DAY, word: 'خلق' });
  });
  it('the same holds when both calls carry the very same timestamp', () => {
    ls.map.set('quran-srs-v1', JSON.stringify({ '2:5:1': { s: 1, d: T0 - 1000, o: 'خلق' } }));
    flushPending(rightVerdict(T0), range);
    flushPending(rightVerdict(T0), range);
    assert.equal(getReviewEntry(wordKey(2, 5, 1))?.stage, 2);
  });
  it('applyOutcomes reports one success, then none', () => {
    ls.map.set('quran-srs-v1', JSON.stringify({ '2:5:1': { s: 2, d: T0 - 1, o: 'خلق' } }));
    const o = [out(1, 'خلق', true)];
    assert.equal(applyOutcomes(2, 5, o, { reviewSession: true, now: T0 }).succeeded, 1);
    assert.equal(applyOutcomes(2, 5, o, { reviewSession: true, now: T0 + 5 }).succeeded, 0);
    assert.equal(getReviewEntry(wordKey(2, 5, 1))?.stage, 3);
  });
  it('a graduating word graduates once; the second call finds nothing', () => {
    ls.map.set('quran-srs-v1', JSON.stringify({ '2:5:1': { s: 5, d: T0 - 1, o: 'خلق' } }));
    const o = [out(1, 'خلق', true)];
    assert.equal(applyOutcomes(2, 5, o, { reviewSession: true, now: T0 }).graduated, 1);
    const again = applyOutcomes(2, 5, o, { reviewSession: true, now: T0 + 5 });
    assert.equal(again.graduated, 0);
    assert.equal(again.succeeded, 0);
  });
  it('a wrong verdict twice stays at stage 1 and adds the word once', () => {
    const o = [out(3, 'نور', false)];
    const a = applyOutcomes(2, 5, o, { reviewSession: false, now: T0 });
    applyOutcomes(2, 5, o, { reviewSession: false, now: T0 + 5 });
    assert.equal(a.added, 1);
    assert.equal(getReviewEntry(wordKey(2, 5, 3))?.stage, 1);
  });
});
