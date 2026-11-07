// بكرة المؤقت (2026-11-07): a large, always-visible scroll wheel for the
// sleep timer. The user scrolls it by hand and the centred value is the
// selected duration. Snap-scrolling keeps exactly one value in the centre.
import { useEffect, useRef, useState } from 'react';

const ITEM_H = 56;
const VIEW_H = 224;

export default function TimerWheel({
  items,
  initialIndex = 1,
  onChange,
}: {
  items: [number, string][];
  initialIndex?: number;
  onChange: (value: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(initialIndex);
  const pad = (VIEW_H - ITEM_H) / 2;

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = initialIndex * ITEM_H;
    onChange(items[initialIndex][0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM_H)));
    if (i !== index) {
      setIndex(i);
      onChange(items[i][0]);
    }
  }

  return (
    <div className="relative" style={{ height: VIEW_H }}>
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-xl bg-emerald-50 border border-emerald-200 pointer-events-none" style={{ height: ITEM_H }} />
      <div
        ref={ref}
        onScroll={onScroll}
        className="h-full overflow-y-auto snap-y snap-mandatory overscroll-contain"
        style={{ scrollbarWidth: 'thin' }}
        role="listbox"
        aria-label="مدة المؤقت"
      >
        <div style={{ height: pad }} />
        {items.map(([m, label], i) => (
          <div
            key={m}
            role="option"
            aria-selected={i === index}
            onClick={() => { if (ref.current) ref.current.scrollTop = i * ITEM_H; }}
            className={`snap-center flex items-center justify-center text-xl font-bold ${i === index ? 'text-emerald-800' : 'text-accent-500'}`}
            style={{ height: ITEM_H }}
          >
            {label}
          </div>
        ))}
        <div style={{ height: pad }} />
      </div>
    </div>
  );
}
