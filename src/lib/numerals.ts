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

/**
 * Convert Arabic-Indic digits (٠-٩, U+0660–U+0669) and Eastern Arabic digits
 * (۰-۹, U+06F0–U+06F9) in a string to Western digits (0-9).
 *
 * The app DISPLAYS Arabic-Indic digits everywhere, but `type="number"`
 * inputs reject non-ASCII digits at the browser level (the HTML value
 * sanitization algorithm only accepts ASCII floating-point numbers), so
 * typing ٣٦ into a number input yields an empty value and parseInt/Number
 * return NaN. Typed inputs therefore use `type="text" inputMode="numeric"`
 * and run their value through this function before every numeric parse.
 * Display formatting (toArabicIndic / formatAr) is untouched.
 */
export function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
}
