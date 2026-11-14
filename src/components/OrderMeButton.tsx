// «اؤمرني»: one big mic on Home. Say what you want ("عايز أقرأ سورة
// الكهف", "عايز أسمع الملك", "سمّعلي الشمس", "المتشابهات") and the
// matching page opens. Not understood -> shows what was heard and
// asks again; nothing opens by guess. (2026-11-08)
import { useEffect, useState } from 'react';
import Hint from './Hint';
import { pressFeedback } from '../lib/pressFeedback';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test' | 'listen' | 'adhkar' | 'room';

interface Props {
  onNavigate: (r: Route) => void;
  onMutashabihat: () => void;
  onElderly: () => void;
}

export default function OrderMeButton({ onMutashabihat, onElderly }: Props) {
  const [on, setOn] = useState(false);

  // The conversation itself lives in <VoiceAssistant/> (App level) so the
  // mic stays open while pages change. This button only toggles it and
  // runs the Home-only actions (المتشابهات / صفحة جدو).
  useEffect(() => {
    const st = (e: Event) => setOn(!!(e as CustomEvent).detail);
    const act = (e: Event) => {
      const k = (e as CustomEvent).detail;
      if (k === 'mutashabihat') onMutashabihat();
      else if (k === 'elderly') onElderly();
    };
    window.addEventListener('voice-assistant-state', st);
    window.addEventListener('voice-home-action', act);
    return () => { window.removeEventListener('voice-assistant-state', st); window.removeEventListener('voice-home-action', act); };
  }, [onMutashabihat, onElderly]);

  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <button
        type="button"
        onPointerDown={pressFeedback}
        onClick={() => window.dispatchEvent(new CustomEvent('voice-assistant-toggle'))}
        aria-label="اؤمرني"
        className={`group relative w-full max-w-md flex flex-col items-center gap-1 px-2 py-3 rounded-3xl min-w-0 overflow-hidden shadow-xl polish-press transition-transform ${on ? 'bg-gradient-to-l from-rose-700 to-rose-900 scale-[1.02]' : 'bg-gradient-to-l from-[#0f5c4d] via-[#12705d] to-[#0b3f37]'}`}
      >
        <VintageMic listening={on} />
        <span className="w-full min-w-0 text-center">
          <span className="block text-[clamp(1.3rem,6vw,1.75rem)] leading-tight font-bold font-display-ar text-[#f6d27a] drop-shadow">{on ? 'المايك مفتوح' : 'اؤمرني'}</span>
          <span className="block text-[clamp(0.7rem,3.1vw,0.875rem)] leading-snug text-[#f3ead7]/90 mt-1 break-words">{on ? 'قول «خلاص» لما تخلّص' : 'قول عايز إيه'}</span>
        </span>
      </button>
      {!on && (
        <Hint id="orderme-examples"><p className="text-center text-xs text-accent-600">قول: «اقرأ الكهف» • «اسمع الملك» • «سمّعلي الشمس» • «المتشابهات» — أو قول اسم السورة بس وأنا أسألك</p></Hint>
      )}
    </div>
  );
}

// Chrome studio microphone (drawn here, in the style of a classic
// tilted stage mic: rounded capsule, slotted grille, holder ring).
function VintageMic({ listening }: { listening: boolean }) {
  return (
    <svg viewBox="0 0 100 120" className={`w-[38%] max-w-24 h-auto shrink-0 drop-shadow-xl ${listening ? 'animate-pulse' : ''}`} aria-hidden="true">
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
