// User-recorded alarm messages (his / his wife's voice), kept on-device in
// IndexedDB. Tone id = `rec:<id>`; played looped by fajrAlarm.startAlarmTone.
export interface AlarmRec { id: string; name: string }
const DB = 'quran-alarm', STORE = 'rec';
const urls = new Map<string, { name: string; url: string }>();

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export const recUrl = (id: string): string | null => urls.get(id)?.url ?? null;
export const recToneId = (id: string) => `rec:${id}`;
export const isRecTone = (t: string) => t.startsWith('rec:');

export async function loadRecordings(): Promise<AlarmRec[]> {
  try {
    const db = await open();
    const all = await new Promise<{ id: string; name: string; blob: Blob }[]>((res, rej) => {
      const q = db.transaction(STORE).objectStore(STORE).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
    urls.forEach((v) => URL.revokeObjectURL(v.url)); urls.clear();
    for (const r of all) urls.set(r.id, { name: r.name, url: URL.createObjectURL(r.blob) });
    return all.map((r) => ({ id: r.id, name: r.name }));
  } catch { return []; }
}
export async function saveRecording(name: string, blob: Blob): Promise<void> {
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id: String(Date.now()), name: name.trim() || 'تسجيلي', blob });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  await loadRecordings();
}
export async function deleteRecording(id: string): Promise<void> {
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  await loadRecordings();
}

/** Start recording (max 20 s). stop() resolves with the audio Blob. */
export async function startRecording(): Promise<{ stop: () => Promise<Blob> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<Blob>((res) => {
    rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); res(new Blob(chunks, { type: rec.mimeType || 'audio/mp4' })); };
  });
  rec.start();
  const t = window.setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, 20000);
  return { stop: () => { window.clearTimeout(t); if (rec.state !== 'inactive') rec.stop(); return done; } };
}
