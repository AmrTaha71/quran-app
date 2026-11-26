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
  tarteelRoundScore: (r: { total: number; credited: number; extras?: number; mistakes?: number; beginner?: boolean }, surahOk: boolean | null) => { completion: number; total: number };
  ROUND_CORRECTIONS: number;
  DeadlineTimer: new (run: () => void) => { sync: (ms: number | null) => void; clear: () => void };
  RoundState: new (total: number, corrections: number) => {
    base: number;
    since: number | null;
    msUntilDue: (now: number) => number | null;
    evaluate: (m: boolean[], all: boolean, final: boolean, now?: number, lastWrong?: boolean) => { kind: 'continue' | 'correct' | 'finish'; locked?: boolean };
    summary: (locked: boolean) => { credited: number; wrong: number[]; locked: boolean; corrected: number; mistakes: number };
  };
  currentHistoryLevel: () => 'beginner' | 'advanced';
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
    `export { firstMistake, tarteelRoundScore, currentHistoryLevel } from '${root}src/lib/roundTest.ts';`,
    `export { RoundState, ROUND_CORRECTIONS, DeadlineTimer } from '${root}src/lib/roundJudge.ts';`,
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

// ---- Mistake rule: only mistakes the reciter had to correct count -------------------------
// beginner: a counted mistake (1 or more) -> half of the ayah part (4 of 8); any other level -> 0.
// A word the user said wrong and then right BEFORE the reciter spoke is not a mistake.
describe('round scoring: self-corrected mistakes do not count', () => {
  const START = 5;
  const BAD = 'ضضضض', BAD2 = 'ططططط';
  type Level = 'beginner' | 'advanced';
  const AYAT: [number, number][] = [[2, 255], [2, 23], [2, 282], [2, 30]];
  const restOf = (s: number, a: number) => { const norms = ayahOf(s, a); return { norms, rest: norms.slice(START) }; };

  /** Plays one round like RoundRecite does: each attempt is what the user says in one listening
   *  session (the reciter correction ends a session and the next one starts at the mistaken word). */
  function play(norms: string[], corrections: number, level: Level, attempts: ((base: number) => string)[]) {
    const total = norms.length - START;
    const st = new B.RoundState(total, corrections);
    let locked: boolean | null = null;
    let corrections_played = 0;
    for (const att of attempts) {
      const al = alignRest(norms, START + st.base, att(st.base), B.alignSpoken);
      const act = st.evaluate(al.matched, al.allMatched, true);
      if (act.kind === 'correct') { corrections_played++; continue; }
      if (act.kind === 'finish') { locked = act.locked!; break; }
    }
    assert.notEqual(locked, null, 'the round must finish');
    const sum = st.summary(locked!);
    const score = B.tarteelRoundScore({ total, ...sum, extras: 0, beginner: level === 'beginner' }, true).completion;
    return { ...sum, score, corrections_played };
  }
  /** What a user says from word `from` (relative to the completed part): words with fixes injected. */
  const say = (rest: string[], from: number, edit: { wrongAt?: number[]; fixAt?: number[]; wrongBare?: number[] }) => {
    const out: string[] = [];
    rest.slice(from).forEach((w, k) => {
      const i = from + k;
      if (edit.fixAt?.includes(i)) out.push(i % 2 ? BAD : BAD2, w);          // wrong word, then the right one (self-correction)
      else if (edit.wrongBare?.includes(i)) out.push(i % 2 ? BAD : BAD2);    // wrong word, never fixed
      else out.push(w);
    });
    return out.join(' ');
  };

  for (const [s, a] of AYAT) {
    // ROUND_CORRECTIONS (=1) is what BOTH tests use. corrections=0 is the judge engine with no correction
    // left (not used by either screen any more): kept to show the scores do not depend on it.
    for (const corrections of [0, 1]) {
      const tag = `${s}:${a} corrections=${corrections}${corrections === 0 ? ' (engine only, unused)' : ''}`;
      for (const level of ['beginner', 'advanced'] as Level[]) {
        it(`${tag} ${level}: clean -> 8`, () => {
          const { norms, rest } = restOf(s, a);
          const r = play(norms, corrections, level, [() => say(rest, 0, {})]);
          assert.equal(r.mistakes, 0); assert.equal(r.score, 8);
        });
        it(`${tag} ${level}: one mistake the user fixed himself -> not counted, 8`, () => {
          const { norms, rest } = restOf(s, a);
          const r = play(norms, corrections, level, [() => say(rest, 0, { fixAt: [2] })]);
          assert.equal(r.mistakes, 0); assert.equal(r.corrected, 0); assert.equal(r.score, 8);
        });
        it(`${tag} ${level}: two mistakes both fixed by the user -> 8 (the first word too)`, () => {
          const { norms, rest } = restOf(s, a);
          const r = play(norms, corrections, level, [() => say(rest, 0, { fixAt: [0, 4] })]);
          assert.equal(r.mistakes, 0); assert.equal(r.score, 8);
        });
        it(`${tag} ${level}: one mistake the reciter corrected -> ${level === 'beginner' ? 4 : 0}`, () => {
          const { norms, rest } = restOf(s, a);
          const r = play(norms, corrections, level, [
            () => say(rest, 0, { wrongBare: [2] }),
            (base) => say(rest, base, {}),       // after the correction the user goes on from the mistaken word
          ]);
          assert.equal(r.mistakes, 1);
          assert.equal(r.score, 4); // 4.25: one mistake costs half the ayah part at every level
        });
        it(`${tag} ${level}: first word wrong and not fixed -> counted like any other word`, () => {
          const { norms, rest } = restOf(s, a);
          const r = play(norms, corrections, level, [() => say(rest, 0, { wrongBare: [0] }), (base) => say(rest, base, {})]);
          assert.equal(r.mistakes, 1);
          assert.equal(r.score, 4); // 4.25: one mistake costs half the ayah part at every level
        });
        it(`${tag} ${level}: two mistakes the reciter had to correct -> beginner 4, else 0 (one mistake when there is no correction: 4)`, () => {
          const { norms, rest } = restOf(s, a);
          const r = play(norms, corrections, level, [
            () => say(rest, 0, { wrongBare: [2] }),
            (base) => say(rest, base, { wrongBare: [6] }),
            (base) => say(rest, base, {}),
          ]);
          assert.equal(r.mistakes, corrections === 0 ? 1 : 2); // no correction: closes at the first; with the reciter correction: at the second
          assert.equal(r.score, level === 'beginner' || r.mistakes === 1 ? 4 : 0);
        });
        it(`${tag} ${level}: one self-fixed + one the reciter corrected -> counts as ONE mistake`, () => {
          const { norms, rest } = restOf(s, a);
          const r = play(norms, corrections, level, [
            () => say(rest, 0, { fixAt: [1], wrongBare: [4] }),
            (base) => say(rest, base, {}),
          ]);
          assert.equal(r.mistakes, 1);
          assert.equal(r.score, 4); // 4.25: one mistake costs half the ayah part at every level
        });
      }
    }
  }

  it('both tests use the same correction setting (ROUND_CORRECTIONS = 1) and therefore the same scores', () => {
    assert.equal(B.ROUND_CORRECTIONS, 1);
    for (const f of ['src/components/TarteelQuizModal.tsx', 'src/components/ComprehensiveTestModal.tsx']) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      assert.match(src, /<RoundRecite [^>]*corrections=\{ROUND_CORRECTIONS\}/, f);
      assert.doesNotMatch(src, /corrections=\{[01]\}/, f);
    }
    for (const [s, a] of AYAT) for (const level of ['beginner', 'advanced'] as Level[]) {
      const { norms, rest } = restOf(s, a);
      const one = play(norms, B.ROUND_CORRECTIONS, level, [() => say(rest, 0, { wrongBare: [3] }), (b) => say(rest, b, {})]);
      assert.equal(one.mistakes, 1);
      assert.equal(one.score, 4);
    }
  });

  it('a mistake only counts when later words were heard (trailing unsaid words are not a mistake)', () => {
    const { norms, rest } = restOf(2, 255);
    const r = play(norms, 1, 'beginner', [() => rest.slice(0, 6).join(' ')]); // said 6 words and stopped
    assert.equal(r.mistakes, 0);
    assert.equal(r.credited, 6);
    assert.equal(B.tarteelRoundScore({ total: rest.length, credited: r.credited, mistakes: 0, beginner: true }, true).completion, Math.round((8 * 6 / rest.length) * 10) / 10);
  });

  it('level is read from quran-test-settings (default beginner; intermediate/advanced/master are not)', () => {
    const g = globalThis as { localStorage?: unknown };
    const store = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
    try {
      assert.equal(B.currentHistoryLevel(), 'beginner');
      for (const [lv, want] of [['beginner', 'beginner'], ['intermediate', 'advanced'], ['advanced', 'advanced'], ['متوسط', 'advanced'], ['متقدم', 'advanced'], ['master', 'advanced']] as const) {
        store.set('quran-test-settings', JSON.stringify({ level: lv }));
        assert.equal(B.currentHistoryLevel(), want, lv);
      }
    } finally { delete g.localStorage; }
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


// ---- When the reciter cuts in: 3 wrong words, 10 s, end of the ayah / «خلصت» ------------------
describe('reciter intervention timing', () => {
  const START = 5;
  const BADS = ['ضضضض', 'ططططط', 'ظظظظظ', 'غغغغغ'];
  const AYAT2: [number, number][] = [[2, 255], [2, 23], [2, 282], [2, 30]];
  /** Wires FakeRec -> ListenSession -> alignRest -> RoundState -> DeadlineTimer like RoundRecite.startMic. */
  function rig(norms: string[], corrections = B.ROUND_CORRECTIONS) {
    const st = new B.RoundState(norms.length - START, corrections);
    const rec = new FakeRec();
    const actions: { kind: string; locked?: boolean }[] = [];
    const judge = (final: boolean) => {
      const al = alignRest(norms, START + st.base, sess.text(), B.alignSpoken);
      const act = st.evaluate(al.matched, al.allMatched, final, Date.now());
      actions.push(act);
      if (act.kind === 'continue') dl.sync(st.msUntilDue(Date.now()));
      else dl.clear();
      return act;
    };
    const dl = new B.DeadlineTimer(() => { judge(false); });
    const sess: ListenSession = new ListenSession({
      rec, kind: 'lab', readResults, isEmptyEvent, isListening: () => true,
      onText: () => { judge(false); }, onQuiet: () => {}, onRestartError: () => {},
    });
    sess.attach();
    return { st, rec, sess, actions, judge };
  }
  const say = (rec: FakeRec, words: string[]) => rec.onresult?.(ev(words.join(' '), false));
  const kinds = (a: { kind: string }[]) => a.map((x) => x.kind).join(',');

  for (const [s, a] of AYAT2) {
    const norms = () => ayahOf(s, a);
    it(`${s}:${a} 3 wrong words in a row (then the right words go on) = the reciter cuts in at the 3rd`, (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      const rest = norms().slice(START);
      const { st, rec, actions } = rig(norms());
      say(rec, [rest[0], BADS[0], rest[2], rest[3]]);                           // 1 wrong word
      say(rec, [rest[0], BADS[0], BADS[1], rest[3], rest[4]]);                 // 2 wrong words
      assert.equal(kinds(actions), 'continue,continue');
      say(rec, [rest[0], BADS[0], BADS[1], BADS[2], rest[4], rest[5]]);        // 3 wrong words
      assert.equal(actions[actions.length - 1].kind, 'correct');
      assert.equal(st.summary(false).mistakes, 1);
    });
    it(`${s}:${a} one mistake + 10 s without fixing it = the reciter cuts in (at 10 s, not before)`, (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      const rest = norms().slice(START);
      const { st, rec, actions } = rig(norms());
      say(rec, [rest[0], BADS[0], rest[2], rest[3], rest[4]]);                 // the mistake is seen at t=0
      t.mock.timers.tick(9999);
      assert.equal(kinds(actions), 'continue', 'nothing before the 10 s');
      t.mock.timers.tick(1);
      assert.equal(actions[actions.length - 1].kind, 'correct');
      assert.equal(st.summary(false).mistakes, 1);
    });
    it(`${s}:${a} a mistake the user fixes himself before 10 s = no intervention, not counted`, (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      const rest = norms().slice(START);
      const { st, rec, actions } = rig(norms());
      say(rec, [rest[0], rest[1], BADS[0], rest[3], rest[4]]);                 // mistake seen
      t.mock.timers.tick(6000);                                                // 6 s later he restarts from the word
      say(rec, [rest[0], rest[1], BADS[0], rest[3], rest[4], ...rest.slice(2, 8)]);
      assert.equal(st.since, null, 'the clock was dropped when the word got fixed');
      t.mock.timers.tick(20000);                                               // far past the old deadline
      assert.ok(actions.every((x) => x.kind === 'continue'), kinds(actions));
      say(rec, [rest[0], rest[1], BADS[0], rest[3], rest[4], ...rest]);       // and goes on to the end
      const last = actions[actions.length - 1];
      assert.deepEqual(last, { kind: 'finish', locked: false });
      assert.equal(st.summary(false).mistakes, 0);
    });
    it(`${s}:${a} a mistake + the end of the ayah (before 10 s, under 3 wrong words) = the reciter cuts in`, (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      const rest = norms().slice(START);
      const { st, rec, actions } = rig(norms());
      say(rec, rest.slice(0, 4));
      say(rec, rest.map((w, i) => (i === 3 ? BADS[0] : w)));                  // whole ayah, word 3 wrong, 1 s total
      assert.equal(actions[actions.length - 1].kind, 'correct');
      assert.equal(st.base, 3);
      assert.equal(st.summary(false).mistakes, 1);
    });
    it(`${s}:${a} «خلصت» with an unfixed mistake and nothing else due = the reciter cuts in`, (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      const rest = norms().slice(START);
      const { rec, actions, judge } = rig(norms());
      say(rec, [rest[0], BADS[0], rest[2], rest[3], rest[4]]);
      assert.equal(kinds(actions), 'continue');
      assert.equal(judge(true).kind, 'correct');
    });
  }

  it('the old rules are gone: a silence (1.8 s, 3 s, 9 s) judges nothing', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const rest = ayahOf(2, 255).slice(START);
    const { rec, actions } = rig(ayahOf(2, 255));
    say(rec, [rest[0], BADS[0], rest[2], rest[3]]);
    t.mock.timers.tick(QUIET_MS);
    t.mock.timers.tick(3000);
    t.mock.timers.tick(5000);
    assert.equal(kinds(actions), 'continue');
  });

  it('no mistake: nothing happens until the ayah is complete; then it finishes', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const rest = ayahOf(2, 23).slice(START);
    const { st, rec, actions } = rig(ayahOf(2, 23));
    say(rec, rest.slice(0, 5));
    t.mock.timers.tick(60000);
    assert.equal(kinds(actions), 'continue');
    assert.equal(st.msUntilDue(Date.now()), null);
    say(rec, rest);
    assert.deepEqual(actions[actions.length - 1], { kind: 'finish', locked: false });
  });

  it('after the correction the clock starts over (the next mistake gets its own 10 s)', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const rest = ayahOf(2, 282).slice(START);
    const { st, rec, actions } = rig(ayahOf(2, 282));
    say(rec, [rest[0], BADS[0], rest[2], rest[3], rest[4]]);
    t.mock.timers.tick(10000);
    assert.equal(actions[actions.length - 1].kind, 'correct');
    assert.equal(st.since, null);
  });
});

// ---- Wrong LAST word then «خلصت» (Dr. Amr 2026-11-21): a counted mistake, not missing words ----
describe('wrong last word then «خلصت» counts as a mistake', () => {
  const START = 5, BAD = 'ضضضض';
  const run = (corrections: number, spoken: (rest: string[]) => string) => {
    const norms = ayahOf(2, 255), rest = norms.slice(START);
    const al = alignRest(norms, START, spoken(rest), B.alignSpoken);
    const st = new B.RoundState(rest.length, corrections);
    const act = st.evaluate(al.matched, al.allMatched, true, Date.now(), al.lastWrong);
    return { al, act, st, total: rest.length };
  };
  it('3 right words, a wrong 4th, «خلصت», no correction left -> mistake, locked', () => {
    const { al, act, st } = run(0, (r) => [...r.slice(0, 3), BAD].join(' '));
    assert.equal(al.lastWrong, true);
    assert.deepEqual(act, { kind: 'finish', locked: true });
    assert.equal(st.summary(true).mistakes, 1);
    assert.equal(st.summary(true).credited, 3);
  });
  it('same with a correction left -> the reciter corrects it, counted', () => {
    const { act, st } = run(1, (r) => [...r.slice(0, 3), BAD].join(' '));
    assert.equal(act.kind, 'correct');
    assert.equal(st.summary(false).mistakes, 1);
  });
  it('only a wrong word said, then «خلصت» -> mistake', () => {
    const { act } = run(0, () => BAD);
    assert.deepEqual(act, { kind: 'finish', locked: true });
  });
  it('right words then «خلصت» (stopped early, last word right) -> missing words, NOT a mistake', () => {
    const { al, act, st } = run(0, (r) => r.slice(0, 4).join(' '));
    assert.equal(al.lastWrong, false);
    assert.deepEqual(act, { kind: 'finish', locked: false });
    assert.equal(st.summary(false).mistakes, 0);
  });
  it('a wrong word the user fixed himself, last word right, «خلصت» early -> not a mistake', () => {
    const { al, act } = run(0, (r) => [...r.slice(0, 2), BAD, r[2], r[3]].join(' '));
    assert.equal(al.lastWrong, false);
    assert.deepEqual(act, { kind: 'finish', locked: false });
  });
  it('whole ayah said right -> no mistake', () => {
    const { al, act } = run(0, (r) => r.join(' '));
    assert.equal(al.lastWrong, false);
    assert.deepEqual(act, { kind: 'finish', locked: false });
  });
});
