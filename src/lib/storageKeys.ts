// 10.11 (2026-11-26): one registry for the storage keys that more than
// one file reads, so a key changes in one line and two meanings of the
// same name can't collide. New keys go here. Rule for a shape change:
// add a new versioned key and keep reading the old one until the next
// wave is stable (CLAUDE.md), the ElderlyHome v1/v2 pattern.
export const SK = {
  uid: 'quran-uid',
  mushafTarget: 'quran-mushaf-target',
  mushafEdition: 'quran-mushaf-edition',
  mushafPage: 'quran-mushaf-page',
  recentActivity: 'quran-recent-activity-v1',
  reciter: 'quran-reciter',
  userGender: 'quran-user-gender',
  wird: 'quran-wird-v1',            // lib/wird.ts WIRD_KEY
  adhkarWird: 'quran-adhkar-wird',  // AdhkarPage's own WIRD_KEY (different meaning)
  testRangePreset: 'quran-test-range-preset',
  testRangeChoice: 'quran-test-range-choice',
  routeScroll: 'quran-route-scroll-v1',
  errorLog: 'quran-error-log-v1',
  hifzCorpus: 'rawabit.hifzCorpus.v1',
  sessions: 'rawabit.sessions.v1',
} as const;

/**
 * Read JSON from storage with a validator. A missing, corrupt or invalid
 * value returns `fallback`, and a corrupt one is reported to `onCorrupt`
 * (instead of vanishing silently).
 */
export function readJSON<T>(
  store: Pick<Storage, 'getItem'>,
  key: string,
  fallback: T,
  validate: (v: unknown) => v is T,
  onCorrupt?: (key: string, err: unknown) => void,
): T {
  let raw: string | null = null;
  try { raw = store.getItem(key); } catch { return fallback; }
  if (raw == null) return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    if (validate(v)) return v;
    onCorrupt?.(key, new Error('invalid shape'));
  } catch (e) {
    onCorrupt?.(key, e);
  }
  return fallback;
}
