// Offline correction reciters (2026-11-08): the user picks which
// reciters correct him and downloads their whole-Quran ayah files
// (EveryAyah). Stored in the Cache API cache 'quran-audio-corr',
// keep-listed in public/sw.js and served cache-first there, so the
// correction player keeps asking for the same URLs and gets the file
// offline. EveryAyah sends no CORS header, so files are fetched
// 'no-cors' and stored opaque (same as the Juhani downloads).
import { SURAH_AYAH_COUNTS } from './surahs';
import { CORR_RECITERS } from './juhaniCorr';
import { JUZ_STARTS } from './quranBoundaries';

export const CORR_AUDIO_CACHE = 'quran-audio-corr';
const DONE_KEY = (f: string) => `quran-corr-dl-done-${f}`;
const COUNT_KEY = (f: string) => `quran-corr-dl-count-${f}`;
export const CHOSEN_KEY = 'quran-corr-chosen-v1';
export const TOTAL_AYAHS = 6236;

/** Approximate whole-Quran size in MB (recitation length x bitrate). */
export const CORR_SIZE_MB: Record<string, number> = {
  Husary_64kbps: 450,
  Abdul_Basit_Murattal_64kbps: 450,
  Minshawy_Murattal_128kbps: 900,
  Alafasy_128kbps: 750,
  Mohammad_al_Tablaway_128kbps: 900,
  'Saood_ash-Shuraym_128kbps': 700,
  'Abu_Bakr_Ash-Shaatree_128kbps': 800,
  Hani_Rifai_192kbps: 1300,
};
export const ALL_SIZE_MB = CORR_RECITERS.reduce((a, r) => a + (CORR_SIZE_MB[r.folder] || 0), 0);

export function formatSize(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} جيجا` : `${mb} ميجا`;
}

export function ayahUrl(folder: string, surah: number, ayah: number): string {
  const p3 = (n: number) => String(n).padStart(3, '0');
  return `https://everyayah.com/data/${folder}/${p3(surah)}${p3(ayah)}.mp3`;
}

export function isDownloaded(folder: string): boolean {
  try { return localStorage.getItem(DONE_KEY(folder)) === '1'; } catch { return false; }
}
export function downloadedCount(folder: string): number {
  try { return Number(localStorage.getItem(COUNT_KEY(folder)) || 0); } catch { return 0; }
}

function* allAyahs(): Generator<[number, number]> {
  for (let s = 1; s <= 114; s++) for (let a = 1; a <= SURAH_AYAH_COUNTS[s - 1]; a++) yield [s, a];
}

// ---- Per-juz downloads (the user may only want what he memorizes) ----
const JUZ_KEY = (f: string, j: number) => `quran-corr-dl-juz-${f}-${j}`;

/** [surah, ayah] list of one juz (1..30). */
export function juzAyahs(juz: number): [number, number][] {
  const startG = JUZ_STARTS[juz - 1].global;
  const endG = juz < 30 ? JUZ_STARTS[juz].global - 1 : TOTAL_AYAHS;
  const out: [number, number][] = [];
  let g = 0;
  for (let s = 1; s <= 114; s++) {
    for (let a = 1; a <= SURAH_AYAH_COUNTS[s - 1]; a++) {
      g++;
      if (g >= startG && g <= endG) out.push([s, a]);
    }
  }
  return out;
}
export function juzSizeMb(folder: string, juz: number): number {
  // The 30 juz are about equal in recited length, so 1/30 of the whole.
  void juz;
  return Math.max(1, Math.round((CORR_SIZE_MB[folder] || 0) / 30));
}
export function isJuzDownloaded(folder: string, juz: number): boolean {
  if (isDownloaded(folder)) return true;
  try { return localStorage.getItem(JUZ_KEY(folder, juz)) === '1'; } catch { return false; }
}
export function downloadedJuzCount(folder: string): number {
  let n = 0;
  for (let j = 1; j <= 30; j++) if (isJuzDownloaded(folder, j)) n++;
  return n;
}

async function fetchList(folder: string, list: [number, number][], onProgress: (d: number, t: number) => void, signal: AbortSignal) {
  const cache = await caches.open(CORR_AUDIO_CACHE);
  let done = 0, failed = 0, i = 0;
  const worker = async () => {
    while (i < list.length && !signal.aborted) {
      const [s, a] = list[i++];
      const url = ayahUrl(folder, s, a);
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url, { mode: 'no-cors', signal });
          await cache.put(url, res);
        }
        done++;
      } catch {
        if (signal.aborted) return;
        failed++;
      }
      if (done % 10 === 0) onProgress(done, list.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  onProgress(done, list.length);
  return { done, failed };
}

export async function downloadJuz(folder: string, juz: number, onProgress: (d: number, t: number) => void, signal: AbortSignal): Promise<'done' | 'aborted' | 'partial'> {
  const list = juzAyahs(juz);
  const r = await fetchList(folder, list, onProgress, signal);
  if (signal.aborted) return 'aborted';
  if (r.failed === 0 && r.done === list.length) {
    try { localStorage.setItem(JUZ_KEY(folder, juz), '1'); } catch { /* ignore */ }
    return 'done';
  }
  return 'partial';
}

export async function deleteJuz(folder: string, juz: number): Promise<void> {
  try {
    const cache = await caches.open(CORR_AUDIO_CACHE);
    await Promise.all(juzAyahs(juz).map(([s, a]) => cache.delete(ayahUrl(folder, s, a))));
  } catch { /* ignore */ }
  try {
    localStorage.removeItem(JUZ_KEY(folder, juz));
    // No longer whole: drop the whole-Quran flag, keep the other juz flags.
    if (localStorage.getItem(DONE_KEY(folder)) === '1') {
      localStorage.removeItem(DONE_KEY(folder));
      for (let j = 1; j <= 30; j++) if (j !== juz) localStorage.setItem(JUZ_KEY(folder, j), '1');
    }
  } catch { /* ignore */ }
}

/** Downloads every ayah file of one reciter. Resumable: cached files
 *  are skipped. Marks done only when every file is in the cache. */
export async function downloadReciter(
  folder: string,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<'done' | 'aborted' | 'partial'> {
  const cache = await caches.open(CORR_AUDIO_CACHE);
  const list = Array.from(allAyahs());
  let done = 0;
  let failed = 0;
  let i = 0;
  const worker = async () => {
    while (i < list.length && !signal.aborted) {
      const [s, a] = list[i++];
      const url = ayahUrl(folder, s, a);
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url, { mode: 'no-cors', signal });
          await cache.put(url, res);
        }
        done++;
      } catch {
        if (signal.aborted) return;
        failed++;
      }
      if (done % 25 === 0) {
        try { localStorage.setItem(COUNT_KEY(folder), String(done)); } catch { /* ignore */ }
        onProgress(done, list.length);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  try { localStorage.setItem(COUNT_KEY(folder), String(done)); } catch { /* ignore */ }
  onProgress(done, list.length);
  if (signal.aborted) return 'aborted';
  if (failed === 0 && done === list.length) {
    try { localStorage.setItem(DONE_KEY(folder), '1'); } catch { /* ignore */ }
    return 'done';
  }
  return 'partial';
}

export async function deleteReciter(folder: string): Promise<void> {
  try {
    const cache = await caches.open(CORR_AUDIO_CACHE);
    const prefix = `https://everyayah.com/data/${folder}/`;
    const keys = await cache.keys();
    await Promise.all(keys.filter((k) => k.url.startsWith(prefix)).map((k) => cache.delete(k)));
  } catch { /* ignore */ }
  try {
    localStorage.removeItem(DONE_KEY(folder));
    localStorage.removeItem(COUNT_KEY(folder));
    for (let j = 1; j <= 30; j++) localStorage.removeItem(JUZ_KEY(folder, j));
  } catch { /* ignore */ }
}

export function hasChosenReciter(): boolean {
  try { return localStorage.getItem(CHOSEN_KEY) === '1'; } catch { return true; }
}
export function markChosenReciter(): void {
  try { localStorage.setItem(CHOSEN_KEY, '1'); } catch { /* ignore */ }
}
