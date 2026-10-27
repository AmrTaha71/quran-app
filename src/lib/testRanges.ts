import { SURAHS, SURAH_AYAH_COUNTS } from './surahs';
import { JUZ_STARTS, HIZB_STARTS, QUARTER_STARTS } from './quranBoundaries';

export const TOTAL_AYAHS = 6236;

export type UnitKind = 'surah' | 'juz' | 'hizb' | 'quarter';
export type EndKind = 'same' | 'juz' | 'hizb' | 'surah';

export interface RangePoint { global: number; surah: number; ayah: number }

export const SURAH_START_GLOBAL: number[] = (() => {
  const starts: number[] = [];
  let g = 1;
  for (const c of SURAH_AYAH_COUNTS) { starts.push(g); g += c; }
  return starts;
})();

export function globalToPoint(global: number): RangePoint {
  const g = Math.max(1, Math.min(TOTAL_AYAHS, global));
  let surah = 1;
  for (let i = 0; i < SURAH_START_GLOBAL.length; i++) {
    if (SURAH_START_GLOBAL[i] <= g) surah = i + 1; else break;
  }
  return { global: g, surah, ayah: g - SURAH_START_GLOBAL[surah - 1] + 1 };
}

export function surahName(no: number): string {
  return SURAHS.find((s) => s.no === no)?.name || '';
}

export function unitStartGlobal(kind: UnitKind, n: number): number {
  if (kind === 'surah') return SURAH_START_GLOBAL[Math.max(1, Math.min(114, n)) - 1];
  if (kind === 'juz') return JUZ_STARTS[Math.max(1, Math.min(30, n)) - 1].global;
  if (kind === 'hizb') return HIZB_STARTS[Math.max(1, Math.min(60, n)) - 1].global;
  return QUARTER_STARTS[Math.max(1, Math.min(240, n)) - 1].global;
}

export function unitEndGlobal(kind: UnitKind, n: number): number {
  if (kind === 'surah') {
    const i = Math.max(1, Math.min(114, n)) - 1;
    return SURAH_START_GLOBAL[i] + SURAH_AYAH_COUNTS[i] - 1;
  }
  const starts = kind === 'juz' ? JUZ_STARTS : kind === 'hizb' ? HIZB_STARTS : QUARTER_STARTS;
  const i = Math.max(1, Math.min(starts.length, n)) - 1;
  return i + 1 < starts.length ? starts[i + 1].global - 1 : TOTAL_AYAHS;
}

export function unitMax(kind: UnitKind): number {
  return kind === 'surah' ? 114 : kind === 'juz' ? 30 : kind === 'hizb' ? 60 : 240;
}

export function unitLabel(kind: UnitKind, n: number): string {
  if (kind === 'surah') return `سورة ${surahName(n)}`;
  if (kind === 'juz') return `الجزء ${n}`;
  if (kind === 'hizb') return `الحزب ${n}`;
  return `الربع ${n}`;
}

// The unit of the given kind that contains this global ayah.
export function containingUnit(kind: UnitKind, global: number): number {
  if (kind === 'surah') return globalToPoint(global).surah;
  const starts = kind === 'juz' ? JUZ_STARTS : kind === 'hizb' ? HIZB_STARTS : QUARTER_STARTS;
  let idx = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i].global <= global) idx = i; else break;
  }
  return idx + 1;
}

export function unitStartPoint(kind: UnitKind, n: number): RangePoint {
  return globalToPoint(unitStartGlobal(kind, n));
}

export function unitEndPoint(kind: UnitKind, n: number): RangePoint {
  return globalToPoint(unitEndGlobal(kind, n));
}

// Resolve the user's end choice: 'same' = end of the start unit,
// otherwise the end of the chosen juz/hizb/surah.
export function resolveRange(
  startKind: UnitKind, startNum: number, endKind: EndKind, endNum: number,
): { start: RangePoint; end: RangePoint } {
  const start = unitStartPoint(startKind, startNum);
  const end = endKind === 'same'
    ? unitEndPoint(startKind, startNum)
    : unitEndPoint(endKind, endNum);
  return { start, end };
}

export function rangeSummary(start: RangePoint, end: RangePoint): string {
  const n = end.global - start.global + 1;
  return `من سورة ${surahName(start.surah)} آية ${start.ayah} إلى سورة ${surahName(end.surah)} آية ${end.ayah} — ${n.toLocaleString('ar-EG')} آية`;
}
