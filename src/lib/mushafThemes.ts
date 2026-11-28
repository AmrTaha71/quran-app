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
  { id: 'ivory', name: 'عاجي', bg: '#f6f0e0', ink: '#0a0907', frame: '#c9b27a', accent: '#8a6d1f', hl: '176, 200, 168', dark: false },
  { id: 'white', name: 'أبيض', bg: '#ffffff', ink: '#000000', frame: '#C2B9C9', accent: '#542F6F', hl: '190, 214, 238', dark: false },
  { id: 'sepia', name: 'بني هادئ', bg: '#eadcc0', ink: '#140e07', frame: '#a8895a', accent: '#6b4a1c', hl: '214, 178, 124', dark: false },
  { id: 'mint', name: 'أخضر هادئ', bg: '#EBE4F0', ink: '#100717', frame: '#A48FB3', accent: '#542F6F', hl: '244, 226, 150', dark: false },
  { id: 'night', name: 'ليلي', bg: '#000000', ink: '#ffffff', frame: '#D7AC2A', accent: '#D7AC2A', hl: '92, 128, 104', dark: true },
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

// Matching highlight colours per page colour (2026-11-21, Dr. Amr): the usual reading-app pairings —
// the first one of each list is the theme's default. "r, g, b" strings for --mushaf-hl-rgb.
export type HlOption = { id: string; name: string; rgb: string };
export const THEME_HIGHLIGHTS: Record<MushafThemeId, HlOption[]> = {
  ivory: [
    { id: 'green', name: 'أخضر فاتح', rgb: '176, 200, 168' },
    { id: 'gray', name: 'رمادي هادئ', rgb: '205, 205, 205' },
    { id: 'sky', name: 'أزرق سماوي', rgb: '176, 208, 232' },
    { id: 'rose', name: 'وردي هادئ', rgb: '240, 198, 200' },
    { id: 'gold', name: 'ذهبي فاتح', rgb: '234, 214, 150' },
  ],
  white: [
    { id: 'babyblue', name: 'بيبي بلو', rgb: '190, 214, 238' },
    { id: 'yellow', name: 'أصفر هادئ', rgb: '255, 236, 150' },
    { id: 'mint', name: 'نعناعي', rgb: '190, 232, 205' },
    { id: 'pink', name: 'وردي فاتح', rgb: '248, 200, 214' },
    { id: 'gray', name: 'رمادي', rgb: '210, 210, 210' },
  ],
  sepia: [
    { id: 'amber', name: 'عنبري', rgb: '214, 178, 124' },
    { id: 'olive', name: 'زيتوني فاتح', rgb: '188, 196, 140' },
    { id: 'slate', name: 'أزرق رمادي', rgb: '170, 190, 205' },
    { id: 'clay', name: 'وردي ترابي', rgb: '226, 176, 164' },
    { id: 'gold', name: 'ذهبي', rgb: '232, 200, 110' },
  ],
  mint: [
    { id: 'lemon', name: 'أصفر ليموني', rgb: '244, 226, 150' },
    { id: 'green', name: 'أخضر أغمق', rgb: '150, 200, 160' },
    { id: 'sky', name: 'أزرق فاتح', rgb: '176, 210, 232' },
    { id: 'peach', name: 'خوخي', rgb: '244, 200, 170' },
    { id: 'lilac', name: 'بنفسجي هادئ', rgb: '208, 196, 230' },
  ],
  night: [
    { id: 'green', name: 'أخضر خافت', rgb: '92, 128, 104' },
    { id: 'gold', name: 'ذهبي خافت', rgb: '150, 130, 70' },
    { id: 'blue', name: 'أزرق ليلي', rgb: '80, 110, 150' },
    { id: 'violet', name: 'بنفسجي', rgb: '120, 100, 150' },
    { id: 'gray', name: 'رمادي', rgb: '100, 110, 110' },
  ],
};

const HL_KEY = 'quran-mushaf-hl:';

/** The highlight the reader picked for this page colour (falls back to the theme's own default). */
export function loadHl(themeId: MushafThemeId): string {
  const list = THEME_HIGHLIGHTS[themeId];
  try {
    const id = localStorage.getItem(HL_KEY + themeId);
    return (list.find((h) => h.id === id) ?? list[0]).rgb;
  } catch { return list[0].rgb; }
}

export function saveHl(themeId: MushafThemeId, rgb: string): void {
  const h = THEME_HIGHLIGHTS[themeId].find((x) => x.rgb === rgb);
  try { if (h) localStorage.setItem(HL_KEY + themeId, h.id); } catch { /* ignore */ }
}
