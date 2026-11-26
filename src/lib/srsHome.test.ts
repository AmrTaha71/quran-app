// node --test src/lib/srsHome.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dueWordsText, firstDueAyah, firstDueAyahText, daySession } from './srsHome.ts';
import { getGlobalAyahNumber } from './surahs.ts';
import type { DueWord } from './srsStore.ts';

const w = (surah: number, ayah: number, wordNo: number, due: number): DueWord => ({
  key: `${surah}:${ayah}:${wordNo}`, surah, ayah, wordNo, word: 'x', stage: 1, due,
});

describe('dueWordsText', () => {
  it('one and two use the special forms', () => {
    assert.equal(dueWordsText(1), 'كلمة واحدة');
    assert.equal(dueWordsText(2), 'كلمتان');
  });
  it('3 to 10 use the plural', () => {
    assert.equal(dueWordsText(3), '٣ كلمات');
    assert.equal(dueWordsText(10), '١٠ كلمات');
  });
  it('11 and above use the singular noun', () => {
    assert.equal(dueWordsText(11), '١١ كلمة');
    assert.equal(dueWordsText(120), '١٢٠ كلمة');
  });
  it('bad input never throws', () => {
    assert.equal(dueWordsText(-4), '٠ كلمة');
    assert.equal(dueWordsText(Number.NaN), '٠ كلمة');
  });
});

describe('firstDueAyah', () => {
  it('is null when nothing is due', () => {
    assert.equal(firstDueAyah([]), null);
    assert.equal(firstDueAyahText([]), null);
  });
  it('takes the first (oldest) word and one global number for both ends', () => {
    const t = firstDueAyah([w(2, 5, 3, 100), w(1, 1, 1, 200)]);
    assert.ok(t);
    assert.equal(t.surah, 2);
    assert.equal(t.ayah, 5);
    assert.equal(t.startGlobal, getGlobalAyahNumber(2, 5));
    assert.equal(t.endGlobal, t.startGlobal);
    assert.equal(t.startGlobal, 12);
    assert.ok(t.label.includes('آية ٥'));
  });
  it('shows the surah with its place', () => {
    assert.equal(firstDueAyahText([w(2, 5, 3, 100)]), 'البقرة (مدنية) — آية ٥');
  });
});

describe('daySession (15.4ب)', () => {
  it('nothing due -> null', () => {
    assert.equal(daySession([], []), null);
  });
  it('mistakes first, then due words, in one stretch of the same surah', () => {
    const s = daySession([{ surah: 2, ayah: 10 }], [w(2, 12, 1, 1), w(2, 30, 1, 2), w(3, 1, 1, 3)]);
    assert.ok(s);
    assert.equal(s.surah, 2);
    assert.equal(s.startGlobal, getGlobalAyahNumber(2, 10));
    assert.equal(s.endGlobal, getGlobalAyahNumber(2, 12));
    assert.equal(s.words, 2);
    assert.equal(s.fromMistakes, 1);
  });
  it('the daily limit caps the words', () => {
    const s = daySession([], [w(2, 1, 1, 1), w(2, 2, 1, 2), w(2, 3, 1, 3)], { limit: 2 });
    assert.equal(s?.words, 2);
    assert.equal(s?.endGlobal, getGlobalAyahNumber(2, 2));
  });
});
