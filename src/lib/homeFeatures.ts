// Home features (1 / 8 / 9) — pure helpers shared by the three Home
// widgets. No React, no DOM writes here, so the logic is node-testable
// (see the parent verification). All three widgets read REAL state:
//   - memorized: the same user_lists 'memorized' set Lawhati reads
//     (src/components/UserLists.tsx), via the contiguous from-start run
//     (the Lawhati gate, UserAppPage.tsx: ids 1..6236 in Mushaf order).
//   - review due: the shared wird module (src/lib/wird.ts,
//     localStorage 'quran-wird-v1'): review parts murajaa + manzil only.
//   - recents: localStorage 'quran-recent-activity-v1', written by the
//     Listen / SelfTest / Adhkar pages; Home only READS it.

import { JUZ_STARTS } from './quranBoundaries';
import { containingUnit, globalToPoint, unitEndGlobal } from './testRanges';
import { recentReviewRange, manzilReviewRange, type PageRange } from './reviewPages';
import { SURAHS } from './surahs';
import {
  formatPages,
  WIRD_TYPE_LABEL,
  type WirdState,
  type WirdType,
} from './wird';

export const TOTAL_AYAHS = 6236;

// ---------------------------------------------------------------- map --
// Contiguous memorized run from verse id 1 — the exact Lawhati gate
// (UserAppPage.tsx): while (lists.memorized.has(n + 1)) n++.
export function memorizedFromStart(memorized: Set<number>): number {
  let n = 0;
  while (memorized.has(n + 1)) n++;
  return n;
}

export type JuzStatus = 'memorized' | 'in-progress' | 'not-yet';

export interface JuzMapEntry {
  juz: number;
  status: JuzStatus;
  startSurah: number;
  startAyah: number;
  startSurahName: string;
}

// Per-Juz status derived from the from-start run (never hardcoded):
// a Juz fully inside the run is memorized, the Juz holding the run's
// boundary ayah is in progress, the rest are not yet. run = 0 → all
// not yet; run = 6236 → all memorized.
export function juzStatuses(run: number): JuzMapEntry[] {
  const r = Math.max(0, Math.min(TOTAL_AYAHS, Math.floor(run)));
  return JUZ_STARTS.map((j) => {
    const end = unitEndGlobal('juz', j.juz);
    const status: JuzStatus =
      end <= r ? 'memorized' : j.global <= r ? 'in-progress' : 'not-yet';
    return {
      juz: j.juz,
      status,
      startSurah: j.surah,
      startAyah: j.ayah,
      startSurahName: SURAHS.find((s) => s.no === j.surah)?.name ?? '',
    };
  });
}

/** Item 5.2: per-Juz status from the ayat really memorized, wherever
 *  they are — someone who memorized Juz 30 alone sees Juz 30 gold, not
 *  thirty «لم يبدأ». All of a Juz's ayat → memorized; some → in progress. */
export function juzStatusesFromSet(memorized: Set<number>): JuzMapEntry[] {
  return JUZ_STARTS.map((j) => {
    const end = unitEndGlobal('juz', j.juz);
    let have = 0;
    for (let g = j.global; g <= end; g++) if (memorized.has(g)) have++;
    const status: JuzStatus = have === end - j.global + 1 ? 'memorized' : have > 0 ? 'in-progress' : 'not-yet';
    return {
      juz: j.juz,
      status,
      startSurah: j.surah,
      startAyah: j.ayah,
      startSurahName: SURAHS.find((s) => s.no === j.surah)?.name ?? '',
    };
  });
}

export function countJuzByStatus(
  entries: JuzMapEntry[],
): Record<JuzStatus, number> {
  const counts: Record<JuzStatus, number> = {
    memorized: 0,
    'in-progress': 0,
    'not-yet': 0,
  };
  for (const e of entries) counts[e.status]++;
  return counts;
}

// ------------------------------------------------------------ review due --
// One-time sessionStorage keys for the "ابدأ المراجعة" button. The
// exact range goes in the preset; the choice flag is the fallback the
// SelfTest page already understands ('quran-test-range-choice' →
// opens that range door on mount). CONTRACT for the SelfTest side:
// if the preset exists, consume it (and clear both keys) and start
// that exact global range; otherwise the choice flag lands the user
// on the juz door, where the card names the juz to pick.
export const TEST_RANGE_PRESET_KEY = 'quran-test-range-preset';
export const TEST_RANGE_CHOICE_KEY = 'quran-test-range-choice';

export interface DuePart {
  type: WirdType;
  label: string;
  pages: number;
  pagesText: string;
}

export interface ReviewRange {
  startGlobal: number;
  endGlobal: number;
  kind: 'murajaa' | 'manzil';
  juz: number;
  label: string;
  rangeText: string;
}

export interface DueReview {
  doneToday: boolean;
  hasReviewConfigured: boolean;
  dueParts: DuePart[];
  // null when there is nothing memorized to review (run = 0), even
  // when review parts are configured — the card then says so kindly
  // instead of offering a start button to nowhere.
  range: ReviewRange | null;
  // 6.13: every due review part with its own range (murajaa first).
  ranges: ReviewRange[];
}

function toReviewRange(kind: 'murajaa' | 'manzil', r: PageRange): ReviewRange {
  const start = globalToPoint(r.startGlobal);
  const end = globalToPoint(r.endGlobal);
  const pages = r.fromPage === r.toPage
    ? `صفحة ${r.fromPage.toLocaleString('ar-EG')}`
    : `الصفحات ${r.fromPage.toLocaleString('ar-EG')}–${r.toPage.toLocaleString('ar-EG')}`;
  return {
    startGlobal: r.startGlobal,
    endGlobal: r.endGlobal,
    kind,
    juz: containingUnit('juz', r.startGlobal),
    label: `${kind === 'murajaa' ? 'مراجعة الحفظ الحديث' : 'مراجعة المحفوظ القديم'} — ${pages}`,
    rangeText: `من سورة ${surahName(start.surah)} آية ${start.ayah.toLocaleString('ar-EG')} إلى سورة ${surahName(end.surah)} آية ${end.ayah.toLocaleString('ar-EG')}`,
  };
}

function todayStr(d = new Date()): string {
  return d.toLocaleDateString('en-CA');
}

function surahName(no: number): string {
  return SURAHS.find((s) => s.no === no)?.name ?? '';
}

// What is due for review TODAY, from the real wird state:
// due = review parts (murajaa / manzil) with pages > 0 AND today not
// already marked done in doneDays. sabaq (جديد) is new memorization,
// never review, so it never appears here.
export function dueReview(wird: WirdState, run: number): DueReview {
  const doneToday = wird.doneDays.includes(todayStr());
  const dueParts: DuePart[] = (['murajaa', 'manzil'] as WirdType[])
    .filter((t) => (wird.parts[t] || 0) > 0)
    .map((t) => ({
      type: t,
      label: WIRD_TYPE_LABEL[t],
      pages: wird.parts[t],
      pagesText: formatPages(wird.parts[t]),
    }));
  const hasReviewConfigured = dueParts.length > 0;
  if (doneToday || !hasReviewConfigured || run <= 0) {
    return { doneToday, hasReviewConfigured, dueParts, range: null, ranges: [] };
  }

  // 6.13: each review part gets its own range from ITS page count
  // (lib/reviewPages, Madinah pages): murajaa = the last N memorized
  // pages; manzil = N pages of the older material before that, moving
  // on each day. Both show together when both are set.
  const ranges: ReviewRange[] = [];
  const mur = recentReviewRange(run, wird.parts.murajaa || 0);
  if (mur) ranges.push(toReviewRange('murajaa', mur));
  const dayNo = Math.floor(new Date(todayStr() + 'T00:00:00').getTime() / 86400000);
  const man = manzilReviewRange(run, wird.parts.manzil || 0, wird.parts.murajaa || 0, dayNo);
  if (man) ranges.push(toReviewRange('manzil', man));
  return { doneToday, hasReviewConfigured, dueParts, range: ranges[0] ?? null, ranges };
}

// --------------------------------------------------------------- recents --
export const RECENTS_KEY = 'quran-recent-activity-v1';

export type RecentActivityType = 'listen' | 'test' | 'adhkar';

export interface RecentActivityEntry {
  type: RecentActivityType;
  surah: number;
  ayah?: number;
  label: string;
  ts: number;
}

export const RECENT_TYPE_LABEL: Record<RecentActivityType, string> = {
  listen: 'استماع',
  test: 'تسميع',
  adhkar: 'أذكار',
};

// READ side only: parse + shape-validate the shared recents list,
// most recent first, max 6. A missing / corrupt / empty value yields
// [] so the row hides — never an error, never an empty box.
export function readRecentActivity(): RecentActivityEntry[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (e): e is RecentActivityEntry =>
          !!e &&
          typeof e === 'object' &&
          ((e as RecentActivityEntry).type === 'listen' ||
            (e as RecentActivityEntry).type === 'test' ||
            (e as RecentActivityEntry).type === 'adhkar') &&
          typeof (e as RecentActivityEntry).surah === 'number' &&
          (e as RecentActivityEntry).surah >= 1 &&
          (e as RecentActivityEntry).surah <= 114 &&
          typeof (e as RecentActivityEntry).label === 'string' &&
          (e as RecentActivityEntry).label.trim().length > 0 &&
          typeof (e as RecentActivityEntry).ts === 'number',
      )
      .map((e) => ({
        ...e,
        ayah:
          typeof e.ayah === 'number' && e.ayah >= 1 ? e.ayah : undefined,
      }))
      .slice(0, 6);
  } catch {
    return [];
  }
}
