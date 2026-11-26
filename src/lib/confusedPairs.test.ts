import test from 'node:test';
import assert from 'node:assert/strict';
import { recordConfusedPair, loadConfusedPairs, removeConfusedPair, CONFUSED_KEY, CONFUSED_MAX } from './confusedPairs.ts';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}
const item = { id: 'c1', clue: 'فبأي آلاء', answers: ['55:13', '55:16'] };

test('records a pair, counts repeats and moves it to the top', () => {
  const s = mem();
  recordConfusedPair(item, '2:5', 1, s);
  recordConfusedPair({ ...item, id: 'c2' }, '3:1', 2, s);
  const out = recordConfusedPair(item, '2:5', 3, s);
  assert.equal(out.length, 2);
  assert.equal(out[0].clueId, 'c1');
  assert.equal(out[0].count, 2);
  assert.deepEqual(loadConfusedPairs(s), out);
});

test('caps the list and survives corrupt storage', () => {
  const s = mem();
  for (let i = 0; i < CONFUSED_MAX + 5; i++) recordConfusedPair({ ...item, id: `c${i}` }, '1:1', i, s);
  assert.equal(loadConfusedPairs(s).length, CONFUSED_MAX);
  s.setItem(CONFUSED_KEY, '{bad');
  assert.deepEqual(loadConfusedPairs(s), []);
});

test('removes one pair', () => {
  const s = mem();
  recordConfusedPair(item, '2:5', 1, s);
  recordConfusedPair(item, '2:6', 2, s);
  assert.deepEqual(removeConfusedPair('c1', '2:5', s).map((p) => p.picked), ['2:6']);
});
