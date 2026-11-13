// «اؤمرني» conversation (2026-11-14). One continuous mic that stays
// open across pages until the user says «خلاص» or taps stop. Each answer
// moves to the next question: surah name -> what to do (اقرأ / اسمع /
// سمّعلي) -> for listening, which reciter. Lives in App so it survives
// route changes. Nothing opens by guess; unclear -> asks again.
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseVoiceCommand, surahGlobalRange, surahName, norm, type VoiceAction } from '../lib/voiceCommand';
import { RECITERS } from '../lib/reciters';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test' | 'listen' | 'adhkar' | 'room';
type Step = { k: 'root' } | { k: 'surah'; surah: number } | { k: 'reciter'; surah: number };

const STOP_WORDS = ['خلاص', 'كفايه', 'انهاء', 'انتهينا', 'اقفل', 'قفل المايك', 'وقف المايك', 'شكرا', 'تمام كده'];
const ANY_RECITER = ['اي حد', 'اي واحد', 'اي قارئ', 'عادي', 'الحالي', 'زي ما', 'اي شيخ', 'مفرق'];
const ALIASES: Record<string, string[]> = {
  husary: ['حصري'], minshawi: ['منشاوي'], alafasy: ['عفاسي', 'مشاري'], sudais: ['سديس'],
  muaiqly: ['معيقلي', 'ماهر'], abdulbasit: ['عبد الباسط', 'باسط'], jaber: ['جابر'], rifai: ['رفاعي'], ayyoub: ['ايوب'],
};

function findReciter(text: string): string | null {
  const t = norm(text);
  for (const r of RECITERS) {
    const words = [norm(r.name).replace(/^ال/, ''), ...(ALIASES[r.id] || [])];
    if (words.some((w) => w && t.includes(w))) return r.id;
  }
  return null;
}
const hasAny = (t: string, ws: string[]) => ws.some((w) => t.includes(norm(w)));

export default function VoiceAssistant({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState<Step>({ k: 'root' });
  const [heard, setHeard] = useState('');
  const [note, setNote] = useState('');
  const activeRef = useRef(false);
  const stepRef = useRef<Step>({ k: 'root' });
  const recRef = useRef<any>(null);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStepBoth = (s: Step) => { stepRef.current = s; setStep(s); };
  const announce = (on: boolean) => window.dispatchEvent(new CustomEvent('voice-assistant-state', { detail: on }));

  const stop = useCallback((msg = '') => {
    activeRef.current = false;
    setActive(false);
    announce(false);
    if (restartTimer.current) clearTimeout(restartTimer.current);
    try { recRef.current?.abort?.(); } catch { /* ignore */ }
    recRef.current = null;
    setStepBoth({ k: 'root' });
    setNote(msg);
    if (msg) setTimeout(() => setNote(''), 2500);
  }, []);

  const go = (a: VoiceAction, reciter?: string) => {
    try {
      if (a.kind === 'mushaf') {
        if (a.surah) localStorage.setItem('quran-mushaf-target', JSON.stringify({ surah: a.surah, ayah: 1 }));
        onNavigate('mushaf');
        setNote(a.surah ? `فتحت المصحف على سورة ${surahName(a.surah)}` : 'فتحت المصحف');
      } else if (a.kind === 'listen') {
        if (a.surah) sessionStorage.setItem('quran-listen-surah', String(a.surah));
        if (reciter) sessionStorage.setItem('quran-listen-reciter', reciter);
        onNavigate('listen');
        const rn = RECITERS.find((r) => r.id === reciter)?.name;
        setNote(a.surah ? `شغّلت سورة ${surahName(a.surah)}${rn ? ' — ' + rn : ''}` : 'فتحت الاستماع');
      } else if (a.kind === 'test') {
        if (a.surah) {
          const r = surahGlobalRange(a.surah);
          sessionStorage.setItem('quran-test-range-preset', JSON.stringify({ startGlobal: r.start, endGlobal: r.end, label: `سورة ${surahName(a.surah)}` }));
        }
        onNavigate('test');
        setNote(a.surah ? `جاهز أسمّعك سورة ${surahName(a.surah)}` : 'فتحت التسميع');
      } else if (a.kind === 'mutashabihat' || a.kind === 'elderly') {
        onNavigate('home');
        setTimeout(() => window.dispatchEvent(new CustomEvent('voice-home-action', { detail: a.kind })), 450);
        setNote(a.kind === 'mutashabihat' ? 'فتحت المتشابهات' : 'فتحت صفحة جدو');
      } else if (a.kind === 'route') {
        onNavigate(a.route);
        setNote('تمام، فتحتها');
      }
    } catch { /* storage blocked */ }
    setStepBoth({ k: 'root' });
  };

  const handle = (alts: string[]) => {
    setHeard(alts[0] || '');
    if (alts.some((t) => hasAny(norm(t), STOP_WORDS))) { stop('قفلت المايك'); return; }
    const st = stepRef.current;

    if (st.k === 'reciter') {
      for (const t of alts) {
        const rid = findReciter(t);
        if (rid) { go({ kind: 'listen', surah: st.surah }, rid); return; }
      }
      if (alts.some((t) => hasAny(norm(t), ANY_RECITER))) { go({ kind: 'listen', surah: st.surah }); return; }
    }

    for (const t of alts) {
      const a = parseVoiceCommand(t);
      if (!a) continue;
      const pending = st.k === 'surah' || st.k === 'reciter' ? st.surah : null;
      if (a.kind === 'ask') { setStepBoth({ k: 'surah', surah: a.surah }); setNote(''); return; }
      if (a.kind === 'listen') {
        const surah = a.surah ?? pending;
        if (surah) {
          const rid = findReciter(t);
          if (rid) go({ kind: 'listen', surah }, rid);
          else { setStepBoth({ k: 'reciter', surah }); setNote(''); }
        } else go(a);
        return;
      }
      if (a.kind === 'mushaf' || a.kind === 'test') { go({ ...a, surah: a.surah ?? pending }); return; }
      go(a);
      return;
    }
    setNote(st.k === 'reciter' ? 'ما فهمتش القارئ، قول اسمه تاني' : st.k === 'surah' ? 'قول: اقرأ، اسمع، أو سمّعلي' : 'ما فهمتش، قول تاني');
  };

  const begin = useCallback(() => {
    const W = window as any;
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) { setNote('المتصفح ده مش بيدعم الأوامر بالصوت'); return; }
    activeRef.current = true;
    setActive(true);
    announce(true);
    setHeard('');
    setNote('');
    setStepBoth({ k: 'root' });
    const startOnce = () => {
      if (!activeRef.current) return;
      try {
        const r = new Ctor();
        recRef.current = r;
        r.lang = 'ar-SA';
        r.continuous = true;
        r.interimResults = false;
        r.maxAlternatives = 3;
        r.onresult = (e: any) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (!res.isFinal) continue;
            const alts: string[] = [];
            for (let j = 0; j < res.length; j++) alts.push(String(res[j]?.transcript || ''));
            if (alts[0]) handle(alts);
          }
        };
        r.onerror = (ev: any) => {
          if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') stop('المايك مش مسموح، فعّله من إعدادات المتصفح');
        };
        r.onend = () => {
          if (!activeRef.current) return;
          restartTimer.current = setTimeout(startOnce, 350); // keep the mic open
        };
        r.start();
      } catch {
        restartTimer.current = setTimeout(startOnce, 800);
      }
    };
    startOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const on = () => { if (activeRef.current) stop('قفلت المايك'); else begin(); };
    window.addEventListener('voice-assistant-toggle', on);
    return () => { window.removeEventListener('voice-assistant-toggle', on); activeRef.current = false; try { recRef.current?.abort?.(); } catch { /* ignore */ } };
  }, [begin, stop]);

  if (!active && !note) return null;
  const q = step.k === 'surah'
    ? `سورة ${surahName(step.surah)} — تحب إيه؟`
    : step.k === 'reciter' ? `سورة ${surahName(step.surah)} — مع مين؟` : 'قول أمرك: اقرأ الكهف • اسمع الملك • سمّعلي الشمس';
  return (
    <div dir="rtl" className="fixed inset-x-0 bottom-0 z-[3000] p-3 pointer-events-none">
      <div className="pointer-events-auto max-w-md mx-auto rounded-3xl bg-rose-800 text-white shadow-2xl p-3 space-y-2">
        <div className="flex items-center gap-3">
          <span className={`text-3xl ${active ? 'animate-pulse' : ''}`} aria-hidden="true">🎙️</span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-lg truncate">{active ? (heard ? `«${heard}»` : 'بسمعك…') : note}</p>
            {active && <p className="text-sm text-rose-100">{note || q}</p>}
          </div>
          {active && (
            <button type="button" onClick={() => stop('قفلت المايك')} className="min-h-[44px] px-4 rounded-xl bg-white text-rose-800 font-bold">خلاص</button>
          )}
        </div>
        {active && step.k === 'surah' && (
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => go({ kind: 'mushaf', surah: step.surah })} className="min-h-[44px] rounded-xl bg-emerald-600 font-bold">أقرأها</button>
            <button type="button" onClick={() => setStepBoth({ k: 'reciter', surah: step.surah })} className="min-h-[44px] rounded-xl bg-emerald-600 font-bold">أسمعها</button>
            <button type="button" onClick={() => go({ kind: 'test', surah: step.surah })} className="min-h-[44px] rounded-xl bg-amber-500 font-bold">سمّعها لي</button>
          </div>
        )}
        {active && step.k === 'reciter' && (
          <div className="flex flex-wrap gap-2">
            {RECITERS.map((r) => (
              <button key={r.id} type="button" onClick={() => go({ kind: 'listen', surah: step.surah }, r.id)} className="min-h-[40px] px-3 rounded-xl bg-white/20 font-bold">{r.name}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
