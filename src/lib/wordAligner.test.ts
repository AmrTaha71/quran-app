// node --test src/lib/wordAligner.test.ts
// 10.6: the aligner now lives in its own file, so it has unit tests, and a
// whole-Mushaf comparison of the lenient and strict passes (the step that
// must hold before the two are merged into one function).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { alignWords, alignWordsStrict, spokenTokens, softWordEq } from './wordAligner.ts';
import { expectedWordList } from './expectedWords.ts';

const root = path.resolve(import.meta.dirname, '../..');
const ayat: { surah: number; ayah: number; text: string }[] =
  JSON.parse(fs.readFileSync(path.join(root, 'public/tajweed/tajweed-mushaf-image.json'), 'utf8'));
const norms = (t: string) => expectedWordList(t).map((w) => w.norm);

describe('wordAligner', () => {
  it('a word-perfect recitation matches every word, with no extras', () => {
    const e = norms(ayat.find((a) => a.surah === 1 && a.ayah === 2)!.text);
    const r = alignWordsStrict(e, spokenTokens(e.join(' ')));
    assert.ok(r.allMatched);
    assert.deepEqual(r.extras, []);
  });
  it('a skipped word stays unmatched; an added word is an extra only in strict', () => {
    const e = norms(ayat.find((a) => a.surah === 1 && a.ayah === 7)!.text);
    const skipped = e.filter((_, i) => i !== 2).join(' ');
    assert.equal(alignWords(e, spokenTokens(skipped)).matched[2], false);
    const added = [...e.slice(0, 3), 'زيادة', ...e.slice(3)].join(' ');
    assert.ok(alignWords(e, spokenTokens(added)).allMatched);
    assert.deepEqual(alignWordsStrict(e, spokenTokens(added)).extras.length, 1);
  });
  it('softWordEq keeps different words apart', () => {
    assert.equal(softWordEq('الدنيا', 'الدين'), false);
    assert.equal(softWordEq('فيها', 'فيه'), false);
  });
  it('lenient and strict give the same matched words on the whole Mushaf (perfect, one word dropped, one word added)', () => {
    let diff = 0;
    for (const a of ayat) {
      const e = norms(a.text);
      if (e.length === 0) continue;
      const drop = Math.floor(e.length / 2);
      for (const said of [e, e.filter((_, i) => i !== drop), [...e.slice(0, drop), 'كلمه', ...e.slice(drop)]]) {
        const sp = spokenTokens(said.join(' '));
        const l = alignWords(e, sp).matched.join();
        const s = alignWordsStrict(e, sp).matched.join();
        if (l !== s) diff++;
      }
    }
    assert.equal(diff, 0);
  });
});
