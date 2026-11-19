// Score log for the tasmee' test (W4-D, 2026-11-19, plan item 7).
// One record per finished test: score, completed or not, date + time and
// the grading level it ran at. The progress curve is pinned to ONE level:
// scores from different levels are never mixed on one line.
// New key; the old 'quran-test-history' (20 records, no level) stays as is
// and keeps feeding the old list and DailyReport.

export type HistoryLevel = 'beginner' | 'advanced' | 'master';
export const HISTORY_LEVEL_LABEL: Record<HistoryLevel, string> = { beginner: 'مبتدئ', advanced: 'متقدم', master: 'متقن' };

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
};

export type TestKind = 'tasmee' | 'tarteel' | 'comprehensive';
export const TEST_KIND_LABEL: Record<TestKind, string> = { tasmee: 'تسميع', tarteel: 'ترتيل', comprehensive: 'شامل' };
export const kindOf = (e: TestHistoryEntry): TestKind => e.kind ?? 'tasmee';

export const TEST_HISTORY_V1_KEY = 'quran-test-history-v1';
export const TEST_HISTORY_MAX = 100;

const LEVELS: HistoryLevel[] = ['beginner', 'advanced', 'master'];

function valid(e: unknown): e is TestHistoryEntry {
  const r = e as TestHistoryEntry;
  return !!r && typeof r.ts === 'string' && LEVELS.includes(r.level)
    && Number.isFinite(r.score) && Number.isFinite(r.correct) && Number.isFinite(r.attempted)
    && typeof r.completed === 'boolean';
}

/** Newest first. */
export function loadTestHistoryV1(): TestHistoryEntry[] {
  try {
    const arr = JSON.parse(localStorage.getItem(TEST_HISTORY_V1_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter(valid).slice(0, TEST_HISTORY_MAX) : [];
  } catch { return []; }
}

export function addTestHistoryV1(e: TestHistoryEntry): TestHistoryEntry[] {
  const next = [e, ...loadTestHistoryV1()].slice(0, TEST_HISTORY_MAX);
  try { localStorage.setItem(TEST_HISTORY_V1_KEY, JSON.stringify(next)); } catch { /* quota / blocked */ }
  return next;
}
