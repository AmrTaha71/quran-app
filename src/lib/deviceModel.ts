// «جهازك» (2026-11-14): cascading drum choice — type → brand → model → size →
// how it is held. Each leaf carries the portrait CSS size, which sets the
// root font size and layout hints (data-device / data-dsize on <html>).
// Real rotation is still handled by CSS media queries; the held-orientation
// choice is the starting hint only.
export type Cat = 'phone' | 'tablet' | 'desktop' | 'tv';
export type Orient = 'portrait' | 'landscape';
type Size = [number, number];
type Variants = Record<string, Size>;
type Tree = Record<string, Record<string, Variants>>; // brand → model → variant → size

export const CAT_LABELS: Record<Cat, string> = { phone: 'تليفون', tablet: 'آيباد / تابلت', desktop: 'كمبيوتر', tv: 'شاشة تلفزيون' };
export const CATS: Cat[] = ['phone', 'tablet', 'desktop', 'tv'];

const gen = (from: number, to: number, f: (n: number) => [string, Variants]): Record<string, Variants> => {
  const o: Record<string, Variants> = {};
  for (let n = from; n <= to; n++) { const [k, v] = f(n); o[k] = v; }
  return o;
};
const S_ONE = (w: number, h: number): Variants => ({ 'عادي': [w, h] });

const IPHONE: Record<string, Variants> = {
  'آيفون (الأول)': S_ONE(320, 480), 'آيفون 3G': S_ONE(320, 480), 'آيفون 3GS': S_ONE(320, 480), 'آيفون 4': S_ONE(320, 480), 'آيفون 4s': S_ONE(320, 480),
  'آيفون 5': S_ONE(320, 568), 'آيفون 5c': S_ONE(320, 568), 'آيفون 5s': S_ONE(320, 568), 'آيفون SE (الأول)': S_ONE(320, 568),
  'آيفون 6 / 6s': { 'عادي': [375, 667], 'بلس': [414, 736] }, 'آيفون 7': { 'عادي': [375, 667], 'بلس': [414, 736] }, 'آيفون 8': { 'عادي': [375, 667], 'بلس': [414, 736] },
  'آيفون SE (2 / 3)': S_ONE(375, 667), 'آيفون X': S_ONE(375, 812), 'آيفون XS': { 'عادي': [375, 812], 'ماكس': [414, 896] }, 'آيفون XR': S_ONE(414, 896),
  'آيفون 11': { 'عادي': [414, 896], 'برو': [375, 812], 'برو ماكس': [414, 896] },
  'آيفون 12': { 'ميني': [360, 780], 'عادي': [390, 844], 'برو': [390, 844], 'برو ماكس': [428, 926] },
  'آيفون 13': { 'ميني': [375, 812], 'عادي': [390, 844], 'برو': [390, 844], 'برو ماكس': [428, 926] },
  'آيفون 14': { 'عادي': [390, 844], 'بلس': [428, 926], 'برو': [393, 852], 'برو ماكس': [430, 932] },
  'آيفون 15': { 'عادي': [393, 852], 'بلس': [430, 932], 'برو': [393, 852], 'برو ماكس': [430, 932] },
  'آيفون 16': { 'عادي': [393, 852], 'بلس': [430, 932], 'برو': [402, 874], 'برو ماكس': [440, 956] },
  'آيفون 16e': S_ONE(390, 844),
  'آيفون 17': { 'عادي': [402, 874], 'آير': [420, 912], 'برو': [402, 874], 'برو ماكس': [440, 956] },
  'آيفون 18': { 'عادي': [402, 874], 'برو': [402, 874], 'برو ماكس': [440, 956], 'فولد': [480, 800] },
};
const sSeries = (n: number): [string, Variants] => [`جالاكسي S${n}`, { 'عادي': [360, 780], 'بلس': [384, 832], 'ألترا': [412, 915] }];
const generic = (): Variants => ({ 'صغيرة': [360, 720], 'متوسطة': [390, 844], 'كبيرة': [412, 915], 'ضخمة': [448, 990] });
const proSet = (): Variants => ({ 'عادي': [393, 852], 'برو': [412, 915], 'ألترا / ماكس': [430, 932] });

const PHONE: Tree = {
  'آيفون': IPHONE,
  'سامسونج': {
    ...gen(8, 26, sSeries), 'جالاكسي S20 FE / S21 FE': { 'FE': [360, 800] },
    'جالاكسي A (الفئة المتوسطة)': { 'A0x – A1x': [360, 800], 'A2x – A3x': [384, 854], 'A5x – A7x': [412, 915] },
    'جالاكسي Z Flip': { 'مقفول': [412, 914], 'مفتوح': [412, 914] }, 'جالاكسي Z Fold': { 'مقفول': [360, 800], 'مفتوح': [673, 841] },
    'جالاكسي Note': { 'Note 8 – 9': [360, 740], 'Note 10 – 20': [412, 915] },
  },
  'أوبو': { 'Reno': proSet(), 'Find X': proSet(), 'A series': { 'صغيرة': [360, 800], 'كبيرة': [412, 915] }, 'F series': { 'عادي': [360, 800], 'برو': [412, 915] } },
  'شاومي': { 'Xiaomi (13 / 14 / 15)': proSet(), 'Redmi Note': { 'عادي': [393, 873], 'برو': [412, 915], 'برو بلس': [412, 915] }, 'Redmi': { 'صغيرة': [360, 800], 'كبيرة': [393, 873] }, 'Poco': { 'عادي': [393, 873], 'برو': [412, 915] } },
  'هواوي': { 'P series': { 'عادي': [360, 780], 'برو': [412, 892] }, 'Mate': { 'عادي': [360, 780], 'برو': [412, 892] }, 'Nova': S_ONE(360, 780), 'Y series': S_ONE(360, 800) },
  'هونر': { 'Magic': proSet(), 'X series': S_ONE(393, 873), 'عدد من الموديلات': generic() },
  'ريلمي': { 'GT': proSet(), 'Number series': proSet(), 'C series': { 'صغيرة': [360, 800], 'كبيرة': [412, 915] } },
  'فيفو': { 'X series': proSet(), 'V series': proSet(), 'Y series': { 'صغيرة': [360, 800], 'كبيرة': [412, 915] } },
  'جوجل بيكسل': { 'بيكسل 6 – 7': { 'عادي': [412, 915], 'برو': [412, 892] }, 'بيكسل 8 – 9': { 'عادي': [412, 915], 'برو': [412, 892], 'برو XL': [448, 998] }, 'بيكسل 10': { 'عادي': [412, 915], 'برو': [412, 892], 'برو XL': [448, 998] } },
  'وان بلس': { 'الرقمي (11 / 12 / 13)': proSet(), 'Nord': { 'عادي': [412, 915] } },
  'إنفينكس / تكنو': { 'Hot / Spark / Camon': { 'صغيرة': [360, 800], 'كبيرة': [412, 915] } },
  'ماركة تانية': { 'مش لاقيه': generic() },
};

const IPAD: Record<string, Variants> = {
  'آيباد (العادي)': { '9.7 بوصة': [768, 1024], '10.2 بوصة': [810, 1080], '10.9 بوصة': [820, 1180] },
  'آيباد ميني': { '7.9 بوصة': [768, 1024], '8.3 بوصة': [744, 1133] },
  'آيباد إير': { '9.7 بوصة': [768, 1024], '10.5 بوصة': [834, 1112], '10.9 بوصة': [820, 1180], '11 بوصة': [820, 1180], '13 بوصة': [1024, 1366] },
  'آيباد برو': { '9.7 بوصة': [768, 1024], '10.5 بوصة': [834, 1112], '11 بوصة': [834, 1194], '12.9 بوصة': [1024, 1366], '13 بوصة': [1032, 1376] },
};
const TAB_SIZES = (): Variants => ({ '8 بوصة': [600, 960], '10 – 11 بوصة': [800, 1280], '12 – 13 بوصة': [900, 1440] });
const TABLET: Tree = {
  'آيباد': IPAD,
  'سامسونج تاب': { 'Tab A': TAB_SIZES(), 'Tab S': { '11 بوصة': [800, 1280], '12.4 بوصة': [900, 1440], 'ألترا 14.6 بوصة': [1000, 1600] } },
  'هواوي ميت باد': { 'MatePad': TAB_SIZES() },
  'لينوفو': { 'Tab': TAB_SIZES() },
  'شاومي باد': { 'Pad': TAB_SIZES() },
  'تابلت تاني': { 'مش لاقيه': TAB_SIZES() },
};
const SCREENS = (): Variants => ({ 'شاشة 13 بوصة': [1280, 720], 'شاشة 14 – 15 بوصة': [1440, 800], 'شاشة 16 – 17 بوصة': [1536, 864], 'شاشة خارجية 24 بوصة': [1920, 1080], 'شاشة خارجية 27 بوصة+': [2560, 1440] });
const DESKTOP: Tree = {
  'ويندوز': { 'لابتوب': SCREENS(), 'كمبيوتر مكتبي': SCREENS() },
  'ماك': { 'ماك بوك إير': { '13 بوصة': [1470, 956], '15 بوصة': [1710, 1107] }, 'ماك بوك برو': { '13 بوصة': [1440, 900], '14 بوصة': [1512, 982], '16 بوصة': [1728, 1117] }, 'آي ماك / ستوديو': { '24 بوصة': [2240, 1260], 'شاشة خارجية 27 بوصة+': [2560, 1440] } },
  'كروم بوك': { 'لابتوب': SCREENS() },
  'لينكس': { 'لابتوب أو مكتبي': SCREENS() },
};
const TV_RES = (): Variants => ({ 'Full HD': [960, 540], '4K': [960, 540], 'HD (قديم)': [640, 360] });
const TV_SIZES = (): Record<string, Variants> => ({ '32 بوصة أو أقل': TV_RES(), '40 – 43 بوصة': TV_RES(), '50 – 55 بوصة': TV_RES(), '65 بوصة': TV_RES(), '75 بوصة+': TV_RES() });
const TV: Tree = { 'سامسونج': TV_SIZES(), 'إل جي': TV_SIZES(), 'سوني': TV_SIZES(), 'أندرويد تي في': TV_SIZES(), 'آبل تي في / أيربلاي': TV_SIZES(), 'فاير تي في': TV_SIZES(), 'شاشة تانية': TV_SIZES() };

export const TREES: Record<Cat, Tree> = { phone: PHONE, tablet: TABLET, desktop: DESKTOP, tv: TV };
export const LEVEL_TITLES: Record<Cat, [string, string, string]> = {
  phone: ['الماركة', 'الموديل', 'الحجم / الطراز'], tablet: ['الماركة', 'النوع', 'حجم الشاشة'],
  desktop: ['النظام', 'النوع', 'الشاشة'], tv: ['الماركة', 'مقاس الشاشة', 'الدقة'],
};

export interface DeviceChoice { cat: Cat; brand: string; model: string; variant: string; orient: Orient }
const KEY = 'quran-device-model-v1';

export function loadDeviceChoice(): DeviceChoice | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as DeviceChoice | null;
    return v && CATS.includes(v.cat) ? v : null;
  } catch { return null; }
}
export function saveDeviceChoice(c: DeviceChoice): void { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ } }

export function sizeOf(c: DeviceChoice | null): Size | null {
  if (!c) return null;
  return TREES[c.cat]?.[c.brand]?.[c.model]?.[c.variant] ?? null;
}

/** Guess the type from the live viewport so the first drum starts near right. */
export function guessCat(): Cat {
  const w = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
  const ua = navigator.userAgent;
  if (/TV|SmartTV|AFT|Tizen|WebOS/i.test(ua)) return 'tv';
  if (/iPad|Tablet/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))) return 'tablet';
  if (/Android|iPhone|Mobile/i.test(ua)) return w >= 600 ? 'tablet' : 'phone';
  return 'desktop';
}

/** Root font size + data-* hooks for CSS. Safe to call any time. */
export function applyDeviceLayout(): void {
  const el = document.documentElement;
  const c = loadDeviceChoice();
  const cat: Cat = c?.cat ?? guessCat();
  const sz = sizeOf(c);
  const short = sz ? Math.min(sz[0], sz[1]) : Math.min(window.innerWidth, window.innerHeight);
  let fs = 16; let bucket = 'm';
  if (cat === 'phone') {
    bucket = short < 350 ? 'xs' : short < 385 ? 's' : short < 420 ? 'm' : short < 450 ? 'l' : 'xl';
    fs = { xs: 14.5, s: 15.5, m: 16, l: 16.5, xl: 17 }[bucket] as number;
  } else if (cat === 'tablet') { bucket = short < 700 ? 's' : short < 900 ? 'm' : 'l'; fs = short < 700 ? 16.5 : short < 900 ? 17 : 18; }
  else if (cat === 'tv') { bucket = 'xl'; fs = 24; }
  else { bucket = 'm'; fs = short >= 2000 ? 18 : 16; }
  el.dataset.device = cat; el.dataset.dsize = bucket;
  if (c) el.dataset.heldOrient = c.orient;
  el.style.setProperty('--dev-fs', `${fs}px`);
}
