// Night-reading ground for the Mushaf margins (approved 2026-11-04).
// Sets/clears <html data-mushaf-night="1">; index.css reads it.
export const MUSHAF_NIGHT_KEY = 'quran-mushaf-night';

export function isMushafNight(): boolean {
  try {
    return localStorage.getItem(MUSHAF_NIGHT_KEY) === '1';
  } catch {
    return false;
  }
}

export function applyMushafNight(on: boolean = isMushafNight()): void {
  try {
    if (on) document.documentElement.dataset.mushafNight = '1';
    else delete document.documentElement.dataset.mushafNight;
  } catch {
    // decorative: never break the page
  }
}

export function setMushafNight(on: boolean): void {
  try {
    localStorage.setItem(MUSHAF_NIGHT_KEY, on ? '1' : '0');
  } catch {
    // storage unavailable: the choice just won't persist
  }
  applyMushafNight(on);
}

// Applied on import. App.tsx imports SettingsPage statically, so this runs
// at app load and the saved choice is in effect before the Mushaf opens.
if (typeof document !== 'undefined') applyMushafNight();
