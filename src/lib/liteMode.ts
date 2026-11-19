// «وضع التوفير» (2026-11-14): one switch that makes the app gentle on the
// battery. On: no vibration, no tap/opening sounds, no animations or blur/
// shadow effects, a soft dim over the screen (saves power on OLED; a web page
// cannot set the phone's own brightness). The keep-awake lock stays, because reading, listening and tasmee' must not be cut. Each effect can be switched off in
// Settings → وضع التوفير (see LITE_OPTIONS below). Switches on
// by itself once when the battery drops to 20% or less (not charging), unless
// the user switched it off by hand. Battery API: Android/Chrome only.
const KEY = 'quran-lite';
const EVT = 'quran-lite-change';
// W3-S2: the master switch (KEY, unchanged) turns the mode on; each effect
// below can be switched off on its own. All are ON by default, so someone who
// already had «وضع التوفير» on sees exactly what they had before. Only the ones
// the user switched off are stored (JSON {id:false}); new key, nothing old moves.
// The Screen Wake Lock is NOT touched by any option: the screen stays awake in
// the Mushaf / tasmee / Listen pages (useKeepAwake) whatever is chosen here.
const OPTS_KEY = 'quran-lite-opts';
export type LiteOptionId = 'motion' | 'blur' | 'shadows' | 'dim' | 'haptics' | 'sounds' | 'auto';
export const LITE_OPTIONS: { id: LiteOptionId; title: string; hint: string; impact: 'high' | 'med' | 'low' }[] = [
  { id: 'motion', title: 'إيقاف الحركة والأنيميشن', hint: 'الأيقونات المتحركة والانتقالات بتوقف: أقل شغل للمعالج.', impact: 'high' },
  { id: 'blur', title: 'إيقاف الزجاج والضبابية', hint: 'خلفيات الكروت الشفافة والـblur بتبقى عادية.', impact: 'high' },
  { id: 'shadows', title: 'إيقاف الظلال', hint: 'من غير ظلال حوالين الكروت والنصوص.', impact: 'med' },
  { id: 'dim', title: 'تعتيم خفيف للشاشة', hint: 'طبقة سودا شفافة: بتفيد في شاشات OLED بس، وماتفرقش في LCD. التطبيق مش بيقدر يغيّر سطوع الموبايل نفسه.', impact: 'low' },
  { id: 'haptics', title: 'إيقاف الاهتزاز', hint: 'ماتهتزش عند اللمس.', impact: 'low' },
  { id: 'sounds', title: 'إيقاف صوت اللمس', hint: 'من غير نقرات صوت عند الضغط على الأزرار.', impact: 'low' },
  { id: 'auto', title: 'تشغيله لوحده لما البطارية توصل ٢٠٪', hint: 'بيشتغل على أندرويد/كروم بس (آيفون مش بيدّي التطبيق نسبة البطارية).', impact: 'med' },
];
const OPT_IDS: string[] = LITE_OPTIONS.map((o) => o.id);

function readOffOptions(): Record<string, boolean> {
  try {
    const p = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}') as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const id of OPT_IDS) if (p[id] === false) out[id] = false;
    return out;
  } catch { return {}; }
}
const realVibrate: Navigator['vibrate'] | undefined = typeof navigator !== 'undefined' ? navigator.vibrate?.bind(navigator) : undefined;

export function isLite(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** The option itself is enabled (ignores the master switch). */
export function isLiteOption(id: LiteOptionId): boolean {
  return readOffOptions()[id] !== false;
}

/** Master switch on AND this effect on: what the app should actually do. */
export function liteActive(id: LiteOptionId): boolean {
  return isLite() && isLiteOption(id);
}

/** Cheap string that changes whenever the master or any option changes (for useSyncExternalStore). */
export function liteSnapshot(): string {
  return `${isLite() ? 1 : 0}|${LITE_OPTIONS.map((o) => (isLiteOption(o.id) ? 1 : 0)).join('')}`;
}

function apply(): void {
  const on = isLite();
  const root = document.documentElement;
  root.classList.toggle('lite', on);
  root.classList.toggle('lite-motion', liteActive('motion'));
  root.classList.toggle('lite-blur', liteActive('blur'));
  root.classList.toggle('lite-shadows', liteActive('shadows'));
  root.classList.toggle('lite-dim', liteActive('dim'));
  try {
    (navigator as unknown as { vibrate: unknown }).vibrate = liteActive('haptics') ? () => false : realVibrate;
  } catch { /* read-only */ }
  window.dispatchEvent(new CustomEvent(EVT, { detail: on }));
}

export function setLiteOption(id: LiteOptionId, on: boolean): void {
  const off = readOffOptions();
  if (on) delete off[id]; else off[id] = false;
  try { localStorage.setItem(OPTS_KEY, JSON.stringify(off)); } catch { /* ignore */ }
  apply();
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
      if (stored === null && isLiteOption('auto') && b.level <= 0.2 && !b.charging) setLite(true);
    };
    check();
    b.addEventListener('levelchange', check);
    b.addEventListener('chargingchange', check);
  }).catch(() => {});
}
