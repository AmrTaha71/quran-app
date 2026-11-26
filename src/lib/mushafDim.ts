// Item 5.14 (owner decision §11.16, 2026-11-26): an OPTIONAL real dim
// of the Mushaf page scans, only from 21:00 local time until sunrise.
// Off by default. It dims the scan image alone (class .mushaf-scan) —
// never the ayah highlight or the controls, and it is not an overlay.
// Sunrise comes from the adhan day the app already cached (aladhan
// timings); without one it falls back to 06:00.
export const MUSHAF_DIM_KEY = 'quran-mushaf-dim';
const ADHAN_DAY_KEY = 'quran-adhan-day';

export function isMushafDimOn(): boolean {
  try { return localStorage.getItem(MUSHAF_DIM_KEY) === '1'; } catch { return false; }
}

function cachedSunriseMinutes(): number | null {
  try {
    const raw = localStorage.getItem(ADHAN_DAY_KEY);
    if (!raw) return null;
    const t = (JSON.parse(raw) as { day?: { timings?: Record<string, string> } }).day?.timings?.Sunrise;
    const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  } catch { return null; }
}

/** True from 21:00 until sunrise (local time). */
export function inDimWindow(now: Date, sunriseMin: number | null = cachedSunriseMinutes()): boolean {
  const min = now.getHours() * 60 + now.getMinutes();
  return min >= 21 * 60 || min < (sunriseMin ?? 6 * 60);
}

export function applyMushafDim(now: Date = new Date()): void {
  try {
    if (isMushafDimOn() && inDimWindow(now)) document.documentElement.dataset.mushafDim = '1';
    else delete document.documentElement.dataset.mushafDim;
  } catch { /* decorative */ }
}

export function setMushafDim(on: boolean): void {
  try { localStorage.setItem(MUSHAF_DIM_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  applyMushafDim();
}

if (typeof document !== 'undefined') {
  applyMushafDim();
  // Re-check each minute so 21:00 and sunrise take effect on their own.
  setInterval(() => applyMushafDim(), 60_000);
}
