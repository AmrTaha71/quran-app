// 15.3 (2026-11-26): «أخطائي» voice clips: the user reading a word they
// keep getting wrong, kept ON THIS DEVICE only (IndexedDB), never
// uploaded. At most 50 clips; the oldest goes first (FIFO). Recording
// needs an explicit consent once (MISTAKE_VOICE_CONSENT_KEY).
export const MISTAKE_VOICE_CONSENT_KEY = 'quran-mistake-voice-consent-v1';
export const MISTAKE_VOICE_MAX = 50;
const DB = 'quran-mistake-voice', STORE = 'clip';

type Row = { id: string; at: number; blob: Blob };

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
function all(db: IDBDatabase): Promise<Row[]> {
  return new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).getAll(); q.onsuccess = () => res(q.result as Row[]); q.onerror = () => rej(q.error); });
}

export function hasVoiceConsent(): boolean { try { return localStorage.getItem(MISTAKE_VOICE_CONSENT_KEY) === '1'; } catch { return false; } }
export function giveVoiceConsent(): void { try { localStorage.setItem(MISTAKE_VOICE_CONSENT_KEY, '1'); } catch { /* ignore */ } }

/** Ids (surah:ayah:wordNo) that have a clip. */
export async function listVoiceIds(): Promise<Set<string>> {
  try { const db = await open(); return new Set((await all(db)).map((r) => r.id)); } catch { return new Set(); }
}
export async function saveVoice(id: string, blob: Blob): Promise<void> {
  const db = await open();
  const rows = await all(db);
  const doomed = rows.filter((r) => r.id !== id).sort((a, b) => a.at - b.at)
    .slice(0, Math.max(0, rows.filter((r) => r.id !== id).length - (MISTAKE_VOICE_MAX - 1)));
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    doomed.forEach((r) => st.delete(r.id));
    st.put({ id, at: Date.now(), blob });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
export async function voiceUrl(id: string): Promise<string | null> {
  try {
    const db = await open();
    const row = await new Promise<Row | undefined>((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(id); q.onsuccess = () => res(q.result as Row | undefined); q.onerror = () => rej(q.error); });
    return row ? URL.createObjectURL(row.blob) : null;
  } catch { return null; }
}
