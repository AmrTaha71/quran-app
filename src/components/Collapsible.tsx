// Collapsible section (wave 2, W2-2): a title row with a chevron that
// opens and closes its content. The content stays MOUNTED while closed
// (`hidden`), never unmounted, so state inside it (GPS fix, a recording
// in progress, form fields) survives a close. One level only: do not
// nest a Collapsible inside another.
//
// `storageKey` (optional) remembers open/closed in sessionStorage under
// `quran-collapsible:<key>`; a new key, so no existing storage is touched.
import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { pressFeedback } from '../lib/pressFeedback';

const PREFIX = 'quran-collapsible:';

function readOpen(key: string | undefined, fallback: boolean): boolean {
  if (!key) return fallback;
  try {
    const v = sessionStorage.getItem(PREFIX + key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

export default function Collapsible({
  title,
  summary,
  defaultOpen = false,
  storageKey,
  children,
}: {
  title: ReactNode;
  /** Short text shown beside the title while closed (e.g. the city name). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));
  const panelId = useId();
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey) {
      try { sessionStorage.setItem(PREFIX + storageKey, next ? '1' : '0'); } catch { /* storage off */ }
    }
  };
  return (
    <section className="glass-card rounded-2xl overflow-hidden">
      <button
        type="button"
        onPointerDown={pressFeedback}
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full min-h-[48px] px-4 py-3 flex items-center gap-3 text-start polish-press"
      >
        <span className="flex-1 min-w-0 text-base md:text-lg font-semibold text-ink">{title}</span>
        {!open && summary && <span className="text-sm text-ink-2 truncate max-w-[45%]">{summary}</span>}
        <ChevronDown className={`w-5 h-5 shrink-0 text-emerald-700 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      <div id={panelId} hidden={!open} className="px-4 pb-4">
        {children}
      </div>
    </section>
  );
}
