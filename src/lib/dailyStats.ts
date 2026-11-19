// Per-day listening / reading seconds (local only) + the daily report setting.
import { anyAudioPlaying } from './pressFeedback';

const KEY = 'quran-daily-stats-v1';
const SET_KEY = 'quran-daily-report-v1';
type Day = { listen: number; read: number; open: number };

export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function load(): Record<string, Day> { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
const norm = (d?: Partial<Day>): Day => ({ listen: d?.listen ?? 0, read: d?.read ?? 0, open: d?.open ?? 0 });
export function getDay(date = todayKey()): Day { return norm(load()[date]); }
function add(kind: keyof Day, sec: number) {
  try {
    const all = load(); const k = todayKey();
    all[k] = norm(all[k]);
    all[k][kind] += sec;
    const keep = Object.keys(all).sort().slice(-14);
    const out: Record<string, Day> = {}; keep.forEach((x) => { out[x] = all[x]; });
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch { /* ignore */ }
}

/** Call every ~10 s: audio playing counts as listening, a visible mushaf as reading. */
export function tickStats(route: string, seconds = 10): void {
  watchActivity();
  const audio = anyAudioPlaying();
  if (audio) add('listen', seconds);
  else if ((route === 'mushaf' || route === 'follow') && !document.hidden) add('read', seconds);
  // W4-H: time with the app = page visible AND (sound playing OR a touch / key in
  // the last 2 minutes). A screen left on while asleep is not counted.
  if (!document.hidden && (audio || Date.now() - lastTouch < ACTIVE_WINDOW_MS)) {
    add('open', seconds);
    markActive();
  }
}

const ACTIVE_WINDOW_MS = 120000;
const LAST_ACTIVE_KEY = 'quran-last-active-v1';
export const RECAP_AFTER_MS = 30 * 60 * 1000;
let lastTouch = 0;
let watching = false;
function watchActivity(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const touch = () => { lastTouch = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'scroll']) window.addEventListener(ev, touch, { passive: true, capture: true });
  touch();
}
export function markActive(): void { try { localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())); } catch { /* ignore */ } }
export function msSinceActive(): number {
  try { const v = Number(localStorage.getItem(LAST_ACTIVE_KEY)); return v ? Date.now() - v : 0; } catch { return 0; }
}

/** Ask the global watcher (DailyReportWatcher) to show «إنجاز اليوم» + «تقبّل الله منك». */
export const DAY_RECAP_EVENT = 'quran-day-recap';
export function requestDayRecap(): void { try { window.dispatchEvent(new CustomEvent(DAY_RECAP_EVENT)); } catch { /* ignore */ } }

export interface ReportSettings { on: boolean; time: string; lastShown: string }
export function loadReportSettings(): ReportSettings {
  try { return { on: true, time: '21:00', lastShown: '', ...JSON.parse(localStorage.getItem(SET_KEY) || '{}') }; } catch { return { on: true, time: '21:00', lastShown: '' }; }
}
export function saveReportSettings(s: ReportSettings): void { try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
