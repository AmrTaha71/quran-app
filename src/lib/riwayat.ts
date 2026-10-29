// Riwayat (non-Hafs readings) for listen-only playback — v1.
//
// SCOPE: listening only. Every edition here is type `surahbysurah`
// on AlQuranCloud: ONE audio file per surah, not verse-by-verse,
// so there is no ayah-by-ayah chaining and no read-along ayah
// highlight in riwaya mode (the app's seeded text is Hafs, and the
// words differ between readings — showing Hafs text under a
// non-Hafs voice would mislead). No offline-download support for
// riwayat in v1. Warsh is DELIBERATELY absent: no clean,
// embeddable Warsh audio source was confirmed, so no Warsh
// edition is listed here even though Warsh recordings exist
// elsewhere (apps / uploads without a clear embedding licence).
//
// URL PATTERN (verified live per edition, surah 1 + surah 2 for
// Qaloon, via api.alquran.cloud/v1/surah/{n}/{edition}):
//   https://cdn.islamic.network/quran/audio-surah/128/{edition}/{surah}.mp3
// The three Sufi identifiers below are the ones the live editions
// list actually returns (ar.abdurrasheedsufisoosi,
// ar.abdurrasheedsufishubahanasim,
// ar.abdurrasheedsufiabialhaarithanalkasaaee); shorter
// look-alikes (assosi / shubah / abulharithalkisaei) do NOT
// resolve — the API silently falls back to the default text
// edition for them, which is why the identifiers here must not
// be "tidied up" by hand.

export interface Riwaya {
  id: string;
  /** Display name, e.g. 'قالون — الحذيفي'. */
  name: string;
  /** AlQuranCloud audio edition identifier (verified). */
  edition: string;
  audioUrl: (surahNo: number) => string;
}

const surahFile =
  (edition: string) =>
  (surahNo: number): string =>
    `https://cdn.islamic.network/quran/audio-surah/128/${edition}/${surahNo}.mp3`;

export const RIWAYAT: Riwaya[] = [
  {
    id: 'qaloon',
    name: 'قالون — الحذيفي',
    edition: 'ar.aliabdurrahmanalhuthaifyqaloon',
    audioUrl: surahFile('ar.aliabdurrahmanalhuthaifyqaloon'),
  },
  {
    id: 'duri',
    name: 'الدوري عن أبي عمرو — الصوفي',
    edition: 'ar.abdurrasheedsufiaddoorianabiamr',
    audioUrl: surahFile('ar.abdurrasheedsufiaddoorianabiamr'),
  },
  {
    id: 'susi',
    name: 'السوسي — الصوفي',
    edition: 'ar.abdurrasheedsufisoosi',
    audioUrl: surahFile('ar.abdurrasheedsufisoosi'),
  },
  {
    id: 'shubah',
    name: 'شعبة عن عاصم — الصوفي',
    edition: 'ar.abdurrasheedsufishubahanasim',
    audioUrl: surahFile('ar.abdurrasheedsufishubahanasim'),
  },
  {
    id: 'abulHarith',
    name: 'أبو الحارث عن الكسائي — الصوفي',
    edition: 'ar.abdurrasheedsufiabialhaarithanalkasaaee',
    audioUrl: surahFile('ar.abdurrasheedsufiabialhaarithanalkasaaee'),
  },
];

export function findRiwaya(id: string | null | undefined): Riwaya | null {
  if (!id) return null;
  return RIWAYAT.find((r) => r.id === id) ?? null;
}

// ------------------------------------------------------------------
// Per-riwaya resume: last (surah, time-in-surah) per riwaya id, so
// the user can stop in one riwaya and return to it later without
// losing another riwaya's position. Same localStorage discipline
// as the Hafs listening wird: read at call time, swallow every
// failure, validate shape, normalise a bad time to 0 instead of
// invalidating an otherwise good position.
// ------------------------------------------------------------------

export interface RiwayaPosition {
  riwaya: string;
  surah: number;
  time: number;
}

export const RIWAYA_RESUME_KEY = 'quran-riwayat-resume';

function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

function cleanPosition(riwaya: string, raw: unknown): RiwayaPosition | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { surah, time } = raw as { surah?: unknown; time?: unknown };
  if (!Number.isInteger(surah) || (surah as number) < 1 || (surah as number) > 114) return null;
  const cleanTime =
    typeof time === 'number' && Number.isFinite(time) && time >= 0 ? time : 0;
  return { riwaya, surah: surah as number, time: cleanTime };
}

export function readRiwayaResume(riwayaId: string): RiwayaPosition | null {
  try {
    if (!RIWAYAT.some((r) => r.id === riwayaId)) return null;
    const ls = storage();
    if (!ls) return null;
    const parsed: unknown = JSON.parse(ls.getItem(RIWAYA_RESUME_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return null;
    return cleanPosition(riwayaId, (parsed as Record<string, unknown>)[riwayaId]);
  } catch {
    return null;
  }
}

export function writeRiwayaResume(pos: RiwayaPosition): void {
  try {
    if (!RIWAYAT.some((r) => r.id === pos.riwaya)) return;
    const ls = storage();
    if (!ls) return;
    let all: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(ls.getItem(RIWAYA_RESUME_KEY) ?? 'null');
      if (typeof parsed === 'object' && parsed !== null) all = parsed as Record<string, unknown>;
    } catch {
      all = {};
    }
    all[pos.riwaya] = { surah: pos.surah, time: pos.time };
    ls.setItem(RIWAYA_RESUME_KEY, JSON.stringify(all));
  } catch {
    // Swallow: persistence must never break playback.
  }
}

export function clearRiwayaResume(riwayaId: string): void {
  try {
    const ls = storage();
    if (!ls) return;
    let all: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(ls.getItem(RIWAYA_RESUME_KEY) ?? 'null');
      if (typeof parsed === 'object' && parsed !== null) all = parsed as Record<string, unknown>;
    } catch {
      all = {};
    }
    delete all[riwayaId];
    ls.setItem(RIWAYA_RESUME_KEY, JSON.stringify(all));
  } catch {
    // Swallow, as above.
  }
}
