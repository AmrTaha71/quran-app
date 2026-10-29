// quranTextCache.ts — IndexedDB cache for Quran text rows (Phase 1 of
// the smooth/fast/offline self-test goal). DOM-free except for the
// IndexedDB backend itself, which is isolated behind the
// QuranTextBackend interface so the completeness / validation logic
// is unit-testable in node against the memory backend.
//
// WHY ROWS, NOT THE INDEX: the trigram index rebuilds in-memory in
// ~90ms, so caching rows is enough; caching the index would add a
// second artifact to keep consistent for no real gain. The Quran text
// is static (seeded once), so rows never need a version or TTL —
// unlike correction audio, whose voice engine can change.
//
// COMPLETENESS IS PER-READER: a row written by a narrow select (the
// self-test range query has no ayah_text_clean; the QUL label query
// has no link fields) must never satisfy a reader that needs those
// columns. Each reader therefore validates the columns IT needs and
// treats a miss as "fetch from network". A cache hit is always
// byte-identical to what the network would have returned for those
// columns, so grading and computed results are unchanged.
//
// LINK-FIELD STALENESS (documented, accepted): rows written by
// select('*') fetches carry has_links/links_count, which change when
// an admin approves a link. A cached spanned-surah row can therefore
// show stale link indicators until its surah is refetched. The
// primary page's own surah (fetchPageVerses) is deliberately NOT
// cached, so the main page's indicators are always fresh; only
// spanned (other-surah) rows can go stale, and their text — the
// offline-critical part — is always right.
//
// FAILURE DISCIPLINE: every cache operation swallows its own
// failure and resolves null/void. IndexedDB unavailable, a corrupt
// entry, a quota error — all of them degrade to "fetch from network
// exactly as today". The cache can never break a test or a page.

import { SURAHS } from './surahs';

export interface CachedTextRow {
  id: number;
  surah_no: number;
  surah_name: string;
  ayah_no: number;
  ayah_text: string;
  ayah_text_clean: string | null;
  has_links?: boolean;
  links_count?: number;
  is_protected?: boolean;
}

export interface SurahReadOptions {
  /** Reader needs ayah_text_clean (loadQuranText, QUL labels). */
  requireClean?: boolean;
  /** Reader renders link indicators (spanned surah rows). */
  requireLinks?: boolean;
}

// A row is usable as TEXT when its identity + text are intact.
// surah_name is filled from SURAHS at write time when absent.
export function isValidTextRow(r: unknown): r is CachedTextRow {
  if (!r || typeof r !== 'object') return false;
  const row = r as Partial<CachedTextRow>;
  return (
    typeof row.id === 'number' &&
    Number.isFinite(row.id) &&
    typeof row.surah_no === 'number' &&
    typeof row.ayah_no === 'number' &&
    typeof row.ayah_text === 'string' &&
    row.ayah_text.length > 0 &&
    typeof row.surah_name === 'string'
  );
}

export function normalizeRow(r: unknown): CachedTextRow | null {
  if (!r || typeof r !== 'object') return null;
  const row = r as Partial<CachedTextRow>;
  const surahName =
    typeof row.surah_name === 'string' && row.surah_name.length > 0
      ? row.surah_name
      : SURAHS.find((s) => s.no === row.surah_no)?.name || `سورة ${row.surah_no}`;
  const out: CachedTextRow = {
    id: row.id as number,
    surah_no: row.surah_no as number,
    surah_name: surahName,
    ayah_no: row.ayah_no as number,
    ayah_text: row.ayah_text as string,
    ayah_text_clean: typeof row.ayah_text_clean === 'string' ? row.ayah_text_clean : null,
  };
  if (typeof row.has_links === 'boolean') out.has_links = row.has_links;
  if (typeof row.links_count === 'number') out.links_count = row.links_count;
  if (typeof row.is_protected === 'boolean') out.is_protected = row.is_protected;
  return isValidTextRow(out) ? out : null;
}

function rowSatisfies(row: CachedTextRow, opts: SurahReadOptions): boolean {
  if (opts.requireClean && typeof row.ayah_text_clean !== 'string') return false;
  if (opts.requireLinks) {
    if (typeof row.has_links !== 'boolean') return false;
    if (typeof row.links_count !== 'number') return false;
    if (typeof row.is_protected !== 'boolean') return false;
  }
  return true;
}

// Pure selectors over a row array (unit-testable, no storage):
// each returns null unless the result is COMPLETE for that reader.

export function selectRange(rows: CachedTextRow[], lo: number, hi: number): CachedTextRow[] | null {
  const byId = new Map<number, CachedTextRow>();
  for (const r of rows) {
    if (isValidTextRow(r)) byId.set(r.id, r);
  }
  const out: CachedTextRow[] = [];
  for (let id = lo; id <= hi; id++) {
    const row = byId.get(id);
    if (!row) return null;
    out.push(row);
  }
  return out;
}

export function selectSurah(
  rows: CachedTextRow[],
  surahNo: number,
  expectedCount: number,
  opts: SurahReadOptions = {},
): CachedTextRow[] | null {
  if (expectedCount <= 0) return null;
  const out = rows.filter((r) => r.surah_no === surahNo && isValidTextRow(r) && rowSatisfies(r, opts));
  if (out.length !== expectedCount) return null;
  out.sort((a, b) => a.ayah_no - b.ayah_no);
  return out;
}

export function selectAll(rows: CachedTextRow[], minCount: number): CachedTextRow[] | null {
  const valid = rows.filter((r) => isValidTextRow(r) && typeof r.ayah_text_clean === 'string');
  if (valid.length < minCount) return null;
  valid.sort((a, b) => a.id - b.id);
  return valid;
}

// Offline predicates (pure, so the runner can prove them):
// the notice shows exactly when text was served from cache while the
// device reports offline; an online cache hit is just fast, silent.
export function shouldShowOfflineNotice(servedFromCache: boolean, onLine: boolean | undefined): boolean {
  return servedFromCache && onLine === false;
}

export function isOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

export interface QuranTextBackend {
  loadAll(): Promise<CachedTextRow[]>;
  save(rows: CachedTextRow[]): Promise<void>;
}

// In-memory backend: the node-test fake AND the runtime fallback
// when IndexedDB is unavailable. Same upsert-by-id semantics as the
// IndexedDB backend, so tests prove the policy. A session-only cache
// still removes repeat network loads within one visit.
export class MemoryQuranTextBackend implements QuranTextBackend {
  private readonly map = new Map<number, CachedTextRow>();
  async loadAll(): Promise<CachedTextRow[]> {
    return [...this.map.values()];
  }
  async save(rows: CachedTextRow[]): Promise<void> {
    for (const r of rows) this.map.set(r.id, r);
  }
  get size(): number {
    return this.map.size;
  }
}

const IDB_NAME = 'quran-text-cache';
const IDB_STORE = 'rows';

// IndexedDB backend. Throws synchronously when indexedDB is
// unavailable (node, SSR); method rejections are the caller's to
// swallow — a backend failure must never break a test or a page.
export function createIndexedDBBackend(
  dbName: string = IDB_NAME,
  storeName: string = IDB_STORE,
): QuranTextBackend {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) throw new Error('indexedDB unavailable');
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = idb.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const request = <T>(req: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  return {
    async loadAll(): Promise<CachedTextRow[]> {
      const db = await open();
      try {
        const tx = db.transaction(storeName, 'readonly');
        return await request(tx.objectStore(storeName).getAll());
      } finally {
        db.close();
      }
    },
    async save(rows: CachedTextRow[]): Promise<void> {
      if (rows.length === 0) return;
      const db = await open();
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        await Promise.all(rows.map((r) => request(store.put(r))));
      } finally {
        db.close();
      }
    },
  };
}

// The cache itself: thin orchestration over a backend. Every method
// swallows backend failure and resolves null/void, so callers can
// treat "cache unavailable" exactly like "cache empty".
export class QuranTextCache {
  constructor(private readonly backend: QuranTextBackend) {}

  async getRange(lo: number, hi: number): Promise<CachedTextRow[] | null> {
    try {
      const rows = await this.backend.loadAll();
      return selectRange(rows, lo, hi);
    } catch {
      return null;
    }
  }

  async getSurah(
    surahNo: number,
    expectedCount: number,
    opts: SurahReadOptions = {},
  ): Promise<CachedTextRow[] | null> {
    try {
      const rows = await this.backend.loadAll();
      return selectSurah(rows, surahNo, expectedCount, opts);
    } catch {
      return null;
    }
  }

  async getAll(minCount: number): Promise<CachedTextRow[] | null> {
    try {
      const rows = await this.backend.loadAll();
      return selectAll(rows, minCount);
    } catch {
      return null;
    }
  }

  async putRows(rows: unknown[]): Promise<void> {
    try {
      const normalized: CachedTextRow[] = [];
      for (const r of rows) {
        const row = normalizeRow(r);
        if (row) normalized.push(row);
      }
      if (normalized.length > 0) await this.backend.save(normalized);
    } catch {
      // Persistence must never break the caller.
    }
  }
}

// Module singleton: IndexedDB when available, memory fallback
// otherwise (still correct, just session-scoped).
let singleton: QuranTextCache | null = null;
export function getQuranTextCache(): QuranTextCache {
  if (!singleton) {
    try {
      singleton = new QuranTextCache(createIndexedDBBackend());
    } catch {
      singleton = new QuranTextCache(new MemoryQuranTextBackend());
    }
  }
  return singleton;
}
