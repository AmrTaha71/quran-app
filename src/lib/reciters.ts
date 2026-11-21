import { getGlobalAyahNumber } from './surahs';

export interface Reciter {
  id: string;
  name: string;
  quality: string; // kbps actually served — verified live per reciter
  /** Words per second measured from the reciter's word-timing data (public/corr-timings); absent = no timing data yet. */
  wps?: number;
  /** Manual speed class (Dr. Amr's judgement): used when there is no timing data, and it wins over the measured value. */
  speed?: 'fast' | 'medium' | 'slow';
  /** True until playback of this reciter's audio has been checked on a device. */
  unverified?: boolean;
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
  { id: 'ayyoub', wps: 0.73, name: 'محمد أيوب', quality: '128', audioUrl: islamicNetwork('ar.muhammadayyoub') },
  { id: 'sudais', wps: 1.06, name: 'السديس', quality: '192', audioUrl: everyayah('Abdurrahmaan_As-Sudais_192kbps') },
  { id: 'husary', wps: 0.57, name: 'الحصري', quality: '128', audioUrl: islamicNetwork('ar.husary') },
  { id: 'alafasy', wps: 0.76, name: 'العفاسي', quality: '128', audioUrl: islamicNetwork('ar.alafasy') },
  { id: 'muaiqly', wps: 1.1, name: 'المعيقلي', quality: '128', audioUrl: islamicNetwork('ar.mahermuaiqly') },
  { id: 'abdulbasit', wps: 0.76, name: 'عبد الباسط', quality: '192', audioUrl: everyayah('Abdul_Basit_Murattal_192kbps') },
  // Jaber: only 64kbps exists on any open source found (everyayah);
  // his islamic.network edition is blocked, and no 128 folder exists.
  { id: 'jaber', wps: 0.94, name: 'علي جابر', quality: '64', audioUrl: everyayah('Ali_Jaber_64kbps') },
  // Hani Ar-Rifai: added as a trial (2026-11-08). Folder name and licence not verified from the sandbox; check playback on device.
  { id: 'rifai', wps: 0.89, name: 'هاني الرفاعي', quality: '192', audioUrl: everyayah('Hani_Rifai_192kbps') },
  // Added 2026-11-21 (Dr. Amr): all three have word timings for the whole Quran (public/corr-timings), so they
  // also work as correction reciters. EveryAyah folders as in CORR_RECITERS.
  { id: 'shuraym', wps: 1.24, name: 'سعود الشريم', quality: '128', audioUrl: everyayah('Saood_ash-Shuraym_128kbps') },
  { id: 'shaatree', wps: 0.88, name: 'أبو بكر الشاطري', quality: '128', audioUrl: everyayah('Abu_Bakr_Ash-Shaatree_128kbps') },
  { id: 'tablaway', wps: 0.78, name: 'محمد الطبلاوي', quality: '128', audioUrl: everyayah('Mohammad_al_Tablaway_128kbps') },
  // Fast (hadr) reciters for khatmas, added 2026-11-21 on Dr. Amr's request. No word timings, so they are listen-only
  // (no correction). EveryAyah folders verified to exist (2026-11-21). wps of these four and of ayyoub/sudais/muaiqly/jaber is MEASURED from the audio files (file words/sec, calibrated on the 8 timed reciters, divided by 0.93), not from word timings.
  { id: 'tunaiji', wps: 0.86, name: 'خليفة الطنيجي', quality: '64', audioUrl: everyayah('khalefa_al_tunaiji_64kbps') },
  { id: 'bukhatir', wps: 1.01, name: 'صلاح بو خاطر', quality: '128', audioUrl: everyayah('Salaah_AbdulRahman_Bukhatir_128kbps') },
  { id: 'neana', wps: 0.78, name: 'أحمد نعينع', quality: '128', audioUrl: everyayah('Ahmed_Neana_128kbps') },
  { id: 'matroud', wps: 0.84, name: 'عبد الله المطرود', quality: '128', audioUrl: everyayah('Abdullah_Matroud_128kbps') },
];

/** Speed groups of the Hafs reciters (reciter picker: riwaya -> speed -> reciter). The class comes from the measured
 *  words/second (fast >= 1.0, slow < 0.7, otherwise medium); a reciter without timing data is 'unrated' until measured. */
export type SpeedClass = 'fast' | 'medium' | 'slow' | 'unrated';
export const SPEED_ORDER: SpeedClass[] = ['fast', 'medium', 'slow', 'unrated'];
export const SPEED_LABEL: Record<SpeedClass, string> = { fast: 'سريعة', medium: 'متوسطة', slow: 'بطيئة', unrated: 'غير مصنّفة بعد' };
export function speedOf(r: Reciter): SpeedClass {
  if (r.speed) return r.speed;
  if (r.wps === undefined) return 'unrated';
  return r.wps >= 1.0 ? 'fast' : r.wps < 0.7 ? 'slow' : 'medium';
}

export const DEFAULT_RECITER_ID = 'minshawi';
