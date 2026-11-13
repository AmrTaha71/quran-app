// «الصلاة القادمة» (2026-11-13): next prayer and the time left, from the
// saved Adhan location (same data as the Adhan settings). No location yet →
// the tile sends the user to Settings to set one.
import { useEffect, useState, type ReactNode } from 'react';
import { ADHAN_PRAYERS, ensureAdhanDay, loadAdhanSettings, timeInTimezone, type AdhanDay } from '../lib/adhan';

const toMin = (s: string): number | null => {
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

function nextInfo(day: AdhanDay): { label: string; left: number } | null {
  const now = toMin(timeInTimezone(day.timezone));
  if (now === null) return null;
  for (const p of ADHAN_PRAYERS) {
    const t = toMin(day.timings[p.key] ?? '');
    if (t !== null && t > now) return { label: p.label, left: t - now };
  }
  const fajr = toMin(day.timings['Fajr'] ?? '');
  return fajr === null ? null : { label: 'الفجر', left: fajr + 1440 - now };
}

const ar = (n: number) => n.toLocaleString('ar-EG');
function leftText(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return `بعد ${ar(m)} د`;
  return m === 0 ? `بعد ${ar(h)} س` : `بعد ${ar(h)} س ${ar(m)} د`;
}

export default function NextPrayerTile({ icon, onNoLocation, onPress }: { icon: ReactNode; onNoLocation: () => void; onPress?: () => void }) {
  const [day, setDay] = useState<AdhanDay | null>(null);
  const [tick, setTick] = useState(0);
  const hasLoc = !!loadAdhanSettings().location;

  useEffect(() => {
    let alive = true;
    const loc = loadAdhanSettings().location;
    if (loc) ensureAdhanDay(loc).then((d) => alive && setDay(d)).catch(() => {});
    const id = window.setInterval(() => setTick((t) => t + 1), 30000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  void tick;
  const info = day ? nextInfo(day) : null;
  return (
    <button type="button" onClick={() => (hasLoc ? onPress?.() : onNoLocation())} aria-label="موعد الصلاة القادمة" className="home-tile polish-focus !min-h-0">
      <span className="tile-medal tile-medal-night" aria-hidden="true">{icon}</span>
      <span className="home-tile-title">{info ? info.label : 'موعد الصلاة'}</span>
      <span className="home-tile-hint">{info ? leftText(info.left) : hasLoc ? '…' : 'حدّد موقعك'}</span>
    </button>
  );
}
