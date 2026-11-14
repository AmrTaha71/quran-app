// Shared back button (2026-11-06, back-button part 1).
//
// ONE back control per page, in the same place: App.tsx renders the
// shell <BackButton> in flow at the top of the route wrapper, and
// pages with an internal "back" destination (an open Settings door,
// a Listen detail view, a SelfTest sub-view) publish that destination
// through src/lib/backTarget.ts instead of rendering their own button.
// The Mushaf fullscreen uses this same component for its own return
// button (the shell button sits behind the fullscreen overlay).
//
// Styling: the emerald Home-door fill (grad-emerald-door) with the
// 3D press sink + water ripple from the alive stylesheets, gold is
// the accent, never a per-page meaning colour. A real <button> with
// min-height 56px, so the elderly-mode tap-target rule applies.

import { useEffect, useState } from 'react';
import { getBackTarget, subscribeBackTarget, type BackTarget } from '../lib/backTarget';
import { pressFeedback } from '../lib/pressFeedback';

export function BackButton({ label, onBack, compact }: { label: string; onBack: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onPointerDown={pressFeedback}
      onClick={onBack}
      aria-label={label}
      className={`grad-emerald-door polish-press inline-flex items-center gap-2 rounded-xl text-white font-bold shadow-sm ${compact ? 'min-h-[36px] px-3 py-1 text-sm' : 'min-h-[56px] px-4 py-3 text-base md:text-lg'}`}
    >
      <span aria-hidden="true">←</span>
      <span>{label}</span>
    </button>
  );
}

/** The currently registered internal back target, or null. Re-renders on change. */
export function useBackTarget(): BackTarget | null {
  const [target, setTarget] = useState<BackTarget | null>(() => getBackTarget());
  useEffect(() => {
    const sync = () => setTarget(getBackTarget());
    return subscribeBackTarget(sync);
  }, []);
  return target;
}
