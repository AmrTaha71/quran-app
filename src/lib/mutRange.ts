// Range for the mutashabihat questions (W4-M): the whole Quran, one surah or one juz,
// picked on the drum or asked by voice («سورة الكهف» / «الجزء ٣٠»). A clue belongs to
// a range when at least one of its ayat is inside it (the other ayat may be anywhere:
// that is what a mutashabih is).
import { SURAHS, getGlobalAyahNumber } from './surahs';
import { rangeOf } from './comprehensiveTest';
import { findSurah, norm } from './voiceCommand';

export type MutRange = { scope: 'all' | 'surah' | 'juz'; n: number };
export const MUT_ALL: MutRange = { scope: 'all', n: 0 };

/** Global ayah span (inclusive) of a range, null = the whole Quran. */
export function mutSpan(r: MutRange): { start: number; end: number } | null {
  if (r.scope === 'all') return null;
  const x = rangeOf(r.scope, r.n);
  return { start: x.start, end: x.end - 1 };
}

export function bankInSpan<T extends { answers: string[] }>(bank: T[], span: { start: number; end: number } | null): T[] {
  if (!span) return bank;
  return bank.filter((b) => b.answers.some((k) => {
    const [s, a] = k.split(':').map(Number);
    const g = getGlobalAyahNumber(s, a);
    return g >= span.start && g <= span.end;
  }));
}

export function mutRangeLabel(r: MutRange): string {
  if (r.scope === 'all') return 'كل القرآن';
  return r.scope === 'surah' ? `سورة ${SURAHS[r.n - 1]?.name ?? ''}` : `الجزء ${r.n.toLocaleString('ar-EG')}`;
}

const UNITS: Record<string, number> = {
  واحد: 1, احد: 1, اول: 1, حادي: 1, اثنين: 2, اثنان: 2, اثنا: 2, ثاني: 2, ثالث: 3, ثلاثه: 3, رابع: 4, اربعه: 4, خامس: 5, خمسه: 5,
  سادس: 6, سته: 6, سابع: 7, سبعه: 7, ثامن: 8, ثمانيه: 8, تاسع: 9, تسعه: 9, عاشر: 10, عشره: 10,
};
const TENS: Record<string, number> = { عشرين: 20, عشرون: 20, ثلاثين: 30, ثلاثون: 30 };
const strip = (t: string) => norm(t).replace(/^و/, '').replace(/^ال/, '');

/** «الثالث والعشرين» / «٣٠» / «خمسة عشر» / «عم» -> 1..30 or null. */
function juzNumber(tokens: string[]): number | null {
  const digits = norm(tokens.join(' ')).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).match(/\d+/);
  if (digits) { const n = Number(digits[0]); return n >= 1 && n <= 30 ? n : null; }
  let total = 0, read = false;
  for (let i = 0; i < Math.min(4, tokens.length); i++) {
    const t = strip(tokens[i]);
    if (t === 'عم' && !read) return 30;
    const next = tokens[i + 1] ? strip(tokens[i + 1]) : '';
    if (TENS[t]) { total += TENS[t]; read = true; }
    else if (UNITS[t]) {
      if (next === 'عشر' || (t !== 'عشره' && next === 'عشره')) { total += UNITS[t] + 10; i++; } else total += UNITS[t];
      read = true;
    } else if (read) break;
  }
  return read && total >= 1 && total <= 30 ? total : null;
}

/** Understands «سورة الكهف», «الجزء ٣٠», «الجزء الثالث والعشرين», «جزء عم», «كل القرآن».
 *  Surah names reuse voiceCommand.findSurah. null = not understood (nothing changes). */
export function parseRangeSpeech(raw: string): MutRange | null {
  const t = norm(raw);
  if (!t) return null;
  const tokens = t.split(' ');
  const j = tokens.findIndex((x) => x === 'جزء' || x === 'الجزء' || x === 'الجز');
  if (j >= 0) { const n = juzNumber(tokens.slice(j + 1)); if (n) return { scope: 'juz', n }; }
  const s = findSurah(raw);
  if (s) return { scope: 'surah', n: s };
  if (t.includes('كل القران') || t.includes('القران كله') || t.includes('القران كامل')) return MUT_ALL;
  return null;
}
