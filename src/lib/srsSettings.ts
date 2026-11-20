// SRS settings (step 3, spec 2026-11-20 §4): the review gaps, editable by the
// user in days. One new local-only key. Nothing here touches the review
// table (quran-srs-v1): changing the gaps affects FUTURE scheduling only, a
// word already in the table keeps its current due time until it is reviewed
// next (the caller passes loadSrsIntervals() to the srsStore functions).
//
// The default list is SRS_DEFAULT_INTERVALS_DAYS from srs.ts. Only a list the
// user actually changed is stored: saving the defaults (or pressing reset)
// removes the key, so a user who never customized keeps following the
// defaults if they are changed later. A stored value that is not valid
// reads as "not set" and goes through sanitizeIntervals (back to defaults).
//
// Best-effort like the other stores: a missing, corrupt or full localStorage
// never throws.

import { SRS_DEFAULT_INTERVALS_DAYS, sanitizeIntervals } from './srs.ts';
import { normalizeDigits } from './numerals.ts';

export const SRS_SETTINGS_KEY = 'quran-srs-settings-v1';

/** Allowed range for one gap, in whole days (UI validation bounds). */
export const SRS_INTERVAL_MIN_DAYS = 1;
export const SRS_INTERVAL_MAX_DAYS = 365;

function isDays(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) &&
    x >= SRS_INTERVAL_MIN_DAYS && x <= SRS_INTERVAL_MAX_DAYS;
}

/** One whole-day gap per stage, same length as the defaults. */
function isValidList(x: unknown): x is number[] {
  return Array.isArray(x) && x.length === SRS_DEFAULT_INTERVALS_DAYS.length && x.every(isDays);
}

/** The gaps to schedule with: the saved list, or the defaults. */
export function loadSrsIntervals(): readonly number[] {
  try {
    const raw = localStorage.getItem(SRS_SETTINGS_KEY);
    if (raw) {
      const p: unknown = JSON.parse(raw);
      const iv = p && typeof p === 'object' ? (p as { iv?: unknown }).iv : null;
      return sanitizeIntervals(isValidList(iv) ? iv : null);
    }
  } catch { /* unreadable: use the defaults */ }
  return sanitizeIntervals(null);
}

/** True when the saved gaps differ from the defaults. */
export function hasCustomSrsIntervals(): boolean {
  const cur = loadSrsIntervals();
  return cur.some((d, i) => d !== SRS_DEFAULT_INTERVALS_DAYS[i]);
}

/** Text fields (Arabic-Indic or Western digits) -> days, or null when any
 *  field is empty, not a whole number, out of range, or the count is wrong. */
export function parseIntervalInputs(values: readonly string[]): number[] | null {
  if (values.length !== SRS_DEFAULT_INTERVALS_DAYS.length) return null;
  const out: number[] = [];
  for (const v of values) {
    const t = normalizeDigits(String(v)).trim();
    if (!/^\d+$/.test(t)) return null;
    const n = Number(t);
    if (!isDays(n)) return null;
    out.push(n);
  }
  return out;
}

/** Save the gaps. Returns false (and writes nothing) when the list is not
 *  valid or storage failed. Saving exactly the defaults clears the key. */
export function saveSrsIntervals(days: readonly number[]): boolean {
  if (!isValidList(days)) return false;
  try {
    if (days.every((d, i) => d === SRS_DEFAULT_INTERVALS_DAYS[i])) {
      localStorage.removeItem(SRS_SETTINGS_KEY);
    } else {
      localStorage.setItem(SRS_SETTINGS_KEY, JSON.stringify({ iv: [...days] }));
    }
    return true;
  } catch { return false; }
}

/** Back to the defaults. */
export function resetSrsIntervals(): boolean {
  try { localStorage.removeItem(SRS_SETTINGS_KEY); return true; }
  catch { return false; }
}
