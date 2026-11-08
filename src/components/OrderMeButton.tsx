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

  const run = (a: VoiceAction) => {
    try {
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
      {state !== 'listening' && !note && (
        <p className="text-center text-xs text-accent-600">مثال: «عايز أقرأ سورة الكهف» • «عايز أسمع سورة الملك» • «سمّعلي الشمس»</p>
      )}
      {note && <p className="text-center text-sm text-accent-700 bg-white/80 rounded-xl px-3 py-2">{note}</p>}
    </div>
  );
}

// Classic 1960s broadcast microphone (capsule head with grille, ring
// mount, short stand), tilted like a radio-studio mic. Gold on green.
function VintageMic({ listening }: { listening: boolean }) {
  return (
    <svg viewBox="0 0 80 100" className={`w-20 h-24 shrink-0 drop-shadow-lg ${listening ? 'animate-pulse' : ''}`} aria-hidden="true">
      <defs>
        <linearGradient id="vmGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1c1" />
          <stop offset="0.45" stopColor="#e9b949" />
          <stop offset="1" stopColor="#9a6a12" />
        </linearGradient>
        <linearGradient id="vmHead" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3b3b3b" />
          <stop offset="0.5" stopColor="#9a9a9a" />
          <stop offset="1" stopColor="#2d2d2d" />
        </linearGradient>
      </defs>
      <g transform="rotate(-18 40 50)">
        {/* capsule head */}
        <rect x="24" y="6" width="32" height="46" rx="16" fill="url(#vmHead)" stroke="url(#vmGold)" strokeWidth="3" />
        {[14, 20, 26, 32, 38, 44].map((y) => (
          <line key={y} x1="27" y1={y} x2="53" y2={y} stroke="#1e1e1e" strokeWidth="1.6" opacity="0.7" />
        ))}
        <rect x="22" y="27" width="36" height="6" rx="3" fill="url(#vmGold)" />
        {/* yoke */}
        <path d="M18 30 Q18 62 40 62 Q62 62 62 30" fill="none" stroke="url(#vmGold)" strokeWidth="4" strokeLinecap="round" />
        {/* stand */}
        <rect x="37" y="62" width="6" height="22" fill="url(#vmGold)" />
        <ellipse cx="40" cy="88" rx="18" ry="5" fill="url(#vmGold)" />
        {listening && <circle cx="40" cy="29" r="30" fill="none" stroke="#fecdd3" strokeWidth="2" opacity="0.7" />}
      </g>
    </svg>
  );
}
