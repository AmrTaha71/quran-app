import { useEffect, useState } from 'react';
import { Clock, Headphones, RotateCcw, Users, MoonStar, Hand } from 'lucide-react';
import { pressFeedback } from '../lib/pressFeedback';
import { ADHAN_PRAYERS, AdhanDay, ensureAdhanDay, loadAdhanSettings, timeInTimezone } from '../lib/adhan';
import { loadWird, wirdTotal, formatPages } from '../lib/wird';
import { setSleepTimer } from '../lib/sleepTimer';

// «صفحة جدو» extras: the simple home for elderly mode. Six helpers, each
// one big, plain card: next prayer, continue reading, today's wird,
// a tasbih counter, listen-with-family room, and listen-until-sleep.

type ElderlyRoute = 'listen' | 'mushaf' | 'room' | 'test' | 'home';

type Props = {
  onNavigate: (r: ElderlyRoute) => void;
  onResume: () => void;
};

const TASBIH_KEY = 'quran-tasbih-v1';
const TASBIH_PHRASES = ['سبحان الله', 'الحمد لله', 'الله أكبر', 'لا إله إلا الله', 'أستغفر الله'];

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

function readTasbih(): { day: string; phrase: number; count: number } {
  const fresh = { day: todayKey(), phrase: 0, count: 0 };
  try {
    const raw = localStorage.getItem(TASBIH_KEY);
    if (!raw) return fresh;
    const p = JSON.parse(raw);
    if (p.day !== todayKey()) return { ...fresh, phrase: p.phrase ?? 0 };
    return { day: p.day, phrase: p.phrase ?? 0, count: p.count ?? 0 };
  } catch {
    return fresh;
  }
}

function writeTasbih(v: { day: string; phrase: number; count: number }) {
  try { localStorage.setItem(TASBIH_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}

const CARD = 'w-full bg-white rounded-2xl border-2 border-emerald-200 p-5 space-y-3 text-right';
const BIG_BTN = 'w-full min-h-[72px] py-4 rounded-2xl font-bold text-xl flex items-center justify-center gap-3 polish-press polish-focus';

export default function ElderlyHome({ onNavigate, onResume }: Props) {
  const [day, setDay] = useState<AdhanDay | null>(null);
  const [tasbih, setTasbih] = useState(readTasbih);
  const [sleepSet, setSleepSet] = useState(false);

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

  const tap = (p: number) => {
    const v = { day: todayKey(), phrase: p, count: p === tasbih.phrase ? tasbih.count : 0 };
    setTasbih(v);
    writeTasbih(v);
  };
  const count = () => {
    const v = { ...tasbih, day: todayKey(), count: tasbih.count + 1 };
    setTasbih(v);
    writeTasbih(v);
  };
  const resetCount = () => {
    const v = { ...tasbih, day: todayKey(), count: 0 };
    setTasbih(v);
    writeTasbih(v);
  };

  const listenUntilSleep = () => {
    setSleepTimer(60);
    setSleepSet(true);
    onNavigate('listen');
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
          <Headphones className="w-7 h-7" /> استمع للورد
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
        <button
          onPointerDown={pressFeedback}
          onClick={count}
          className="w-full min-h-[120px] rounded-3xl bg-emerald-700 text-white font-bold flex flex-col items-center justify-center gap-1"
        >
          <Hand className="w-8 h-8" />
          <span className="text-5xl">{tasbih.count.toLocaleString('ar-EG')}</span>
          <span className="text-lg">{TASBIH_PHRASES[tasbih.phrase]}</span>
        </button>
        <button onClick={resetCount} className="w-full min-h-[56px] rounded-xl border-2 text-lg font-semibold text-ink">
          ابدأ العد من جديد
        </button>
      </div>

      {/* 5. Listen with family (shared room) */}
      <button
        onPointerDown={pressFeedback}
        onClick={() => onNavigate('room')}
        className={`${BIG_BTN} bg-white text-emerald-800 border-2 border-emerald-700`}
      >
        <Users className="w-7 h-7" /> راجع مع الرفيق
      </button>

      {/* 6. Listen until sleep */}
      <button
        onPointerDown={pressFeedback}
        onClick={listenUntilSleep}
        className={`${BIG_BTN} bg-slate-800 text-white`}
      >
        <MoonStar className="w-7 h-7" /> استمع وأنا نايم (ساعة)
      </button>
      {sleepSet && <p className="text-lg text-ink-2 text-center">المؤقت اتظبط على ساعة، شغّل التلاوة من الصفحة.</p>}
    </div>
  );
}
