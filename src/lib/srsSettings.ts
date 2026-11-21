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

/** Index of the first stage shorter than the stage before it, or -1 when
 *  every stage is at least as long as the previous one (equal is allowed). */
export function findOrderViolation(days: readonly number[]): number {
  for (let i = 1; i < days.length; i++) if (days[i] < days[i - 1]) return i;
  return -1;
}

/** One whole-day gap per stage, same length as the defaults, each stage not
 *  shorter than the one before it. */
function isValidList(x: unknown): x is number[] {
  return Array.isArray(x) && x.length === SRS_DEFAULT_INTERVALS_DAYS.length &&
    x.every(isDays) && findOrderViolation(x) === -1;
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

export type IntervalCheck =
  | { ok: true; days: number[] }
  | { ok: false; reason: 'format' }
  | { ok: false; reason: 'order'; index: number };

/** Validate the text fields: format first, then the ordering rule (each stage
 *  at least as long as the one before it). `index` is the 0-based stage that
 *  breaks the order. */
export function checkIntervalInputs(values: readonly string[]): IntervalCheck {
  const days = parseIntervalInputs(values);
  if (!days) return { ok: false, reason: 'format' };
  const index = findOrderViolation(days);
  return index === -1 ? { ok: true, days } : { ok: false, reason: 'order', index };
}

/** Save the gaps. Returns false (and writes nothing) when the list is not
 *  valid (format, range or order) or storage failed. Saving exactly the defaults clears the key. */
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
