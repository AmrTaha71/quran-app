// «اؤمرني» voice command parser (2026-11-08). Keyword + surah-name
// matching only: no AI, no network, no cost. Returns null when the
// sentence is not understood, so nothing wrong ever opens.
import { SURAHS, SURAH_AYAH_COUNTS } from './surahs';

export type VoiceAction =
  | { kind: 'mushaf'; surah: number | null }
  | { kind: 'listen'; surah: number | null }
  | { kind: 'test'; surah: number | null }
  | { kind: 'mutashabihat' }
  | { kind: 'route'; route: 'adhkar' | 'follow' | 'settings' | 'room' | 'app' }
  | { kind: 'elderly' };

function norm(s: string): string {
  return s
    .replace(/[ً-ْٰـ]/g, '') // tashkeel + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Longest surah name found in the sentence (so "الملك" never loses to a shorter hit). */
export function findSurah(text: string): number | null {
  const t = ` ${norm(text)} `;
  let best: { no: number; len: number } | null = null;
  for (const s of SURAHS) {
    const n = norm(s.name);
    const bare = n.replace(/^ال/, '');
    const hit = t.includes(` ${n} `) || t.includes(` ${n}`) || (bare.length >= 3 && t.includes(` ${bare}`));
    if (hit && (!best || n.length > best.len)) best = { no: s.no, len: n.length };
  }
  return best ? best.no : null;
}

const has = (t: string, words: string[]) => words.some((w) => t.includes(norm(w)));

export function parseVoiceCommand(raw: string): VoiceAction | null {
  const t = norm(raw);
  if (!t) return null;
  const surah = findSurah(raw);
  if (has(t, ['متشابه', 'المتشابهات'])) return { kind: 'mutashabihat' };
  if (has(t, ['اذكار', 'الاذكار', 'ذكر الصباح', 'ذكر المساء'])) return { kind: 'route', route: 'adhkar' };
  if (has(t, ['الامام', 'الحق الامام', 'صلاه', 'التراويح'])) return { kind: 'route', route: 'follow' };
  if (has(t, ['اعدادات', 'الاعدادات'])) return { kind: 'route', route: 'settings' };
  if (has(t, ['رفيق', 'صديق', 'الغرفه', 'رفيقتي'])) return { kind: 'route', route: 'room' };
  if (has(t, ['جدو', 'جده', 'كبير السن'])) return { kind: 'elderly' };
  if (has(t, ['لوحتي', 'لوحه'])) return { kind: 'route', route: 'app' };
  // Recite (test) before listen: "سمعني/سمع لنفسي/اسمع" overlap.
  if (has(t, ['سمعلي', 'سمع لي', 'اسمع لك', 'اسمعها', 'اسمع نفسي', 'سمع لنفسي', 'اختبر', 'اختبرني', 'تسميع', 'اسمعه', 'اسمع حفظي', 'احفظ'])) return { kind: 'test', surah };
  if (has(t, ['اسمع', 'سمعني', 'شغل', 'استماع', 'استمع'])) return { kind: 'listen', surah };
  if (has(t, ['اقرا', 'المصحف', 'مصحف', 'افتح', 'قراءه', 'قرايه'])) return { kind: 'mushaf', surah };
  // Only a surah name: open it in the mushaf.
  if (surah) return { kind: 'mushaf', surah };
  return null;
}

/** Global ayah range (1..6236) of a surah, for the test preset. */
export function surahGlobalRange(surah: number): { start: number; end: number } {
  let start = 1;
  for (let i = 0; i < surah - 1; i++) start += SURAH_AYAH_COUNTS[i];
  return { start, end: start + SURAH_AYAH_COUNTS[surah - 1] - 1 };
}

export function surahName(surah: number): string {
  return SURAHS.find((s) => s.no === surah)?.name ?? '';
}
