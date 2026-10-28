import { useEffect } from 'react';

// Shared Escape-to-close for modals/overlays (S6 platform/UX batch).
// Each modal calls this with its own open flag + close handler; the
// listener is only attached while the modal is open, so stacked overlays
// never double-close. Callers that stack modals (Mushaf page) order their
// own checks topmost-first instead of using this hook twice.
export function useEscapeClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onClose]);
}
