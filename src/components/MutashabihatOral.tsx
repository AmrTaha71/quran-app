// Oral mutashabihat question (W4-F): the clue is shown, the user SAYS the
// ayat that contain it, one ayah per tap, by voice (no typing, no ayah numbers).
// An ayah counts when most of its words are heard (>= 75%).
import { useEffect, useMemo, useRef, useState } from 'react';
import { expectedWordList } from '../lib/expectedWords';
import { alignSpoken } from '../lib/alignBridge';
import { createRecognizer, readResults, type Rec } from '../lib/voiceCapture';
import { speechErrorMessage } from '../lib/speechErrors';
import { earLabOn, preloadEarLab } from '../lib/quranLabEar';
import { setExtraWordMin } from '../lib/phonemeEar';
import { surahLabel } from '../lib/surahs';
import { countAyat } from './MutashabihatGame';

const PASS = 0.75;

export default function MutashabihatOral({ clue, answers, text, onDone }: {
  clue: string;
  answers: string[];
  text: Map<string, string> | null;
  /** found = ayat said right out of answers.length */
  onDone: (found: number) => void;
}) {
  const [found, setFound] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [grading, setGrading] = useState(false);
  const [msg, setMsg] = useState('');
  const [selfMode, setSelfMode] = useState(false);
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
      if (m?.fatal || (made.kind === 'lab' && e?.error === 'network')) { recRef.current = null; setListening(false); setSelfMode(true); }
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
      if (next.length === answers.length) onDone(next.length);
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

  // No recognizer on the device: the user says them aloud, then ticks what he got.
  const [ticked, setTicked] = useState<string[]>([]);
  if (selfMode) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-accent-700">التعرّف على الصوت مش شغّال على الجهاز ده: سمّع الآيات بصوتك، وبعدين علّم اللي قلتها صح.</p>
        {answers.map((k) => {
          const [s, a] = k.split(':').map(Number);
          return (
            <button key={k} type="button" onClick={() => setTicked((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]))}
              className={`w-full text-right py-3 px-4 rounded-xl border ${ticked.includes(k) ? 'bg-emerald-50 border-emerald-400 text-emerald-800' : 'bg-white border-hairline-emerald text-accent-700'}`}>
              {ticked.includes(k) ? '✓ ' : '○ '}{surahLabel(s)} — آية {a}
            </button>
          );
        })}
        <button onClick={() => onDone(ticked.length)} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">تمام</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-gray-50 rounded-lg p-4 border border-emerald-100">
        <p className="font-arabic text-xl text-accent-800 leading-loose">{clue}</p>
      </div>
      <p className="text-sm text-accent-700">الجملة دي في {countAyat(answers.length)}. سمّع الآيات — آية آية.</p>
      {found.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {found.map((k) => { const [s, a] = k.split(':').map(Number); return <span key={k} className="px-3 py-1 rounded-full bg-emerald-600 text-white text-sm font-bold">{surahLabel(s)} {a.toLocaleString('ar-EG')}</span>; })}
        </div>
      )}
      {listening ? (
        <button onClick={stop} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">خلصت الآية</button>
      ) : grading ? (
        <p className="text-center text-accent-700 font-bold py-3">بنراجع…</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={begin} className="py-3 grad-emerald-door text-white font-bold rounded-xl">سمّع آية</button>
          <button onClick={() => onDone(found.length)} className="py-3 bg-gray-100 text-accent-700 font-bold rounded-xl">مش فاكر</button>
        </div>
      )}
      {listening && <p className="text-xs text-emerald-700 text-center">بيسمعك…</p>}
      {msg && <p className="text-xs text-amber-700 text-center">{msg}</p>}
    </div>
  );
}
