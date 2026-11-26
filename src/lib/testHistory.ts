// Score log for the tasmee' test (W4-D, 2026-11-19, plan item 7).
// One record per finished test: score, completed or not, date + time and
// the grading level it ran at. The progress curve is pinned to ONE level:
// scores from different levels are never mixed on one line.
// New key; the old 'quran-test-history' (20 records, no level) stays as is
// and keeps feeding the old list and DailyReport.

// Item 16.8 (owner decision 2026-11-26): the experimental «متقن» level is gone. Old
// 'master' records are migrated to 'advanced' (it graded words exactly like «متقدم»).
export type HistoryLevel = 'beginner' | 'advanced';
export const HISTORY_LEVEL_LABEL: Record<HistoryLevel, string> = { beginner: 'مبتدئ', advanced: 'متقدم' };

export type TestHistoryEntry = {
  /** ISO time of the finish (date + time). */
  ts: string;
  /** Level locked at the test start. */
  level: HistoryLevel;
  /** 0-100: correct / attempted ayat. */
  score: number;
  correct: number;
  attempted: number;
  /** Every ayah of the range was recited (none skipped). */
  completed: boolean;
  mode: 'ayah' | 'continuous';
  /** Which ear graded it: device (Quran-Lab), browser, the old model, or self-graded. */
  ear: 'lab' | 'browser' | 'model' | 'manual';
  /** Human range label, e.g. «سورة الملك ١–٥». */
  label: string;
  /** W4-E: which test. Missing = the tasmee' test (all older entries). The
   *  tarteel / comprehensive scores are out of 40 and kept on their own curve. */
  kind?: TestKind;
  /** 17.11: per position, the words that were wrong (optional; older
   *  entries have none and still show). `ayah` is «surah:ayah». */
  wrong?: WrongSpot[];
  /** 17.7: tombstone time (ms). A deleted entry stays in storage (the
   *  log is append-only) and is hidden; «تراجع» clears the mark. */
  deletedAt?: number;
};

export type WrongSpot = { ayah: string; words: string[]; idx?: number[] };

export type TestKind = 'tasmee' | 'tarteel' | 'comprehensive' | 'written' | 'questions';
export const TEST_KIND_LABEL: Record<TestKind, string> = { tasmee: 'تسميع', tarteel: 'ترتيل', comprehensive: 'شامل', written: 'كتابي', questions: 'أسئلة' };
export const kindOf = (e: TestHistoryEntry): TestKind => e.kind ?? 'tasmee';

export const TEST_HISTORY_V1_KEY = 'quran-test-history-v1';
export const TEST_HISTORY_MAX = 100;

const LEVELS: string[] = ['beginner', 'advanced', 'master'];

function valid(e: unknown): e is TestHistoryEntry {
  const r = e as TestHistoryEntry;
  return !!r && typeof r.ts === 'string' && LEVELS.includes(r.level as string)
    && Number.isFinite(r.score) && Number.isFinite(r.correct) && Number.isFinite(r.attempted)
    && typeof r.completed === 'boolean';
}

/** Newest first, without deleted entries. */
export function loadTestHistoryV1(): TestHistoryEntry[] {
  return loadTestHistoryRaw().filter((e) => !e.deletedAt);
}

/** Newest first, tombstoned entries included (17.7). */
export function loadTestHistoryRaw(): TestHistoryEntry[] {
  try {
    const arr = JSON.parse(localStorage.getItem(TEST_HISTORY_V1_KEY) || '[]');
    if (!Array.isArray(arr)) return [];
    const list = arr.filter(valid).slice(0, TEST_HISTORY_MAX);
    // 16.8: explicit one-way migration of legacy «متقن» records, saved back once.
    if (list.some((e) => (e.level as string) === 'master')) {
      const migrated = list.map((e) => ((e.level as string) === 'master' ? { ...e, level: 'advanced' as const } : e));
      try { localStorage.setItem(TEST_HISTORY_V1_KEY, JSON.stringify(migrated)); } catch { /* quota / blocked */ }
      return migrated;
    }
    return list;
  } catch { return []; }
}

export function addTestHistoryV1(e: TestHistoryEntry): TestHistoryEntry[] {
  const next = [e, ...loadTestHistoryRaw()].slice(0, TEST_HISTORY_MAX);
  try { localStorage.setItem(TEST_HISTORY_V1_KEY, JSON.stringify(next)); } catch { /* quota / blocked */ }
  return next.filter((x) => !x.deletedAt);
}

// 17.7: delete = tombstone (undo-able), never an immediate splice.
function markDeleted(match: (e: TestHistoryEntry) => boolean, at: number | undefined): TestHistoryEntry[] {
  const next = loadTestHistoryRaw().map((e) => (match(e) ? { ...e, deletedAt: at } : e));
  try { localStorage.setItem(TEST_HISTORY_V1_KEY, JSON.stringify(next)); } catch { /* quota / blocked */ }
  return next.filter((x) => !x.deletedAt);
}
/** Hide one entry (by its ts); returns the visible list. */
export function deleteTestHistoryEntry(ts: string, now = Date.now()): TestHistoryEntry[] { return markDeleted((e) => e.ts === ts, now); }
/** Bring a hidden entry back. */
export function undoDeleteTestHistoryEntry(ts: string): TestHistoryEntry[] { return markDeleted((e) => e.ts === ts, undefined); }
/** «مسح الكل»: hides every visible entry, all with the same mark, so one undo brings them back. */
export function deleteAllTestHistory(now = Date.now()): { list: TestHistoryEntry[]; mark: number } {
  return { list: markDeleted((e) => !e.deletedAt, now), mark: now };
}
/** Undo a «مسح الكل» by its mark. */
export function undoDeleteAll(mark: number): TestHistoryEntry[] {
  const next = loadTestHistoryRaw().map((e) => (e.deletedAt === mark ? { ...e, deletedAt: undefined } : e));
  try { localStorage.setItem(TEST_HISTORY_V1_KEY, JSON.stringify(next)); } catch { /* quota / blocked */ }
  return next.filter((x) => !x.deletedAt);
}
