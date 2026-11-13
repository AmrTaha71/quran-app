import { useEffect, useRef, useState } from 'react';
import { makeChallenges, startAlarmTone, type FajrAlarmMode } from '../lib/fajrAlarm';

// Full-screen Fajr alarm. 'smart': stopping only mutes for 60 s, then it
// rings again; it ends only when all three challenges are solved.
export default function FajrAlarmOverlay({ mode, onDone }: { mode: FajrAlarmMode; onDone: () => void }) {
  const [chs, setChs] = useState(() => makeChallenges());
  const [step, setStep] = useState(0);
  const [val, setVal] = useState('');
  const [wrong, setWrong] = useState(false);
  const [muted, setMuted] = useState(false);
  const [left, setLeft] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!muted) { stopRef.current = startAlarmTone(); return () => stopRef.current?.(); }
    stopRef.current?.();
    setLeft(60);
    const t = window.setInterval(() => setLeft((l) => {
      if (l <= 1) { window.clearInterval(t); setMuted(false); return 0; }
      return l - 1;
    }), 1000);
    return () => window.clearInterval(t);
  }, [muted]);

  const ch = chs[step];
  const next = () => {
    setVal(''); setWrong(false);
    if (step >= 2) { stopRef.current?.(); onDone(); } else setStep(step + 1);
  };
  const fail = () => { setWrong(true); setChs(makeChallenges()); setVal(''); };
  const submit = () => {
    if (ch.kind === 'math') return val.trim() === ch.answer ? next() : fail();
    if (ch.kind === 'code') return val.trim() === ch.code ? next() : fail();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-emerald-900 text-white flex flex-col items-center justify-center p-6" dir="rtl">
      <p className="text-3xl font-bold mb-1">⏰ حان وقت الفجر</p>
      {mode === 'simple' ? (
        <button onClick={() => { stopRef.current?.(); onDone(); }} className="mt-8 px-10 py-4 bg-white text-emerald-800 text-xl font-bold rounded-2xl">إيقاف المنبه</button>
      ) : (
        <>
          <p className="text-emerald-100 mb-4">حلّ الأسئلة الثلاثة ({step + 1}/3) عشان المنبه يقف</p>
          <div className="w-full max-w-sm bg-white text-accent-800 rounded-2xl p-5 text-center">
            {ch.kind === 'math' && (<><p className="mb-2 font-bold">كم ناتج:</p><p className="text-3xl font-bold mb-3" dir="ltr">{ch.q}</p></>)}
            {ch.kind === 'code' && (<><p className="mb-2 font-bold">اكتب الرقم التالي:</p><p className="text-4xl font-bold tracking-widest mb-3" dir="ltr">{ch.code}</p></>)}
            {ch.kind === 'odd' && (
              <>
                <p className="mb-3 font-bold">اختر الشكل المختلف:</p>
                <div className="grid grid-cols-4 gap-2">
                  {ch.items.map((it, i) => (
                    <button key={i} onClick={() => (i === ch.odd ? next() : fail())} className="text-4xl py-3 bg-gray-100 rounded-xl">{it}</button>
                  ))}
                </div>
              </>
            )}
            {ch.kind !== 'odd' && (
              <>
                <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="numeric" dir="ltr"
                  className="w-full text-center text-2xl border-2 border-emerald-300 rounded-xl p-2 mb-3" />
                <button onClick={submit} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">تأكيد</button>
              </>
            )}
            {wrong && <p className="text-red-600 font-bold mt-3">إجابة غلط — سؤال جديد</p>}
          </div>
          <button onClick={() => setMuted(true)} disabled={muted} className="mt-5 px-6 py-2 bg-emerald-700 rounded-xl text-sm disabled:opacity-60">
            {muted ? `هيرن تاني بعد ${left} ث` : 'كتم دقيقة (هيرن تاني)'}
          </button>
        </>
      )}
    </div>
  );
}
