// Fixed bottom chrome registry (wave 2, W2-3). Anything pinned to the
// bottom of the screen (BottomNav, the Listen control bar) reports its
// height here; the tallest one is published as the CSS variable
// --bottom-chrome-h on <html>, and the floating BottomBackBar sits just
// above it. With nothing registered the variable is unset and the bar
// falls back to env(safe-area-inset-bottom). A hidden element reports 0,
// so a page kept mounted under display:none never pushes the bar up.
import { useCallback, useEffect, useRef } from 'react';

const heights = new Map<object, number>();

function publish(): void {
  try {
    let max = 0;
    for (const h of heights.values()) if (h > max) max = h;
    const root = document.documentElement;
    if (max > 0) root.style.setProperty('--bottom-chrome-h', `${max}px`);
    else root.style.removeProperty('--bottom-chrome-h');
  } catch {
    // decorative: never break the page
  }
}

/** Callback ref: attach to a fixed-bottom element to report its height. */
export function useBottomChromeRef(): (el: HTMLElement | null) => void {
  const id = useRef({}).current;
  const ro = useRef<ResizeObserver | null>(null);
  useEffect(
    () => () => {
      ro.current?.disconnect();
      ro.current = null;
      heights.delete(id);
      publish();
    },
    [id],
  );
  return useCallback(
    (el: HTMLElement | null) => {
      ro.current?.disconnect();
      ro.current = null;
      if (!el) {
        heights.delete(id);
        publish();
        return;
      }
      const update = () => {
        heights.set(id, el.offsetHeight);
        publish();
      };
      update();
      if (typeof ResizeObserver !== 'undefined') {
        ro.current = new ResizeObserver(update);
        ro.current.observe(el);
      }
    },
    [id],
  );
}
