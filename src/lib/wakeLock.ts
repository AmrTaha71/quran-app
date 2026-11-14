// Keeps the screen awake while `active` is true (2026-11-08). The browser
// drops the lock when the page is hidden, so it is re-acquired on return.
// Silently does nothing where the Screen Wake Lock API is missing.
import { useEffect } from 'react';

export function useWakeLock(active: boolean, force = false): void {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> } };
    if (!nav.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await nav.wakeLock!.request('screen');
        if (cancelled) {
          void s.release();
          return;
        }
        sentinel = s;
        // The browser drops the lock when the screen goes off or the tab hides;
        // forget it then so it is taken again on return.
        s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
      } catch {
        // denied or unsupported: the test still works, the screen may sleep
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !sentinel) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release();
      sentinel = null;
    };
  }, [active]);
}
