// Muaalem integration point for the «متقن» tasmee' level (W4-A, 2026-11-19).
//
// Dr. Amr's decision 5: harakat + tajweed are judged ONLY in «متقن», on a
// server running Muaalem (Hafs, MIT), admin-only for now. The on-device
// ears (Quran-Lab / browser) judge words; this layer would ADD tajweed notes
// after a test, it never changes the word grade.
//
// Status today: NOT CONNECTED. There is no server, so every call returns
// { status: 'unavailable' } and the UI says so honestly. Nothing here may
// ever invent notes.
//
// To connect later:
//  1. Set MUAALEM_ENDPOINT (e.g. from import.meta.env.VITE_MUAALEM_URL).
//  2. Capture the user's audio for the test (lib/recorder.ts already records
//     with consent) and pass it as `audio`.
//  3. POST { surah, fromAyah, toAyah, audio } and map the server reply to
//     TajweedNote[] in requestTajweedReview below.
//  4. Licence check first: keep this layer independent of Quran-Lab output
//     (NPL-1.2 forbids charging for features built on it).

export type TajweedNote = {
  surah: number;
  ayah: number;
  /** Word index inside the ayah (0-based), when the server gives one. */
  word?: number;
  /** Rule name, e.g. «مد متصل», «إخفاء», «حركة». */
  rule: string;
  /** Short Arabic explanation for the user. */
  message: string;
};

export type TajweedReview =
  | { status: 'unavailable'; reason: 'not-connected' | 'not-admin' | 'no-audio' }
  | { status: 'error'; message: string }
  | { status: 'ok'; notes: TajweedNote[] };

export type TajweedRequest = {
  surah: number;
  fromAyah: number;
  toAyah: number;
  /** Recorded recitation; required once the server exists. */
  audio?: Blob;
};

/** Server URL. Empty = not connected (today). */
const MUAALEM_ENDPOINT = '';

export function muaalemStatus(): 'connected' | 'not-connected' {
  return MUAALEM_ENDPOINT ? 'connected' : 'not-connected';
}

/** Ask Muaalem for tajweed notes on a finished «متقن» test.
 *  Returns 'unavailable' until the server is connected; never fakes notes. */
export async function requestTajweedReview(req: TajweedRequest, isAdmin: boolean): Promise<TajweedReview> {
  if (!isAdmin) return { status: 'unavailable', reason: 'not-admin' };
  if (!MUAALEM_ENDPOINT) return { status: 'unavailable', reason: 'not-connected' };
  if (!req.audio) return { status: 'unavailable', reason: 'no-audio' };
  // INTEGRATION POINT: the real call goes here once the server exists.
  // Until then this line is unreachable (MUAALEM_ENDPOINT is empty).
  return { status: 'error', message: 'Muaalem client not implemented' };
}
