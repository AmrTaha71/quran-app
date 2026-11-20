// Word-level mistake log for the tasmee' test (2026-11-20, Dr. Amr).
// Until now only the whole ayah was marked weak. This keeps, per WORD
// (surah:ayah:wordNo), how many times it was missed, so the app can say
// "you stumble on this word N times" and train just those ayahs.
//
// Rules (agreed wording: record only what was really judged):
//  - a missed word adds 1 and resets its correct streak;
//  - a word recited right after being logged adds to its streak and is
//    removed once it is right 3 times in a row (mastered);
//  - ayahs where NOTHING was matched are not recorded (the mic heard
//    nothing / the user stayed silent: that is not a word mistake).
// Local only (localStorage), new key, never read by older code.
export const WORD_MISTAKES_KEY = 'quran-word-mistakes-v1';
const MASTER_AFTER = 3;
const MAX_ENTRIES = 3000;

export type WordMistake = {
  /** times missed */ m: number;
  /** right in a row since the last miss */ c: number;
  /** last miss, ms epoch */ t: number;
  /** the word as written (with tashkeel), for display */ o: string;
};
type Store = Record<string, WordMistake>;

function load(): Store {
  try {
    const p = JSON.parse(localStorage.getItem(WORD_MISTAKES_KEY) || '{}');
    return p && typeof p === 'object' ? p as Store : {};
  } catch { return {}; }
}
function save(s: Store) {
  try {
    const keys = Object.keys(s);
    if (keys.length > MAX_ENTRIES) {
      // drop the least-missed, oldest entries first
      keys.sort((a, b) => (s[a].m - s[b].m) || (s[a].t - s[b].t));
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete s[k];
    }
    localStorage.setItem(WORD_MISTAKES_KEY, JSON.stringify(s));
  } catch { /* storage unavailable or full: tracking is best-effort */ }
}

/** Record one judged ayah. `words[i].orig` is the word as written,
 *  `matched[i]` whether it was recited right in place. */
export function recordAyahWords(surah: number, ayah: number, words: { orig: string }[], matched: boolean[]): void {
  if (!words.length || !matched.some(Boolean)) return;
  const store = load();
  const now = Date.now();
  words.forEach((w, i) => {
    const key = `${surah}:${ayah}:${i + 1}`;
    if (!matched[i]) {
      const e = store[key];
      store[key] = { m: (e?.m ?? 0) + 1, c: 0, t: now, o: w.orig };
    } else if (store[key]) {
      const e = store[key];
      e.c += 1;
      if (e.c >= MASTER_AFTER) delete store[key];
    }
  });
  save(store);
}

export type WeakWord = { surah: number; ayah: number; wordNo: number; word: string; misses: number; last: number };

/** Weak words, most-missed first (ties: most recent first). */
export function listWeakWords(): WeakWord[] {
  const s = load();
  return Object.entries(s).map(([k, v]) => {
    const [surah, ayah, wordNo] = k.split(':').map(Number);
    return { surah, ayah, wordNo, word: v.o, misses: v.m, last: v.t };
  }).sort((a, b) => (b.misses - a.misses) || (b.last - a.last));
}

/** Distinct ayahs that contain weak words, as [surah, ayah] in Mushaf order. */
export function weakWordAyahs(): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const w of listWeakWords()) {
    const k = `${w.surah}:${w.ayah}`;
    if (!seen.has(k)) { seen.add(k); out.push([w.surah, w.ayah]); }
  }
  return out.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
}

export function clearWeakWords(): void {
  try { localStorage.removeItem(WORD_MISTAKES_KEY); } catch { /* ignore */ }
}
