// corrAudioStore.ts — persistent correction-audio cache for the
// continuous self-test prompt (SelfTestPage). DOM-free except for
// the IndexedDB backend itself, which is isolated behind the
// CorrAudioBackend interface so the key / serialization / eviction
// logic is unit-testable in node against the memory backend.
//
// WHY INDEXEDDB (not Cache API): the cache key is content metadata
// (voice, words, version, rate), not a request URL, and the store
// needs structured records (savedAt for oldest-first eviction, blob
// size accounting, version filtering). Cache API stores
// request/response pairs and cannot enumerate metadata. Blobs are
// stored, so a repeat prompt plays instantly AND offline — a stored
// URL alone would still need the network at play time.
//
// SAFARI PERSISTENCE CAVEAT: Safari may wipe a non-installed site's
// storage after ~7 days without use; an installed PWA (home-screen
// install) is exempt. A wipe only costs re-generation (the race +
// TTS fallback still works) — it never breaks correction.
//
// VERSIONING: the key includes CORR_AUDIO_CACHE_VERSION. When the
// voice engine or model changes, bump the constant: old entries
// miss by key and refill gradually. No purge is ever needed, and
// hydrate opportunistically deletes old-version rows.

// v2 (2026-10-29): generate-voice v10 moved the OpenAI path to
// Realtime cedar/marin — v1 entries (old voices) miss by key and
// refill gradually; hydrate deletes old-version rows.
// v3 (2026-10-30): rate REMOVED from the key. Correction files are
// generated once at neutral speed (generate-voice v13,
// rateMode:'playback') and the user's corrRate applies at play time
// via audio.playbackRate (pitch-preserved). v2 entries miss by
// version and refill gradually; hydrate deletes old-version rows.
export const CORR_AUDIO_CACHE_VERSION = 'v3';

export interface CorrAudioEntry {
  key: string;
  voice: string;
  words: string;
  indices: number[];
  rate: number;
  version: string;
  blob: Blob;
  savedAt: number;
}

// Full cache key: (version, voice, spoken-words text, indices).
// Rate is DELIBERATELY absent (v3): one neutral-speed file serves
// all corrRates via playbackRate, so a rate change never
// regenerates. Deliberately separate from the N1 dedupe key
// (indices only): a stall-prefetched bare-word audio ("للمتقين")
// must never play for a context-word prompt ("هدى للمتقين") with
// the same indices, and vice versa. Indices stay in the key for
// disambiguation even though identical spoken text yields identical
// audio — a repeat of the same missed position (the common case)
// still hits.
export function corrAudioCacheKey(
  version: string,
  voice: string,
  words: string[],
  indices: number[],
): string {
  return version + '|' + voice + '|' + words.join(' ') + '#' + indices.join(',');
}

// Synchronous in-memory mirror of playable URLs. The prompt path
// must decide prefetched-vs-race synchronously, so it reads this
// mirror; the persistent backend hydrates it (object URLs from
// stored blobs) and every new audio persists in the background.
// Eviction revokes blob: URLs; remote URLs are left alone
// (revokeObjectURL ignores non-blob URLs, but the prefix check
// keeps the intent explicit).
export class AudioUrlCache {
  private readonly cap: number;
  private readonly map = new Map<string, string>();
  constructor(cap: number) {
    this.cap = cap;
  }
  get(key: string): string | null {
    const url = this.map.get(key);
    return url === undefined ? null : url;
  }
  set(key: string, url: string): void {
    if (this.map.has(key)) this.map.delete(key);
    while (this.map.size >= this.cap) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      const oldUrl = this.map.get(oldest.value);
      this.map.delete(oldest.value);
      if (oldUrl !== undefined && oldUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(oldUrl); } catch {}
      }
    }
    this.map.set(key, url);
  }
  delete(key: string): void {
    const url = this.map.get(key);
    this.map.delete(key);
    if (url !== undefined && url.startsWith('blob:')) {
      try { URL.revokeObjectURL(url); } catch {}
    }
  }
  clear(): void {
    for (const url of this.map.values()) {
      if (url.startsWith('blob:')) {
        try { URL.revokeObjectURL(url); } catch {}
      }
    }
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}

export interface CorrAudioBackend {
  loadAll(): Promise<CorrAudioEntry[]>;
  save(entry: CorrAudioEntry): Promise<void>;
  remove(key: string): Promise<void>;
}

// In-memory backend: the node-test fake AND the runtime fallback
// when IndexedDB is unavailable. Same cap + oldest-first eviction
// semantics as the IndexedDB backend, so tests prove the policy.
export class MemoryCorrAudioBackend implements CorrAudioBackend {
  private readonly cap: number;
  private readonly map = new Map<string, CorrAudioEntry>();
  constructor(cap: number) {
    this.cap = cap;
  }
  async loadAll(): Promise<CorrAudioEntry[]> {
    return [...this.map.values()];
  }
  async save(entry: CorrAudioEntry): Promise<void> {
    if (this.map.has(entry.key)) this.map.delete(entry.key);
    this.map.set(entry.key, entry);
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
  get size(): number {
    return this.map.size;
  }
}

const IDB_NAME = 'quran-corr-audio';
const IDB_STORE = 'entries';

// IndexedDB backend. Throws synchronously when indexedDB is
// unavailable (node, SSR); method rejections (denied storage, quota)
// are the caller's to swallow — a backend failure must never break
// correction, only lose persistence for that write. Cap enforcement
// runs in a separate transaction after the put, so no transaction
// spans an await gap.
export function createIndexedDBBackend(
  dbName: string = IDB_NAME,
  storeName: string = IDB_STORE,
  cap: number = 500,
): CorrAudioBackend {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) throw new Error('indexedDB unavailable');
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = idb.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'key' });
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
    async loadAll(): Promise<CorrAudioEntry[]> {
      const db = await open();
      try {
        const tx = db.transaction(storeName, 'readonly');
        return await request(tx.objectStore(storeName).getAll());
      } finally {
        db.close();
      }
    },
    async save(entry: CorrAudioEntry): Promise<void> {
      const db = await open();
      try {
        const tx = db.transaction(storeName, 'readwrite');
        await request(tx.objectStore(storeName).put(entry));
      } finally {
        db.close();
      }
      // Enforce the cap in a fresh transaction: delete oldest-first
      // beyond the cap. Best-effort — a failure here leaves one
      // extra row, never a broken prompt.
      try {
        const db2 = await open();
        try {
          const tx2 = db2.transaction(storeName, 'readwrite');
          const store2 = tx2.objectStore(storeName);
          const all = await request(store2.getAll());
          all.sort((a, b) => a.savedAt - b.savedAt);
          for (let i = 0; i + cap < all.length; i++) {
            await request(store2.delete(all[i].key));
          }
        } finally {
          db2.close();
        }
      } catch {}
    },
    async remove(key: string): Promise<void> {
      const db = await open();
      try {
        const tx = db.transaction(storeName, 'readwrite');
        await request(tx.objectStore(storeName).delete(key));
      } finally {
        db.close();
      }
    },
  };
}
