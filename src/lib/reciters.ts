import { getGlobalAyahNumber } from './surahs';

export interface Reciter {
  id: string;
  name: string;
  quality: string; // kbps actually served — verified live per reciter
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
  { id: 'minshawi', name: 'المنشاوي', quality: '128', audioUrl: islamicNetwork('ar.minshawi') },
  { id: 'ayyoub', name: 'محمد أيوب', quality: '128', audioUrl: islamicNetwork('ar.muhammadayyoub') },
  { id: 'sudais', name: 'السديس', quality: '192', audioUrl: everyayah('Abdurrahmaan_As-Sudais_192kbps') },
  { id: 'husary', name: 'الحصري', quality: '128', audioUrl: islamicNetwork('ar.husary') },
  { id: 'alafasy', name: 'العفاسي', quality: '128', audioUrl: islamicNetwork('ar.alafasy') },
  { id: 'muaiqly', name: 'المعيقلي', quality: '128', audioUrl: islamicNetwork('ar.mahermuaiqly') },
  { id: 'abdulbasit', name: 'عبد الباسط', quality: '192', audioUrl: everyayah('Abdul_Basit_Murattal_192kbps') },
  // Jaber: only 64kbps exists on any open source found (everyayah);
  // his islamic.network edition is blocked, and no 128 folder exists.
  { id: 'jaber', name: 'علي جابر', quality: '64', audioUrl: everyayah('Ali_Jaber_64kbps') },
];

export const DEFAULT_RECITER_ID = 'minshawi';
