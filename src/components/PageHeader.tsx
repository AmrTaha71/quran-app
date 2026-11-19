// Shared thin page header (wave 2, W2-2). A single ~44px row: small icon,
// title, optional one-line subtitle and optional trailing actions. It has
// NO back buttons — going back lives in the bottom-left BottomBackBar,
// because on iPhone the top edge is the Dynamic Island.
//
// The iOS safe-area inset is applied here once (inline), so a page using
// this header never needs its own `padding-top: env(safe-area-inset-top)`.
// Pass `sticky` only for long pages; short control pages should scroll
// the header away.
import type { ComponentType, ReactNode } from 'react';
import Hint from './Hint';

export default function PageHeader({
  title,
  icon: Icon,
  subtitle,
  hintId,
  actions,
  sticky = false,
}: {
  title: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  /** One short line under the title. Keep it to a single line. */
  subtitle?: ReactNode;
  /** When set, the subtitle retires itself after a few views (lib/hints). */
  hintId?: string;
  /** Trailing controls (language, sign-out...). Never back/home buttons. */
  actions?: ReactNode;
  sticky?: boolean;
}) {
  const sub = subtitle ? <p className="text-xs md:text-sm text-ink-2 leading-snug truncate">{subtitle}</p> : null;
  return (
    <header
      className={`${sticky ? 'sticky top-0 z-40 ' : ''}app-header`}
      style={sticky ? undefined : { paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="max-w-5xl mx-auto px-4 min-h-[44px] py-1.5 flex items-center gap-2.5">
        {Icon && <Icon className="w-7 h-7 text-emerald-700 shrink-0" />}
        <div className="min-w-0 flex-1">
          <h1 className="text-lg md:text-xl font-bold font-display-ar text-accent-800 leading-tight truncate">{title}</h1>
          {sub && (hintId ? <Hint id={hintId}>{sub}</Hint> : sub)}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
