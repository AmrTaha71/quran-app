// Mushaf-page → ayah-range resolution for the SelfTest range picker
// (بالصفحة, 2026-11-06). One request per page to the AlQuranCloud
// page endpoint (already used by the app for tafsir, no key):
//   GET https://api.alquran.cloud/v1/page/{1..604}/quran-uthmani
// The response lists the page's ayahs in order; first→last is the
// page's range (contiguous in global order), so the existing
// startTestGlobal(first.global, last.global) runs it — even when the
// page spans surahs (the recording-mode single-surah rule then
// disables the start button, as before). Resolved ranges are cached
// in localStorage per page, so a repeat visit needs no network.
//
// Why AlQuranCloud and not the Mushaf's Quranpedia lists, and not
// SURAH_START_PAGES — verified 2026-11-06 against the Madinah page
// IMAGES the app itself displays:
// - Quranpedia's mushaf 1 is a DIFFERENT print: surah 67 starts on
//   its page 562 (Madinah: 556), surah 77 on 580 (Madinah: 578),
//   surah 78 on 582 — and with its lists, page 581 resolved to
//   nothing at all. Rejected.
// - The app's own SURAH_START_PAGES says surah 78 starts on 581,
//   but the printed page 581 is Al-Mursalat 77:20–50 and Juz 30
//   starts on 582 (78:1–30, Juz-30 marker on the page) — the table
//   is off by a page here (the app's quranIndex.ts already says Juz
//   30 starts on 582). That is a PRE-EXISTING Mushaf-table bug,
//   flagged to the parent, NOT fixed here.
// - AlQuranCloud agrees with Quran.com on every page checked
//   (1, 2, 50, 578–583, 604) AND with the printed images for the
//   disputed pages 581/582. That is the source used here.

import { TOTAL_MUSHAF_PAGES } from './mushafEditions';
import { SURAH_START_GLOBAL, globalToPoint, type RangePoint } from './testRanges';

export { TOTAL_MUSHAF_PAGES };

const PAGE_RANGE_STORAGE_KEY = 'quran-test-page-ranges';

interface StoredPageRange {
  start: { surah: number; ayah: number };
  end: { surah: number; ayah: number };
}

function toPoints(r: StoredPageRange): { start: RangePoint; end: RangePoint } {
  const toGlobal = (s: number, a: number) => (SURAH_START_GLOBAL[s - 1] || 1) + a - 1;
  return {
    start: globalToPoint(toGlobal(r.start.surah, r.start.ayah)),
    end: globalToPoint(toGlobal(r.end.surah, r.end.ayah)),
  };
}

// First and last ayah printed on a Mushaf page, as global points.
// Returns null only when the page holds no ayah (never for 1..604);
// throws when the page cannot be fetched (offline, cold cache).
export async function resolvePageRange(page: number): Promise<{ start: RangePoint; end: RangePoint } | null> {
  const p = Math.max(1, Math.min(TOTAL_MUSHAF_PAGES, page));
  try {
    const raw = localStorage.getItem(`${PAGE_RANGE_STORAGE_KEY}:${p}`);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredPageRange;
      if (parsed && parsed.start && parsed.end) return toPoints(parsed);
    }
  } catch { /* ignore a malformed cache entry */ }
  const res = await fetch(`https://api.alquran.cloud/v1/page/${p}/quran-uthmani`);
  if (!res.ok) throw new Error('page fetch failed');
  const json = await res.json();
  const ayahs = json?.data?.ayahs as { surah: { number: number }; numberInSurah: number }[] | undefined;
  if (!Array.isArray(ayahs) || ayahs.length === 0) throw new Error('empty page');
  const stored: StoredPageRange = {
    start: { surah: ayahs[0].surah.number, ayah: ayahs[0].numberInSurah },
    end: { surah: ayahs[ayahs.length - 1].surah.number, ayah: ayahs[ayahs.length - 1].numberInSurah },
  };
  try { localStorage.setItem(`${PAGE_RANGE_STORAGE_KEY}:${p}`, JSON.stringify(stored)); } catch { /* ignore */ }
  return toPoints(stored);
}
