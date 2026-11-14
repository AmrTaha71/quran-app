// «إنجاز اليوم»: at the time the user picked, once a day, a card with what
// they listened, read, memorized and how today's tests went — as coloured
// bars under a word of encouragement. Shown only while the app is open.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getDay, loadReportSettings, saveReportSettings, todayKey } from '../lib/dailyStats';
import { loadWird, wirdTotal } from '../lib/wird';
import DrumSelect from './DrumSelect';

interface T { date: string; total: number; correct: number; surahName?: string }
function todaysTests(): T[] {
  try {
    const h = JSON.parse(localStorage.getItem('quran-test-history') || '[]') as T[];
    const utc = new Date().toISOString().slice(0, 10), loc = todayKey();
    return h.filter((r) => r.date === utc || r.date === loc);
  } catch { return []; }
}
const mins = (s: number) => Math.round(s / 60);
const ar = (n: number) => n.toLocaleString('ar-EG');

function cheer(score: number): string {
  if (score >= 3) return 'ما شاء الله، يوم عامر بالقرآن — ثبّتك الله وزادك';
  if (score >= 2) return 'بارك الله فيك، خطوة بعد خطوة والختمة قريبة';
  if (score >= 1) return 'بداية طيبة، وقليل دائم خير من كثير منقطع';
  return 'لسه فيه وقت — دقايق مع كتاب الله تغيّر يومك';
}

export function DailyReportWatcher() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => {
      const s = loadReportSettings();
      if (!s.on || s.lastShown === todayKey()) return;
      const now = new Date(); const [h, m] = s.time.split(':').map(Number);
      if (now.getHours() * 60 + now.getMinutes() >= h * 60 + m) { saveReportSettings({ ...s, lastShown: todayKey() }); setOpen(true); }
    };
    check();
    const iv = window.setInterval(check, 30000);
    return () => window.clearInterval(iv);
  }, []);
  return open ? <DailyReportCard onClose={() => setOpen(false)} /> : null;
}

export function DailyReportCard({ onClose }: { onClose: () => void }) {
  const d = getDay(); const tests = todaysTests();
  const w = loadWird(); const wirdDone = w.doneDays.includes(todayKey()); const pages = wirdDone ? wirdTotal(w.parts) : 0;
  const tc = tests.reduce((a, r) => a + r.correct, 0), tt = tests.reduce((a, r) => a + r.total, 0);
  const pct = tt ? Math.round((tc / tt) * 100) : 0;
  const bars = [
    { label: 'سمعت', val: `${ar(mins(d.listen))} د`, f: Math.min(1, d.listen / 1800), c: 'bg-sky-500' },
    { label: 'قرأت', val: `${ar(mins(d.read))} د`, f: Math.min(1, d.read / 900), c: 'bg-amber-500' },
    { label: 'حفظت', val: wirdDone ? `${ar(pages)} ص` : '—', f: wirdDone ? 1 : 0, c: 'bg-emerald-600' },
    { label: 'اختباراتك', val: tests.length ? `${ar(pct)}٪` : '—', f: pct / 100, c: 'bg-rose-500' },
  ];
  const score = (d.listen >= 600 ? 1 : 0) + (d.read >= 300 ? 1 : 0) + (wirdDone ? 1 : 0) + (tests.length ? 1 : 0);
  return (
    <div dir="rtl" className="fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-sm rounded-3xl p-5 max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-xl font-bold font-display-ar text-ink">إنجاز اليوم</h2>
          <button onClick={onClose} aria-label="إغلاق" className="p-1"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-base font-semibold text-emerald-800 mt-2 leading-relaxed">{cheer(score)}</p>
        <div className="mt-4 flex items-end justify-between gap-3 h-44">
          {bars.map((b) => (
            <div key={b.label} className="flex-1 flex flex-col items-center justify-end h-full">
              <span className="text-sm font-bold text-ink mb-1">{b.val}</span>
              <div className="w-full rounded-t-xl bg-gray-100 flex items-end" style={{ height: '70%' }}>
                <div className={`w-full rounded-t-xl ${b.c}`} style={{ height: `${Math.max(b.f * 100, b.f > 0 ? 6 : 0)}%` }} />
              </div>
              <span className="text-xs text-ink-2 mt-1.5 font-semibold">{b.label}</span>
            </div>
          ))}
        </div>
        {tests.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {tests.slice(0, 4).map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="w-24 truncate text-ink-2">{r.surahName || 'اختبار'}</span>
                <div className="flex-1 h-3 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-rose-500" style={{ width: `${r.total ? (r.correct / r.total) * 100 : 0}%` }} /></div>
                <span className="w-12 text-left font-bold">{ar(r.correct)}/{ar(r.total)}</span>
              </div>
            ))}
          </div>
        )}
        <button onClick={onClose} className="btn-3d mt-5 w-full py-3 bg-emerald-600 text-white font-bold rounded-2xl">تمام</button>
      </div>
    </div>
  );
}

/** Settings block: on/off and the time of day. */
export function DailyReportSettings() {
  const [s, setS] = useState(loadReportSettings);
  const [h, m] = s.time.split(':').map(Number);
  const upd = (n: Partial<typeof s>) => { const v = { ...s, ...n }; setS(v); saveReportSettings(v); };
  return (
    <div className="mt-5 p-4 rounded-xl border-2 border-hairline bg-white space-y-3">
      <button type="button" onClick={() => upd({ on: !s.on })} aria-pressed={s.on} className="w-full flex items-center justify-between">
        <span className="font-bold text-accent-800">إنجاز اليوم</span>
        <span className={`w-12 h-7 rounded-full p-1 ${s.on ? 'bg-amber-500' : 'bg-gray-300'}`}>
          <span className={`block w-5 h-5 bg-white rounded-full shadow ${s.on ? 'ltr:translate-x-5 rtl:-translate-x-5' : ''}`} />
        </span>
      </button>
      {s.on && (
        <div className="grid grid-cols-2 gap-2">
          <DrumSelect label="الساعة" value={h} onChange={(v) => upd({ time: `${String(v).padStart(2, '0')}:${String(m).padStart(2, '0')}` })}
            options={Array.from({ length: 24 }, (_, i) => ({ value: i, label: `${ar(i)}` }))} />
          <DrumSelect label="الدقيقة" value={m} onChange={(v) => upd({ time: `${String(h).padStart(2, '0')}:${String(v).padStart(2, '0')}` })}
            options={Array.from({ length: 12 }, (_, i) => ({ value: i * 5, label: `${ar(i * 5)}` }))} />
        </div>
      )}
    </div>
  );
}
