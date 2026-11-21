// Page colours for the digital Mushaf page (2026-11-21, Dr. Amr): calm backgrounds the reader picks,
// each with its own ink, frame and recitation-highlight colour. Only used by the standalone digital
// page (text on a plain background); the scan images are never recoloured.
export type MushafThemeId = 'ivory' | 'white' | 'sepia' | 'mint' | 'night';
export type MushafTheme = {
  id: MushafThemeId;
  name: string;
  bg: string;
  ink: string;
  frame: string;
  accent: string;
  /** "r, g, b" for --mushaf-hl-rgb (the recitation / tap highlight). */
  hl: string;
  dark: boolean;
};

export const MUSHAF_THEMES: MushafTheme[] = [
  { id: 'ivory', name: 'عاجي', bg: '#fbf6e9', ink: '#2b2a26', frame: '#c9b27a', accent: '#8a6d1f', hl: '176, 200, 168', dark: false },
  { id: 'white', name: 'أبيض', bg: '#ffffff', ink: '#1f1f1f', frame: '#b9c9bd', accent: '#2f6f4f', hl: '190, 214, 238', dark: false },
  { id: 'sepia', name: 'بني هادئ', bg: '#eadcc0', ink: '#3a2d1e', frame: '#a8895a', accent: '#6b4a1c', hl: '214, 178, 124', dark: false },
  { id: 'mint', name: 'أخضر هادئ', bg: '#e6f0e4', ink: '#1e3a2b', frame: '#8fb39a', accent: '#2f6f4f', hl: '244, 226, 150', dark: false },
  { id: 'night', name: 'ليلي', bg: '#16201c', ink: '#e9e4d3', frame: '#5f7a69', accent: '#d9bf6a', hl: '92, 128, 104', dark: true },
];

const KEY = 'quran-mushaf-theme';

export function themeById(id: string | null | undefined): MushafTheme {
  return MUSHAF_THEMES.find((t) => t.id === id) ?? MUSHAF_THEMES[0];
}

export function loadThemeId(): MushafThemeId {
  try { return themeById(localStorage.getItem(KEY)).id; } catch { return 'ivory'; }
}

export function saveThemeId(id: MushafThemeId): void {
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
}

/** Tajweed colours are tuned for light paper; on the dark theme mix them toward white so they stay readable. */
export function adaptRuleColor(hex: string, dark: boolean): string {
  if (!dark) return hex;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.5);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}
