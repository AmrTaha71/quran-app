// SelfTest Batch 4, part 2 (brief 07-selftest-batch4-brief.md): transparent practice history.
// One source of truth: the reRecites map. The done-screen badge and the diag count both read from it.
// The finished score is never changed by a re-recite.

export type ReRecites = Readonly<Record<string, number>>;

export function addReRecite(map: ReRecites, ayahKey: string): ReRecites {
  const cur = map[ayahKey] ?? 0;
  return { ...map, [ayahKey]: cur + 1 };
}

// Ayahs that show the "أعيدت ممارستها ✓" badge.
export function badgedAyahKeys(map: ReRecites): string[] {
  return Object.keys(map).filter((k) => (map[k] ?? 0) > 0);
}

export function totalReRecites(map: ReRecites): number {
  return Object.values(map).reduce((a, b) => a + (b > 0 ? b : 0), 0);
}

// Shadow logging (brief part 3): counts and positions only, no grading change.
export interface ShadowLog {
  candidates: number;
  byPosition: Readonly<Record<string, number>>;
  laterMatched: number;
}

export const EMPTY_SHADOW_LOG: ShadowLog = { candidates: 0, byPosition: {}, laterMatched: 0 };

export function recordShadowCandidate(log: ShadowLog, position: number, laterFinalMatched: boolean): ShadowLog {
  const key = String(position);
  return {
    candidates: log.candidates + 1,
    byPosition: { ...log.byPosition, [key]: (log.byPosition[key] ?? 0) + 1 },
    laterMatched: log.laterMatched + (laterFinalMatched ? 1 : 0),
  };
}
