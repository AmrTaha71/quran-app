// Item 17.2: «محفوظي» — the set of ayat the user has declared memorized.
// When it is not empty, every round-test question comes from it only
// («الأسئلة من محفوظك فقط»): never an ayah outside it. By default it IS
// the memorized list (user_lists 'memorized', one source of truth),
// mirrored here so the tests can read it without a network call. Verse
// ids are the global Mushaf order (checked in 16.11). Whether the user
// may later keep a separate hand-edited corpus is owner question §11.14.
export const HIFZ_CORPUS_KEY = 'rawabit.hifzCorpus.v1';

export function syncCorpusFromMemorized(ids: Iterable<number>): void {
  try { localStorage.setItem(HIFZ_CORPUS_KEY, JSON.stringify({ source: 'memorized', ids: [...ids].sort((a, b) => a - b) })); } catch { /* ignore */ }
}

/** The declared corpus, or null when none is declared (no restriction). */
export function loadHifzCorpus(): Set<number> | null {
  try {
    const raw = JSON.parse(localStorage.getItem(HIFZ_CORPUS_KEY) || 'null') as { ids?: unknown } | null;
    const ids = Array.isArray(raw?.ids) ? raw!.ids.filter((x): x is number => Number.isInteger(x)) : [];
    return ids.length > 0 ? new Set(ids) : null;
  } catch { return null; }
}

/** How many corpus ayat fall inside [start, end] (global ids). */
export function corpusCountIn(corpus: Set<number>, start: number, end: number): number {
  let n = 0;
  for (const g of corpus) if (g >= start && g <= end) n++;
  return n;
}
