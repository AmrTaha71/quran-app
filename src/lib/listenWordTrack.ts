// 2026-11-19: word-by-word position of the recitation that Listen is playing.
// Reads the shared audio element (no change to Listen). The recording's
// folder is parsed from the audio URL (everyayah .../data/<folder>/SSSAAA.mp3).
// If we have measured word timings for that reciter (public/corr-timings) they
// are used; otherwise the ayah's duration is split across its words in
// proportion to each word's width on the page (works for any reciter).
import { getSharedAudio } from './sharedAudio';
import { CORR_RECITERS } from './juhaniCorr';

type TimingMap = Record<string, number[]>;
const maps = new Map<string, TimingMap | null>();
const loading = new Set<string>();

const baseName = (f: string) => f.replace(/_\d+kbps$/i, '').toLowerCase();

function corrFolderFor(folder: string): string | null {
  const b = baseName(folder);
  return CORR_RECITERS.find((r) => baseName(r.folder) === b)?.folder ?? null;
}

function ensureMap(folder: string): TimingMap | null {
  if (maps.has(folder)) return maps.get(folder) ?? null;
  if (!loading.has(folder)) {
    loading.add(folder);
    fetch(`/corr-timings/${folder}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => { maps.set(folder, (m as TimingMap) ?? null); })
      .catch(() => { maps.set(folder, null); })
      .finally(() => loading.delete(folder));
  }
  return null;
}

/** 0-based index of the word being recited now, or -1 if unknown.
 *  `weights` = relative width of each word (length = word count). */
export function currentListenWord(surah: number, ayah: number, weights: number[]): number {
  if (weights.length === 0) return -1;
  let audio: HTMLAudioElement;
  try { audio = getSharedAudio(); } catch { return -1; }
  const t = audio.currentTime;
  if (!Number.isFinite(t)) return -1;
  const m = /\/data\/([^/]+)\//.exec(audio.currentSrc || audio.src || '');
  const corr = m ? corrFolderFor(m[1]) : null;
  if (corr) {
    const map = ensureMap(corr);
    const flat = map?.[`${surah}:${ayah}`];
    if (flat && flat.length >= 2) {
      const n = Math.min(Math.floor(flat.length / 2), weights.length);
      if (t < flat[0]) return 0;
      for (let i = 0; i < n; i++) if (t <= flat[2 * i + 1] + 0.005) return i;
      return n - 1;
    }
  }
  const dur = audio.duration;
  if (!Number.isFinite(dur) || dur <= 0) return -1;
  // The recording has a little silence at both ends.
  const lead = Math.min(0.25, dur * 0.05);
  const span = Math.max(0.1, dur - lead * 2);
  const frac = Math.min(1, Math.max(0, (t - lead) / span));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] / total;
    if (frac <= acc) return i;
  }
  return weights.length - 1;
}

/** Continuous position of the recitation, in word space: 3.4 = 40% of the way through the 4th word
 *  (0-based word 3). -1 when unknown. Same timings as currentListenWord, but with the fraction inside
 *  the word, so a highlight can glide with the voice instead of jumping word to word.
 *  `wordNos` = 1-based word numbers of the boxes (sorted), parallel to `weights`. */
export function currentListenProgress(surah: number, ayah: number, weights: number[], wordNos: number[]): number {
  if (weights.length === 0) return -1;
  let audio: HTMLAudioElement;
  try { audio = getSharedAudio(); } catch { return -1; }
  const t = audio.currentTime;
  if (!Number.isFinite(t)) return -1;
  const m = /\/data\/([^/]+)\//.exec(audio.currentSrc || audio.src || '');
  const corr = m ? corrFolderFor(m[1]) : null;
  if (corr) {
    const map = ensureMap(corr);
    const flat = map?.[`${surah}:${ayah}`];
    if (flat && flat.length >= 2) {
      const n = Math.floor(flat.length / 2);
      if (t <= flat[0]) return 0;
      for (let i = 0; i < n; i++) {
        const s = flat[2 * i], e = flat[2 * i + 1];
        if (t <= e) return t >= s && e > s ? i + (t - s) / (e - s) : i; // inside word i, or the gap before it
      }
      return n;
    }
  }
  const dur = audio.duration;
  if (!Number.isFinite(dur) || dur <= 0) return -1;
  const lead = Math.min(0.25, dur * 0.05);
  const span = Math.max(0.1, dur - lead * 2);
  const frac = Math.min(1, Math.max(0, (t - lead) / span));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] / total;
    if (frac <= acc + w) return (wordNos[i] - 1) + (w > 0 ? (frac - acc) / w : 0);
    acc += w;
  }
  return wordNos[wordNos.length - 1];
}
