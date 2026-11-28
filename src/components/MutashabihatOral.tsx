import MicIcon from './icons/MicIcon';
// Oral mutashabihat question (W4-F, reworked W4-J): the clue is shown, the user
// SAYS the ayat that contain it, one ayah per tap, by voice (no typing, no ayah
// numbers, and the question never names a surah). An ayah counts when most of its
// words are heard (>= 75%). At the end each ayah said gets «في أي سورة؟» (2 of the
// question's 10; the ayat themselves are 8).
import { useEffect, useMemo, useRef, useState } from 'react';
import { expectedWordList } from '../lib/expectedWords';
import { alignSpoken } from '../lib/alignBridge';
import { createRecognizer, readResults, type Rec } from '../lib/voiceCapture';
import { speechErrorMessage } from '../lib/speechErrors';
import { earLabOn, preloadEarLab } from '../lib/quranLabEar';
import { setExtraWordMin } from '../lib/phonemeEar';
import { surahLabel } from '../lib/surahs';
import { countAyat } from './MutashabihatGame';
import SurahTiles from './SurahTiles';
import { wordsAfterClue } from '../lib/mutHint';
import { HINT_COST, HINT_WORDS, MAX_HINTS } from '../lib/roundTest';

const PASS = 0.75;

export type OralResult = { found: number; surahRight: number; hints: number };
type Phase = 'say' | 'surah' | 'review';
const keyParts = (k: string) => k.split(':').map(Number) as [number, number];

export default function MutashabihatOral({ clue, answers, text, onDone }: {
  clue: string;
  answers: string[];
  text: Map<string, string> | null;
  /** found = ayat said right out of answers.length; surahRight = surah names right. */
  onDone: (res: OralResult) => void;
}) {
  const [found, setFound] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [grading, setGrading] = useState(false);
  const [msg, setMsg] = useState('');
  const [selfMode, setSelfMode] = useState(false);
  const [phase, setPhase] = useState<Phase>('say');
  const [queue, setQueue] = useState<string[]>([]);
  const [qi, setQi] = useState(0);
  const [surahOk, setSurahOk] = useState<Record<string, boolean>>({});
  // «اديني كلمتين كمان»: words after the clue in the next ayah not said yet (text only, no names).
  const [hintWords, setHintWords] = useState<Record<string, number>>({});
  const [hints, setHints] = useState(0);
  const recRef = useRef<Rec | null>(null);
  const finals = useRef('');
  const interim = useRef('');

  useEffect(() => { if (earLabOn()) preloadEarLab(); }, []);
  useEffect(() => () => { const r = recRef.current; recRef.current = null; if (r) { r.onresult = null; r.onend = null; r.onerror = null; try { r.abort(); } catch { /* ignore */ } } }, []);

  const words = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const k of answers) { const [s, a] = k.split(':'); m.set(k, expectedWordList(text?.get(`${s}:${a}`) ?? '').map((w) => w.norm)); }
    return m;
  }, [answers, text]);
  const left = answers.filter((k) => !found.includes(k));
  const short = (k: string) => expectedWordList(text?.get(k) ?? '').slice(0, 9).map((w) => w.orig).join(' ');

  function toSurahPhase(list: string[]) {
    if (list.length === 0) { setPhase('review'); return; }
    setQueue(list); setQi(0); setPhase('surah');
  }

  function moreWords() {
    const k = left[0];
    if (!k || hints >= MAX_HINTS) return;
    const n = (hintWords[k] ?? 0) + HINT_WORDS;
    if (!wordsAfterClue(clue, text?.get(k) ?? '', n)) { setMsg('مفيش كلمات زيادة نديك إياها في الآية دي.'); return; }
    setHintWords({ ...hintWords, [k]: n });
    setHints(hints + 1);
    setMsg('');
  }

  function begin() {
    setMsg('');
    finals.current = ''; interim.current = '';
    const expected = left.flatMap((k) => words.get(k) ?? []);
    const made = createRecognizer(expected);
    if (!made || expected.length === 0) { setSelfMode(true); return; }
    setExtraWordMin(Infinity);
    const { rec } = made;
    recRef.current = rec;
    rec.onresult = (e) => { if (recRef.current !== rec) return; const r = readResults(e, finals.current); finals.current = r.finals; interim.current = r.interim; };
    rec.onerror = (e) => {
      const m = speechErrorMessage(e?.error);
      if (m) setMsg(m.text);
      if (m?.fatal || (made.kind === 'lab' && (e?.error === 'model-load' || e?.error === 'network'))) { recRef.current = null; setListening(false); setSelfMode(true); }
    };
    try { rec.start(); } catch { /* ignore */ }
    setListening(true);
  }

  function grade() {
    let best = '', bestRatio = 0;
    for (const k of left) {
      const w = words.get(k) ?? [];
      if (w.length === 0) continue;
      const al = alignSpoken(w, `${finals.current} ${interim.current}`);
      const ratio = al.matched.filter(Boolean).length / w.length;
      if (ratio > bestRatio) { best = k; bestRatio = ratio; }
    }
    setGrading(false);
    if (best && bestRatio >= PASS) {
      const next = [...found, best];
      setFound(next);
      setMsg('');
      if (next.length === answers.length) toSurahPhase(next);
    } else {
      setMsg('ما اتعرّفتش على آية كاملة — جرّب تسمّع آية واحدة بوضوح.');
    }
  }

  function stop() {
    setListening(false);
    setGrading(true);
    const r = recRef.current;
    if (!r) { grade(); return; }
    let done = false;
    const go = () => { if (done) return; done = true; recRef.current = null; grade(); };
    r.onend = go;
    setTimeout(go, 2500);
    try { r.stop(); } catch { go(); }
  }

  const finishAll = () => onDone({ found: found.length, surahRight: Object.values(surahOk).filter(Boolean).length, hints });
  const finishSelf = (list: string[]) => { setFound(list); toSurahPhase(list); };

  // No recognizer on the device: the user says them aloud, then ticks what he got.
  const [ticked, setTicked] = useState<string[]>([]);
  if (phase === 'surah') {
    const k = queue[qi];
    return (
      <div className="space-y-3">
        <p className="text-sm text-accent-700">الآية اللي قلتها:</p>
        <p className="font-arabic text-xl leading-loose text-accent-800">{short(k)}…</p>
        <SurahTiles key={k} correct={keyParts(k)[0]} onAnswer={(sn) => {
          setSurahOk((o) => ({ ...o, [k]: sn === keyParts(k)[0] }));
          if (qi + 1 < queue.length) setQi(qi + 1); else setPhase('review');
        }} />
      </div>
    );
  }
  if (phase === 'review') {
    return (
      <div className="space-y-2">
        {answers.map((k) => {
          const [s, a] = keyParts(k);
          const said = found.includes(k);
          return (
            <p key={k} className="text-sm text-accent-800">
              {surahLabel(s)} — آية {a.toLocaleString('ar-EG')}: {said ? '✓ قلتها' : '✗ ما قلتهاش'}{said ? (surahOk[k] ? ' · السورة ✓' : ' · السورة ✗') : ''}
            </p>
          );
        })}
        <button onClick={finishAll} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">كمّل</button>
      </div>
    );
  }
  if (selfMode) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-accent-700">التعرّف على الصوت مش شغّال على الجهاز ده: سمّع الآيات بصوتك، وبعدين علّم اللي قلتها صح.</p>
        {answers.map((k) => (
          <button key={k} type="button" onClick={() => setTicked((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]))}
            className={`w-full text-right py-3 px-4 rounded-xl border font-arabic ${ticked.includes(k) ? 'bg-emerald-50 border-emerald-400 text-emerald-800' : 'bg-white border-hairline-emerald text-accent-700'}`}>
            {ticked.includes(k) ? '✓ ' : '○ '}{short(k)}…
          </button>
        ))}
        <button onClick={() => finishSelf(ticked)} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">تمام</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-gray-50 rounded-lg p-4 border border-emerald-100">
        <p className="font-arabic text-xl text-accent-800 leading-loose">{clue}</p>
      </div>
      <p className="text-sm text-accent-700">الجملة دي في {countAyat(answers.length)}. كمّل كل آية بصوتك — آية آية.</p>
      {found.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {found.map((k, i) => <span key={k} className="px-3 py-1 rounded-full bg-emerald-700 text-white text-sm font-bold">✓ الآية {(i + 1).toLocaleString('ar-EG')}</span>)}
        </div>
      )}
      {answers.map((k, i) => (hintWords[k] && !found.includes(k)
        ? <p key={k} className="font-arabic text-lg text-amber-800">الآية {(i + 1).toLocaleString('ar-EG')}: … {wordsAfterClue(clue, text?.get(k) ?? '', hintWords[k])}</p> : null))}
      {listening ? (
        <button onClick={stop} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">خلصت الآية</button>
      ) : grading ? (
        <p className="text-center text-accent-700 font-bold py-3">بنراجع…</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={begin} className="py-3 grad-emerald-door text-white font-bold rounded-xl flex items-center justify-center gap-2"><MicIcon className="w-6 h-6" />سمّع آية</button>
          {text && left.length > 0 && hints < MAX_HINTS && (
            <button onClick={moreWords} className="col-span-2 order-last py-2 rounded-xl border border-amber-300 text-amber-800 font-bold">
              اديني كلمتين كمان <span className="text-xs font-normal">(بيخصم {(HINT_COST * 100).toLocaleString('ar-EG')}٪ من درجة الآيات)</span>
            </button>
          )}
          <button onClick={() => toSurahPhase(found)} className="py-3 bg-gray-100 text-accent-700 font-bold rounded-xl">{found.length > 0 ? 'كفاية كده' : 'مش فاكر'}</button>
        </div>
      )}
      {listening && <p className="text-xs text-emerald-700 text-center">بيسمعك…</p>}
      {msg && <p className="text-xs text-amber-700 text-center">{msg}</p>}
    </div>
  );
}
