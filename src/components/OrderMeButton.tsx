// «اؤمرني»: one big mic on Home. Say what you want ("عايز أقرأ سورة
// الكهف", "عايز أسمع الملك", "سمّعلي الشمس", "المتشابهات") and the
// matching page opens. Not understood -> shows what was heard and
// asks again; nothing opens by guess. (2026-11-08)
import { useState } from 'react';
import { Mic } from 'lucide-react';
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
    <div className="space-y-2">
      <button
        type="button"
        onPointerDown={pressFeedback}
        onClick={start}
        className={`w-full flex items-center justify-center gap-3 px-6 py-5 rounded-2xl text-white font-bold text-2xl shadow-lg polish-press ${state === 'listening' ? 'bg-red-600 animate-pulse' : 'grad-emerald-door'}`}
      >
        <Mic className="w-8 h-8" />
        {state === 'listening' ? 'بسمعك…' : 'اؤمرني'}
      </button>
      {note && <p className="text-center text-sm text-accent-700 bg-white/80 rounded-xl px-3 py-2">{note}</p>}
    </div>
  );
}
