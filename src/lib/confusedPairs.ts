// 17.9 (2026-11-26): «تخلط بين هاتين الآيتين». When the user picks a wrong
// ayah in the mutashabihat game, the pair (the ayah he said and the clue's
// right ayat) is kept on the device, so he can see which ayat he mixes up.
// Local only, newest first, capped.
export const CONFUSED_KEY = 'rawabit.confusedPairs.v1';
export const CONFUSED_MAX = 40;

export type ConfusedPair = {
  clueId: string;
  clue: string;
  picked: string;      // 's:a' the user said
  answers: string[];   // 's:a' the clue really is in
  count: number;
  last: number;        // ms
};

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const ls = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

function isPair(v: unknown): v is ConfusedPair {
  const p = v as ConfusedPair;
  return !!p && typeof p.clueId === 'string' && typeof p.picked === 'string' && Array.isArray(p.answers) && typeof p.count === 'number';
}

export function loadConfusedPairs(store: Store | null = ls()): ConfusedPair[] {
  if (!store) return [];
  try {
    const v: unknown = JSON.parse(store.getItem(CONFUSED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(isPair) : [];
  } catch { return []; }
}

export function recordConfusedPair(
  item: { id: string; clue: string; answers: string[] }, picked: string,
  now = Date.now(), store: Store | null = ls(),
): ConfusedPair[] {
  if (!store) return [];
  const list = loadConfusedPairs(store);
  const i = list.findIndex((p) => p.clueId === item.id && p.picked === picked);
  const prev = i >= 0 ? list.splice(i, 1)[0] : null;
  const next: ConfusedPair = { clueId: item.id, clue: item.clue, picked, answers: [...item.answers], count: (prev?.count ?? 0) + 1, last: now };
  const out = [next, ...list].slice(0, CONFUSED_MAX);
  try { store.setItem(CONFUSED_KEY, JSON.stringify(out)); } catch { /* storage full: keep going */ }
  return out;
}

export function removeConfusedPair(clueId: string, picked: string, store: Store | null = ls()): ConfusedPair[] {
  if (!store) return [];
  const out = loadConfusedPairs(store).filter((p) => !(p.clueId === clueId && p.picked === picked));
  try { store.setItem(CONFUSED_KEY, JSON.stringify(out)); } catch { /* ignore */ }
  return out;
}
