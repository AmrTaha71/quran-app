// «اؤمرني» conversation (2026-11-14). One continuous mic that stays
// open across pages until the user says «خلاص» or taps stop. Each answer
// moves to the next question: surah name -> what to do (اقرأ / اسمع /
// سمّعلي) -> for listening, which reciter. Lives in App so it survives
// route changes. Nothing opens by guess; unclear -> asks again.
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseVoiceCommand, findSurah, surahGlobalRange, surahName, norm, type VoiceAction } from '../lib/voiceCommand';
import { RECITERS } from '../lib/reciters';
import { CORR_RECITERS, setCorrReciter } from '../lib/juhaniCorr';
import { recitersForRange } from '../lib/corrDownload';
import { speechErrorMessage } from '../lib/speechErrors';
import type { Route } from '../lib/routes';

type Step = { k: 'root' } | { k: 'surah'; surah: number } | { k: 'reciter'; surah: number } | { k: 'recite'; surah: number };

const STOP_WORDS = ['خلاص', 'كفايه', 'انهاء', 'انتهينا', 'اقفل', 'قفل المايك', 'وقف المايك', 'شكرا', 'تمام كده'];
const ANY_RECITER = ['اي حد', 'اي واحد', 'اي قارئ', 'عادي', 'الحالي', 'زي ما', 'اي شيخ', 'مفرق'];
const ALIASES: Record<string, string[]> = {
  husary: ['حصري'], minshawi: ['منشاوي'], alafasy: ['عفاسي', 'مشاري'], sudais: ['سديس'],
  muaiqly: ['معيقلي', 'ماهر'], abdulbasit: ['عبد الباسط', 'باسط'], jaber: ['جابر'], rifai: ['رفاعي'], ayyoub: ['ايوب'],
};

const CORR_ALIASES: [string, string[]][] = [
  ['Minshawy', ['منشاوي']], ['Husary', ['حصري']], ['Abdul_Basit', ['عبد الباسط', 'باسط']], ['Alafasy', ['عفاسي', 'مشاري']],
  ['Tablaway', ['طبلاوي']], ['Shuraym', ['شريم']], ['Shaatree', ['شاطري']], ['Rifai', ['رفاعي']],
];
/** Reciters that have word timings for the whole surah (the «سمّع» candidates). */
function reciteOptions(surah: number): { folder: string; name: string }[] {
  const r = surahGlobalRange(surah);
  const ok = new Set(recitersForRange(r.start, r.end));
  return CORR_RECITERS.filter((c) => ok.has(c.folder));
}
function findCorrReciter(text: string, opts: { folder: string }[]): string | null {
  const t = norm(text);
  for (const o of opts) {
    const al = CORR_ALIASES.find(([k]) => o.folder.includes(k))?.[1] || [];
    if (al.some((w) => t.includes(w))) return o.folder;
  }
  return null;
}

function findReciter(text: string): string | null {
  const t = norm(text);
  for (const r of RECITERS) {
    const words = [norm(r.name).replace(/^ال/, ''), ...(ALIASES[r.id] || [])];
    if (words.some((w) => w && t.includes(w))) return r.id;
  }
  return null;
}
const hasAny = (t: string, ws: string[]) => ws.some((w) => t.includes(norm(w)));

type Choice = 'read' | 'play' | 'recite' | 'memorize';
/** Wave-1 words. Order matters: «اسمعلي/سمّعلي» (recite to me) before «اسمع» (play). */
function matchChoice(raw: string): Choice | null {
  const t = norm(raw);
  if (hasAny(t, ['تحفظها', 'احفظها', 'احفظ', 'حفظ'])) return 'memorize';
  if (/(على ?الشيخ|اسمعها|سمعها|اسمعنيها|سمع ?لي|اسمع ?لي|تسميع|امتحن|راجع)/.test(t)) return 'recite';
  if (hasAny(t, ['شغل', 'تشغيل', 'استمع', 'اسمع', 'سماع'])) return 'play';
  if (hasAny(t, ['اقرا', 'مصحف', 'قراءه', 'قرايه', 'افتح'])) return 'read';
  if (/(^| )(ا?سمع|سمعها|سمعني)( |$)/.test(t)) return 'recite';
  return null;
}

export default function VoiceAssistant({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState<Step>({ k: 'root' });
  const [heard, setHeard] = useState('');
  const [note, setNote] = useState('');
  const activeRef = useRef(false);
  const netErrRef = useRef(0);
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

  // A leaf of the tree: open the page, then close the mic by itself.
  const go = (a: VoiceAction, reciter?: string) => {
    let msg = '';
    try {
      if (a.kind === 'mushaf') {
        if (a.surah) localStorage.setItem('quran-mushaf-target', JSON.stringify({ surah: a.surah, ayah: 1 }));
        onNavigate('mushaf');
        msg = a.surah ? `فتحت المصحف على سورة ${surahName(a.surah)}` : 'فتحت المصحف';
      } else if (a.kind === 'listen') {
        if (a.surah) sessionStorage.setItem('quran-listen-surah', String(a.surah));
        if (reciter) sessionStorage.setItem('quran-listen-reciter', reciter);
        onNavigate('listen');
        const rn = RECITERS.find((r) => r.id === reciter)?.name;
        msg = a.surah ? `شغّلت سورة ${surahName(a.surah)}${rn ? ' — ' + rn : ''}` : 'فتحت الاستماع';
      } else if (a.kind === 'test') {
        // Opens the tasmee SETTINGS (surah list), never starts by itself.
        // 'quran-test-voice-prefill' is for SelfTestPage to preselect the
        // surah (needs a hook there); the reciter is saved as the default.
        sessionStorage.setItem('quran-test-range-choice', 'surah');
        if (a.surah) sessionStorage.setItem('quran-test-voice-prefill', JSON.stringify({ surah: a.surah, ...(reciter ? { reciter } : {}) }));
        if (reciter) setCorrReciter(reciter);
        onNavigate('test');
        const cn = CORR_RECITERS.find((c) => c.folder === reciter)?.name;
        msg = a.surah ? `فتحت إعدادات التسميع — سورة ${surahName(a.surah)}${cn ? ' على ' + cn : ''}` : 'فتحت إعدادات التسميع';
      } else if (a.kind === 'mutashabihat' || a.kind === 'elderly') {
        onNavigate('home');
        setTimeout(() => window.dispatchEvent(new CustomEvent('voice-home-action', { detail: a.kind })), 450);
        msg = a.kind === 'mutashabihat' ? 'فتحت المتشابهات' : 'فتحت صفحة جدو';
      } else if (a.kind === 'route') {
        onNavigate(a.route);
        msg = 'تمام، فتحتها';
      }
    } catch { /* storage blocked */ }
    stop(msg || 'تمام');
  };

  // «سمّع»: ask «على مين؟» offering only reciters with timings for this surah.
  const toRecite = (surah: number) => {
    const opts = reciteOptions(surah);
    if (opts.length === 0) { go({ kind: 'test', surah }); return; }
    if (opts.length === 1) { go({ kind: 'test', surah }, opts[0].folder); return; }
    setStepBoth({ k: 'recite', surah }); setNote('');
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

    if (st.k === 'recite') {
      const opts = reciteOptions(st.surah);
      for (const t of alts) {
        const f = findCorrReciter(t, opts);
        if (f) { go({ kind: 'test', surah: st.surah }, f); return; }
      }
      if (alts.some((t) => hasAny(norm(t), ANY_RECITER))) { go({ kind: 'test', surah: st.surah }); return; }
    }

    if (st.k === 'surah') {
      for (const t of alts) {
        const c = matchChoice(t);
        if (c === 'read') { go({ kind: 'mushaf', surah: st.surah }); return; }
        if (c === 'recite') {
          const f = findCorrReciter(t, reciteOptions(st.surah));
          if (f) go({ kind: 'test', surah: st.surah }, f); else toRecite(st.surah);
          return;
        }
        if (c === 'memorize') { go({ kind: 'test', surah: st.surah }); return; }
        if (c === 'play') {
          const rid = findReciter(t);
          if (rid) go({ kind: 'listen', surah: st.surah }, rid);
          else { setStepBoth({ k: 'reciter', surah: st.surah }); setNote(''); }
          return;
        }
      }
      for (const t of alts) {
        const sn = findSurah(t);
        if (sn) { setStepBoth({ k: 'surah', surah: sn }); setNote(''); return; }
      }
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
      if (a.kind === 'test') {
        const surah = a.surah ?? pending;
        const f = surah ? findCorrReciter(t, reciteOptions(surah)) : null;
        go({ ...a, surah }, f ?? undefined);
        return;
      }
      if (a.kind === 'mushaf') { go({ ...a, surah: a.surah ?? pending }); return; }
      go(a);
      return;
    }
    setNote(st.k === 'reciter' ? 'ما فهمتش القارئ، قول اسمه تاني' : st.k === 'surah' ? 'قول: اقرأ، شغّل، اسمّعها، أو احفظ' : 'ما فهمتش، قول تاني');
  };

  const begin = useCallback(() => {
    const W = window as any;
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) { setNote('المتصفح ده مش بيدعم الأوامر بالصوت'); return; }
    activeRef.current = true;
    netErrRef.current = 0;
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
          netErrRef.current = 0;
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (!res.isFinal) continue;
            const alts: string[] = [];
            for (let j = 0; j < res.length; j++) alts.push(String(res[j]?.transcript || ''));
            if (alts[0]) handle(alts);
          }
        };
        r.onerror = (ev: any) => {
          const m = speechErrorMessage(ev?.error);
          if (!m) return;
          if (m.fatal) { stop(m.text); return; }
          // Transient (network): say so, and give up after 3 in a row.
          netErrRef.current += 1;
          if (netErrRef.current >= 3) { stop(m.text); return; }
          setNote(m.text);
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

  // Small toast after the mic closed (what just happened / why it failed).
  if (!active) {
    if (!note) return null;
    return (
      <div dir="rtl" className="fixed inset-x-0 bottom-0 z-[3000] p-3 pointer-events-none">
        <div className="pointer-events-auto max-w-md mx-auto rounded-2xl bg-[#290B3F] text-white shadow-2xl px-4 py-3 text-base font-bold" role="status">{note}</div>
      </div>
    );
  }
  const q = step.k === 'surah'
    ? `سورة ${surahName(step.surah)} — اختار واحدة`
    : step.k === 'reciter' ? `سورة ${surahName(step.surah)} — مع مين؟` : step.k === 'recite' ? `على مين؟ (اللي توقيتاته جاهزة)` : 'قول اسم السورة وعايز تعمل إيه وأنا أساعدك';
  // Example tiles run the real parser, so what they show is what works.
  const EXAMPLES: { text: string; cls: string; icon: string }[] = [
    { text: 'افتح سورة الكهف', cls: 'bg-emerald-600', icon: '📖' },
    { text: 'سمّع لي سورة الكهف على المنشاوي', cls: 'bg-amber-500', icon: '🎙️' },
    { text: 'شغّل الكهف بصوت الحصري', cls: 'bg-sky-600', icon: '🎧' },
  ];
  const tile = 'min-h-[76px] rounded-2xl font-bold flex flex-col items-center justify-center text-white px-2 text-center active:scale-95 transition-transform';
  return (
    <div dir="rtl" role="dialog" aria-modal="true" aria-label="اؤمرني" className="fixed inset-0 z-[3000] bg-gradient-to-b from-[#290B3F] via-[#3C0F5C] to-[#1C082A] text-white overflow-y-auto" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="min-h-full max-w-md mx-auto flex flex-col items-center gap-4 px-4 py-6">
        <span className="text-7xl mt-4 animate-pulse" aria-hidden="true">🎙️</span>
        <p className="text-xl font-bold text-center leading-snug">{heard ? `«${heard}»` : 'المايك مفتوح، بسمعك…'}</p>
        <p className="text-base text-[#f3ead7] text-center leading-relaxed" aria-live="polite">{note || q}</p>
        <div className="w-full flex-1 flex flex-col justify-center gap-3">
          {step.k === 'root' && (
            <div key="w0" className="va-wave flex flex-col gap-3">
              {EXAMPLES.map((e) => (
                <button key={e.text} type="button" onClick={() => handle([e.text])} className={`${tile} ${e.cls}`}>
                  <span className="text-2xl">{e.icon}</span>
                  <span className="text-lg">«{e.text}»</span>
                </button>
              ))}
            </div>
          )}
          {step.k === 'surah' && (
            <div key="w1" className="va-wave grid grid-cols-2 gap-2">
              <button type="button" onClick={() => go({ kind: 'mushaf', surah: step.surah })} className={`${tile} bg-emerald-600`}><span className="text-2xl">📖</span><span className="text-lg">تقراها</span><span className="text-[11px] opacity-80">المصحف</span></button>
              <button type="button" onClick={() => setStepBoth({ k: 'reciter', surah: step.surah })} className={`${tile} bg-sky-600`}><span className="text-2xl">🎧</span><span className="text-lg">تسمعها</span><span className="text-[11px] opacity-80">بصوت قارئ</span></button>
              <button type="button" onClick={() => toRecite(step.surah)} className={`${tile} bg-amber-500`}><span className="text-2xl">🎙️</span><span className="text-lg">تسمّعها</span><span className="text-[11px] opacity-80">على الشيخ</span></button>
              <button type="button" onClick={() => go({ kind: 'test', surah: step.surah })} className={`${tile} bg-violet-600`}><span className="text-2xl">🧠</span><span className="text-lg">تحفظها</span><span className="text-[11px] opacity-80">إعدادات التسميع</span></button>
            </div>
          )}
          {step.k === 'recite' && (
            <div key="w3" className="va-wave grid grid-cols-2 gap-2">
              {reciteOptions(step.surah).map((r) => (
                <button key={r.folder} type="button" onClick={() => go({ kind: 'test', surah: step.surah }, r.folder)} className="min-h-[52px] px-2 rounded-xl bg-amber-500 font-bold">{r.name}</button>
              ))}
            </div>
          )}
          {step.k === 'reciter' && (
            <div key="w2" className="va-wave grid grid-cols-2 gap-2">
              {RECITERS.map((r) => (
                <button key={r.id} type="button" onClick={() => go({ kind: 'listen', surah: step.surah }, r.id)} className="min-h-[52px] px-2 rounded-xl bg-white/20 font-bold">{r.name}</button>
              ))}
              <button type="button" onClick={() => go({ kind: 'listen', surah: step.surah })} className="min-h-[52px] px-2 rounded-xl bg-white/10 font-bold">أي قارئ</button>
            </div>
          )}
        </div>
        <button type="button" onClick={() => stop('قفلت المايك')} className="min-h-[52px] w-full max-w-xs rounded-2xl bg-white text-[#290B3F] text-lg font-bold">خلاص</button>
      </div>
    </div>
  );
}
