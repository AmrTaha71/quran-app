// One «سمّعني»-style position (W4-E): the reciter says the first 5 words of an
// ayah, the user completes it by voice. Same ear as the tasmee' test (the
// device ear when loaded, else the browser's) and the same word alignment
// (alignWords). Optional corrections: the reciter says the wrong word ONCE and
// the user goes on from it; the next mistake closes the position.
import { useEffect, useMemo, useRef, useState } from 'react';
import { earLabOn, preloadEarLab } from '../lib/quranLabEar';
import { createRecognizer, readResults } from '../lib/voiceCapture';
import { isEmptyEvent } from '../lib/speechResults';
import { ListenSession, alignRest } from '../lib/roundListen';
import { roundDebugOn, setRoundDebug, getRoundDebug } from '../lib/roundDebug';
import { setExtraWordMin } from '../lib/phonemeEar';
import { alignSpoken } from '../lib/alignBridge';
import { speechErrorMessage } from '../lib/speechErrors';
import { playSpan, type SpanHandle } from '../lib/spanPlayer';
import { reciterAyahUrl } from '../lib/juhaniCorr';
import { DeadlineTimer, RoundState, roundCutMs, loadRoundCutMode, ROUND_CUT_LABEL } from '../lib/roundJudge';
import { mistakeBuzz, acceptChime, roundBuzzOn, roundChimeOn, setRoundBuzz, setRoundChime } from '../lib/roundFeel';
import { currentHistoryLevel, HINT_COST, HINT_WORDS, MAX_HINTS, type PickedAyah, type RoundResult } from '../lib/roundTest';

type Phase = 'idle' | 'prompting' | 'ready' | 'listening' | 'grading' | 'correcting' | 'afterCorr' | 'self';

export default function RoundRecite({ ayah, corrections, onFinish }: {
  ayah: PickedAyah;
  /** How many times the reciter corrects (ROUND_CORRECTIONS in both tests). */
  corrections: number;
  onFinish: (r: RoundResult) => void;
}) {
  // «اديني كلمتين كمان»: each request plays HINT_WORDS more words before the user starts.
  const [extra, setExtra] = useState(0);
  const eff = ayah.promptLen + HINT_WORDS * extra;
  const rest = useMemo(() => ayah.words.slice(eff), [ayah, eff]);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const [msg, setMsg] = useState('');
  const [heard, setHeard] = useState(0);
  const [manualWrong, setManualWrong] = useState<Set<number>>(new Set());
  // Item 17.5: the word the pointer is stopped on (absolute index in the
  // completed part), and whether its first-letter hint is shown.
  const [stuckAt, setStuckAt] = useState<number | null>(null);
  const [hintShown, setHintShown] = useState(false);
  const [buzz, setBuzz] = useState(roundBuzzOn);
  const [chime, setChime] = useState(roundChimeOn);

  const stuckRef = useRef<number | null>(null);
  const stRef = useRef<RoundState | null>(null);
  // Item 16.9: the unfixed-mistake clock follows the user's setting (10 s / 15 s / ayah end).
  if (!stRef.current) stRef.current = new RoundState(rest.length, corrections, roundCutMs(loadRoundCutMode()));
  const st = stRef.current;
  // Re-judges when the clock of the unfixed mistake is up (only while listening).
  const dlRef = useRef<DeadlineTimer | null>(null);
  if (!dlRef.current) dlRef.current = new DeadlineTimer(() => { if (phaseRef.current === 'listening') evaluate(false); });
  const dl = dlRef.current;
  const effRef = useRef(eff);
  effRef.current = eff;
  const sessRef = useRef<ListenSession | null>(null);
  const kindRef = useRef<'lab' | 'browser' | 'manual'>('manual');
  const fullNorms = useMemo(() => ayah.words.map((w) => w.norm), [ayah]);
  const [, bumpDebug] = useState(0);
  const audio = useRef<SpanHandle | null>(null);
  const finished = useRef(false);

  useEffect(() => { if (earLabOn()) preloadEarLab(); }, []);
  useEffect(() => () => {
    finished.current = true;
    audio.current?.cancel();
    dl.clear();
    sessRef.current?.abort(); sessRef.current = null;
  }, [dl]);

  const url = reciterAyahUrl(ayah.folder, ayah.surah, ayah.ayah);
  const t = ayah.timings;

  async function span(from: number, to: number): Promise<boolean> {
    audio.current?.cancel();
    const h = playSpan(url, from, to);
    audio.current = h;
    try { await h.promise; return true; } catch { setMsg('تعذّر تشغيل الصوت — اتأكد من النت وجرّب تاني'); return false; }
  }

  async function playPrompt() {
    setMsg('');
    setPhase('prompting');
    await span(Math.max(0, t[0] - 0.25), t[2 * (effRef.current - 1) + 1] + 0.15);
    if (!finished.current) setPhase('ready');
  }

  const canMore = extra < MAX_HINTS && ayah.words.length - (eff + HINT_WORDS) >= 2;
  async function moreWords() {
    if (!canMore) return;
    const from = eff, to = eff + HINT_WORDS;
    st.reset(ayah.words.length - to);
    setExtra(extra + 1);
    setMsg('');
    setPhase('prompting');
    await span(Math.max(0, t[2 * from] - 0.1), t[2 * (to - 1) + 1] + 0.1);
    if (!finished.current) setPhase('ready');
  }

  async function playCorrection() {
    setPhase('correcting');
    const abs = effRef.current + st.base;
    const nextW = Math.min(abs + 1, ayah.words.length - 1);
    await span(Math.max(0, t[2 * abs] - 0.1), t[2 * nextW + 1] + 0.1);
    if (!finished.current) setPhase('afterCorr');
  }

  function stopRec() {
    dl.clear();
    sessRef.current?.abort();
    sessRef.current = null;
  }

  function finishAll(locked: boolean) {
    if (finished.current) return;
    finished.current = true;
    stopRec();
    const sum = st.summary(locked);
    if (!locked && sum.mistakes === 0) acceptChime();
    onFinish({
      total: rest.length, ...sum, beginner: currentHistoryLevel() === 'beginner',
      promptLen: effRef.current, extras: extra, ear: kindRef.current,
    });
  }

  // Item 17.6 (b) + 17.10: «تجاوز الآية» closes the position as skipped. It is
  // not a mistake and does not count in the average (the modal leaves it
  // out and the result says «اتخطّت»); the correction budget is untouched.
  function skipAyah() {
    if (finished.current) return;
    finished.current = true;
    stopRec();
    audio.current?.cancel();
    onFinish({
      total: rest.length, credited: 0, wrong: [], locked: false, corrected: 0,
      mistakes: 0, beginner: currentHistoryLevel() === 'beginner',
      promptLen: effRef.current, extras: extra, ear: kindRef.current, skipped: true,
    });
  }

  function evaluate(final: boolean) {
    if (finished.current) return;
    // Whole ayah in, prompt part cut out after matching (see alignRest). Words the user
    // fixed himself are already right here; only what is still wrong reaches the judge, and
    // the judge cuts in on 3 wrong words, the clock of the unfixed mistake (setting), the end of the
    // ayah, or «خلصت» (never at a silence).
    const al = alignRest(fullNorms, effRef.current + st.base, sessRef.current?.text() ?? '', alignSpoken);
    setHeard(al.matched.filter(Boolean).length);
    const act = st.evaluate(al.matched, al.allMatched, final, Date.now(), al.lastWrong);
    // Item 17.5: a confident mismatch (a later word already matched) stops
    // the pointer on that word; the user re-says it or asks for a hint.
    const nowStuck = act.kind === 'continue' ? st.pendingIdx : null;
    if (nowStuck !== stuckRef.current) {
      if (nowStuck !== null) mistakeBuzz();
      stuckRef.current = nowStuck;
      setStuckAt(nowStuck);
      setHintShown(false);
    }
    if (act.kind === 'correct') { stopRec(); void playCorrection(); }
    else if (act.kind === 'finish') finishAll(act.locked);
    else dl.sync(st.msUntilDue(Date.now())); // an unfixed mistake is waiting for its clock
  }

  // A start()/restart that throws used to be swallowed: log it and tell the user.
  function reportStartError(where: string, err: unknown) {
    console.warn(`[RoundRecite] ${where} failed`, err);
    setMsg('الاستماع وقف ومقدرش يكمّل — اضغط «خلصت» أو جرّب تاني');
  }

  function startMic() {
    setMsg('');
    stopRec();
    // The ear gets the WHOLE ayah and starts aligning after the words already played
    // (the prompt must not be part of what the user is expected to say).
    const start = effRef.current + st.base;
    const made = createRecognizer(fullNorms, start);
    if (!made) { kindRef.current = 'manual'; setPhase('self'); return; }
    const { rec, kind } = made;
    kindRef.current = kind;
    setExtraWordMin(Infinity);
    const sess: ListenSession = new ListenSession({
      rec, kind, readResults, isEmptyEvent,
      isListening: () => phaseRef.current === 'listening',
      // Every real change of finals / interim is judged (evaluate also refreshes the live counter).
      // Judging never waits for a silence: the reciter cuts in on 3 wrong words, 10 s, or the end.
      onText: (text) => {
        if (phaseRef.current === 'listening') evaluate(false);
        else setHeard(alignRest(fullNorms, start, text, alignSpoken).matched.filter(Boolean).length);
      },
      onQuiet: () => {}, // a silence is not a reason to judge any more
      onRestartError: (err) => reportStartError('rec.start() in onend', err),
    });
    sessRef.current = sess;
    sess.attach();
    rec.onerror = (e) => {
      if (sessRef.current !== sess) return;
      if (kind === 'lab' && (e?.error === 'model-load' || e?.error === 'network')) {
        setMsg('تعذّر تحميل برنامج التعرّف على الصوت — قيّم نفسك بإيدك');
        stopRec(); kindRef.current = 'manual'; setPhase('self'); return;
      }
      const m = speechErrorMessage(e?.error);
      if (m) setMsg(m.text);
      if (m?.fatal) { stopRec(); kindRef.current = 'manual'; setPhase('self'); }
    };
    try { rec.start(); } catch (err) { reportStartError('rec.start()', err); }
    setPhase('listening');
  }

  function stopAndGrade() {
    setPhase('grading');
    const sess = sessRef.current;
    if (!sess) { evaluate(true); return; }
    // Snapshot for ?debug=1: what the ear had heard at the moment of stopping.
    const snapAt = (via: string) => {
      if (!roundDebugOn()) return;
      setRoundDebug({ kind: kindRef.current, finals: sess.finals, interim: sess.interim, start: effRef.current + st.base, total: ayah.words.length, via });
      bumpDebug((n) => n + 1);
    };
    snapAt('stop');
    // evaluate(true) reads the session's text; finishAll()/stopRec() then drops the session.
    sess.stopAndGrade((via) => { snapAt(via); evaluate(true); });
  }

  function finishManual() {
    const credited = rest.length - manualWrong.size;
    finished.current = true;
    onFinish({ total: rest.length, credited, wrong: [...manualWrong].sort((a, b) => a - b), locked: false, corrected: 0, promptLen: effRef.current, extras: extra, ear: 'manual' });
  }

  const btn = 'w-full py-3 text-white font-bold rounded-xl disabled:opacity-50';
  return (
    <div className="space-y-3">
      {phase === 'idle' && (
        <>
          <p className="text-sm text-accent-700">هتسمع أول {eff.toLocaleString('ar-EG')} كلمات من آية بصوت القارئ، وبعدين كمّل الآية بصوتك.</p>
          <button onClick={() => void playPrompt()} className={`${btn} grad-amber-door`}>اسمع الكلمات</button>
          {/* Item 17.6 (c): optional feedback, both off by default. */}
          <div className="flex flex-wrap gap-2 justify-center text-xs">
            <button type="button" aria-pressed={buzz} onClick={() => { setRoundBuzz(!buzz); setBuzz(!buzz); }}
              className={`min-h-[44px] px-3 rounded-lg border ${buzz ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-accent-700 border-hairline'}`}>اهتزاز عند الغلط {buzz ? '✓' : ''}</button>
            <button type="button" aria-pressed={chime} onClick={() => { setRoundChime(!chime); setChime(!chime); }}
              className={`min-h-[44px] px-3 rounded-lg border ${chime ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-accent-700 border-hairline'}`}>رنّة لما الآية تخلص صح {chime ? '✓' : ''}</button>
          </div>
        </>
      )}
      {phase === 'prompting' && <p className="text-center text-accent-700 font-bold py-4">بنسمّعك الكلمات…</p>}
      {(phase === 'ready' || phase === 'afterCorr') && (
        <>
          {phase === 'afterCorr' && <p className="text-sm text-amber-800">سمعت التصحيح — كمّل الآية من الكلمة دي.</p>}
          {phase === 'ready' && <p className="text-sm text-accent-700">كمّل الآية من بعد الكلمات اللي سمعتها.</p>}
          <button onClick={startMic} className={`${btn} grad-emerald-door`}>كمّل بصوتك</button>
          {phase === 'ready' && <button onClick={() => void playPrompt()} className="w-full py-2 rounded-xl border border-emerald-300 text-emerald-800 font-bold">أعد سماع الكلمات</button>}
          {phase === 'ready' && canMore && (
            <button onClick={() => void moreWords()} className="w-full py-2 rounded-xl border border-amber-300 text-amber-800 font-bold">
              اديني كلمتين كمان <span className="text-xs font-normal">(بيخصم {(HINT_COST * 100).toLocaleString('ar-EG')}٪ من درجة الآية)</span>
            </button>
          )}
        </>
      )}
      {phase === 'listening' && (
        <>
          <p className="text-center text-emerald-700 font-bold py-3">بيسمعك… كمّل الآية ({heard.toLocaleString('ar-EG')} من {(rest.length - st.base).toLocaleString('ar-EG')} كلمة)</p>
          {/* Item 2.19: the round's rules, visible while reciting. */}
          <p className="text-xs text-accent-700 text-center">
            {st.corrLeft > 0
              ? `باقي لك تصحيح واحد. لو غلطت ومصلّحتش، القارئ يوقفك ${ROUND_CUT_LABEL[loadRoundCutMode()]}. غلطة تانية بعد التصحيح بتقفل الموضع.`
              : 'خلص التصحيح — غلطة تانية دلوقتي بتقفل الموضع.'}
          </p>
          {stuckAt !== null && stuckAt < rest.length && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-center space-y-2" role="status" aria-live="polite">
              <p className="text-sm font-bold text-amber-900">وقفت عند كلمة محتاجة تتصلّح — قولها تاني.</p>
              {hintShown
                ? <p className="text-sm text-accent-800">أولها حرف «<span className="font-arabic text-lg font-bold">{firstLetter(rest[stuckAt].orig)}</span>»</p>
                : <button type="button" onClick={() => setHintShown(true)} className="min-h-[44px] px-4 rounded-lg border border-amber-300 text-amber-900 font-bold text-sm">تلميح: أول حرف</button>}
            </div>
          )}
          {/* 4.25(ب): rounds do not count extra words; say so instead of hiding it. */}
          <p className="text-xs text-accent-600 text-center">في الجولات الكلمات الزيادة مش بتتحسب عليك — المهم تكمّل الآية صح.</p>
          <div className="grid grid-cols-3 gap-2">
            <button onClick={stopAndGrade} className={`${btn} grad-emerald-door col-span-2`}>خلصت</button>
            <button type="button" onClick={skipAyah} className="w-full py-3 rounded-xl border border-hairline text-accent-800 font-bold text-sm">تجاوز الآية</button>
          </div>
        </>
      )}
      {phase === 'grading' && <p className="text-center text-accent-700 font-bold py-4">بنراجع…</p>}
      {phase === 'correcting' && <p className="text-center text-amber-800 font-bold py-4">غلطة — القارئ بيصحّحلك الكلمة (مرة واحدة)…</p>}
      {phase === 'self' && (
        <>
          <p className="text-sm text-accent-700">التعرّف على الصوت مش شغّال على الجهاز ده، فقيّم نفسك: اضغط على الكلمات اللي غلطت فيها أو نسيتها.</p>
          <p className="font-arabic text-xl leading-loose text-accent-800">
            {rest.map((w, i) => (
              <button key={i} type="button" onClick={() => setManualWrong((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                className={`mx-0.5 px-1 rounded ${manualWrong.has(i) ? 'bg-rose-100 text-rose-700' : ''}`}>{w.orig}</button>
            ))}
          </p>
          <button onClick={finishManual} className={`${btn} grad-emerald-door`}>تمام</button>
        </>
      )}
      {msg && <p className="text-xs text-amber-700 text-center">{msg}</p>}
      <RoundDebugOverlay />
    </div>
  );
}

/** Item 17.5: the first Arabic letter of a word (diacritics and tatweel skipped). */
function firstLetter(word: string): string {
  const m = /[\u0621-\u063A\u0641-\u064A\u0671]/.exec(word);
  return m ? m[0] : '';
}

/** ?debug=1 only: which ear ran and the finals it had when «خلصت» was pressed. */
export function RoundDebugOverlay() {
  if (!roundDebugOn()) return null;
  const d = getRoundDebug();
  return (
    <div dir="ltr" className="fixed bottom-2 left-2 right-2 z-[60] rounded-lg bg-black/80 p-2 text-[11px] leading-snug text-green-300 font-mono pointer-events-none">
      {d ? (
        <>
          <div>kind: {d.kind} · start: {d.start}/{d.total} · via: {d.via}</div>
          <div className="break-words">finals: “{d.finals}”{d.interim ? ` · interim: “${d.interim}”` : ''}</div>
        </>
      ) : <div>debug: no stop yet</div>}
    </div>
  );
}

/** The ayah after a position: the prompt words grey, right words green, wrong red. */
export function RoundReveal({ ayah, result }: { ayah: PickedAyah; result: RoundResult }) {
  const wrong = new Set(result.wrong);
  return (
    <p className="font-arabic text-xl leading-loose">
      {ayah.words.map((w, i) => {
        const j = i - result.promptLen;
        const cls = j < 0 ? 'text-accent-400' : wrong.has(j) ? 'text-rose-700 font-bold' : 'text-emerald-700';
        return <span key={i} className={`${cls} mx-0.5`}>{w.orig}</span>;
      })}
    </p>
  );
}
