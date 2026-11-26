// 15.11: settings card for the daily review reminder.
import { useState } from 'react';
import { Bell } from 'lucide-react';
import { loadReviewReminder, saveReviewReminder, type ReviewReminder } from '../lib/reviewReminder';
import { isNativeApp } from '../lib/nativeAlarm';

export default function ReviewReminderCard() {
  const [r, setR] = useState<ReviewReminder>(loadReviewReminder);
  const [msg, setMsg] = useState('');
  const apply = async (next: ReviewReminder) => {
    setR(next);
    const res = await saveReviewReminder(next);
    setMsg(!res.ok ? (res.reason === 'notifications-denied' ? 'لازم تسمح بالإشعارات عشان التذكير يوصلك.' : 'ما قدرناش نضبط التذكير — جرّب تاني.') : next.on ? 'اتظبط ✓' : 'اتقفل');
  };
  return (
    <section className="glass-card rounded-2xl p-5 md:p-6 space-y-3">
      <h3 className="font-semibold text-accent-800 flex items-center gap-2"><Bell className="w-5 h-5 text-emerald-700" /> تذكير المراجعة اليومي</h3>
      <label className="flex items-center justify-between gap-3 min-h-[44px]">
        <span className="text-base text-ink">فكّرني أراجع كل يوم</span>
        <input type="checkbox" checked={r.on} onChange={(e) => void apply({ ...r, on: e.target.checked })} className="w-6 h-6 accent-emerald-700" />
      </label>
      <label className="flex items-center justify-between gap-3 min-h-[44px]">
        <span className="text-base text-ink">الساعة</span>
        <input type="time" value={r.time} onChange={(e) => void apply({ ...r, time: e.target.value || r.time })}
          className="min-h-[44px] rounded-xl border border-hairline px-3 text-base" dir="ltr" />
      </label>
      <p className="text-xs text-ink-2 leading-relaxed">
        {isNativeApp()
          ? 'التذكير بيوصلك في معاده حتى لو التطبيق مقفول، ومعاه عدد الكلمات اللي مستنياك.'
          : 'في المتصفح التذكير بيظهر لو التطبيق مفتوح وقت المعاد (أو أول ما تفتحه بعده). في تطبيق الموبايل بيوصلك حتى لو مقفول.'}
      </p>
      {msg && <p className="text-sm font-semibold text-accent-700" role="status">{msg}</p>}
    </section>
  );
}
