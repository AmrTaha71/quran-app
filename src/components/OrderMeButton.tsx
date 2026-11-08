// «اؤمرني»: one big mic on Home. Say what you want ("عايز أقرأ سورة
// الكهف", "عايز أسمع الملك", "سمّعلي الشمس", "المتشابهات") and the
// matching page opens. Not understood -> shows what was heard and
// asks again; nothing opens by guess. (2026-11-08)
import { useState } from 'react';
import { parseVoiceCommand, surahGlobalRange, surahName, type VoiceAction } from '../lib/voiceCommand';
import { pressFeedback } from '../lib/pressFeedback';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test' | 'listen' | 'adhkar' | 'room';

interface Props {
  onNavigate: (r: Route) => void;
  onMutashabihat: () => void;
  onElderly: () => void;
}

export default function OrderMeButton({ onNavigate, onMutashabihat, onElderly }: Props) {
  const [state, setState] = useState<'idle' | 'listening'>('idle');
  const [note, setNote] = useState('');
  const [askSurah, setAskSurah] = useState<number | null>(null);

  const run = (a: VoiceAction) => {
    try {
      if (a.kind === 'ask') {
        setAskSurah(a.surah);
        return;
      }
      if (a.kind === 'mushaf') {
        if (a.surah) localStorage.setItem('quran-mushaf-target', JSON.stringify({ surah: a.surah, ayah: 1 }));
        onNavigate('mushaf');
      } else if (a.kind === 'listen') {
        if (a.surah) sessionStorage.setItem('quran-listen-surah', String(a.surah));
        onNavigate('listen');
      } else if (a.kind === 'test') {
        if (a.surah) {
          const r = surahGlobalRange(a.surah);
          sessionStorage.setItem('quran-test-range-preset', JSON.stringify({ startGlobal: r.start, endGlobal: r.end, label: `سورة ${surahName(a.surah)}` }));
        }
        onNavigate('test');
      } else if (a.kind === 'mutashabihat') {
        onMutashabihat();
      } else if (a.kind === 'elderly') {
        onElderly();
      } else {
        onNavigate(a.route);
      }
    } catch { /* storage blocked: still navigate where possible */ }
  };

  const start = () => {
    const W = window as any;
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) { setNote('المتصفح ده مش بيدعم الأوامر بالصوت'); return; }
    try {
      const r = new Ctor();
      r.lang = 'ar-SA';
      r.interimResults = false;
      r.maxAlternatives = 3;
      let handled = false;
      r.onresult = (e: any) => {
        const res = e?.results?.[0];
        const alts: string[] = [];
        for (let i = 0; res && i < res.length; i++) alts.push(String(res[i]?.transcript || ''));
        for (const t of alts) {
          const a = parseVoiceCommand(t);
          if (a) { handled = true; setNote(''); run(a); return; }
        }
        handled = true;
        setNote(`سمعت: «${alts[0] || ''}» — ما فهمتش، قول تاني. مثال: عايز أقرأ سورة الكهف`);
      };
      r.onerror = () => { setState('idle'); };
      r.onend = () => {
        setState('idle');
        if (!handled) setNote('ما سمعتش حاجة، دوس وقول طلبك');
      };
      setNote('');
      setState('listening');
      r.start();
    } catch {
      setState('idle');
    }
  };

  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <button
        type="button"
        onPointerDown={pressFeedback}
        onClick={start}
        aria-label="اؤمرني"
        className={`group relative w-full max-w-md flex items-center gap-4 px-5 py-4 rounded-3xl shadow-xl polish-press transition-transform ${state === 'listening' ? 'bg-gradient-to-l from-rose-700 to-rose-900 scale-[1.02]' : 'bg-gradient-to-l from-[#0f5c4d] via-[#12705d] to-[#0b3f37]'}`}
      >
        <VintageMic listening={state === 'listening'} />
        <span className="flex-1 text-right">
          <span className="block text-3xl font-bold font-display-ar text-[#f6d27a] drop-shadow">{state === 'listening' ? 'بسمعك…' : 'اؤمرني'}</span>
          <span className="block text-sm text-[#f3ead7]/90 mt-1">{state === 'listening' ? 'قول دلوقتي…' : 'قول لي عايز تعمل إيه، وأنا أفتحهولك'}</span>
        </span>
      </button>
      {askSurah && (
        <div className="w-full max-w-md bg-white rounded-2xl border-2 border-amber-300 p-3 space-y-2" dir="rtl">
          <p className="text-center font-bold text-accent-900">عايز تعمل إيه في سورة {surahName(askSurah)}؟</p>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => { const s0 = askSurah; setAskSurah(null); run({ kind: 'mushaf', surah: s0 }); }} className="min-h-[48px] rounded-xl bg-emerald-600 text-white font-bold">أقرأها</button>
            <button type="button" onClick={() => { const s0 = askSurah; setAskSurah(null); run({ kind: 'listen', surah: s0 }); }} className="min-h-[48px] rounded-xl bg-emerald-600 text-white font-bold">أسمعها</button>
            <button type="button" onClick={() => { const s0 = askSurah; setAskSurah(null); run({ kind: 'test', surah: s0 }); }} className="min-h-[48px] rounded-xl bg-amber-500 text-white font-bold">سمّعها لي</button>
          </div>
        </div>
      )}
      {state !== 'listening' && !note && !askSurah && (
        <p className="text-center text-xs text-accent-600">قول: «اقرأ الكهف» • «اسمع الملك» • «سمّعلي الشمس» • «المتشابهات» — أو قول اسم السورة بس وأنا أسألك</p>
      )}
      {note && <p className="text-center text-sm text-accent-700 bg-white/80 rounded-xl px-3 py-2">{note}</p>}
    </div>
  );
}

// Chrome studio microphone (drawn here, in the style of a classic
// tilted stage mic: rounded capsule, slotted grille, holder ring).
function VintageMic({ listening }: { listening: boolean }) {
  return (
    <svg viewBox="0 0 100 120" className={`w-28 h-32 shrink-0 drop-shadow-xl ${listening ? 'animate-pulse' : ''}`} aria-hidden="true">
      <defs>
        <linearGradient id="vmChrome" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5b5f6a" />
          <stop offset="0.25" stopColor="#f4f6fb" />
          <stop offset="0.5" stopColor="#b9bfcc" />
          <stop offset="0.75" stopColor="#ffffff" />
          <stop offset="1" stopColor="#6b7080" />
        </linearGradient>
        <linearGradient id="vmGlow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6d27a" />
          <stop offset="1" stopColor="#c58a1f" />
        </linearGradient>
      </defs>
      <g transform="rotate(-20 50 60)">
        <rect x="28" y="4" width="44" height="66" rx="22" fill="url(#vmChrome)" stroke="url(#vmGlow)" strokeWidth="2.5" />
        {[14, 21, 28, 35, 42, 49, 56].map((y) => (
          <rect key={y} x="35" y={y} width="30" height="3.4" rx="1.7" fill="#1f2937" opacity="0.75" />
        ))}
        <rect x="40" y="70" width="20" height="10" rx="3" fill="url(#vmChrome)" />
        <rect x="34" y="78" width="32" height="14" rx="4" fill="url(#vmChrome)" stroke="url(#vmGlow)" strokeWidth="2" />
        <rect x="45" y="92" width="10" height="26" fill="url(#vmChrome)" />
        {listening && <circle cx="50" cy="37" r="40" fill="none" stroke="#fecdd3" strokeWidth="2" opacity="0.8" />}
      </g>
    </svg>
  );
}
