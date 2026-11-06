// Sleep timer — ONE shared timer for ALL listening types in the app
// (Listen khatmas / free listen / tafsir journeys, Adhkar, ...).
// Created 2026-11-06 for feature #10 (Listen integration is in
// src/pages/ListenPage.tsx; the Adhkar integration is a separate
// Wave-2 step that uses ONLY this file's API).
//
// MODEL: a module singleton, in-memory only. It lives outside any
// React component, so it SURVIVES navigation between pages (the
// timer keeps running while the user moves around the app), but it
// does NOT survive a full app reload (module state resets — the UI
// then simply shows "not running", which is automatic, no stored
// stale timer to clean up). It NEVER touches adhan audio: the sleep
// timer is for listening only, never for adhan.
//
// API (exact — Wave-2 Adhkar agent: use these, nothing else):
//   SleepTimerMinutes           — 30 | 60 | 120 (minutes).
//   setSleepTimer(minutes)      — start (or restart) the timer;
//                                 clears any existing timer first.
//   clearSleepTimer()           — cancel the timer.
//   getSleepTimerRemainingMs()  — remaining ms, or null if no timer
//                                 is running.
//   subscribeSleepTimer(cb)     — subscribe to timer changes
//                                 (set / clear / every 1s tick while
//                                 running); returns an unsubscribe
//                                 function. The lib ticks every 1s
//                                 while a timer runs so the UI can
//                                 show a live countdown.
//   registerSleepStopHandler(id, fn)   — register a stop callback;
//                                 each playback engine registers one
//                                 (e.g. Listen 'listen-hafs',
//                                 'listen-journey', 'listen-riwaya').
//   unregisterSleepStopHandler(id)     — unregister it.
// When the timer fires: ALL registered stop callbacks are called,
// each in its own try/catch (one failing handler never blocks the
// others), then the timer is cleared and subscribers are notified.
// A stop handler should PAUSE its playback (fade out if the engine
// supports it, otherwise a clean pause) — it must never throw.
//
// EXTRA (convenience, not part of the core API):
//   SLEEP_TIMER_OPTIONS — [30, 60, 120], the chips the UI renders.
//
// Usage sketch (Adhkar Wave-2):
//   import { setSleepTimer, clearSleepTimer, getSleepTimerRemainingMs,
//            subscribeSleepTimer, registerSleepStopHandler,
//            unregisterSleepStopHandler } from '../lib/sleepTimer';
//   // on mount: registerSleepStopHandler('adhkar', () => pauseAdhkar());
//   // on unmount: unregisterSleepStopHandler('adhkar');
//   // chips: onClick={() => setSleepTimer(30)} (etc.)
//   // countdown: useEffect(() => subscribeSleepTimer(() =>
//   //   setRemaining(getSleepTimerRemainingMs())), [])
//   // cancel button: onClick={() => clearSleepTimer()}
// Hook-free, React-free, Supabase-free, same as the other engines.

// 2026-11-07: widened to any positive minute count (khatma timers use 15/45/180 too).
export type SleepTimerMinutes = number;

/** The three durations the UI offers, in minutes. */
export const SLEEP_TIMER_OPTIONS: SleepTimerMinutes[] = [30, 60, 120];

// Milliseconds per minute. Kept as a named constant so the
// minutes→ms conversion is never a magic number in two places.
const MS_PER_MINUTE = 60 * 1000;

// Tick cadence while a timer runs: the UI countdown updates once
// a second. A 1s tick is cheap (one subscriber notification) and
// matches the displayed mm:ss resolution.
const TICK_MS = 1000;

let timeoutId: ReturnType<typeof setTimeout> | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
// Epoch ms the timer fires at; null = no timer running.
let endsAt: number | null = null;

const stopHandlers = new Map<string, () => void>();
const subscribers = new Set<() => void>();

function notifySubscribers(): void {
  for (const cb of [...subscribers]) {
    try {
      cb();
    } catch {
      // A throwing subscriber must never break the timer.
    }
  }
}

function clearTimersOnly(): void {
  if (timeoutId !== null) {
    try {
      clearTimeout(timeoutId);
    } catch {
      // Swallow: clearing is best-effort.
    }
    timeoutId = null;
  }
  if (intervalId !== null) {
    try {
      clearInterval(intervalId);
    } catch {
      // Swallow.
    }
    intervalId = null;
  }
  endsAt = null;
}

// Fire path: clear FIRST (so a stop handler that starts a new
// timer is never wiped by our own cleanup), then call every
// registered stop callback in its own try/catch, then notify.
function fireTimer(): void {
  clearTimersOnly();
  const handlers = [...stopHandlers.values()];
  for (const fn of handlers) {
    try {
      fn();
    } catch {
      // One failing handler never blocks the others.
    }
  }
  notifySubscribers();
}

/**
 * Start (or restart) the sleep timer for `minutes`. Clears any
 * existing timer first, so there is ever at most one timer.
 */
export function setSleepTimer(minutes: SleepTimerMinutes): void {
  clearTimersOnly();
  endsAt = Date.now() + minutes * MS_PER_MINUTE;
  try {
    timeoutId = setTimeout(fireTimer, minutes * MS_PER_MINUTE);
  } catch {
    endsAt = null;
    return;
  }
  try {
    intervalId = setInterval(notifySubscribers, TICK_MS);
  } catch {
    // A missing tick only freezes the displayed countdown; the
    // fire timeout above still stops playback on time.
    intervalId = null;
  }
  notifySubscribers();
}

/** Cancel the timer, if one is running. No-op otherwise. */
export function clearSleepTimer(): void {
  const wasRunning = endsAt !== null;
  clearTimersOnly();
  if (wasRunning) notifySubscribers();
}

/**
 * Remaining milliseconds, or null if no timer is running.
 * Never negative: once the fire timeout has run, endsAt is null
 * (cleared in fireTimer), and a late read clamps to 0.
 */
export function getSleepTimerRemainingMs(): number | null {
  if (endsAt === null) return null;
  return Math.max(0, endsAt - Date.now());
}

/**
 * Subscribe to timer changes (set / clear / every 1s tick while
 * running). Returns an unsubscribe function. Callers read the
 * current value with getSleepTimerRemainingMs() inside the
 * callback.
 */
export function subscribeSleepTimer(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/**
 * Register a stop callback for one playback engine. `id` is the
 * engine's stable name (e.g. 'listen-hafs', 'adhkar'); registering
 * the same id twice replaces the previous callback. Called (all
 * handlers, each try/caught) when the timer fires.
 */
export function registerSleepStopHandler(id: string, fn: () => void): void {
  stopHandlers.set(id, fn);
}

/** Unregister a stop callback (call it when the engine is destroyed). */
export function unregisterSleepStopHandler(id: string): void {
  stopHandlers.delete(id);
}
