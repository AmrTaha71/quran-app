import { useState, useEffect, cloneElement } from 'react';
import { LayoutDashboard, BookOpen, Home, AudioLines, Settings } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { pressFeedback } from '../lib/pressFeedback';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test';

// Remember the kunya label per user so each page's nav starts with the
// right label instead of flashing 'لوحتي'. 'quran-uid' is mirrored by App.
let navLabelCache: { uid: string; label: string } | null = null;
function cachedNavLabel(): string {
  try {
    const uid = localStorage.getItem('quran-uid');
    if (uid && navLabelCache && navLabelCache.uid === uid) return navLabelCache.label;
  } catch {
    // storage unavailable: default label
  }
  return 'لوحتي';
}

/**
 * Bottom navigation, in logical RTL order.
 * In an RTL flex row the first DOM item is the rightmost one, so
 * الرئيسية comes first (rightmost), then لوحتي right after it, then
 * المصحف, then الحق الإمام, then الإعدادات (leftmost).
 *
 * Visual batch (2026-11-04): water-glass bar (translucent gradient +
 * blur, so page content shows through beneath it), one sliding gold
 * pill at the top (the thick top line + animated indicator in one
 * element), and an active tab that is unmistakable without color
 * alone: filled icon + background pill + heavier label + a deeper
 * emerald. Every tab press also fires pressFeedback (ripple + tap
 * sound + vibration where supported); the sound is suppressed on
 * test/listen/adhkar/follow routes and while any audio plays.
 * BOLD pass (2026-11-04): the nav itself slides up + fades on every
 * page mount (.nav-enter — each page mounts its own nav, so this
 * plays on every route change including to/from Mushaf/Follow;
 * mushaf<->follow share one page instance, so there the gold pill
 * slides instead of a nav re-entrance). Inactive labels use ink-2
 * (5.99 on the tinted glass) instead of accent-500 (3.82, below AA).
 */
export default function BottomNav({
  current,
  onNavigate,
}: {
  current: 'home' | 'app' | 'mushaf' | 'settings' | 'follow' | 'test';
  onNavigate: (r: Route) => void;
}) {
  // The board's name is the user's kunya when they set one
  // ("لوحة أبو …"), otherwise the plain "لوحتي". Loaded here so the
  // label matches on every page that shows this bar.
  const [appLabel, setAppLabel] = useState(cachedNavLabel);
  useEffect(() => {
    const loadLabel = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) return;
        const { data } = await supabase.from('user_profiles').select('preferred_name').eq('user_id', userId).single();
        const label = data?.preferred_name ? `لوحة ${data.preferred_name}` : 'لوحتي';
        navLabelCache = { uid: userId, label };
        setAppLabel(label);
      } catch {}
    };
    loadLabel();
  }, []);
  const items = [
    { id: 'home' as const, label: 'الرئيسية', icon: <Home className="w-7 h-7" /> },
    // لوحتي is a board (wird, self-test, lists, greeting), not just
    // saved items — a dashboard grid reads instantly, a bookmark does not.
    { id: 'app' as const, label: appLabel, icon: <LayoutDashboard className="w-7 h-7" /> },
    { id: 'mushaf' as const, label: 'المصحف', icon: <BookOpen className="w-7 h-7" /> },
    { id: 'follow' as const, label: 'الحق الإمام', icon: <AudioLines className="w-7 h-7" /> },
    { id: 'settings' as const, label: 'الإعدادات', icon: <Settings className="w-7 h-7" /> },
  ];
  // Sliding pill: one tab wide (5 equal tabs). In RTL the first tab
  // is rightmost, so the pill starts at `right: 0` and slides LEFT
  // with a negative translate; in LTR it mirrors. No tab matches
  // (e.g. SelfTest) → no pill, no active tab.
  const activeIndex = items.findIndex((item) => item.id === current);
  const isRtl = typeof document !== 'undefined' && document.documentElement.dir !== 'ltr';
  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="fixed bottom-0 right-0 left-0 z-40 glass-nav nav-enter pb-[calc(0.5rem_+_env(safe-area-inset-bottom))]"
    >
      <div className="max-w-5xl mx-auto flex relative">
        {activeIndex >= 0 && (
          <span
            className="nav-tab-pill"
            style={{
              ...(isRtl ? { right: 0 } : { left: 0 }),
              transform: `translateX(${(isRtl ? -1 : 1) * activeIndex * 100}%)`,
            }}
            aria-hidden="true"
          />
        )}
        {items.map((item) => {
          const active = item.id === current;
          // Icons: one size (w-7) everywhere; inactive icons get a
          // bolder stroke (2.5) so they read solid, not faint outlines
          // next to the filled active icon.
          const iconEl = active
            ? cloneElement(item.icon, { fill: 'currentColor' })
            : cloneElement(item.icon, { strokeWidth: 2.5 });
          return (
            <button
              key={item.id}
              onPointerDown={pressFeedback}
              onClick={() => {
                onNavigate(item.id);
              }}
              className={`icon-action relative polish-press flex-1 flex-col py-2 text-sm ${
                active ? 'font-extrabold text-emerald-deep' : 'font-semibold text-ink-2 hover:bg-emerald-50/60'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <span className={active ? 'nav-pill-active' : 'flex flex-col items-center'}>
                <span className={`nav-icon ${active ? 'nav-icon-on' : ''}`}>
                  {iconEl}
                </span>
                <span>{item.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
