import { useEffect, useRef, useState } from 'react';
import {
  ADHAN_PRAYERS,
  adhanAlreadyFired,
  ensureAdhanDay,
  loadAdhanSettings,
  markAdhanFired,
  playAdhanSound,
  timeInTimezone,
  type AdhanPrayerKey,
} from '../lib/adhan';

// App-wide foreground adhan scheduler. Mounted once in App, outside
// the login gate, so alerts work on any route while the app is open.
// Honest limits: it cannot fire while the app is closed (iOS web
// apps get no background execution), and iOS may block the first
// alert's audio until the user has tapped something in this session
// (the Settings test button counts as that tap).
export default function AdhanScheduler() {
  const [banner, setBanner] = useState<{ prayer: AdhanPrayerKey; label: string } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const settings = loadAdhanSettings();
      if (!settings.enabled || !settings.location) return;
      let day;
      try {
        day = await ensureAdhanDay(settings.location);
      } catch {
        return; // No timings today (offline/API down) — retry next tick.
      }
      if (stopped) return;
      const now = timeInTimezone(day.timezone);
      for (const p of ADHAN_PRAYERS) {
        const t = day.timings[p.key];
        if (!t) continue;
        if (t === now && !adhanAlreadyFired(day.dateKey, p.key)) {
          markAdhanFired(day.dateKey, p.key);
          audioRef.current?.pause();
          audioRef.current = playAdhanSound(settings.sound);
          if (settings.alertType === 'both') {
            setBanner({ prayer: p.key, label: p.label });
          }
          break;
        }
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 30000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      audioRef.current?.pause();
    };
  }, []);

  if (!banner) return null;
  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-md" dir="rtl">
      <div className="bg-emerald-700 text-white rounded-2xl shadow-2xl p-4">
        <p className="font-bold text-lg">🕌 حان الآن وقت صلاة {banner.label}</p>
        <p className="text-sm text-emerald-100 mt-1">تقبّل الله منا ومنكم</p>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => {
              audioRef.current?.pause();
              audioRef.current = null;
              setBanner(null);
            }}
            className="flex-1 py-2 bg-white text-emerald-800 font-bold rounded-xl"
          >
            إيقاف الصوت وإغلاق
          </button>
          <button
            onClick={() => setBanner(null)}
            className="flex-1 py-2 bg-emerald-600 text-white font-bold rounded-xl"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
