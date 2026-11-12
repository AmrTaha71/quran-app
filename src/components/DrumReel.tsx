// بكرة الاختيار (2026-11-12): a drum-style reel. The centred item is the
// selected value: larger, brighter, on an emerald band with gold-edged
// type. Items above and below sit smaller, fainter and tilted back on a
// curved drum, so the centre reads as the one in focus. One soft tick per
// step (Web Audio, no file). DrumReel = one reel; DrumPicker = same API
// as WheelPicker (drop-in).
import { useEffect, useRef, useState } from 'react';

export const DRUM_ITEM_H = 56;
const VIEW_H = 220;
const PAD = (VIEW_H - DRUM_ITEM_H) / 2;

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

export function DrumReel({
  labels,
  index,
  onIndex,
  label,
  className = '',
}: {
  labels: string[];
  index: number;
  onIndex: (i: number) => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(index);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = index * DRUM_ITEM_H;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(el.scrollTop / DRUM_ITEM_H)));
    if (i !== shown) {
      tick();
      setShown(i);
      onIndex(i);
    }
  }

  return (
    <div className={`relative min-w-0 ${className}`} style={{ height: VIEW_H, perspective: 700 }}>
      {/* centre band: the selected row */}
      <div
        className="absolute inset-x-1 top-1/2 -translate-y-1/2 rounded-2xl grad-emerald-door pointer-events-none shadow-[0_6px_14px_rgba(20,60,45,0.35),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-2px_0_rgba(0,0,0,0.2)]"
        style={{ height: DRUM_ITEM_H }}
      />
      <div
        ref={ref}
        onScroll={onScroll}
        className="h-full overflow-y-auto snap-y snap-mandatory overscroll-contain relative z-10"
        style={{
          scrollbarWidth: 'none',
          maskImage: 'linear-gradient(to bottom, transparent, #000 22%, #000 78%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, #000 22%, #000 78%, transparent)',
        }}
        role="listbox"
        aria-label={label}
      >
        <div style={{ height: PAD }} />
        {labels.map((l, i) => {
          const dist = Math.abs(i - shown);
          const sel = dist === 0;
          return (
            <div
              key={`${i}-${l}`}
              role="option"
              aria-selected={sel}
              onClick={() => { if (ref.current) ref.current.scrollTop = i * DRUM_ITEM_H; }}
              className="snap-center flex items-center justify-center text-center px-2 tabular-nums"
              style={{
                height: DRUM_ITEM_H,
                fontSize: sel ? '1.5rem' : dist === 1 ? '1.05rem' : '0.9rem',
                fontWeight: sel ? 900 : 700,
                color: sel ? '#FFF4CF' : dist === 1 ? '#6E7F77' : '#A9B6AF',
                opacity: sel ? 1 : dist === 1 ? 0.7 : 0.35,
                transform: `rotateX(${(i - shown) * -18}deg) scale(${sel ? 1 : 0.9})`,
                transition: 'transform 140ms ease-out, opacity 140ms, font-size 140ms, color 140ms',
                textShadow: sel
                  ? '0 1px 0 #E9C978, 0 2px 0 #B98C36, 0 4px 6px rgba(0,0,0,0.35)'
                  : '0 1px 0 rgba(255,255,255,0.6)',
              }}
            >
              {l}
            </div>
          );
        })}
        <div style={{ height: PAD }} />
      </div>
    </div>
  );
}

/** Drop-in replacement for WheelPicker (same props). */
export default function DrumPicker<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const start = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <DrumReel
      labels={options.map((o) => o.label)}
      index={start}
      label={label}
      onIndex={(i) => onChange(options[i].value)}
    />
  );
}
