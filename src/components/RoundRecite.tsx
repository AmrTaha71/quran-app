// One «سمّعني»-style position (W4-E): the reciter says the first 5 words of an
// ayah, the user completes it by voice. Same ear as the tasmee' test (the
// device ear when loaded, else the browser's) and the same word alignment
// (alignWords). Optional corrections: the reciter says the wrong word ONCE and
// the user goes on from it; the next mistake closes the position.
import { useEffect, useMemo, useRef, useState } from 'react';
import { earLabOn, preloadEarLab } from '../lib/quranLabEar';
import { createRecognizer, readResults, type Rec } from '../lib/voiceCapture';
import { setExtraWordMin } from '../lib/phonemeEar';
import { alignSpoken } from '../lib/alignBridge';
import { speechErrorMessage } from '../lib/speechErrors';
import { playSpan, type SpanHandle } from '../lib/spanPlayer';
import { reciterAyahUrl } from '../lib/juhaniCorr';
import { firstMistake, PROMPT_WORDS, type PickedAyah, type RoundResult } from '../lib/roundTest';

type Phase = 'idle' | 'prompting' | 'ready' | 'listening' | 'grading' | 'correcting' | 'afterCorr' | 'self';
const QUIET_MS = 1800;

export default function RoundRecite({ ayah, corrections, onFinish }: {
  ayah: PickedAyah;
  /** 0 = no correction (tarteel); 1 = the reciter corrects once (comprehensive). */
  corrections: number;
  onFinish: (r: RoundResult) => void;
}) {
  const rest = useMemo(() => ayah.words.slice(PROMPT_WORDS), [ayah]);
  const restNorms = useMemo(() => rest.map((w) => w.norm), [rest]);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const [msg, setMsg] = useState('');
  const [heard, setHeard] = useState(0);
  const [manualWrong, setManualWrong] = useState<Set<number>>(new Set());

  const base = useRef(0);
  const got = useRef<boolean[]>(new Array(rest.length).fill(false));
  const mistaken = useRef<Set<number>>(new Set());
  const corrLeft = useRef(corrections);
  const recRef = useRef<Rec | null>(null);
  const kindRef = useRef<'lab' | 'browser' | 'manual'>('manual');
  const finals = useRef('');
  const interim = useRef('');
  const quietT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audio = useRef<SpanHandle | null>(null);
  const finished = useRef(false);

  useEffect(() => { if (earLabOn()) preloadEarLab(); }, []);
  useEffect(() => () => {
    finished.current = true;
    if (quietT.current) clearTimeout(quietT.current);
    audio.current?.cancel();
    const r = recRef.current; recRef.current = null;
    if (r) { r.onresult = null; r.onend = null; r.onerror = null; try { r.abort(); } catch { /* ignore */ } }
  }, []);

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
    await span(Math.max(0, t[0] - 0.25), t[2 * (PROMPT_WORDS - 1) + 1] + 0.15);
    if (!finished.current) setPhase('ready');
  }

  async function playCorrection() {
    setPhase('correcting');
    const abs = PROMPT_WORDS + base.current;
    const nextW = Math.min(abs + 1, ayah.words.length - 1);
    await span(Math.max(0, t[2 * abs] - 0.1), t[2 * nextW + 1] + 0.1);
    if (!finished.current) setPhase('afterCorr');
  }

  function stopRec(flush = false) {
    if (quietT.current) { clearTimeout(quietT.current); quietT.current = null; }
    const r = recRef.current;
    if (!r) return;
    if (!flush) { recRef.current = null; r.onresult = null; r.onend = null; r.onerror = null; try { r.abort(); } catch { /* ignore */ } }
    else { try { r.stop(); } catch { /* ignore */ } }
  }

  function creditUpTo(matched: boolean[], limit: number) {
    for (let k = 0; k < limit && k < matched.length; k++) {
      const idx = base.current + k;
      if (matched[k] && !mistaken.current.has(idx)) got.current[idx] = true;
    }
  }

  function finishAll(locked: boolean) {
    if (finished.current) return;
    finished.current = true;
    stopRec();
    const credited = got.current.filter(Boolean).length;
    const wrong: number[] = [];
    got.current.forEach((g, i) => { if (!g) wrong.push(i); });
    onFinish({ total: rest.length, credited, wrong, locked, corrected: mistaken.current.size, ear: kindRef.current });
  }

  function evaluate(final: boolean) {
    if (finished.current) return;
    const exp = restNorms.slice(base.current);
    const al = alignSpoken(exp, `${finals.current} ${interim.current}`);
    setHeard(al.matched.filter(Boolean).length);
    const m = firstMistake(al.matched);
    if (m >= 0) {
      creditUpTo(al.matched, m);
      if (corrLeft.current > 0) {
        corrLeft.current -= 1;
        mistaken.current.add(base.current + m);
        stopRec();
        base.current += m;
        void playCorrection();
      } else {
        finishAll(true); // the 2nd mistake closes the position
      }
      return;
    }
    if (al.allMatched || final) {
      creditUpTo(al.matched, al.matched.length);
      finishAll(false);
    }
  }

  function startMic() {
    setMsg('');
    finals.current = '';
    interim.current = '';
    const made = createRecognizer(restNorms.slice(base.current));
    if (!made) { kindRef.current = 'manual'; setPhase('self'); return; }
    const { rec, kind } = made;
    kindRef.current = kind;
    setExtraWordMin(Infinity);
    recRef.current = rec;
    rec.onresult = (e) => {
      if (recRef.current !== rec) return;
      const r = readResults(e, finals.current);
      finals.current = r.finals;
      interim.current = r.interim;
      if (phaseRef.current !== 'listening') return;
      if (quietT.current) clearTimeout(quietT.current);
      quietT.current = setTimeout(() => evaluate(false), QUIET_MS);
    };
    rec.onerror = (e) => {
      if (recRef.current !== rec) return;
      if (kind === 'lab' && e?.error === 'network') {
        setMsg('تعذّر تحميل برنامج التعرّف على الصوت — قيّم نفسك بإيدك');
        stopRec(); kindRef.current = 'manual'; setPhase('self'); return;
      }
      const m = speechErrorMessage(e?.error);
      if (m) setMsg(m.text);
      if (m?.fatal) { stopRec(); kindRef.current = 'manual'; setPhase('self'); }
    };
    // The browser engine ends by itself after a silence: keep it open while we wait.
    rec.onend = () => {
      if (kind === 'browser' && recRef.current === rec && phaseRef.current === 'listening') { try { rec.start(); } catch { /* ignore */ } }
    };
    try { rec.start(); } catch { /* ignore */ }
    setPhase('listening');
  }

  function stopAndGrade() {
    setPhase('grading');
    const r = recRef.current;
    if (!r) { evaluate(true); return; }
    let done = false;
    const go = () => { if (done) return; done = true; recRef.current = null; evaluate(true); };
    r.onend = go;
    setTimeout(go, 2500);
    stopRec(true);
  }

  function finishManual() {
    const credited = rest.length - manualWrong.size;
    finished.current = true;
    onFinish({ total: rest.length, credited, wrong: [...manualWrong].sort((a, b) => a - b), locked: false, corrected: 0, ear: 'manual' });
  }

  const btn = 'w-full py-3 text-white font-bold rounded-xl disabled:opacity-50';
  return (
    <div className="space-y-3">
      {phase === 'idle' && (
        <>
          <p className="text-sm text-accent-700">هتسمع أول {PROMPT_WORDS.toLocaleString('ar-EG')} كلمات من آية بصوت القارئ، وبعدين كمّل الآية بصوتك.</p>
          <button onClick={() => void playPrompt()} className={`${btn} grad-amber-door`}>اسمع الكلمات</button>
        </>
      )}
      {phase === 'prompting' && <p className="text-center text-accent-700 font-bold py-4">بنسمّعك الكلمات…</p>}
      {(phase === 'ready' || phase === 'afterCorr') && (
        <>
          {phase === 'afterCorr' && <p className="text-sm text-amber-800">سمعت التصحيح — كمّل الآية من الكلمة دي.</p>}
          {phase === 'ready' && <p className="text-sm text-accent-700">كمّل الآية من بعد الكلمات اللي سمعتها.</p>}
          <button onClick={startMic} className={`${btn} grad-emerald-door`}>كمّل بصوتك</button>
          {phase === 'ready' && <button onClick={() => void playPrompt()} className="w-full py-2 rounded-xl border border-emerald-300 text-emerald-800 font-bold">أعد سماع الكلمات</button>}
        </>
      )}
      {phase === 'listening' && (
        <>
          <p className="text-center text-emerald-700 font-bold py-3">بيسمعك… كمّل الآية ({heard.toLocaleString('ar-EG')} من {(rest.length - base.current).toLocaleString('ar-EG')} كلمة)</p>
          <button onClick={stopAndGrade} className={`${btn} grad-emerald-door`}>خلصت</button>
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
    </div>
  );
}

/** The ayah after a position: the 5 prompt words grey, right words green, wrong red. */
export function RoundReveal({ ayah, result }: { ayah: PickedAyah; result: RoundResult }) {
  const wrong = new Set(result.wrong);
  return (
    <p className="font-arabic text-xl leading-loose">
      {ayah.words.map((w, i) => {
        const j = i - PROMPT_WORDS;
        const cls = j < 0 ? 'text-accent-400' : wrong.has(j) ? 'text-rose-700 font-bold' : 'text-emerald-700';
        return <span key={i} className={`${cls} mx-0.5`}>{w.orig}</span>;
      })}
    </p>
  );
}
