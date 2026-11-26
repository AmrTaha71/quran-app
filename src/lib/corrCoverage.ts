// Item 2.21: how much of a global ayah range a correction reciter's word
// timings cover (from the generated CORR_TIMING_RUNS). Without timings
// for an ayah the correction falls back to the whole ayah.
import { CORR_TIMING_RUNS } from './corrTimingCoverage';

export function timingCoverage(folder: string, lo: number, hi: number): 'full' | 'partial' | 'none' {
  const runs = CORR_TIMING_RUNS[folder];
  if (!runs || hi < lo) return 'none';
  let covered = 0;
  for (const [a, b] of runs) {
    const s = Math.max(a, lo), e = Math.min(b, hi);
    if (e >= s) covered += e - s + 1;
  }
  const total = hi - lo + 1;
  return covered >= total ? 'full' : covered > 0 ? 'partial' : 'none';
}
