// Per-day listening / reading seconds (local only) + the daily report setting.
import { anyAudioPlaying } from './pressFeedback';

const KEY = 'quran-daily-stats-v1';
const SET_KEY = 'quran-daily-report-v1';
type Day = { listen: number; read: number };

export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function load(): Record<string, Day> { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
export function getDay(date = todayKey()): Day { return load()[date] ?? { listen: 0, read: 0 }; }
function add(kind: keyof Day, sec: number) {
  try {
    const all = load(); const k = todayKey();
    all[k] = { ...(all[k] ?? { listen: 0, read: 0 }) };
    all[k][kind] += sec;
    const keep = Object.keys(all).sort().slice(-14);
    const out: Record<string, Day> = {}; keep.forEach((x) => { out[x] = all[x]; });
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch { /* ignore */ }
}

/** Call every ~10 s: audio playing counts as listening, a visible mushaf as reading. */
export function tickStats(route: string, seconds = 10): void {
  if (anyAudioPlaying()) add('listen', seconds);
  else if ((route === 'mushaf' || route === 'follow') && !document.hidden) add('read', seconds);
}

export interface ReportSettings { on: boolean; time: string; lastShown: string }
export function loadReportSettings(): ReportSettings {
  try { return { on: true, time: '21:00', lastShown: '', ...JSON.parse(localStorage.getItem(SET_KEY) || '{}') }; } catch { return { on: true, time: '21:00', lastShown: '' }; }
}
export function saveReportSettings(s: ReportSettings): void { try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
