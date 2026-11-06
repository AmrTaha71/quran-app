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
    return { doneToday, hasReviewConfigured, dueParts, range: null };
  }

  // The review range is the memorized material itself — no page→ayah
  // conversion is invented (the wird stores pages, not ayahs):
  //  - murajaa (recent, most urgent first): the memorized portion of
  //    the Juz holding the run boundary, from that Juz's start to the
  //    last memorized ayah.
  //  - manzil only (old): the oldest memorized material, Juz 1 (or
  //    its memorized portion when the run has not finished it).
  if ((wird.parts.murajaa || 0) > 0) {
    const juz = containingUnit('juz', run);
    const startGlobal = JUZ_STARTS[juz - 1].global;
    const start = globalToPoint(startGlobal);
    const end = globalToPoint(run);
    return {
      doneToday,
      hasReviewConfigured,
      dueParts,
      range: {
        startGlobal,
        endGlobal: run,
        kind: 'murajaa',
        juz,
        label: `مراجعة الحفظ الحديث — الجزء ${juz.toLocaleString('ar-EG')}`,
        rangeText: `من سورة ${surahName(start.surah)} آية ${start.ayah.toLocaleString('ar-EG')} إلى سورة ${surahName(end.surah)} آية ${end.ayah.toLocaleString('ar-EG')}`,
      },
    };
  }
  const endGlobal = Math.min(run, unitEndGlobal('juz', 1));
  const end = globalToPoint(endGlobal);
  return {
    doneToday,
    hasReviewConfigured,
    dueParts,
    range: {
      startGlobal: 1,
      endGlobal,
      kind: 'manzil',
      juz: 1,
      label: 'مراجعة المحفوظ القديم — الجزء ١',
      rangeText: `من أول المصحف إلى سورة ${surahName(end.surah)} آية ${end.ayah.toLocaleString('ar-EG')}`,
    },
  };
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
