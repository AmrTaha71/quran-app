// One formatter for every user-facing number (S6 platform/UX batch).
//
// The bug: Western digits leaked into Arabic surfaces (Landing stats used
// bare toLocaleString(), admin pagination rendered raw `page + 1`, self-test
// history rendered raw from/to/correct/total, the Mushaf page-number input
// rendered a Western total, and لوحتي hard-coded the literal "6,236").
// Everything below routes through here so the digit system can never drift
// apart again. Arabic UI uses Arabic-Indic digits (ar-EG grouping); Latin
// UI (en/fr) keeps Western digits.

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';

/** Convert Western digits in a value to Arabic-Indic digits (no grouping). */
export function toArabicIndic(value: number | string): string {
  return String(value).replace(/\d/g, (d) => ARABIC_INDIC[Number(d)]);
}

/** Grouped Arabic-Indic rendering, e.g. 6236 -> "٦٬٢٣٦". */
export function formatAr(value: number): string {
  return value.toLocaleString('ar-EG');
}

/** Locale-aware grouped rendering: Arabic-Indic for ar/ar-EG, Western otherwise. */
export function formatNum(value: number, lang?: string): string {
  return lang === 'ar' || lang === 'ar-EG'
    ? formatAr(value)
    : value.toLocaleString('en-US');
}
