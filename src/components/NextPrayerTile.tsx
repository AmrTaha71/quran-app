// «الصلاة القادمة» (2026-11-13): next prayer and the time left, from the
// saved Adhan location (same data as the Adhan settings). No location yet →
// the tile sends the user to Settings to set one.
import { useEffect, useState, type ReactNode } from 'react';
import { ADHAN_PRAYERS, ensureAdhanDay, loadAdhanSettings, timeInTimezone, type AdhanDay } from '../lib/adhan';

const toMin = (s: string): number | null => {
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Seconds since midnight in the location's time zone. */
function nowSec(tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const v = g('hour') * 3600 + g('minute') * 60 + g('second');
    return Number.isFinite(v) ? v : null;
  } catch {
    const m = toMin(timeInTimezone(tz));
    return m === null ? null : m * 60;
  }
}

function nextInfo(day: AdhanDay): { label: string; left: number } | null {
  const now = nowSec(day.timezone);
  if (now === null) return null;
  for (const p of ADHAN_PRAYERS) {
    const t = toMin(day.timings[p.key] ?? '');
    if (t !== null && t * 60 > now) return { label: p.label, left: t * 60 - now };
  }
  const fajr = toMin(day.timings['Fajr'] ?? '');
  return fajr === null ? null : { label: 'الفجر', left: fajr * 60 + 86400 - now };
}

const ar = (n: number) => n.toLocaleString('ar-EG');
function leftText(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  return `${h > 0 ? `${ar(h)} س ` : ''}${ar(m)} د ${ar(x)} ث`;
}

export default function NextPrayerTile({ icon, onNoLocation, onPress }: { icon: ReactNode; onNoLocation: () => void; onPress?: () => void }) {
  const [day, setDay] = useState<AdhanDay | null>(null);
  const [tick, setTick] = useState(0);
  const hasLoc = !!loadAdhanSettings().location;

  useEffect(() => {
    let alive = true;
    const loc = loadAdhanSettings().location;
    if (loc) ensureAdhanDay(loc).then((d) => alive && setDay(d)).catch(() => {});
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  void tick;
  const info = day ? nextInfo(day) : null;
  return (
    <button type="button" onClick={() => (hasLoc ? onPress?.() : onNoLocation())} aria-label="موعد الصلاة القادمة" className="home-tile polish-focus !min-h-0">
      <span className="tile-medal tile-medal-night" aria-hidden="true">{icon}</span>
      <span className="home-tile-title">{info ? info.label : 'موعد الصلاة'}</span>
      <span className="home-tile-hint tabular-nums">{info ? leftText(info.left) : hasLoc ? '…' : 'حدّد موقعك'}</span>
    </button>
  );
}
