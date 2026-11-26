import { useEffect, useRef } from 'react';

// Shared Escape-to-close for modals/overlays (S6 platform/UX batch).
// Each modal calls this with its own open flag + close handler; the
// listener is only attached while the modal is open, so stacked overlays
// never double-close. Callers that stack modals (Mushaf page) order their
// own checks topmost-first instead of using this hook twice.
//
// Item 8.7: while open, Tab / Shift+Tab stay inside the topmost
// [aria-modal="true"] element (focus trap), focus moves into it when it
// opens, and when it closes focus returns to whatever opened it. No
// caller changes: the dialog is found by its aria-modal attribute.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

function topModal(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
  return all.length ? all[all.length - 1] : null;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function useEscapeClose(active: boolean, onClose: () => void) {
  const openerRef = useRef<HTMLElement | null>(null);
  // The close handler is read through a ref so an inline callback does
  // not re-run the effect on every render (that would bounce focus).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const raf = requestAnimationFrame(() => {
      const m = topModal();
      if (m && !m.contains(document.activeElement)) {
        const first = focusables(m)[0];
        if (first) first.focus({ preventScroll: true });
        else { if (!m.hasAttribute('tabindex')) m.setAttribute('tabindex', '-1'); m.focus({ preventScroll: true }); }
      }
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const m = topModal();
      if (!m) return;
      const list = focusables(m);
      if (list.length === 0) { e.preventDefault(); return; }
      const first = list[0], last = list[list.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey && (cur === first || !m.contains(cur))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (cur === last || !m.contains(cur))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      const opener = openerRef.current;
      if (opener && document.contains(opener)) { try { opener.focus({ preventScroll: true }); } catch { /* ignore */ } }
    };
  }, [active]);
}
