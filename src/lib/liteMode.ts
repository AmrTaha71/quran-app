// «وضع التوفير» (2026-11-14): one switch that makes the app gentle on the
// battery. On: no vibration, no tap/opening sounds, no animations or blur/
// shadow effects, a soft dim over the screen (saves power on OLED; a web page
// cannot set the phone's own brightness), and no keep-awake lock. Switches on
// by itself once when the battery drops to 20% or less (not charging), unless
// the user switched it off by hand. Battery API: Android/Chrome only.
const KEY = 'quran-lite';
const EVT = 'quran-lite-change';
const realVibrate: Navigator['vibrate'] | undefined = typeof navigator !== 'undefined' ? navigator.vibrate?.bind(navigator) : undefined;

export function isLite(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

function apply(): void {
  const on = isLite();
  document.documentElement.classList.toggle('lite', on);
  try {
    (navigator as unknown as { vibrate: unknown }).vibrate = on ? () => false : realVibrate;
  } catch { /* read-only */ }
  window.dispatchEvent(new CustomEvent(EVT, { detail: on }));
}

export function setLite(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
  apply();
}

export function subscribeLite(cb: () => void): () => void {
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}

export function initLite(): void {
  apply();
  const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (t: string, f: () => void) => void }> };
  if (!nav.getBattery) return;
  void nav.getBattery().then((b) => {
    const check = () => {
      let stored: string | null = null;
      try { stored = localStorage.getItem(KEY); } catch { /* ignore */ }
      if (stored === null && b.level <= 0.2 && !b.charging) setLite(true);
    };
    check();
    b.addEventListener('levelchange', check);
    b.addEventListener('chargingchange', check);
  }).catch(() => {});
}
