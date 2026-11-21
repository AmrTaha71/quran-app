import { useEffect, useRef, useState } from 'react';
import { closeBlackScreen, useBlackScreenOpen } from '../lib/blackScreenStore';

/**
 * Fullscreen black overlay (moved out of ListenPage unchanged in behaviour):
 * hides the UI while audio keeps playing untouched. Exit is a long-press
 * (>=1000ms) or a swipe (>60px) only, never a single tap, so pocket touches
 * cannot dismiss it; the bottom button needs a long press too (800ms).
 * Mounted once in App, so it covers any route (Listen page or the Mushaf)
 * and closing it just reveals the page that was underneath.
 */
export default function BlackScreenOverlay() {
  const open = useBlackScreenOpen();
  const [showHint, setShowHint] = useState(false);
  const pressRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const backHoldRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Faint exit hint: shows when the overlay opens, hides itself.
  useEffect(() => {
    if (!open) return;
    setShowHint(true);
    const timer = setTimeout(() => setShowHint(false), 4000);
    return () => clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  // iOS can cancel a long touch (system gesture) or the page can be busy, so release is not required: the
  // hold itself closes the overlay after 900 ms (a short pocket touch never reaches it).
  const holdRef = backHoldRef;
  const pressStart = (x: number, y: number) => {
    pressRef.current = { t: Date.now(), x, y };
    if (holdRef.current) clearTimeout(holdRef.current);
    holdRef.current = setTimeout(() => { holdRef.current = null; if (pressRef.current) { pressRef.current = null; closeBlackScreen(); } }, 900);
  };
  const pressMove = (x: number, y: number) => {
    const p = pressRef.current;
    if (!p) return;
    if (Math.hypot(x - p.x, y - p.y) > 60) {
      pressRef.current = null;
      closeBlackScreen();
    }
  };
  const pressEnd = () => {
    const p = pressRef.current;
    pressRef.current = null;
    if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; }
    if (p && Date.now() - p.t >= 900) closeBlackScreen();
  };
  const clearBackHold = () => {
    if (backHoldRef.current) { clearTimeout(backHoldRef.current); backHoldRef.current = null; }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black flex items-center justify-center select-none touch-none"
      style={{ WebkitTouchCallout: 'none' }}
      onContextMenu={(e) => e.preventDefault()}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t) pressStart(t.clientX, t.clientY);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (t) pressMove(t.clientX, t.clientY);
      }}
      onTouchEnd={pressEnd}
      onTouchCancel={pressEnd}
      onMouseDown={(e) => pressStart(e.clientX, e.clientY)}
      onMouseMove={(e) => { if (pressRef.current) pressMove(e.clientX, e.clientY); }}
      onMouseUp={pressEnd}
    >
      {showHint && (
        <p className="text-white/20 text-sm font-medium">اضغط مطوّلًا للعودة</p>
      )}
      <button
        onPointerDown={(e) => {
          e.stopPropagation();
          clearBackHold();
          backHoldRef.current = setTimeout(() => { backHoldRef.current = null; closeBlackScreen(); }, 800);
        }}
        onPointerUp={clearBackHold}
        onPointerLeave={clearBackHold}
        onPointerCancel={clearBackHold}
        onTouchStart={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ touchAction: 'none' }}
        className="absolute bottom-[calc(1.25rem_+_env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 px-8 py-3 rounded-full bg-white/10 text-white/50 text-base font-semibold"
        aria-label="رجوع"
      >
        اضغط مطوّلًا للرجوع
      </button>
    </div>
  );
}
