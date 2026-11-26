// Run: node --test src/lib/roundJudge.test.ts
// Phase 2 fixes in the round judge (items 16.3-16.6, 16.9).
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';

const root = new URL('../../', import.meta.url).pathname;

type St = {
  base: number; since: number | null; pendingIdx: number | null; corrLeft: number; mistaken: Set<number>;
  msUntilDue: (now: number) => number | null;
  reset: (total: number) => void;
  evaluate: (m: boolean[], all: boolean, final: boolean, now?: number, lastWrong?: boolean) => { kind: string; locked?: boolean };
  summary: (locked: boolean) => { credited: number; wrong: number[]; locked: boolean; corrected: number; mistakes: number };
};
let J: {
  RoundState: new (total: number, corrections: number, mistakeMs?: number | null) => St;
  roundCutMs: (m: string) => number | null;
};

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-'));
  const entry = path.join(dir, 'entry.ts');
  fs.writeFileSync(entry, `export { RoundState, roundCutMs } from '${root}src/lib/roundJudge.ts';`);
  buildSync({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: path.join(dir, 'out.mjs'), logLevel: 'error',
    define: { 'import.meta.env.VITE_SUPABASE_URL': '"http://x.test"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"k"', 'import.meta.env.BASE_URL': '"/"', 'import.meta.env': '{}' },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  J = await import(path.join(dir, 'out.mjs'));
});

const T = true, F = false;
/** `matched` covers the WHOLE rest of the ayah (as alignRest returns it): pad with «not said yet». */
const pad = (n: number, xs: boolean[]) => [...xs, ...new Array<boolean>(Math.max(0, n - xs.length)).fill(false)];

describe('16.3 the clock belongs to one word index', () => {
  it('a new mistake at another index starts its own clock', () => {
    const st = new J.RoundState(8, 1);
    assert.equal(st.evaluate(pad(8, [T, F, T]), false, false, 0).kind, 'continue');
    assert.equal(st.pendingIdx, 1);
    // word 1 fixed, word 4 now wrong 9 s later: a fresh clock, not the old one.
    assert.equal(st.evaluate(pad(8, [T, T, T, T, F, T]), false, false, 9000).kind, 'continue');
    assert.equal(st.pendingIdx, 4);
    assert.equal(st.since, 9000);
    assert.equal(st.msUntilDue(9000), 10_000);
  });
  it('a frame where the pending word is not visible as a mistake does not drop the clock', () => {
    const st = new J.RoundState(8, 1);
    st.evaluate(pad(8, [T, F, T]), false, false, 0);
    // aligner shows only [T]: word 1 is not right, just not followed by a match.
    st.evaluate(pad(8, [T]), false, false, 4000);
    assert.equal(st.since, 0);
    assert.equal(st.evaluate(pad(8, [T, F, T]), false, false, 10_000).kind, 'correct');
  });
});

describe('16.4 a corrected word said right afterwards is credited', () => {
  it('credits it and still counts the correction', () => {
    const st = new J.RoundState(4, 1);
    assert.equal(st.evaluate(pad(4, [T, F, T]), false, false, 0, false).kind, 'continue');
    assert.equal(st.evaluate(pad(4, [T, F, T]), false, true, 1).kind, 'correct'); // «خلصت» -> reciter corrects word 1
    // after the correction he says words 1..3 right (relative to base 1)
    assert.equal(st.evaluate([T, T, T], true, false, 2).kind, 'finish');
    const sum = st.summary(false);
    assert.equal(sum.credited, 4);
    assert.equal(sum.mistakes, 1);
    assert.deepEqual(sum.wrong, [1]);
  });
});

describe('16.5 locked: wrong = corrected words + the closing one, never the unsaid tail', () => {
  it('does not list words the user never tried to say', () => {
    const st = new J.RoundState(10, 0); // no correction left: the first counted mistake locks
    const act = st.evaluate(pad(10, [T, F, T]), false, true, 0);
    assert.equal(act.kind, 'finish');
    assert.equal(act.locked, true);
    const sum = st.summary(true);
    assert.deepEqual(sum.wrong, [1]);
    assert.equal(sum.mistakes, 1);
  });
});

describe('16.6 reset() clears the old part but keeps the spent budget', () => {
  it('drops clock, pending index and corrected words; corrLeft stays', () => {
    const st = new J.RoundState(8, 1);
    st.evaluate(pad(8, [T, F, T]), false, true, 0); // correct -> corrLeft 0
    st.evaluate(pad(7, [F, T]), false, false, 100); // new clock in the new part
    st.reset(5);
    assert.equal(st.since, null);
    assert.equal(st.pendingIdx, null);
    assert.equal(st.mistaken.size, 0);
    assert.equal(st.base, 0);
    assert.equal(st.corrLeft, 0);
  });
});

describe('16.9 cut-in clock is a setting', () => {
  it('maps the modes', () => {
    assert.equal(J.roundCutMs('10s'), 10_000);
    assert.equal(J.roundCutMs('15s'), 15_000);
    assert.equal(J.roundCutMs('ayah-end'), null);
  });
  it('15 s waits longer than 10 s', () => {
    const st = new J.RoundState(8, 1, 15_000);
    st.evaluate(pad(8, [T, F, T]), false, false, 0);
    assert.equal(st.evaluate(pad(8, [T, F, T]), false, false, 10_000).kind, 'continue');
    assert.equal(st.evaluate(pad(8, [T, F, T]), false, false, 15_000).kind, 'correct');
  });
  it('ayah-end has no clock: only the ayah end / 3 wrong words / «خلصت» cut in', () => {
    const st = new J.RoundState(8, 1, null);
    st.evaluate(pad(8, [T, F, T]), false, false, 0);
    assert.equal(st.msUntilDue(60_000), null);
    assert.equal(st.evaluate(pad(8, [T, F, T]), false, false, 600_000).kind, 'continue');
    assert.equal(st.evaluate(pad(8, [T, F, T, T, T, T, T, T]), false, false, 600_001).kind, 'correct');
  });
});
