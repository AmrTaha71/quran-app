import { useState } from 'react';
import { CalendarDays, Flame, BookOpen, Check } from 'lucide-react';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test';

type WirdType = 'sabaq' | 'murajaa' | 'manzil';

const WIRD_KEY = 'quran-wird-v1';

const TYPE_LABEL: Record<WirdType, string> = {
  sabaq: 'سبق (جديد)',
  murajaa: 'مراجعة',
  // Display name only (the stored key stays 'manzil'): "المحفوظ القديم"
  // reads clearly, unlike "منزل" which users did not understand, and
  // unlike "ما تم مراجعته من قبل" which would collide with مراجعة.
  manzil: 'المحفوظ القديم',
};

interface WirdState {
  target: number;
  type: WirdType;
  streak: number;
  lastDone: string; // YYYY-MM-DD local, '' when never
  doneDays: string[]; // dates marked done
}

function todayStr(d = new Date()): string {
  return d.toLocaleDateString('en-CA');
}

function loadWird(): WirdState {
  try {
    const raw = localStorage.getItem(WIRD_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.target === 'number' && typeof p.streak === 'number' && Array.isArray(p.doneDays)) {
        return { target: p.target, type: p.type || 'sabaq', streak: p.streak, lastDone: p.lastDone || '', doneDays: p.doneDays };
      }
    }
  } catch {}
  return { target: 2, type: 'sabaq', streak: 0, lastDone: '', doneDays: [] };
}

function saveWird(s: WirdState) {
  try { localStorage.setItem(WIRD_KEY, JSON.stringify(s)); } catch {}
}

// Daily wird card (v1, localStorage only): a pages-per-day target, a
// simple type (سبق / مراجعة / المحفوظ القديم), a done button, a streak counter
// and a 7-day history strip. No server, no notifications in v1.
export default function DailyWird({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const [wird, setWird] = useState<WirdState>(loadWird);
  const today = todayStr();
  const doneToday = wird.doneDays.includes(today);

  const update = (patch: Partial<WirdState>) => {
    const next = { ...wird, ...patch };
    setWird(next);
    saveWird(next);
  };

  const markDone = () => {
    if (doneToday) return;
    const yesterday = todayStr(new Date(Date.now() - 86400000));
    const streak = wird.lastDone === yesterday ? wird.streak + 1 : 1;
    update({ streak, lastDone: today, doneDays: [...wird.doneDays, today] });
  };

  // Last 7 days ending today, oldest first.
  const last7: { date: string; label: string; done: boolean; isToday: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    last7.push({
      date: todayStr(d),
      label: d.toLocaleDateString('ar-EG', { weekday: 'short' }),
      done: wird.doneDays.includes(todayStr(d)),
      isToday: i === 0,
    });
  }

  return (
    <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-1">
        <CalendarDays className="w-5 h-5 text-amber-600" />
        <h2 className="font-bold text-accent-800">وردك اليومي</h2>
        {wird.streak > 0 && (
          <span className="mr-auto flex items-center gap-1 text-sm font-bold text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full">
            <Flame className="w-4 h-4" /> {wird.streak.toLocaleString('ar-EG')} يوم متتالي
          </span>
        )}
      </div>
      <p className="text-sm text-accent-500 mb-4">
        {doneToday
          ? `تم ورد اليوم (${TYPE_LABEL[wird.type]} — ${wird.target.toLocaleString('ar-EG')} صفحة). تقبل الله منك.`
          : `ورد اليوم: ${TYPE_LABEL[wird.type]} — ${wird.target.toLocaleString('ar-EG')} صفحة. اقرأها ثم علّمها منجزة.`}
      </p>

      {!doneToday && (
        <>
          <div className="flex gap-2 mb-3 flex-wrap">
            {(Object.keys(TYPE_LABEL) as WirdType[]).map((k) => (
              <button key={k} onClick={() => update({ type: k })}
                className={`px-3 py-1.5 text-sm font-bold rounded-full transition-smooth ${wird.type === k ? 'bg-amber-500 text-white' : 'bg-gray-100 text-accent-600 hover:bg-gray-200'}`}>
                {TYPE_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm font-bold text-accent-700">صفحات اليوم:</span>
            <button onClick={() => update({ target: Math.max(1, wird.target - 1) })}
              className="w-9 h-9 text-lg font-bold bg-gray-100 hover:bg-gray-200 rounded-full">−</button>
            <span className="text-lg font-bold text-accent-800 w-8 text-center">{wird.target.toLocaleString('ar-EG')}</span>
            <button onClick={() => update({ target: Math.min(10, wird.target + 1) })}
              className="w-9 h-9 text-lg font-bold bg-gray-100 hover:bg-gray-200 rounded-full">+</button>
          </div>
        </>
      )}

      <div className="flex gap-2">
        <button onClick={() => onNavigate('mushaf')}
          className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2">
          <BookOpen className="w-5 h-5" /> {doneToday ? 'افتح المصحف' : 'ابدأ الورد'}
        </button>
        {!doneToday && (
          <button onClick={markDone}
            className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl flex items-center justify-center gap-2">
            <Check className="w-5 h-5" /> أنجزت ورد اليوم
          </button>
        )}
      </div>

      <div className="flex justify-between mt-4">
        {last7.map((d) => (
          <div key={d.date} className="flex flex-col items-center gap-1">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${d.done ? 'bg-emerald-500 text-white' : d.isToday ? 'bg-white text-accent-500 ring-2 ring-amber-400' : 'bg-gray-100 text-accent-400'}`}>
              {d.done ? <Check className="w-4 h-4" /> : d.label}
            </span>
            <span className="text-[10px] text-accent-400">{d.isToday ? 'اليوم' : d.date.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
