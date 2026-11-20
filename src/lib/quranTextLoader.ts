// quranTextLoader.ts — pure loader behind roundTest.loadQuranText (no imports, so
// it is unit-testable in plain Node). Cache first, network on a cache miss, and a
// failure is NOT remembered: the next call retries. Before 2026-11-20 the loader
// only read the IndexedDB cache, so on a fresh device/origin the text stayed null
// forever and «ابدأ» (which needs the text) stayed disabled.
export type TextRow = { surah_no: number; ayah_no: number; ayah_text: string };

export function createTextLoader<R extends TextRow>(deps: {
  readCache: () => Promise<R[] | null>;
  fetchRows: () => Promise<R[] | null>;
}): () => Promise<Map<string, string> | null> {
  let memo: Promise<Map<string, string> | null> | null = null;
  return () => {
    if (!memo) {
      const p: Promise<Map<string, string> | null> = (async () => {
        let rows = await deps.readCache();
        if (!rows) rows = await deps.fetchRows();
        if (!rows) return null;
        const m = new Map<string, string>();
        for (const r of rows) m.set(`${r.surah_no}:${r.ayah_no}`, r.ayah_text);
        return m;
      })().catch(() => null);
      memo = p;
      void p.then((m) => { if (!m && memo === p) memo = null; });
    }
    return memo;
  };
}
