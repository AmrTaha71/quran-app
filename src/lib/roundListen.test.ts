// Run: node --test src/lib/roundListen.test.ts
// 1) alignRest on real ayat with the REAL tasmee' aligner (bundled from SelfTestPage by esbuild).
// 2) ListenSession with a fake recognizer (keepalive, stop/end, restart) on mocked timers.
import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { alignRest, ListenSession, QUIET_MS, STOP_GRACE_MS } from './roundListen.ts';
import { readResults, isEmptyEvent } from './speechResults.ts';
import type { Rec, RecEvent } from './speechResults.ts';

const root = new URL('../../', import.meta.url).pathname;

type Bundle = {
  alignSpoken: (e: string[], s: string) => { matched: boolean[]; allMatched: boolean };
  expectedWordList: (t: string) => { orig: string; norm: string }[];
  firstMistake: (m: boolean[]) => number;
  tarteelRoundScore: (r: { total: number; credited: number; extras?: number }, surahOk: boolean | null) => { total: number };
};
let B: Bundle;
let ayat: { surah: number; ayah: number; text: string }[];

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'round-'));
  const entry = path.join(dir, 'entry.ts');
  fs.writeFileSync(entry, [
    `import '${root}src/pages/SelfTestPage.tsx';`,
    `export { alignSpoken } from '${root}src/lib/alignBridge.ts';`,
    `export { expectedWordList } from '${root}src/lib/expectedWords.ts';`,
    `export { firstMistake, tarteelRoundScore } from '${root}src/lib/roundTest.ts';`,
  ].join('\n'));
  buildSync({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: path.join(dir, 'out.mjs'), logLevel: 'error', jsx: 'automatic',
    define: { 'import.meta.env.VITE_SUPABASE_URL': '"http://x.test"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"k"', 'import.meta.env.BASE_URL': '"/"', 'import.meta.env': '{}' },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.wasm': 'empty', '.onnx': 'empty' },
  });
  B = await import(path.join(dir, 'out.mjs'));
  ayat = JSON.parse(fs.readFileSync(path.join(root, 'public/tajweed/tajweed-mushaf-image.json'), 'utf8'));
});

const ayahOf = (s: number, a: number) => {
  const r = ayat.find((x) => x.surah === s && x.ayah === a)!;
  return B.expectedWordList(r.text).map((w) => w.norm);
};

describe('alignRest on real ayat (prompt = first 5 words)', () => {
  const START = 5;
  for (const [s, a] of [[2, 255], [2, 23], [2, 282], [2, 30]] as [number, number][]) {
    const info = () => { const norms = ayahOf(s, a); return { norms, rest: norms.length - START }; };
    it(`${s}:${a} (أ) spoken exactly after the prompt -> all green`, () => {
      const { norms, rest } = info();
      const r = alignRest(norms, START, norms.slice(START).join(' '), B.alignSpoken);
      assert.equal(r.matched.length, rest);
      assert.ok(r.matched.every(Boolean));
      assert.equal(r.allMatched, true);
    });
    it(`${s}:${a} (ب) whole ayah including the prompt -> all green`, () => {
      const { norms } = info();
      const r = alignRest(norms, START, norms.join(' '), B.alignSpoken);
      assert.ok(r.matched.every(Boolean));
      assert.equal(r.allMatched, true);
    });
    it(`${s}:${a} (ج) first word wrong, the rest right -> partial match share`, () => {
      const { norms, rest } = info();
      const spoken = ['ضضضض', ...norms.slice(START + 1)].join(' ');
      const r = alignRest(norms, START, spoken, B.alignSpoken);
      assert.equal(r.matched[0], false);
      assert.ok(r.matched.slice(1).every(Boolean));
      assert.equal(r.allMatched, false);
      assert.equal(r.matched.filter(Boolean).length, rest - 1);
      // Product question for Dr. Amr (NOT changed here): with no corrections the position is
      // locked at this first mistake, so the round credits 0 words, not (rest-1)/rest.
      assert.equal(B.firstMistake(r.matched), 0);
    });
    it(`${s}:${a} (د) empty text -> nothing matched, score 0`, () => {
      const { norms, rest } = info();
      const r = alignRest(norms, START, '', B.alignSpoken);
      assert.equal(r.matched.length, rest);
      assert.ok(r.matched.every((m) => !m));
      assert.equal(r.allMatched, false);
      assert.equal(B.tarteelRoundScore({ total: rest, credited: 0, extras: 0 }, null).total, 0);
    });
  }

  it('(أ)/(ب) with the whole-ayah match alone would fail real ayat (why alignRest takes the better of two)', () => {
    const norms = ayahOf(2, 23);
    const onlyCut = B.alignSpoken(norms, norms.slice(START).join(' ')).matched.slice(START);
    assert.equal(onlyCut.every(Boolean), false);
    assert.ok(alignRest(norms, START, norms.slice(START).join(' '), B.alignSpoken).allMatched);
  });

  it('sweep: every ayah with 8+ words, cases (أ) and (ب), prompt 5 words', () => {
    let n = 0; const bad: string[] = [];
    for (const r of ayat) {
      const norms = B.expectedWordList(r.text).map((w) => w.norm);
      if (norms.length < 8) continue;
      n++;
      const a = alignRest(norms, START, norms.slice(START).join(' '), B.alignSpoken);
      const b = alignRest(norms, START, norms.join(' '), B.alignSpoken);
      if (!a.allMatched) bad.push(`${r.surah}:${r.ayah}(a)`);
      if (!b.allMatched) bad.push(`${r.surah}:${r.ayah}(b)`);
    }
    console.log(`sweep: ${n} ayat, failures: ${bad.length}`, bad.slice(0, 20).join(' '));
    assert.deepEqual(bad, []);
  });
});

// ---- ListenSession with a fake recognizer -------------------------------------------------
const ev = (text: string, isFinal = false): RecEvent => ({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] });
// The device ear's real keepalive shape (quranLabEar.ts): one non-final result with an empty transcript.
const keepalive = (): RecEvent => ({ resultIndex: 0, results: [Object.assign([{ transcript: '' }], { isFinal: false })] });

class FakeRec implements Rec {
  onresult: Rec['onresult'] = null; onerror: Rec['onerror'] = null; onend: Rec['onend'] = null;
  starts = 0; stops = 0; aborts = 0; endAfterStopMs: number | null = 100; startThrows = false;
  start() { this.starts++; if (this.startThrows) throw new Error('InvalidStateError'); }
  stop() { this.stops++; if (this.endAfterStopMs !== null) setTimeout(() => this.onend?.(), this.endAfterStopMs); }
  abort() { this.aborts++; }
}

function make(kind: 'lab' | 'browser', listening = true) {
  const rec = new FakeRec();
  const log = { quiet: 0, text: [] as string[], restartErr: 0 };
  const s = new ListenSession({
    rec, kind, readResults, isEmptyEvent, isListening: () => listening,
    onText: (t) => log.text.push(t), onQuiet: () => { log.quiet++; }, onRestartError: () => { log.restartErr++; },
  });
  s.attach();
  return { rec, s, log };
}

describe('ListenSession (fake recognizer, mocked timers)', () => {
  it('empty keepalive every 1500 ms does not postpone the quiet timer (fires QUIET_MS after the last words)', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const { rec, log } = make('lab');
    const ka = setInterval(() => rec.onresult?.(keepalive()), 1500);
    rec.onresult?.(ev('الحمد لله'));                // speech at t=0
    t.mock.timers.tick(1500);                        // keepalive #1 — used to reset the 1800 ms timer
    assert.equal(log.quiet, 0);
    t.mock.timers.tick(300);                         // t=1800
    assert.equal(log.quiet, 1, 'quiet fired at 1800 ms despite the keepalive');
    t.mock.timers.tick(6000);                        // more keepalives: nothing new, no re-fire
    assert.equal(log.quiet, 1);
    assert.deepEqual(log.text, ['الحمد لله'], 'live counter updated once, never for keepalives');
    clearInterval(ka);
  });

  it('a keepalive after speech does not wipe the interim text', () => {
    const { rec, s } = make('browser');
    rec.onresult?.(ev('بسم الله', false));
    rec.onresult?.(keepalive());
    assert.equal(s.text(), 'بسم الله');
    assert.equal(isEmptyEvent({ resultIndex: 0, results: [] }), true);
  });

  it('live text updates immediately on a changed interim / final, and not on an identical repeat', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { rec, log } = make('browser');
    rec.onresult?.(ev('بسم', false));
    rec.onresult?.(ev('بسم الله', false));
    rec.onresult?.(ev('بسم الله', false));           // same -> ignored
    rec.onresult?.(ev('بسم الله', true));            // becomes final -> changed
    assert.equal(log.text.length, 3);
  });

  it('stopAndGrade: grades once when the engine ends by itself', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { rec, s } = make('lab');
    const graded: string[] = [];
    s.stopAndGrade((via) => graded.push(via));
    assert.equal(rec.stops, 1);
    t.mock.timers.tick(100);                         // engine `end` arrives
    assert.deepEqual(graded, ['end']);
    t.mock.timers.tick(STOP_GRACE_MS + 1000);        // grace timer must not grade a second time
    assert.deepEqual(graded, ['end']);
  });

  it('stopAndGrade: still grades once after 2500 ms when `end` never comes', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { rec, s } = make('browser');
    rec.endAfterStopMs = null;
    const graded: string[] = [];
    s.stopAndGrade((via) => graded.push(via));
    t.mock.timers.tick(STOP_GRACE_MS - 1);
    assert.deepEqual(graded, []);
    t.mock.timers.tick(1);
    assert.deepEqual(graded, ['timeout']);
    rec.onend?.();                                   // a late end must not grade again
    assert.deepEqual(graded, ['timeout']);
  });

  it('stopAndGrade: results arriving between stop() and end still count; stop() throwing still grades', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const a = make('lab');
    a.s.stopAndGrade(() => {});
    a.rec.onresult?.(ev('اخر كلمه', true));
    assert.equal(a.s.text(), 'اخر كلمه');
    const b = make('lab');
    b.rec.stop = () => { throw new Error('x'); };
    let g = 0;
    b.s.stopAndGrade(() => { g++; });
    t.mock.timers.tick(STOP_GRACE_MS);
    assert.equal(g, 1);
  });

  it('browser onend while listening restarts; a start() error is reported, not swallowed', () => {
    const a = make('browser');
    a.rec.onend?.();
    assert.equal(a.rec.starts, 1);
    const b = make('browser');
    b.rec.startThrows = true;
    b.rec.onend?.();
    assert.equal(b.log.restartErr, 1);
    const c = make('lab');
    c.rec.onend?.();
    assert.equal(c.rec.starts, 0, 'the device ear is never restarted');
    const d = make('browser', false);
    d.rec.onend?.();
    assert.equal(d.rec.starts, 0, 'not restarted outside the listening phase');
  });

  it('abort silences everything', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { rec, s, log } = make('lab');
    rec.onresult?.(ev('x'));
    s.abort();
    t.mock.timers.tick(5000);
    assert.equal(log.quiet, 0);
    assert.equal(rec.aborts, 1);
    assert.equal(rec.onresult, null);
  });
});

void mock; void QUIET_MS;
