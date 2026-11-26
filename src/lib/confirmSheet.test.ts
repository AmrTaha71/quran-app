import test from 'node:test';
import assert from 'node:assert/strict';
import { askConfirm, answerConfirm, subscribeConfirm } from './confirmSheet.ts';

test('askConfirm resolves with the answer and notifies listeners', async () => {
  const seen: (string | null)[] = [];
  const off = subscribeConfirm((p) => seen.push(p ? p.text : null));
  const pr = askConfirm({ text: 'تمسح؟', danger: true });
  answerConfirm(true);
  assert.equal(await pr, true);
  assert.deepEqual(seen, [null, 'تمسح؟', null]);
  off();
});

test('a second ask answers the first one no', async () => {
  const a = askConfirm('أ');
  const b = askConfirm('ب');
  assert.equal(await a, false);
  answerConfirm(false);
  assert.equal(await b, false);
});
