// بكرة الاختيار — 3D drum (2026-11-12, v2). A hidden snap-scroll list takes
// the touch input; a visual layer places every row on a real cylinder
// (rotateX + translateZ) from the continuous scroll offset, so rows roll
// over the top like a drum. The centred row sits on a lit gold bar in large
// dark-emerald type; the rest fade and shrink as they turn away. Soft tick
// per step (Web Audio, no file). DrumPicker = drop-in for WheelPicker.
import { useEffect, useRef, useState } from 'react';

export const DRUM_ITEM_H = 34;
const VIEW_H = 196;
const PAD = (VIEW_H - DRUM_ITEM_H) / 2;
const STEP_DEG = 21;
const RADIUS = Math.round(DRUM_ITEM_H / 2 / Math.tan((STEP_DEG / 2) * (Math.PI / 180)));

// Two looks (2026-11-12): 'range' = cream, dark-red bold choice, grey rest;
// 'clock' = iOS-style dark drum with a soft grey band, for timers.
export type DrumVariant = 'range' | 'clock';
const LOOK = {
  // range: cream face, lit gold bar (light on top, dark below) with dark-emerald choice.
  range: { bg: '#FBF7EE', band: 'linear-gradient(180deg,#F6E3A1 0%,#E2B94F 52%,#C48F22 100%)', sel: '#06301F', rest: '#7E9F8E', fade: '#FBF7EE' },
  clock: { bg: 'transparent', band: 'transparent', sel: '#FBF3DC', rest: '#7FA593', fade: '' },
} as const;

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
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2200, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.018);
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    osc.connect(gain).connect(sharedCtx.destination);
    osc.start(t);
    osc.stop(t + 0.035);
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
  variant = 'range',
}: {
  labels: string[];
  index: number;
  onIndex: (i: number) => void;
  label: string;
  className?: string;
  variant?: DrumVariant;
}) {
  const look = LOOK[variant];
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(index);
  const lastIdx = useRef(index);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = index * DRUM_ITEM_H;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const p = Math.max(0, Math.min(labels.length - 1, el.scrollTop / DRUM_ITEM_H));
    setPos(p);
    const i = Math.round(p);
    if (i !== lastIdx.current) {
      lastIdx.current = i;
      tick();
      try { navigator.vibrate?.(4); } catch { /* no haptics */ }
      onIndex(i);
    }
  }

  const go = (i: number) => ref.current?.scrollTo({ top: i * DRUM_ITEM_H, behavior: 'smooth' });

  return (
    <div className={`relative min-w-0 overflow-hidden select-none font-ui ${className}`} style={{ height: VIEW_H, background: look.bg }}>
      <div
        className="absolute inset-x-1 top-1/2 -translate-y-1/2 rounded-xl pointer-events-none"
        style={{
          height: DRUM_ITEM_H + 6,
          background: look.band,
          boxShadow: variant === 'range' ? '0 3px 10px rgba(122,84,10,.35), inset 0 1px 0 rgba(255,255,255,.65), inset 0 -2px 3px rgba(122,84,10,.35)' : undefined,
        }}
      />
      <div className="absolute inset-0 pointer-events-none" style={{ perspective: 600 }} aria-hidden>
        <div className="absolute inset-x-0 top-1/2" style={{ transformStyle: 'preserve-3d' }}>
          {labels.map((l, i) => {
            const d = i - pos;
            if (Math.abs(d) > 4.2) return null;
            const sel = Math.abs(d) < 0.5;
            return (
              <div
                key={`${i}-${l}`}
                className="absolute inset-x-0 flex items-center justify-center whitespace-nowrap px-1 tabular-nums"
                style={{
                  top: -DRUM_ITEM_H / 2,
                  height: DRUM_ITEM_H,
                  transform: `rotateX(${-d * STEP_DEG}deg) translateZ(${RADIUS}px)`,
                  backfaceVisibility: 'hidden',
                  fontSize: sel ? '1.55rem' : '1.1rem',
                  fontWeight: sel ? 700 : 500,
                  color: sel ? look.sel : look.rest,
                  opacity: sel ? 1 : Math.max(0.3, 1 - 0.17 * Math.abs(d)),
                }}
              >
                {l}
              </div>
            );
          })}
        </div>
      </div>
      {look.fade && (
        <>
          <div className="absolute inset-x-0 top-0 h-14 pointer-events-none" style={{ background: `linear-gradient(${look.fade}, ${look.fade}00)` }} />
          <div className="absolute inset-x-0 bottom-0 h-14 pointer-events-none" style={{ background: `linear-gradient(${look.fade}00, ${look.fade})` }} />
        </>
      )}
      {/* input layer */}
      <div
        ref={ref}
        onScroll={onScroll}
        className="absolute inset-0 overflow-y-auto snap-y snap-mandatory overscroll-contain opacity-0"
        style={{ scrollbarWidth: 'none' }}
        role="listbox"
        aria-label={label}
      >
        <div style={{ height: PAD }} />
        {labels.map((l, i) => (
          <div key={`${i}-${l}`} role="option" aria-selected={i === Math.round(pos)} onClick={() => go(i)} className="snap-center" style={{ height: DRUM_ITEM_H }}>
            {l}
          </div>
        ))}
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
  return <DrumReel labels={options.map((o) => o.label)} index={start} label={label} onIndex={(i) => onChange(options[i].value)} />;
}

/** Two reels side by side: «من … إلى …». Keeps from ≤ to. */
export function DrumRange({
  labels,
  from,
  to,
  onChange,
  label,
}: {
  labels: string[];
  from: number;
  to: number;
  onChange: (from: number, to: number) => void;
  label: string;
}) {
  const f = useRef(from);
  const t = useRef(to);
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4" aria-label={label}>
      <DrumReel labels={labels} index={from} label={`${label}: من`} onIndex={(i) => { f.current = i; onChange(i, Math.max(i, t.current)); }} />
      <span className="text-sm font-bold text-[#B98C36] font-ui">إلى</span>
      <DrumReel labels={labels} index={to} label={`${label}: إلى`} onIndex={(i) => { t.current = i; onChange(Math.min(f.current, i), i); }} />
    </div>
  );
}
