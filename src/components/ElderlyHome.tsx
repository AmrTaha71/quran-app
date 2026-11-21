import { roomLabel } from '../lib/roomLabel';
import { useEffect, useState } from 'react';
import { Clock, Headphones, RotateCcw, Users, Hand } from 'lucide-react';
import { pressFeedback } from '../lib/pressFeedback';
import { ADHAN_PRAYERS, AdhanDay, ensureAdhanDay, loadAdhanSettings, timeInTimezone } from '../lib/adhan';
import { loadWird, wirdTotal, formatPages } from '../lib/wird';

// «صفحة جدو» extras: the simple home for elderly mode. Six helpers, each
// one big, plain card: next prayer, continue reading, today's wird,
// a tasbih counter, listen-with-family room, and listen-until-sleep.

type ElderlyRoute = 'listen' | 'mushaf' | 'room' | 'test' | 'home';

type Props = {
  onNavigate: (r: ElderlyRoute) => void;
  onResume: () => void;
};

const TASBIH_KEY = 'quran-tasbih-v1';
const TASBIH_PHRASES = ['سبحان الله', 'الحمد لله', 'الله أكبر', 'لا إله إلا الله', 'أستغفر الله', 'اللهم صل على سيدنا محمد'];
// v2: one counter per dhikr, never reset by a new day. The v1 key stays
// readable (migrated once) and is still written so older builds keep working.
const TASBIH_KEY_V2 = 'quran-tasbih-v2';
type Tasbih = { phrase: number; counts: Record<string, number> };

function todayKey(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toMinutes(hhmm: string): number | null {
  const m = hhmm.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function nextPrayer(day: AdhanDay): { label: string; time: string } | null {
  const nowStr = timeInTimezone(day.timezone);
  const now = toMinutes(nowStr);
  if (now === null) return null;
  for (const p of ADHAN_PRAYERS) {
    const t = day.timings[p.key];
    const mins = t ? toMinutes(t) : null;
    if (mins !== null && mins > now) return { label: p.label, time: t.match(/\d{1,2}:\d{2}/)?.[0] ?? t };
  }
  const fajr = day.timings['Fajr'];
  return fajr ? { label: 'الفجر (بكرة)', time: fajr.match(/\d{1,2}:\d{2}/)?.[0] ?? fajr } : null;
}

function readTasbih(): Tasbih {
  try {
    const raw2 = localStorage.getItem(TASBIH_KEY_V2);
    if (raw2) {
      const p = JSON.parse(raw2);
      const phrase = Number.isInteger(p.phrase) && p.phrase >= 0 && p.phrase < TASBIH_PHRASES.length ? p.phrase : 0;
      return { phrase, counts: p.counts && typeof p.counts === 'object' ? p.counts : {} };
    }
    const raw = localStorage.getItem(TASBIH_KEY);
    if (!raw) return { phrase: 0, counts: {} };
    const p = JSON.parse(raw);
    const phrase = Number.isInteger(p.phrase) && p.phrase >= 0 && p.phrase < TASBIH_PHRASES.length ? p.phrase : 0;
    return { phrase, counts: { [phrase]: Number(p.count) || 0 } };
  } catch {
    return { phrase: 0, counts: {} };
  }
}

function writeTasbih(v: Tasbih) {
  try {
    localStorage.setItem(TASBIH_KEY_V2, JSON.stringify(v));
    localStorage.setItem(TASBIH_KEY, JSON.stringify({ day: todayKey(), phrase: v.phrase, count: v.counts[v.phrase] ?? 0 }));
  } catch { /* ignore */ }
}

const CARD = 'w-full bg-white rounded-2xl border-2 border-emerald-200 p-5 space-y-3 text-right';
const BIG_BTN = 'w-full min-h-[72px] py-4 rounded-2xl font-bold text-xl flex items-center justify-center gap-3 polish-press polish-focus';

export default function ElderlyHome({ onNavigate, onResume }: Props) {
  const [day, setDay] = useState<AdhanDay | null>(null);
  const [tasbih, setTasbih] = useState(readTasbih);
  const [flash, setFlash] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const loc = loadAdhanSettings().location;
    if (!loc) return;
    ensureAdhanDay(loc)
      .then((d) => { if (!cancelled) setDay(d); })
      .catch(() => { /* no prayer times offline; the card stays hidden */ });
    return () => { cancelled = true; };
  }, []);

  const next = day ? nextPrayer(day) : null;

  const wird = loadWird();
  const wirdPages = wirdTotal(wird.parts);
  const wirdDone = wird.doneDays.includes(todayKey());

  const current = tasbih.counts[tasbih.phrase] ?? 0;
  const tap = (p: number) => {
    const v = { ...tasbih, phrase: p };
    setTasbih(v);
    writeTasbih(v);
  };
  const count = () => {
    const v = { ...tasbih, counts: { ...tasbih.counts, [tasbih.phrase]: current + 1 } };
    setTasbih(v);
    writeTasbih(v);
  };
  const resetCount = () => {
    const v = { ...tasbih, counts: { ...tasbih.counts, [tasbih.phrase]: 0 } };
    setTasbih(v);
    writeTasbih(v);
  };


  return (
    <div className="flex flex-col gap-5" dir="rtl">
      {/* 1. Next prayer */}
      {next && (
        <div className={CARD}>
          <p className="flex items-center gap-2 text-lg text-emerald-800 font-bold">
            <Clock className="w-6 h-6" /> الصلاة الجاية
          </p>
          <p className="text-3xl font-bold text-ink">{next.label}</p>
          <p className="text-2xl text-ink-2" dir="ltr">{next.time}</p>
        </div>
      )}

      {/* 2. Continue reading */}
      <button
        onPointerDown={pressFeedback}
        onClick={onResume}
        className={`${BIG_BTN} bg-amber-100 text-amber-900 border-2 border-amber-400`}
      >
        <RotateCcw className="w-7 h-7" /> كمّل من آخر صفحة
      </button>

      {/* 3. Today's wird */}
      <div className={CARD}>
        <p className="text-lg text-emerald-800 font-bold">ورد النهارده</p>
        <p className="text-2xl font-bold text-ink">
          {wirdPages > 0 ? `${formatPages(wirdPages)}` : 'مفيش ورد متسجل'}
        </p>
        {wirdPages > 0 && (
          <p className="text-lg text-ink-2">{wirdDone ? 'خلصته النهارده ✓' : 'لسه ماخلصتهوش'}</p>
        )}
        <button
          onPointerDown={pressFeedback}
          onClick={() => onNavigate('listen')}
          className={`${BIG_BTN} bg-emerald-600 text-white`}
        >
          <Headphones className="w-7 h-7" /> الورد
        </button>
      </div>

      {/* 4. Tasbih counter */}
      <div className={CARD}>
        <p className="text-lg text-emerald-800 font-bold">السبحة</p>
        <div className="grid grid-cols-2 gap-2">
          {TASBIH_PHRASES.map((p, i) => (
            <button
              key={p}
              onPointerDown={pressFeedback}
              onClick={() => tap(i)}
              className={`min-h-[56px] rounded-xl border-2 font-bold text-lg ${tasbih.phrase === i ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-ink border-emerald-200'}`}
            >
              {p}
            </button>
          ))}
        </div>
        {/* Under the finger: always the phrase itself, with a short flash
            on each tap. The number lives in the row below. */}
        <button
          onPointerDown={pressFeedback}
          onClick={() => { count(); setFlash((n) => n + 1); }}
          className="relative w-full min-h-[140px] rounded-3xl bg-emerald-700 text-white font-bold flex items-center justify-center overflow-hidden"
        >
          <span key={flash} className="absolute inset-0 bg-white/40 animate-[tasbihFlash_0.35s_ease-out_forwards] pointer-events-none" />
          <span key={flash} className="text-5xl font-display-ar relative inline-block animate-[dhikrPulse_0.45s_ease-out]">{TASBIH_PHRASES[tasbih.phrase]}</span>
        </button>
        <style>{`@keyframes tasbihFlash { from { opacity: 1 } to { opacity: 0 } } @keyframes dhikrPulse { 0% { opacity: .15; transform: scale(.94) } 100% { opacity: 1; transform: scale(1) } }`}</style>
        <div className="grid grid-cols-3 items-center gap-2">
          <span />
          <span className="text-center text-5xl font-extrabold text-emerald-700 tabular-nums" dir="ltr">{current.toLocaleString('en-US')}</span>
          <button onClick={resetCount} className="min-h-[56px] rounded-xl border-2 text-base font-semibold text-ink">
            ابدأ من جديد
          </button>
        </div>
      </div>


      {/* 6. Listen (one door). The sleep timer is a wheel on the listen
          page itself (2026-11-12: merged with «استمع وأنا نايم»). */}
      <button
        onPointerDown={pressFeedback}
        onClick={() => onNavigate('listen')}
        className={`${BIG_BTN} bg-slate-800 text-white`}
      >
        <Headphones className="w-7 h-7" /> استمع
      </button>
    </div>
  );
}
