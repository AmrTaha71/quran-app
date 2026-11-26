// Run: node --test src/lib/juhaniCorr.test.ts
// Item 4.3: a failed timing fetch must not stick for the whole session.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';

const root = new URL('../../', import.meta.url).pathname;
let J: {
  loadCorrReciter: (f?: string) => Promise<void>;
  isJuhaniCorrEnabled: (s: number, a: number, wc: number) => boolean;
  getCorrReciter: () => string;
};

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

let fetchOk = false;
let fetchCalls = 0;
(globalThis as unknown as { fetch: unknown }).fetch = async () => {
  fetchCalls++;
  if (!fetchOk) return { ok: false, json: async () => ({}) };
  // Al-Fatiha 1:1 = 4 words, sane per-word windows.
  return { ok: true, json: async () => ({ '1:1': [0, 0.5, 0.5, 1, 1, 1.5, 1.5, 2] }) };
};

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jcorr-'));
  const entry = path.join(dir, 'entry.ts');
  fs.writeFileSync(entry, `export { loadCorrReciter, isJuhaniCorrEnabled, getCorrReciter } from '${root}src/lib/juhaniCorr.ts';`);
  buildSync({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: path.join(dir, 'out.mjs'), logLevel: 'error',
    define: { 'import.meta.env.VITE_SUPABASE_URL': '"http://x.test"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"k"', 'import.meta.env.BASE_URL': '"/"', 'import.meta.env': '{}' },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  J = await import(path.join(dir, 'out.mjs'));
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('4.3 timing fetch failure is not sticky', () => {
  it('fails once, then word windows come back after the network does', async () => {
    await J.loadCorrReciter(J.getCorrReciter());
    assert.equal(J.isJuhaniCorrEnabled(1, 1, 4), false); // whole-ayah fallback; a retry starts (still offline)
    await settle(); await settle();
    fetchOk = true;
    const before = fetchCalls;
    assert.equal(J.isJuhaniCorrEnabled(1, 1, 4), false); // the next mistake retries the fetch
    assert.ok(fetchCalls > before, 'a new fetch was made after the failure');
    await settle(); await settle(); await settle();
    assert.equal(J.isJuhaniCorrEnabled(1, 1, 4), true);
  });
});
