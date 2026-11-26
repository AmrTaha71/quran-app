// node --test src/lib/writtenGrade.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gradeWrittenWords, writtenAllowed } from './writtenGrade.ts';

describe('writtenGrade (16.1)', () => {
  it('allowed mistakes = max(1, ceil(5%))', () => {
    assert.equal(writtenAllowed(10), 1);
    assert.equal(writtenAllowed(20), 1);
    assert.equal(writtenAllowed(21), 2);
    assert.equal(writtenAllowed(100), 5);
  });
  it('a perfect answer passes with accuracy 1', () => {
    const r = gradeWrittenWords(['قل', 'هو', 'الله', 'احد'], ['قل', 'هو', 'الله', 'احد']);
    assert.equal(r.cost, 0); assert.equal(r.accuracy, 1); assert.ok(r.pass);
  });
  it('a wrong, a missing and an extra word each cost 1', () => {
    const r = gradeWrittenWords(['قل', 'هو', 'الله', 'احد'], ['قل', 'هي', 'احد', 'زياده']);
    assert.equal(r.cost, 3);
    const st = r.words.map((w) => w.status);
    assert.equal(st.filter((x) => x === 'ok').length, 2);
    assert.equal(st.filter((x) => x === 'wrong').length, 1);
    assert.equal(st.filter((x) => x === 'missing').length, 1);
    assert.deepEqual(r.extras, ['زياده']);
    assert.equal(r.pass, false);
  });
  it('a short passage still allows one mistake', () => {
    const r = gradeWrittenWords(['قل', 'هو', 'الله', 'احد'], ['قل', 'هو', 'الله']);
    assert.equal(r.cost, 1); assert.ok(r.pass);
  });
  it('two Mushaf tokens typed as one word (known pair) cost nothing', () => {
    const r = gradeWrittenWords(['عم', 'ان', 'با'], ['عم', 'انبا']);
    assert.equal(r.cost, 0);
  });
  it('one word typed as the two tokens of a known pair costs nothing; a free split does', () => {
    assert.equal(gradeWrittenWords(['عم', 'انبا'], ['عم', 'ان', 'با']).cost, 0);
    assert.ok(gradeWrittenWords(['عم', 'يتساءلون'], ['عم', 'يتسا', 'ءلون']).cost > 0);
  });
});
