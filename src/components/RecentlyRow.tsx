// سمعت / سمّعت مؤخرًا — recently listened / tested row (Home feature #9).
// READ side only: renders localStorage 'quran-recent-activity-v1'
// (written by the Listen / SelfTest / Adhkar pages — this file never
// writes it). Up to 6 items, most recent first. Empty / missing /
// corrupt → the whole row hides (returns null), never an error or an
// empty box. Tap: listen/test → Mushaf at that ayah (existing
// 'quran-mushaf-target' jump); adhkar → the Adhkar page.
import { useEffect, useState } from 'react';
import { Headphones, History, Mic, SunMoon } from 'lucide-react';
import { pressFeedback } from '../lib/pressFeedback';
import {
  readRecentActivity,
  RECENT_TYPE_LABEL,
  type RecentActivityEntry,
  type RecentActivityType,
} from '../lib/homeFeatures';

const TYPE_ICON: Record<RecentActivityType, React.ReactNode> = {
  listen: <Headphones className="w-5 h-5 text-emerald-700 shrink-0" />,
  test: <Mic className="w-5 h-5 text-amber-700 shrink-0" />,
  adhkar: <SunMoon className="w-5 h-5 text-emerald-700 shrink-0" />,
};

function jumpFor(
  entry: RecentActivityEntry,
  onNavigate: (r: 'mushaf' | 'adhkar') => void,
  onJumpToAyah: (surah: number, ayah: number) => void,
): void {
  if (entry.type === 'adhkar') {
    onNavigate('adhkar');
    return;
  }
  onJumpToAyah(entry.surah, entry.ayah ?? 1);
}

export default function RecentlyRow({
  onNavigate,
  onJumpToAyah,
}: {
  onNavigate: (r: 'mushaf' | 'adhkar') => void;
  onJumpToAyah: (surah: number, ayah: number) => void;
}) {
  const [items, setItems] = useState(readRecentActivity);
  // Home can stay mounted while the user listens/tests elsewhere, so
  // re-read when the tab comes back into focus — same data, no writes.
  useEffect(() => {
    const refresh = () => setItems(readRecentActivity());
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="mb-4">
      <p className="font-bold text-ink text-base flex items-center gap-2 mb-2">
        <History className="w-5 h-5 text-emerald-700" />
        سمعت / سمّعت مؤخرًا
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {items.map((entry, i) => (
          <button
            key={`${entry.type}-${entry.surah}-${entry.ayah ?? ''}-${entry.ts}-${i}`}
            type="button"
            onPointerDown={pressFeedback}
            onClick={() => jumpFor(entry, onNavigate, onJumpToAyah)}
            className="shrink-0 max-w-[220px] rounded-xl glass-card polish-card px-3 py-2.5 flex items-center gap-2 text-right polish-press polish-focus"
          >
            {TYPE_ICON[entry.type]}
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink truncate">
                {entry.label}
              </span>
              <span className="block text-[11px] text-ink-2">
                {RECENT_TYPE_LABEL[entry.type]}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
