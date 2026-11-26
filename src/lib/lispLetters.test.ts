// Run: node --test src/lib/lispLetters.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lispEquivalent, applyLisp } from './lispLetters.ts';

const R = new Set(['ر']);
test('17.1: ر swapped for غ or dropped is the same word', () => {
  assert.equal(lispEquivalent('غبنا', 'ربنا', R), true);
  assert.equal(lispEquivalent('بنا', 'ربنا', R), true);
});
test('17.1: any other difference is still a mistake', () => {
  assert.equal(lispEquivalent('غبكم', 'ربنا', R), false);
  assert.equal(lispEquivalent('ربنا', 'ربنا', R), false);
  assert.equal(lispEquivalent('غبنا', 'ربنا', new Set()), false);
});
test('17.1: applyLisp rewrites only lisp-equivalent tokens', () => {
  assert.deepEqual(applyLisp(['ربنا', 'اتنا'], ['غبنا', 'اتنا', 'فوق'], ['ر']), ['ربنا', 'اتنا', 'فوق']);
  assert.deepEqual(applyLisp(['ربنا'], ['غبنا'], []), ['غبنا']);
});
