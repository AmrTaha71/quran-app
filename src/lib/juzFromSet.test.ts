// Run: node --test src/lib/juzFromSet.test.ts
// Item 5.2: the memorization map counts scattered memorization.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';

const root = new URL('../../', import.meta.url).pathname;
type Entry = { status: string };
let M: { juzStatusesFromSet: (s: Set<number>) => Entry[]; JUZ_STARTS: { global: number }[] };

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'juzset-'));
  const entry = path.join(dir, 'entry.ts');
  fs.writeFileSync(entry, `export { juzStatusesFromSet } from '${root}src/lib/homeFeatures';\nexport { JUZ_STARTS } from '${root}src/lib/quranBoundaries';\n`);
  buildSync({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: path.join(dir, 'out.mjs'), logLevel: 'error',
    define: { 'import.meta.env.VITE_SUPABASE_URL': '"http://x.test"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"k"', 'import.meta.env.BASE_URL': '"/"', 'import.meta.env': '{}' },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  M = await import(path.join(dir, 'out.mjs'));
});

test('5.2: Juz 30 alone shows Juz 30 memorized and the rest not yet', () => {
  const set = new Set<number>();
  for (let g = M.JUZ_STARTS[29].global; g <= 6236; g++) set.add(g);
  const e = M.juzStatusesFromSet(set);
  assert.equal(e[29].status, 'memorized');
  assert.equal(e.filter((x) => x.status === 'not-yet').length, 29);
});

test('5.2: one scattered ayah makes its Juz in progress', () => {
  const e = M.juzStatusesFromSet(new Set([M.JUZ_STARTS[14].global + 3]));
  assert.equal(e[14].status, 'in-progress');
});
