// useKeepAwake (wave 2, W2-5): keep the screen on while `active` is true,
// using the Screen Wake Lock API. Deliberately generic and audio-free: it
// never touches playback, the microphone or any recognition logic.
//
// - request() is wrapped in try/catch: unsupported browsers, a denied
//   request (low battery, hidden tab) or any throw just means the screen
//   may sleep, never an error.
// - The browser drops the lock whenever the tab is hidden; it is asked for
//   again when the tab becomes visible.
// - The effect cleanup (active -> false, or unmount) releases the lock.
//
// App mounts it for the Mushaf, the tasmee (test) page and the Listen
// page only. Do not add it elsewhere without the owner's say.
import { useEffect } from 'react';

type WakeLockApi = { request: (type: 'screen') => Promise<WakeLockSentinel> };

export function useKeepAwake(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
    if (!api || typeof api.request !== 'function') return;

    let sentinel: WakeLockSentinel | null = null;
    let pending = false;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || pending || sentinel || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const s = await api.request('screen');
        if (cancelled) {
          void s.release().catch(() => {});
          return;
        }
        sentinel = s;
        // Dropped by the browser (tab hidden, power saver): forget it so
        // the next visible event takes a fresh one.
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null;
        });
      } catch {
        // denied or unsupported: the screen may sleep, nothing else breaks
      } finally {
        pending = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const s = sentinel;
      sentinel = null;
      if (s) void s.release().catch(() => {});
    };
  }, [active]);
}
