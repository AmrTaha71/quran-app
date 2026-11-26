// node --test src/lib/pageReview.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recordTestPages, pageQueue, pagesOfCorpus, loadPageReview } from './pageReview.ts';
import { pageStartGlobal, pageEndGlobal } from './reviewPages.ts';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}
const T0 = new Date(2026, 10, 1).getTime();
const DAY = 86_400_000;
const pageAyat = (p: number, ok = true) => {
  const out: { g: number; ok: boolean }[] = [];
  for (let g = pageStartGlobal(p); g <= pageEndGlobal(p); g++) out.push({ g, ok });
  return out;
};

describe('pageReview (17.3)', () => {
  it('a clean full page moves a stage and leaves the queue until due', () => {
    const s = mem();
    recordTestPages(pageAyat(3), T0, s);
    const st = loadPageReview(s);
    assert.equal(st[3].s, 1);
    assert.equal(st[3].d, T0 + DAY);
    assert.deepEqual(pageQueue([2, 3], st, T0 + 1).map((q) => q.page), [2]);
    assert.deepEqual(pageQueue([2, 3], st, T0 + DAY).map((q) => q.page), [2, 3]);
  });
  it('a page with a mistake comes first, even when partly tested', () => {
    const s = mem();
    recordTestPages(pageAyat(3), T0, s);
    recordTestPages([{ g: pageStartGlobal(5), ok: false }], T0, s);
    const q = pageQueue([2, 3, 5], loadPageReview(s), T0 + 1);
    assert.equal(q[0].page, 5);
    assert.equal(q[0].open, true);
  });
  it('a partial clean page records nothing', () => {
    const s = mem();
    recordTestPages([{ g: pageStartGlobal(7), ok: true }], T0, s);
    assert.equal(loadPageReview(s)[7], undefined);
  });
  it('corpus ayat map to their pages', () => {
    assert.deepEqual(pagesOfCorpus([pageStartGlobal(4), pageStartGlobal(4) + 1, pageStartGlobal(9)]), [4, 9]);
  });
});
