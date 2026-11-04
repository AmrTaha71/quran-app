import { useState } from 'react';
import { CalendarDays, Flame, Check, Settings } from 'lucide-react';
import { loadWird, saveWird, type WirdState } from '../lib/wird';
import { playSuccessCue } from '../lib/pressFeedback';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test';

function todayStr(d = new Date()): string {
  return d.toLocaleDateString('en-CA');
}

// Daily wird card (v1, localStorage only): a pages-per-day target, a
// simple type (جديد / مراجعة الحفظ الحديث / مراجعة المحفوظ القديم), a done button, a streak counter
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

  // Streak = length of the consecutive-day run ending at the latest
  // done day (recomputed, never a stored guess: retroactive toggles
  // recompute it, and it matches the old markDone rule whenever
  // doneDays was gap-free).
  const recomputeStreak = (doneDays: string[]) => {
    const set = new Set(doneDays.filter((d) => d <= today));
    const sorted = [...set].sort();
    if (sorted.length === 0) return { streak: 0, lastDone: '' };
    const lastDone = sorted[sorted.length - 1];
    let streak = 0;
    const cur = new Date(`${lastDone}T00:00:00`);
    while (set.has(todayStr(cur))) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    }
    return { streak, lastDone };
  };

  const markDone = () => {
    if (doneToday) return;
    const doneDays = [...wird.doneDays, today];
    update({ doneDays, ...recomputeStreak(doneDays) });
    playSuccessCue();
  };

  // Retroactive marking: past days toggle done/undone in the same
  // quran-wird-v1 storage. Today is NOT toggled here (the
  // "أنجزت ورد اليوم" button owns today); future days are never
  // shown in this strip, so they cannot be marked.
  const toggleDay = (date: string) => {
    const doneDays = wird.doneDays.includes(date)
      ? wird.doneDays.filter((d) => d !== date)
      : [...wird.doneDays, date];
    update({ doneDays, ...recomputeStreak(doneDays) });
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
    <div className="glass-card rounded-2xl shadow-sm p-5 h-full">
      <div className="flex items-center gap-2 mb-3">
        <CalendarDays className="w-5 h-5 text-emerald-700" />
        <h2 className="font-semibold text-ink">وردك اليومي</h2>
        {wird.streak > 0 && (
          <span className="mr-auto flex items-center gap-1 text-sm font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
            <Flame className="w-4 h-4" /> {wird.streak.toLocaleString('ar-EG')} يوم متتالي
          </span>
        )}
      </div>
      {/* Configuration moved to Settings: the card shows the wird and
          its complete action; type + pages are chosen in
          الإعدادات (this link), always available — even after today
          is marked done, so tomorrow's wird can be set any time. */}
      <button onClick={() => onNavigate('settings')}
        className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800 mb-4">
        <Settings className="w-4 h-4" /> تعديل الورد من الإعدادات
      </button>

      <div className="flex gap-2">
        {!doneToday && (
          <button onClick={markDone}
            className="flex-1 py-2.5 grad-emerald-door text-white font-bold rounded-xl flex items-center justify-center gap-2">
            <Check className="w-5 h-5" /> أنجزت ورد اليوم
          </button>
        )}
        {doneToday && (
          <p className="flex-1 py-2.5 text-center font-bold text-emerald-700 flex items-center justify-center gap-2 polish-fade-up">
            <Check className="w-5 h-5" /> أنجزت ورد اليوم
          </p>
        )}
      </div>

      <div className="flex justify-between mt-4">
        {last7.map((d) => {
          const inner = (
            <>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${d.done ? 'bg-emerald-700 text-white' : d.isToday ? 'bg-white text-ink-2 ring-2 ring-emerald-500' : 'bg-gray-100 text-ink-2'}`}>
                {d.done ? <Check className="w-4 h-4" /> : d.label}
              </span>
              <span className="text-xs text-ink-2">{d.isToday ? 'اليوم' : d.date.slice(5)}</span>
            </>
          );
          return d.isToday ? (
            <div key={d.date} className="flex flex-col items-center gap-1">{inner}</div>
          ) : (
            <button key={d.date} type="button" onClick={() => toggleDay(d.date)}
              title={d.done ? 'إلغاء علامة الإنجاز لهذا اليوم' : 'تعليم هذا اليوم كمنجز'}
              aria-label={`${d.date} ${d.done ? 'منجز — اضغط للإلغاء' : 'غير منجز — اضغط للتعليم'}`}
              className="flex flex-col items-center gap-1 cursor-pointer rounded-xl hover:opacity-80 transition">
              {inner}
            </button>
          );
        })}
      </div>
    </div>
  );
}
