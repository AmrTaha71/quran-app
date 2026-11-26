// 15.6(ب) (phase 6): daily goals and badges. Owner §11.13 (2026-11-26):
// «اقترح أنت قواعد مبدئية» — these are the first rules, all in this file so
// they can change in one place:
//   Daily goals (3): one finished test today; one Madinah page reviewed
//   today (page queue, 17.3); today's wird marked done (activity-linked, 6.14).
//   Badges: earned from real activity only (the score log, the wird days, the
//   page queue), never from a tap.
// Pure: the card passes the data in.
export type GoalInput = {
  /** ISO timestamps of finished tests (score log, completed only) */
  testDays: string[];
  /** YYYY-MM-DD days the wird was marked done */
  wirdDays: string[];
  /** last recital time (ms) of every page in the page queue store */
  pageRecitals: number[];
  /** pages recited clean at least once */
  cleanPages: number;
  /** ayat in «محفوظي» */
  corpusSize: number;
  today: string; // YYYY-MM-DD local
};

export type Goal = { id: string; label: string; done: boolean };
export type Badge = { id: string; name: string; rule: string; earned: boolean };

const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Longest run of consecutive days in `days` (YYYY-MM-DD). */
export function longestRun(days: readonly string[]): number {
  const set = new Set(days);
  let best = 0;
  for (const d of set) {
    const prev = new Date(`${d}T00:00:00`); prev.setDate(prev.getDate() - 1);
    if (set.has(localDay(prev.getTime()))) continue; // not a run start
    let n = 0;
    const cur = new Date(`${d}T00:00:00`);
    while (set.has(localDay(cur.getTime()))) { n++; cur.setDate(cur.getDate() + 1); }
    best = Math.max(best, n);
  }
  return best;
}

export function dailyGoals(x: GoalInput): Goal[] {
  return [
    { id: 'test', label: 'سمّع اختبار واحد', done: x.testDays.some((t) => localDay(Date.parse(t)) === x.today) },
    { id: 'page', label: 'راجع صفحة', done: x.pageRecitals.some((t) => t > 0 && localDay(t) === x.today) },
    { id: 'wird', label: 'خلّص ورد النهاردة', done: x.wirdDays.includes(x.today) },
  ];
}

export function badges(x: GoalInput): Badge[] {
  const tests = x.testDays.length;
  const activeDays = [...new Set([...x.wirdDays, ...x.testDays.map((t) => localDay(Date.parse(t)))])];
  const run = longestRun(activeDays);
  return [
    { id: 'first-test', name: 'أول تسميع', rule: 'خلّص أول اختبار', earned: tests >= 1 },
    { id: 'tests-10', name: 'عشر تسميعات', rule: 'خلّص ١٠ اختبارات', earned: tests >= 10 },
    { id: 'tests-50', name: 'خمسين تسميع', rule: 'خلّص ٥٠ اختبار', earned: tests >= 50 },
    { id: 'week', name: 'أسبوع متواصل', rule: '٧ أيام ورا بعض فيها ورد أو اختبار', earned: run >= 7 },
    { id: 'month', name: 'شهر متواصل', rule: '٣٠ يوم ورا بعض', earned: run >= 30 },
    { id: 'clean-page', name: 'صفحة نظيفة', rule: 'سمّع صفحة كاملة من غير غلط', earned: x.cleanPages >= 1 },
    { id: 'clean-20', name: 'عشرين صفحة', rule: '٢٠ صفحة نظيفة', earned: x.cleanPages >= 20 },
    { id: 'hifz-juz', name: 'جزء في محفوظي', rule: 'علّم ٢٠٠ آية أو أكتر «حفظتها»', earned: x.corpusSize >= 200 },
  ];
}
