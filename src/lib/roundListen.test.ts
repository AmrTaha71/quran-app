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
  RoundState: new (total: number, corrections: number) => {
    base: number;
    evaluate: (m: boolean[], all: boolean, final: boolean) => { kind: 'continue' | 'correct' | 'finish'; locked?: boolean };
    summary: (locked: boolean) => { credited: number; wrong: number[]; locked: boolean; corrected: number; mistakes: number };
  };
  currentHistoryLevel: (isAdmin: boolean) => 'beginner' | 'advanced' | 'master';
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
    `export { RoundState, ROUND_CORRECTIONS } from '${root}src/lib/roundJudge.ts';`,
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
          assert.equal(r.score, level === 'beginner' ? 4 : 0);
        });
        it(`${tag} ${level}: first word wrong and not fixed -> counted like any other word`, () => {
          const { norms, rest } = restOf(s, a);
          const r = play(norms, corrections, level, [() => say(rest, 0, { wrongBare: [0] }), (base) => say(rest, base, {})]);
          assert.equal(r.mistakes, 1);
          assert.equal(r.score, level === 'beginner' ? 4 : 0);
        });
        it(`${tag} ${level}: two mistakes the reciter had to correct -> ${level === 'beginner' ? 4 : 0}`, () => {
          const { norms, rest } = restOf(s, a);
          const r = play(norms, corrections, level, [
            () => say(rest, 0, { wrongBare: [2] }),
            (base) => say(rest, base, { wrongBare: [6] }),
            (base) => say(rest, base, {}),
          ]);
          assert.equal(r.mistakes, corrections === 0 ? 1 : 2); // no correction: closes at the first; with the reciter correction: at the second
          assert.equal(r.score, level === 'beginner' ? 4 : 0);
        });
        it(`${tag} ${level}: one self-fixed + one the reciter corrected -> counts as ONE mistake`, () => {
          const { norms, rest } = restOf(s, a);
          const r = play(norms, corrections, level, [
            () => say(rest, 0, { fixAt: [1], wrongBare: [4] }),
            (base) => say(rest, base, {}),
          ]);
          assert.equal(r.mistakes, 1);
          assert.equal(r.score, level === 'beginner' ? 4 : 0);
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
      assert.equal(one.score, level === 'beginner' ? 4 : 0);
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
      assert.equal(B.currentHistoryLevel(false), 'beginner');
      for (const [lv, want] of [['beginner', 'beginner'], ['intermediate', 'advanced'], ['advanced', 'advanced'], ['متوسط', 'advanced'], ['متقدم', 'advanced'], ['master', 'advanced']] as const) {
        store.set('quran-test-settings', JSON.stringify({ level: lv }));
        assert.equal(B.currentHistoryLevel(false), want, lv);
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


// ---- When the judge looks: not at a silence --------------------------------------------------
describe('mistakes are judged at «خلصت» or at the last word, never at a mid-ayah silence', () => {
  const START = 5;
  const BAD = 'ضضضض';
  /** Wires FakeRec -> ListenSession -> alignRest -> RoundState exactly like RoundRecite.startMic. */
  function rig(norms: string[], corrections = B.ROUND_CORRECTIONS) {
    const st = new B.RoundState(norms.length - START, corrections);
    const rec = new FakeRec();
    const actions: { kind: string; locked?: boolean }[] = [];
    const judge = (final: boolean) => {
      const al = alignRest(norms, START + st.base, sess.text(), B.alignSpoken);
      const act = st.evaluate(al.matched, al.allMatched, final);
      actions.push(act);
      return act;
    };
    const sess: ListenSession = new ListenSession({
      rec, kind: 'lab', readResults, isEmptyEvent, isListening: () => true,
      onText: () => {}, onQuiet: () => { judge(false); }, onRestartError: () => {},
    });
    sess.attach();
    return { st, rec, sess, actions, judge };
  }
  const say = (rec: FakeRec, words: string[]) => rec.onresult?.(ev(words.join(' '), false));

  for (const [s, a] of [[2, 255], [2, 23], [2, 282], [2, 30]] as [number, number][]) {
    for (const level of ['beginner', 'advanced'] as const) {
      it(`${s}:${a} ${level}: mistake, 3 s silence, he fixes it himself, goes on = NOT counted (8)`, (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const norms = ayahOf(s, a);
        const rest = norms.slice(START);
        const { st, rec, actions } = rig(norms);
        say(rec, [...rest.slice(0, 2), BAD]);                       // wrong word in the middle
        t.mock.timers.tick(3000);                                   // 3 s of silence: the quiet timer fires...
        assert.deepEqual(actions, [{ kind: 'continue' }], 'the silence judged nothing, the reciter did not cut in');
        say(rec, [...rest.slice(0, 2), BAD, rest[2]]);              // ...he says the right word himself
        say(rec, rest);                                             // ...and carries on to the end
        t.mock.timers.tick(QUIET_MS);
        const last = actions[actions.length - 1];
        assert.deepEqual(last, { kind: 'finish', locked: false });
        const sum = st.summary(false);
        assert.equal(sum.mistakes, 0);
        assert.equal(sum.corrected, 0);
        assert.equal(B.tarteelRoundScore({ total: rest.length, ...sum, extras: 0, beginner: level === 'beginner' }, true).completion, 8);
      });
    }
  }

  it('an unfixed mistake is NOT judged at a mid-ayah silence even when later words were heard; «خلصت» judges it', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const norms = ayahOf(2, 255);
    const rest = norms.slice(START);
    const { st, rec, actions, judge } = rig(norms);
    say(rec, [rest[0], BAD, ...rest.slice(2, 8)]);                  // wrong word 1, then 6 right ones, not at the end yet
    t.mock.timers.tick(3000);
    assert.deepEqual(actions, [{ kind: 'continue' }]);
    assert.equal(st.base, 0, 'nothing was settled');
    assert.deepEqual(judge(true), { kind: 'correct' });             // «خلصت»: now the reciter corrects (counted)
    assert.equal(st.base, 1);
    assert.equal(st.summary(false).mistakes, 1);
  });

  it('the ayah is over (last word said) and a word is still wrong -> judged at the quiet timer: reciter corrects', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const norms = ayahOf(2, 23);
    const rest = norms.slice(START);
    const { st, rec, actions } = rig(norms);
    say(rec, rest.map((w, i) => (i === 3 ? BAD : w)));
    t.mock.timers.tick(QUIET_MS);
    assert.deepEqual(actions, [{ kind: 'correct' }]);
    assert.equal(st.base, 3);
    assert.equal(st.summary(false).mistakes, 1);
  });

  it('same, with no correction left (engine only): the position closes locked', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const norms = ayahOf(2, 23);
    const rest = norms.slice(START);
    const { rec, actions } = rig(norms, 0);
    say(rec, rest.map((w, i) => (i === 3 ? BAD : w)));
    t.mock.timers.tick(QUIET_MS);
    assert.deepEqual(actions, [{ kind: 'finish', locked: true }]);
  });
});
