// Short looping mini-screens for the welcome cards: each one replays, in a
// phone-shaped frame with the app's own look and real ayah words, what the
// feature does (links popping up, the imam highlight moving, tasmee' writing
// what you say, listening progress). Pure CSS/React, no images to download.
import { useEffect, useState } from 'react';
import { Headphones, Mic } from 'lucide-react';

export type DemoKind = 'links' | 'tasmee' | 'imam' | 'listen';

const WORDS = ['الْحَمْدُ', 'لِلَّهِ', 'رَبِّ', 'الْعَالَمِينَ'];
const quran = { fontFamily: "'Amiri', 'Scheherazade New', serif" } as const;

function useTick(n: number, ms: number): number {
  const [i, setI] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setI((x) => (x + 1) % n), ms); return () => window.clearInterval(t); }, [n, ms]);
  return i;
}

function Frame({ children, bar }: { children: React.ReactNode; bar: string }) {
  return (
    <div className="mx-auto w-44 rounded-[1.6rem] border-4 border-emerald-900 bg-[#fbf3dc] shadow-lg overflow-hidden mb-5" aria-hidden="true">
      <div className="h-5 bg-emerald-800 text-[9px] text-amber-200 flex items-center justify-center font-bold">{bar}</div>
      <div className="h-36 p-3 flex flex-col items-center justify-center gap-2 relative">{children}</div>
    </div>
  );
}

export default function OnboardingDemo({ kind }: { kind: DemoKind }) {
  // 12 ticks of 280 ms ≈ 3.4 s per loop.
  const t = useTick(12, 280);
  if (kind === 'links') {
    const show = t >= 4 && t < 11;
    return (
      <Frame bar="المصحف">
        <p dir="rtl" style={quran} className={`text-lg leading-loose text-center transition-colors ${t >= 3 ? 'text-amber-700' : 'text-ink'}`}>{WORDS.join(' ')} <span className="text-sm">﴿١﴾</span></p>
        <div className={`flex gap-1.5 transition-all duration-300 ${show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
          {['قبلها', 'بعدها', 'متشابه'].map((c, i) => (
            <span key={c} className="px-2 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 text-white" style={{ transitionDelay: `${i * 90}ms` }}>{c}</span>
          ))}
        </div>
      </Frame>
    );
  }
  if (kind === 'tasmee') {
    const shown = Math.min(WORDS.length, Math.floor(t / 2.4));
    return (
      <Frame bar="سمّع لي">
        <div className="flex items-center gap-1.5 text-rose-600 text-[11px] font-bold"><Mic className={`w-4 h-4 ${t % 2 ? 'scale-125' : ''} transition-transform`} /> بسمعك…</div>
        <p dir="rtl" style={quran} className="text-lg leading-loose text-center">
          {WORDS.map((w, i) => (
            <span key={w} className={`inline-block mx-0.5 transition-all duration-300 ${i < shown ? 'opacity-100 text-emerald-700' : 'opacity-0'}`}>{w}</span>
          ))}
        </p>
      </Frame>
    );
  }
  if (kind === 'imam') {
    const hi = Math.min(WORDS.length - 1, Math.floor(t / 3));
    return (
      <Frame bar="الْحَقِ الإِمَامَ">
        <p dir="rtl" style={quran} className="text-lg leading-loose text-center">
          {WORDS.map((w, i) => (
            <span key={w} className={`inline-block mx-0.5 px-1 rounded-md transition-colors duration-200 ${i === hi ? 'bg-amber-300 text-emerald-950' : 'text-ink'}`}>{w}</span>
          ))}
        </p>
        <div className="flex items-end gap-0.5 h-4">{[3, 7, 4, 8, 5].map((h, i) => <span key={i} className="w-1 rounded bg-emerald-600" style={{ height: `${(t + i) % 2 ? h * 1.6 : h}px`, transition: 'height .25s' }} />)}</div>
      </Frame>
    );
  }
  return (
    <Frame bar="استمع">
      <div className="w-12 h-12 rounded-full grad-emerald-door flex items-center justify-center"><Headphones className="w-6 h-6 text-white" /></div>
      <p className="text-[11px] font-bold text-ink">سورة الفاتحة</p>
      <div className="w-28 h-1.5 rounded-full bg-gray-200 overflow-hidden"><div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${(t + 1) * 8}%` }} /></div>
    </Frame>
  );
}
