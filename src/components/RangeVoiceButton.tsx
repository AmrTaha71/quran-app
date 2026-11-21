// «قول النطاق بصوتك» (W4-M): one-shot browser speech recognition -> parseRangeSpeech.
// Only the browser engine is used (the device ear is built for known ayat, not free
// words). Where it is missing the button says so and the drum stays the way to pick.
import { useEffect, useRef, useState } from 'react';
import { parseRangeSpeech, type MutRange } from '../lib/mutRange';
import { speechErrorMessage } from '../lib/speechErrors';

type SR = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null; onerror: ((e: { error?: string }) => void) | null; onend: (() => void) | null; start(): void; stop(): void; abort(): void };

export default function RangeVoiceButton({ onRange, allowAll = true }: { onRange: (r: MutRange) => void; allowAll?: boolean }) {
  const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState('');
  const ref = useRef<SR | null>(null);
  useEffect(() => () => { const r = ref.current; ref.current = null; if (r) { r.onresult = null; r.onend = null; r.onerror = null; try { r.abort(); } catch { /* ignore */ } } }, []);

  if (!Ctor) return <p className="text-xs text-accent-600">طلب النطاق بالصوت مش متاح على الجهاز ده — اختار بالبكرة.</p>;

  function start() {
    setMsg('');
    const r = new Ctor!();
    r.lang = 'ar-SA'; r.continuous = false; r.interimResults = false;
    ref.current = r;
    let heard = '';
    r.onresult = (e) => { heard = Array.from(e.results).map((x) => x[0]?.transcript ?? '').join(' '); };
    r.onerror = (e) => { const m = speechErrorMessage(e?.error); if (m) setMsg(m.text); };
    r.onend = () => {
      setOn(false);
      ref.current = null;
      if (!heard) { setMsg((m) => m || 'ما سمعتش حاجة — جرّب تاني.'); return; }
      const res = parseRangeSpeech(heard);
      if (!res || (!allowAll && res.scope === 'all')) setMsg(`ما فهمتش النطاق («${heard}»). قول مثلاً: سورة الكهف أو الجزء ٣٠ — أو اختار بالبكرة.`);
      else onRange(res);
    };
    try { r.start(); setOn(true); } catch { setMsg('تعذّر تشغيل الميكروفون — اختار بالبكرة.'); }
  }

  return (
    <div className="space-y-1">
      <button type="button" onClick={on ? () => ref.current?.stop() : start}
        className={`w-full min-h-[44px] rounded-xl border font-bold ${on ? 'bg-rose-50 border-rose-300 text-rose-700' : 'border-emerald-300 text-emerald-800'}`}>
        {on ? 'بيسمعك… اضغط لما تخلّص' : '🎤 قول النطاق بصوتك'}
      </button>
      {msg && <p className="text-xs text-amber-700">{msg}</p>}
    </div>
  );
}
