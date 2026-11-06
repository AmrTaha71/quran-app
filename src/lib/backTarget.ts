// Shared back-target store — the single source of truth for the
// shell back button (2026-11-06, back-button part 1).
//
// MODEL: a tiny module-singleton pub/sub, no React, no storage —
// mirroring src/lib/nowPlaying.ts. A page that has an internal
// "back" destination (an open Settings door, a Listen detail view,
// a SelfTest sub-view) publishes it here; the shell BackButton in
// App.tsx reads it and offers it instead of the route-level parent
// (home). Null = no internal destination: the shell button goes
// back to الرئيسية.
//
// RULES:
// - Only the VISIBLE page may hold a target. Pages that stay
//   mounted while hidden (Listen/Adhkar) must register only while
//   their `visible` prop is true, and clear when it becomes false.
// - Every registration is an effect with cleanup: closing the
//   sub-view or unmounting clears the target, so a stale target
//   from a previous route can never show. App.tsx also clears on
//   every route change (navigate + hashchange, pre-commit).
//
// API:
//   setBackTarget(t)            — publish (or clear with null).
//   getBackTarget()             — current value (null if none).
//   subscribeBackTarget(cb)     — subscribe; returns unsubscribe.
// Hook-free, React-free, Supabase-free, same as the other engines.

export type BackTarget = { label: string; onBack: () => void };

let current: BackTarget | null = null;
const subscribers = new Set<() => void>();

/** Publish a back target (or null to clear). No-op if unchanged by identity. */
export function setBackTarget(t: BackTarget | null): void {
  if (current === t) return;
  current = t;
  for (const cb of [...subscribers]) {
    try {
      cb();
    } catch {
      // A throwing subscriber must never break navigation.
    }
  }
}

/** Current back target, or null if none is registered. */
export function getBackTarget(): BackTarget | null {
  return current;
}

/**
 * Subscribe to back-target changes. Returns an unsubscribe
 * function. Callers read the current value with getBackTarget()
 * inside the callback.
 */
export function subscribeBackTarget(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
