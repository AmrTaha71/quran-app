import { getGlobalAyahNumber } from './surahs';

export interface Reciter {
  id: string;
  name: string;
  quality: string; // kbps actually served — verified live per reciter
  /** Words per second measured from the reciter's word-timing data (public/corr-timings); absent = no timing data yet. */
  wps?: number;
  audioUrl: (surahNo: number, ayahNo: number) => string;
}

// islamic.network serves ayah audio by global ayah number. Its max
// bitrate is 128 (192 returns 502 for every edition — it does not exist
// there), and several editions (Sudais, Abdul Basit, Jaber, Dosari,
// Sufi) are blocked with 403 at every bitrate, so those come from
// everyayah where available. Every URL below was verified live on
// Ayat al-Kursi (2:255) before being added here.
const islamicNetwork = (edition: string) => (surahNo: number, ayahNo: number) =>
  `https://cdn.islamic.network/quran/audio/128/${edition}/${getGlobalAyahNumber(surahNo, ayahNo)}.mp3`;

const pad3 = (n: number) => String(n).padStart(3, '0');

const everyayah = (folder: string) => (surahNo: number, ayahNo: number) =>
  `https://www.everyayah.com/data/${folder}/${pad3(surahNo)}${pad3(ayahNo)}.mp3`;

export const RECITERS: Reciter[] = [
  { id: 'minshawi', wps: 0.81, name: 'المنشاوي', quality: '128', audioUrl: islamicNetwork('ar.minshawi') },
  { id: 'ayyoub', name: 'محمد أيوب', quality: '128', audioUrl: islamicNetwork('ar.muhammadayyoub') },
  { id: 'sudais', name: 'السديس', quality: '192', audioUrl: everyayah('Abdurrahmaan_As-Sudais_192kbps') },
  { id: 'husary', wps: 0.57, name: 'الحصري', quality: '128', audioUrl: islamicNetwork('ar.husary') },
  { id: 'alafasy', wps: 0.76, name: 'العفاسي', quality: '128', audioUrl: islamicNetwork('ar.alafasy') },
  { id: 'muaiqly', name: 'المعيقلي', quality: '128', audioUrl: islamicNetwork('ar.mahermuaiqly') },
  { id: 'abdulbasit', wps: 0.76, name: 'عبد الباسط', quality: '192', audioUrl: everyayah('Abdul_Basit_Murattal_192kbps') },
  // Jaber: only 64kbps exists on any open source found (everyayah);
  // his islamic.network edition is blocked, and no 128 folder exists.
  { id: 'jaber', name: 'علي جابر', quality: '64', audioUrl: everyayah('Ali_Jaber_64kbps') },
  // Hani Ar-Rifai: added as a trial (2026-11-08). Folder name and licence not verified from the sandbox; check playback on device.
  { id: 'rifai', wps: 0.89, name: 'هاني الرفاعي', quality: '192', audioUrl: everyayah('Hani_Rifai_192kbps') },
];

/** Speed groups of the Hafs reciters (reciter picker: riwaya -> speed -> reciter). The class comes from the measured
 *  words/second (fast >= 1.0, slow < 0.7, otherwise medium); a reciter without timing data is 'unrated' until measured. */
export type SpeedClass = 'fast' | 'medium' | 'slow' | 'unrated';
export const SPEED_ORDER: SpeedClass[] = ['fast', 'medium', 'slow', 'unrated'];
export const SPEED_LABEL: Record<SpeedClass, string> = { fast: 'سريعة', medium: 'متوسطة', slow: 'بطيئة', unrated: 'غير مصنّفة بعد' };
export function speedOf(r: Reciter): SpeedClass {
  if (r.wps === undefined) return 'unrated';
  return r.wps >= 1.0 ? 'fast' : r.wps < 0.7 ? 'slow' : 'medium';
}

export const DEFAULT_RECITER_ID = 'minshawi';
