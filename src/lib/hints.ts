// Short explanations that retire themselves (2026-11-10).
// A hint is shown the first HINT_MAX_VIEWS times its screen is opened,
// then hidden for good: the icon and its title stay, the explanation
// goes. One localStorage key holds every counter. A screen counts once
// per app load (not per re-render), so reopening a door in the same
// visit does not burn the three views. Settings can bring them all back.
import { useEffect, useState } from 'react';

export const HINT_MAX_VIEWS = 3;
const KEY = 'quran-hint-views-v1';
const EVT = 'quran-hints-reset';
const countedThisLoad = new Set<string>();

function readAll(): Record<string, number> {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || '{}');
    return j && typeof j === 'object' ? (j as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** True while the hint has been seen fewer than HINT_MAX_VIEWS times. */
export function hintVisible(id: string): boolean {
  if (countedThisLoad.has(id)) return true; // already showing in this load
  return (readAll()[id] || 0) < HINT_MAX_VIEWS;
}

/** Count one view (at most once per app load). */
export function markHintSeen(id: string): void {
  if (countedThisLoad.has(id)) return;
  countedThisLoad.add(id);
  try {
    const all = readAll();
    all[id] = (all[id] || 0) + 1;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the hint simply keeps showing */
  }
}

/** Bring every explanation back (Settings). */
export function resetHints(): void {
  countedThisLoad.clear();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(EVT)); } catch { /* ignore */ }
}

/**
 * useHint('home'): true the first three times this screen is opened.
 * The value is fixed for the life of the mounted screen, so text never
 * disappears while the user is reading it.
 */
export function useHint(id: string): boolean {
  const [show, setShow] = useState(() => hintVisible(id));
  useEffect(() => {
    if (hintVisible(id)) markHintSeen(id);
    const onReset = () => setShow(true);
    window.addEventListener(EVT, onReset);
    return () => window.removeEventListener(EVT, onReset);
  }, [id]);
  return show;
}
