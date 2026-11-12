// عجلة الاختيار (2026-11-12, agreed UI rule): every choice is a spinning
// wheel, not a long dropdown list. The centred row is the selected value.
// Each step past a row plays a short soft tick (a Web Audio click, no
// file), like a real reel. The tick only plays after the user has touched
// the page, so browsers allow it.
import { useEffect, useRef, useState } from 'react';

const ITEM_H = 52;
const VIEW_H = 208;

let sharedCtx: AudioContext | null = null;
function tick() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    sharedCtx ??= new Ctx();
    if (sharedCtx.state === 'suspended') void sharedCtx.resume();
    const t = sharedCtx.currentTime;
    const osc = sharedCtx.createOscillator();
    const gain = sharedCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1400;
    gain.gain.setValueAtTime(0.03, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    osc.connect(gain).connect(sharedCtx.destination);
    osc.start(t);
    osc.stop(t + 0.025);
  } catch {
    // Sound is best-effort.
  }
}

export type WheelOption<T extends string | number> = { value: T; label: string };

export default function WheelPicker<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: WheelOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const start = Math.max(0, options.findIndex((o) => o.value === value));
  const [index, setIndex] = useState(start);
  const pad = (VIEW_H - ITEM_H) / 2;

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = start * ITEM_H;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const i = Math.max(0, Math.min(options.length - 1, Math.round(el.scrollTop / ITEM_H)));
    if (i !== index) {
      tick();
      setIndex(i);
      onChange(options[i].value);
    }
  }

  return (
    <div className="relative select-none" style={{ height: VIEW_H }}>
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-xl bg-emerald-50 border border-emerald-300 pointer-events-none" style={{ height: ITEM_H }} />
      <div
        ref={ref}
        onScroll={onScroll}
        className="h-full overflow-y-auto snap-y snap-mandatory overscroll-contain"
        style={{ scrollbarWidth: 'none' }}
        role="listbox"
        aria-label={label}
      >
        <div style={{ height: pad }} />
        {options.map((o, i) => (
          <div
            key={String(o.value)}
            role="option"
            aria-selected={i === index}
            onClick={() => { if (ref.current) ref.current.scrollTop = i * ITEM_H; }}
            className={`snap-center flex items-center justify-center px-3 text-center text-lg font-bold ${i === index ? 'text-emerald-900' : 'text-accent-500'}`}
            style={{ height: ITEM_H }}
          >
            {o.label}
          </div>
        ))}
        <div style={{ height: pad }} />
      </div>
    </div>
  );
}
