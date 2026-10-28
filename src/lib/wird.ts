// Daily wird (v1, localStorage only) — shared by the لوحتي card
// (display + start/complete actions) and the Settings page (the
// configuration: type + pages per day). One key and one shape, so a
// change made in Settings shows on لوحتي at once, and saved progress
// (streak, done days) is never touched by a settings change.

export type WirdType = 'sabaq' | 'murajaa' | 'manzil';

export const WIRD_KEY = 'quran-wird-v1';

export const WIRD_TYPE_LABEL: Record<WirdType, string> = {
  // Labels renamed 2026-10-27 per Amr (stored keys unchanged, so saved
  // data keeps working): "سبق" dropped, "جديد" for new memorization,
  // and مراجعة split into الحفظ الحديث vs المحفوظ القديم for clarity.
  sabaq: 'جديد',
  murajaa: 'مراجعة الحفظ الحديث',
  manzil: 'مراجعة المحفوظ القديم',
};

export interface WirdState {
  target: number; // legacy mirror: total pages across parts
  type: WirdType; // legacy mirror: first part with pages > 0
  parts: Record<WirdType, number>; // pages per part, 0 = skip that part
  streak: number;
  lastDone: string; // YYYY-MM-DD local, '' when never
  doneDays: string[]; // dates marked done
}

export const WIRD_TYPES_ORDER: WirdType[] = ['sabaq', 'murajaa', 'manzil'];

export function wirdTotal(parts: Record<WirdType, number>): number {
  return WIRD_TYPES_ORDER.reduce((s, k) => s + (parts[k] || 0), 0);
}

export function formatPages(n: number): string {
  if (n === 1) return 'صفحة واحدة';
  if (n === 2) return 'صفحتين';
  return `${n.toLocaleString('ar-EG')} صفحات`;
}

export function loadWird(): WirdState {
  try {
    const raw = localStorage.getItem(WIRD_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.streak === 'number' && Array.isArray(p.doneDays)) {
        // New shape: parts per type.
        if (p.parts && typeof p.parts === 'object') {
          const parts: Record<WirdType, number> = { sabaq: 0, murajaa: 0, manzil: 0 };
          for (const k of WIRD_TYPES_ORDER) {
            const v = p.parts[k];
            if (typeof v === 'number' && v >= 0) parts[k] = Math.min(10, Math.floor(v));
          }
          return { ...normalizeMirrors(parts), parts, streak: p.streak, lastDone: p.lastDone || '', doneDays: p.doneDays };
        }
        // Old shape (single type + target): migrate into parts.
        if (typeof p.target === 'number') {
          const parts: Record<WirdType, number> = { sabaq: 0, murajaa: 0, manzil: 0 };
          const t = (p.type === 'murajaa' || p.type === 'manzil') ? p.type : 'sabaq';
          parts[t] = Math.min(10, Math.max(0, Math.floor(p.target)));
          return { ...normalizeMirrors(parts), parts, streak: p.streak, lastDone: p.lastDone || '', doneDays: p.doneDays };
        }
      }
    }
  } catch {}
  const parts: Record<WirdType, number> = { sabaq: 2, murajaa: 0, manzil: 0 };
  return { ...normalizeMirrors(parts), parts, streak: 0, lastDone: '', doneDays: [] };
}

function normalizeMirrors(parts: Record<WirdType, number>): { target: number; type: WirdType } {
  const total = wirdTotal(parts);
  const type = WIRD_TYPES_ORDER.find((k) => parts[k] > 0) ?? 'sabaq';
  return { target: total, type };
}

export function saveWird(s: WirdState) {
  try {
    // Keep the legacy mirrors consistent with parts for any reader
    // that still looks at target/type.
    const parts = s.parts ?? { sabaq: 0, murajaa: 0, manzil: 0 };
    localStorage.setItem(WIRD_KEY, JSON.stringify({ ...s, parts, ...normalizeMirrors(parts) }));
  } catch {}
}
