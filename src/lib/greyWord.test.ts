// Run: node --test src/lib/greyWord.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nearMissLetter } from './greyWord.ts';

describe('R2 grey: one close letter heard instead of another', () => {
  it('غ heard for خ is grey, with the pair for the message', () => {
    assert.deepEqual(nearMissLetter('خلق', 'غلق'), { expected: 'خ', heard: 'غ' });
  });
  it('ز heard for ذ is grey', () => {
    assert.deepEqual(nearMissLetter('الذي', 'الزي'), { expected: 'ذ', heard: 'ز' });
  });
  it('two letters wrong is a real mistake, not grey', () => {
    assert.equal(nearMissLetter('خلق', 'غلف'), null);
  });
  it('a letter pair that does not sound close is a real mistake', () => {
    assert.equal(nearMissLetter('كتب', 'فتب'), null);
  });
  it('same word, or different length, is not a near miss', () => {
    assert.equal(nearMissLetter('خلق', 'خلق'), null);
    assert.equal(nearMissLetter('خلق', 'خلقه'), null);
  });
});
