// node --test src/lib/srsHome.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dueWordsText, firstDueAyah, firstDueAyahText } from './srsHome.ts';
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
