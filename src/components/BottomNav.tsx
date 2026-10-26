import { Bookmark, BookOpen, Home, Mic } from 'lucide-react';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf';

/**
 * Bottom navigation, in logical RTL order.
 * In an RTL flex row the first DOM item is the rightmost one, so
 * لوحتي comes first (rightmost), then المصحف, then الرئيسية.
 */
export default function BottomNav({
  current,
  onNavigate,
}: {
  current: 'app' | 'mushaf';
  onNavigate: (r: Route) => void;
}) {
  const items = [
    { id: 'app' as const, label: 'لوحتي', icon: <Bookmark className="w-7 h-7" /> },
    { id: 'mushaf' as const, label: 'المصحف', icon: <BookOpen className="w-7 h-7" /> },
    { id: 'imam' as const, label: 'الحق الإمام', icon: <Mic className="w-7 h-7" /> },
    { id: 'home' as const, label: 'الرئيسية', icon: <Home className="w-7 h-7" /> },
  ];
  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="fixed bottom-0 right-0 left-0 z-40 bg-white/95 backdrop-blur-md border-t border-emerald-100 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] pb-[calc(0.5rem_+_env(safe-area-inset-bottom))]"
    >
      <div className="max-w-5xl mx-auto flex">
        {items.map((item) => {
          const active = item.id === current;
          return (
            <button
              key={item.id}
              onClick={() => {
                if (item.id === 'imam') {
                  // Follow-the-imam is a mode of the Mushaf page, not a
                  // route: flag it (session-scoped, so closing the tab
                  // never leaves a stale panel behind), wake the page
                  // (whether it mounts now or is already mounted), and
                  // go there.
                  try { sessionStorage.setItem('quran-follow-mode', '1'); } catch {}
                  window.dispatchEvent(new Event('quran:follow-imam'));
                  onNavigate('mushaf');
                  return;
                }
                onNavigate(item.id);
              }}
              className={`icon-action flex-1 flex-col py-2 text-sm font-bold transition-smooth ${
                active ? 'text-emerald-700 bg-emerald-50' : 'text-accent-500 hover:bg-gray-50'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
