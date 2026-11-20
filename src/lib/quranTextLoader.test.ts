// Run: node --test src/lib/quranTextLoader.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTextLoader } from './quranTextLoader.ts';

const rows = [
  { surah_no: 1, ayah_no: 1, ayah_text: 'a' },
  { surah_no: 1, ayah_no: 2, ayah_text: 'b' },
];

describe('createTextLoader', () => {
  it('uses the cache and never fetches when the cache has the text', async () => {
    let fetched = 0;
    const load = createTextLoader({ readCache: async () => rows, fetchRows: async () => { fetched++; return rows; } });
    const m = await load();
    assert.equal(m?.get('1:2'), 'b');
    assert.equal(fetched, 0);
  });

  it('empty cache -> fetches, so the text is non-null (the «ابدأ» enable condition)', async () => {
    let fetched = 0;
    const load = createTextLoader({ readCache: async () => null, fetchRows: async () => { fetched++; return rows; } });
    const m = await load();
    assert.ok(m, 'text must load on a fresh device');
    assert.equal(m.size, 2);
    assert.equal(fetched, 1);
    await load();
    assert.equal(fetched, 1, 'success is memoized: one fetch only');
  });

  it('a failure is not remembered: the next call retries and can succeed', async () => {
    let calls = 0;
    const load = createTextLoader({ readCache: async () => null, fetchRows: async () => (++calls === 1 ? null : rows) });
    assert.equal(await load(), null);
    await new Promise((r) => setTimeout(r, 0));
    const second = await load();
    assert.ok(second);
    assert.equal(calls, 2);
  });

  it('a throwing backend resolves null instead of rejecting', async () => {
    const load = createTextLoader({ readCache: async () => { throw new Error('idb'); }, fetchRows: async () => rows });
    assert.equal(await load(), null);
  });
});
