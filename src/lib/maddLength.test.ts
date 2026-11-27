// node --test src/lib/maddLength.test.ts
// Owner rule: a madd length is never a mistake (stretched or not), but a
// different word is always a mistake.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { alignWordsStrict, spokenTokens, softWordEq } from './wordAligner.ts';
import { expectedWordList } from './expectedWords.ts';

const kawthar = expectedWordList('إِنَّآ أَعْطَيْنَـٰكَ ٱلْكَوْثَرَ').map((w) => w.norm);
const passes = (heard: string) => {
  const r = alignWordsStrict(kawthar, spokenTokens(heard));
  return r.allMatched && r.extras.length === 0;
};

describe('madd length is not a mistake', () => {
  it('108:1 passes with the madd not stretched', () => {
    assert.ok(passes('إنا أعطيناك الكوثر'));
    assert.ok(passes('انا اعطينك الكوثر'));
  });
  it('108:1 passes with the madd stretched', () => {
    assert.ok(passes('إناا أعطينااك الكوثر'));
    assert.ok(passes('إنااا أعطيناااااك الكووثر'));
    assert.ok(passes('اناا اعطيناااك الكوووثر'));
  });
  it('a stretched madd letter folds on short words too', () => {
    assert.ok(softWordEq('لاا', 'لا'));
    assert.ok(softWordEq('يقوول', 'يقول'));
    assert.ok(softWordEq('فييها', 'فيها'));
  });
  it('a different word is still wrong', () => {
    assert.equal(softWordEq('قل', 'قال'), false);
    assert.equal(softWordEq('قوول', 'قال'), false);
    assert.equal(softWordEq('فيهاا', 'فيه'), false);
    assert.equal(softWordEq('الدنياا', 'الدين'), false);
    assert.equal(softWordEq('الذيين', 'الدين'), false);
    assert.equal(passes('إن أعطيناك الكوثر'), false);
    assert.equal(passes('إنا أعطيناكم الكوثر'), false);
    assert.equal(passes('إنا أعطيناك الكافرون'), false);
  });
});
