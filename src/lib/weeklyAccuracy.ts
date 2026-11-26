// 15.5 (2026-11-26): weekly accuracy from the score log: per week (7-day
// buckets ending today), the average of FINISHED, ear-graded tasmee'
// tests (same rule as the log's average, 16.10). Pure.
import type { TestHistoryEntry } from './testHistory.ts';

export type WeekPoint = { weeksAgo: number; avg: number | null; n: number };

export function weeklyAccuracy(entries: TestHistoryEntry[], weeks = 6, now = Date.now()): WeekPoint[] {
  const out: WeekPoint[] = Array.from({ length: weeks }, (_, i) => ({ weeksAgo: weeks - 1 - i, avg: null, n: 0 }));
  const sums = new Array(weeks).fill(0);
  for (const e of entries) {
    if (e.completed !== true || e.ear === 'manual' || (e.kind ?? 'tasmee') !== 'tasmee' || e.deletedAt) continue;
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t) || t > now) continue;
    const w = Math.floor((now - t) / (7 * 86400000));
    if (w >= weeks) continue;
    const slot = weeks - 1 - w;
    sums[slot] += e.score; out[slot].n += 1;
  }
  out.forEach((p, i) => { if (p.n) p.avg = Math.round(sums[i] / p.n); });
  return out;
}
