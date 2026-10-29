// adhkarFuture.ts — FUTURE PLACEHOLDER ONLY (types, no runtime).
//
// There is NO licensed morning/evening adhkar audio today, so this
// patch builds NO adhkar playback, embeds NO adhkar audio, and links
// NO adhkar audio from any source (not MakkahLive, YouTube, Archive,
// or repackaging apps). The home card stays disabled ("قريبًا") until
// a cleared source exists (Duraihem/original-publisher confirmation
// or Alafasy permission).
//
// This file exists so the future wiring FITS a fixed shape when a
// source is cleared, without rework:
//
//   - ONE audio file per wird (morning file, evening file).
//   - A timing table mapping each dhikr to its [startMs, endMs]
//     window in that file, for per-dhikr skip.
//   - The dhikr TEXT and its REPETITION COUNT alongside the timing.
//
// The shared audio unit already reserves the 'adhkar' owner value;
// a future adhkar player would acquire it like listen/radio do.
// Until then, `audioUrl` MUST stay empty: no URL may be placed here
// until permission for that source is granted.

export type AdhkarWird = 'morning' | 'evening';

/** One dhikr inside a wird file: text + repetitions + time window. */
export interface AdhkarItem {
  /** Stable id for the dhikr (e.g. its order in the wird). */
  id: string;
  /** The dhikr text to display while it plays. */
  text: string;
  /** How many times it is repeated. */
  count: number;
  /** Start of this dhikr in the wird audio file (ms). */
  startMs: number;
  /** End of this dhikr in the wird audio file (ms). */
  endMs: number;
}

/**
 * One wird's audio + timing table. `audioUrl` is EMPTY until a
 * licensed source is granted — it must never point at an
 * unverified, unpermitted, or repackaged file.
 */
export interface AdhkarWirdFile {
  wird: AdhkarWird;
  audioUrl: string;
  items: AdhkarItem[];
}
