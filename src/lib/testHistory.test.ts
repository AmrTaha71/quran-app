import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(), key: () => null, length: 0,
} as Storage;

const h = await import('./testHistory.ts');
const entry = (ts: string, score = 80): import('./testHistory.ts').TestHistoryEntry => ({
  ts, level: 'beginner', score, correct: 4, attempted: 5, completed: true, mode: 'ayah', ear: 'lab', label: 'x',
  wrong: [{ ayah: '67:3', words: ['فارجع'], idx: [5] }],
});

test('17.7: delete hides, undo restores, raw keeps the tombstone', () => {
  store.clear();
  h.addTestHistoryV1(entry('2026-11-26T10:00:00.000Z'));
  h.addTestHistoryV1(entry('2026-11-26T11:00:00.000Z'));
  assert.equal(h.deleteTestHistoryEntry('2026-11-26T10:00:00.000Z', 5).length, 1);
  assert.equal(h.loadTestHistoryRaw().length, 2);
  assert.equal(h.loadTestHistoryRaw()[1].deletedAt, 5);
  assert.equal(h.undoDeleteTestHistoryEntry('2026-11-26T10:00:00.000Z').length, 2);
});

test('17.7: clear all and undo it with one mark; earlier deletions stay deleted', () => {
  store.clear();
  h.addTestHistoryV1(entry('a'));
  h.addTestHistoryV1(entry('b'));
  h.addTestHistoryV1(entry('c'));
  h.deleteTestHistoryEntry('a', 1);
  const { list, mark } = h.deleteAllTestHistory(2);
  assert.equal(list.length, 0);
  const back = h.undoDeleteAll(mark);
  assert.deepEqual(back.map((e) => e.ts), ['c', 'b']);
});

test('17.11: wrong spots survive the round trip; entries without them still load', () => {
  store.clear();
  h.addTestHistoryV1(entry('w'));
  const { wrong: _w, ...old } = entry('old');
  void _w;
  h.addTestHistoryV1(old);
  const list = h.loadTestHistoryV1();
  assert.equal(list.length, 2);
  assert.deepEqual(list[1].wrong, [{ ayah: '67:3', words: ['فارجع'], idx: [5] }]);
  assert.equal(list[0].wrong, undefined);
});
