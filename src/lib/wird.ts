// Daily wird (v1, localStorage only) — shared by the لوحتي card
// (display + start/complete actions) and the Settings page (the
// configuration: type + pages per day). One key and one shape, so a
// change made in Settings shows on لوحتي at once, and saved progress
// (streak, done days) is never touched by a settings change.

export type WirdType = 'sabaq' | 'murajaa' | 'manzil';

export const WIRD_KEY = 'quran-wird-v1';

export const WIRD_TYPE_LABEL: Record<WirdType, string> = {
  sabaq: 'سبق (جديد)',
  murajaa: 'مراجعة',
  // Display name only (the stored key stays 'manzil'): "المحفوظ القديم"
  // reads clearly, unlike "منزل" which users did not understand, and
  // unlike "ما تم مراجعته من قبل" which would collide with مراجعة.
  manzil: 'المحفوظ القديم',
};

export interface WirdState {
  target: number;
  type: WirdType;
  streak: number;
  lastDone: string; // YYYY-MM-DD local, '' when never
  doneDays: string[]; // dates marked done
}

export function loadWird(): WirdState {
  try {
    const raw = localStorage.getItem(WIRD_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.target === 'number' && typeof p.streak === 'number' && Array.isArray(p.doneDays)) {
        return { target: p.target, type: p.type || 'sabaq', streak: p.streak, lastDone: p.lastDone || '', doneDays: p.doneDays };
      }
    }
  } catch {}
  return { target: 2, type: 'sabaq', streak: 0, lastDone: '', doneDays: [] };
}

export function saveWird(s: WirdState) {
  try { localStorage.setItem(WIRD_KEY, JSON.stringify(s)); } catch {}
}
