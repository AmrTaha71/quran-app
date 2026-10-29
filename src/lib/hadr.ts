// حدر (Hadr) — natural fast recitation, surah-file playback.
//
// VERDICT (measured on the studio edition, 2026-10-29 — do NOT
// re-litigate from the old third-party YouTube upload): Abdullah
// Awad al-Juhani IS natural hadr pace. Surah 67: 301s vs Alafasy
// murattal 455s (ratio 0.66x); surah 36: 714s vs 1060s (ratio
// 0.67x). The old YouTube upload of his Baqarah (~2h04m, murattal
// pace) is OVERRULED — evidently a different/slower recording
// than the studio edition used here.
//
// SCOPE (v1): surah-file playback ONLY — the Juhani edition is
// type surahbysurah on AlQuranCloud, not verse-by-verse, so there
// is no ayah-by-ayah chaining and no read-along highlight (the
// same constraint as the riwayat). Resume IS supported, exactly
// like the riwaya modes: last (surah, time-in-surah).
//
// Hadr is a HAFS recitation at a naturally fast pace. It is NOT
// an electronic speedup: the electronic speed chips (1x/1.25x/
// 1.5x playbackRate) are a different thing and are never labelled
// hadr. When hadr plays, the engine is constructed with
// playbackRate 1, so no electronic rate can stack on top of the
// natural pace, and switching back to a Hafs/riwaya engine
// re-applies that engine's own rate on its play().
//
// URL (verified by fetching, 2026-10-29 — same lesson as the
// riwayat ids: never trust a list id without a fetch):
//   https://cdn.islamic.network/quran/audio-surah/128/ar.abdullahawadaljuhani/{surah}.mp3
// Surah 1 fetched 200 audio/mpeg; surah 67 range probe 206
// audio/mpeg. Negative controls confirmed the caution in the
// same round: ar.abdulbasitmurattal-surah and ar.alafasy-surah
// both return 403 via this pattern despite being list ids.
//
// The engine itself is RiwayaEngine (riwayatPlayback.ts) with
// the edition/label/persist overrides: one surah-file engine,
// one Media Session behaviour, one interruption contract —
// hadr therefore gets lock-screen playback exactly like riwayat.
// This module holds only hadr's constants + resume storage.

export const HADR_ID = 'hadr';

/** AlQuranCloud audio edition identifier (verified by fetch). */
export const HADR_EDITION = 'ar.abdullahawadaljuhani';

/** Short name, used in Media Session + the playback view. */
export const HADR_NAME = 'حدر (الجهني)';

/** Full pace-area label: natural pace, never electronic speedup. */
export const HADR_FULL_LABEL = 'حدر (الجهني) — تلاوة سريعة طبيعية';

export const hadrAudioUrl = (surahNo: number): string =>
  `https://cdn.islamic.network/quran/audio-surah/128/${HADR_EDITION}/${surahNo}.mp3`;

// Selection persistence: '1' while hadr is the selected pace
// mode. On load, a set hadr flag wins over a persisted riwaya
// id (the page initialises riwaya to null when this is set) —
// the persisted riwaya id itself is left alone, so reselecting
// that riwaya later still finds its own resume.
export const HADR_SELECT_KEY = 'quran-hadr';

export function readHadrSelected(): boolean {
  try {
    return localStorage.getItem(HADR_SELECT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setHadrSelected(on: boolean): void {
  try {
    if (on) localStorage.setItem(HADR_SELECT_KEY, '1');
    else localStorage.removeItem(HADR_SELECT_KEY);
  } catch {
    // Swallow: persistence must never break playback.
  }
}

// ------------------------------------------------------------------
// Hadr resume: last (surah, time-in-surah). Single position (one
// voice), unlike the per-riwaya map — same validation discipline
// as the riwaya resume: bad shapes ignored, bad time normalises
// to 0 instead of invalidating an otherwise good position.
// ------------------------------------------------------------------

export interface HadrPosition {
  surah: number;
  time: number;
}

export const HADR_RESUME_KEY = 'quran-hadr-resume';

function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export function readHadrResume(): HadrPosition | null {
  try {
    const ls = storage();
    if (!ls) return null;
    const parsed: unknown = JSON.parse(ls.getItem(HADR_RESUME_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { surah, time } = parsed as { surah?: unknown; time?: unknown };
    if (!Number.isInteger(surah) || (surah as number) < 1 || (surah as number) > 114) {
      return null;
    }
    const cleanTime =
      typeof time === 'number' && Number.isFinite(time) && time >= 0 ? time : 0;
    return { surah: surah as number, time: cleanTime };
  } catch {
    return null;
  }
}

export function writeHadrResume(pos: HadrPosition): void {
  try {
    const ls = storage();
    if (!ls) return;
    if (!Number.isInteger(pos.surah) || pos.surah < 1 || pos.surah > 114) return;
    const time =
      typeof pos.time === 'number' && Number.isFinite(pos.time) && pos.time >= 0
        ? pos.time
        : 0;
    ls.setItem(HADR_RESUME_KEY, JSON.stringify({ surah: pos.surah, time }));
  } catch {
    // Swallow: persistence must never break playback.
  }
}

export function clearHadrResume(): void {
  try {
    storage()?.removeItem(HADR_RESUME_KEY);
  } catch {
    // Swallow.
  }
}
