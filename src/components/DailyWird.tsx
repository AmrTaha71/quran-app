import { useState } from 'react';
import { CalendarDays, Flame, BookOpen, Check, Settings } from 'lucide-react';
import { loadWird, saveWird, WIRD_TYPE_LABEL, type WirdState } from '../lib/wird';

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
          ? `تم ورد اليوم (${WIRD_TYPE_LABEL[wird.type]} — ${wird.target.toLocaleString('ar-EG')} صفحة). تقبل الله منك.`
          : `ورد اليوم: ${WIRD_TYPE_LABEL[wird.type]} — ${wird.target.toLocaleString('ar-EG')} صفحة. اقرأها ثم علّمها منجزة.`}
      </p>

      {/* Configuration moved to Settings: the card shows the wird and
          its start/complete actions; type + pages are chosen in
          الإعدادات (this link), always available — even after today
          is marked done, so tomorrow's wird can be set any time. */}
      <button onClick={() => onNavigate('settings')}
        className="flex items-center gap-1.5 text-sm font-bold text-amber-700 hover:text-amber-800 mb-4">
        <Settings className="w-4 h-4" /> تعديل الورد من الإعدادات
      </button>

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
