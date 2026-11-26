// Run: node --test src/lib/hifzCorpus.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); },
};
const m = await import('./hifzCorpus.ts');

test('17.2: no memorized ayat → no restriction', () => {
  m.syncCorpusFromMemorized([]);
  assert.equal(m.loadHifzCorpus(), null);
});
test('17.2: the corpus mirrors the memorized list', () => {
  m.syncCorpusFromMemorized([6230, 6231, 5]);
  const c = m.loadHifzCorpus()!;
  assert.equal(c.size, 3);
  assert.equal(m.corpusCountIn(c, 6000, 6236), 2);
});
