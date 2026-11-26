// 6.13 (2026-11-26): the review ranges from the PAGE counts the user set
// in the wird (it used to review "the juz holding the last memorized
// ayah" whatever the page count, and the old-material part never showed
// next to the recent one). Pages are the Madinah print's pages, the same
// table the app's Mushaf scans use. Pure, node-testable.
import { MADINAH_PAGE_STARTS } from './madinahPageStarts.ts';
import { SURAH_AYAH_COUNTS } from './surahs.ts';

const SURAH_START: number[] = (() => {
  const s: number[] = []; let g = 1;
  for (const c of SURAH_AYAH_COUNTS) { s.push(g); g += c; }
  return s;
})();
const TOTAL = SURAH_START[SURAH_START.length - 1] + SURAH_AYAH_COUNTS[SURAH_AYAH_COUNTS.length - 1] - 1;

function keyToGlobal(k: number): number {
  const surah = Math.floor(k / 1000), ayah = k % 1000;
  return SURAH_START[surah - 1] + ayah - 1;
}
/** Global ayah number (1..6236) that starts page p (1..604). */
export function pageStartGlobal(p: number): number {
  return keyToGlobal(MADINAH_PAGE_STARTS[Math.max(1, Math.min(MADINAH_PAGE_STARTS.length, p)) - 1]);
}
/** Last global ayah on page p. */
export function pageEndGlobal(p: number): number {
  return p >= MADINAH_PAGE_STARTS.length ? TOTAL : pageStartGlobal(p + 1) - 1;
}
/** Page holding the global ayah g. */
export function pageOfGlobal(g: number): number {
  let lo = 1, hi = MADINAH_PAGE_STARTS.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pageStartGlobal(mid) <= g) lo = mid; else hi = mid - 1; }
  return lo;
}

export type PageRange = { startGlobal: number; endGlobal: number; fromPage: number; toPage: number };

/** Recent review: the last `pages` pages of the memorized run, ending at the last memorized ayah. */
export function recentReviewRange(run: number, pages: number): PageRange | null {
  if (run <= 0 || pages <= 0) return null;
  const toPage = pageOfGlobal(run);
  const fromPage = Math.max(1, toPage - Math.ceil(pages) + 1);
  return { startGlobal: pageStartGlobal(fromPage), endGlobal: run, fromPage, toPage };
}

/**
 * Old-material review (manzil): `pages` pages from the memorized material
 * BEFORE the recent range, moving forward each day and wrapping, so the
 * whole old material comes round in turn. `day` is any day counter.
 */
export function manzilReviewRange(run: number, pages: number, recentPages: number, day: number): PageRange | null {
  if (run <= 0 || pages <= 0) return null;
  const recent = recentReviewRange(run, recentPages);
  // Old material ends where the recent range starts (or at the run when no recent part).
  const lastOldPage = recent ? recent.fromPage - 1 : pageOfGlobal(run);
  if (lastOldPage < 1) return null;
  const n = Math.min(Math.ceil(pages), lastOldPage);
  const slots = Math.ceil(lastOldPage / n);
  const fromPage = ((((day % slots) + slots) % slots) * n) + 1;
  const toPage = Math.min(lastOldPage, fromPage + n - 1);
  const endGlobal = Math.min(run, pageEndGlobal(toPage));
  return { startGlobal: pageStartGlobal(fromPage), endGlobal, fromPage, toPage };
}
