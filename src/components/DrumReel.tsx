// بكرة الاختيار — 3D drum (2026-11-12, v2). A hidden snap-scroll list takes
// the touch input; a visual layer places every row on a real cylinder
// (rotateX + translateZ) from the continuous scroll offset, so rows roll
// over the top like a drum. The centred row sits on a lit gold bar in large
// dark-emerald type; the rest fade and shrink as they turn away. Soft tick
// per step (Web Audio, no file). DrumPicker = drop-in for WheelPicker.
import { useEffect, useRef, useState } from 'react';

export const DRUM_ITEM_H = 52;
const VIEW_H = 228;
const PAD = (VIEW_H - DRUM_ITEM_H) / 2;
const STEP_DEG = 20;
const RADIUS = Math.round(DRUM_ITEM_H / 2 / Math.tan((STEP_DEG / 2) * (Math.PI / 180)));

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
}: {
  labels: string[];
  index: number;
  onIndex: (i: number) => void;
  label: string;
  className?: string;
}) {
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

  // Knurled gold side rods spin with the drum (stripe offset follows scroll).
  const rodShift = `${(pos * DRUM_ITEM_H * 0.6) % 12}px`;
  const rod = (side: 'left' | 'right') => (
    <div
      className="absolute top-0 bottom-0 pointer-events-none"
      style={{
        [side]: 0,
        width: 14,
        backgroundImage:
          'linear-gradient(90deg, rgba(0,0,0,0.35), transparent 30%, rgba(255,255,255,0.55) 50%, transparent 70%, rgba(0,0,0,0.35)),' +
          'repeating-linear-gradient(180deg, #8C6A24 0 2px, #E9C978 2px 6px, #C9A24A 6px 12px)',
        backgroundPosition: `0 0, 0 ${rodShift}`,
        borderRadius: side === 'left' ? '14px 0 0 14px' : '0 14px 14px 0',
      } as React.CSSProperties}
    />
  );

  return (
    <div
      className={`relative min-w-0 overflow-hidden rounded-2xl select-none ${className}`}
      style={{
        height: VIEW_H,
        // the drum: cream parchment lit from the front, dark where it turns away
        background:
          'linear-gradient(180deg, #3a2c12 0%, #b9a06a 14%, #efe3c0 32%, #fffaf0 50%, #efe3c0 68%, #b9a06a 86%, #3a2c12 100%)',
        boxShadow: '0 10px 24px -10px rgba(40,30,10,0.6), inset 0 0 0 1px rgba(140,106,36,0.6)',
      }}
    >
      {/* faint manuscript ruling on the drum */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.07]" style={{ backgroundImage: 'repeating-linear-gradient(180deg, #5a4316 0 1px, transparent 1px 9px)', backgroundPosition: `0 ${-pos * DRUM_ITEM_H}px` }} />
      {/* the selection: a surah-title cartouche, like the frames in the Madinah mushaf */}
      <svg className="absolute inset-x-4 top-1/2 -translate-y-1/2 pointer-events-none drop-shadow-[0_4px_6px_rgba(40,30,10,0.45)]" style={{ height: DRUM_ITEM_H + 6, width: 'calc(100% - 2rem)' }} viewBox="0 0 300 58" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="dr-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FFF0B8" /><stop offset="0.45" stopColor="#D9B25A" /><stop offset="1" stopColor="#8C6A24" />
          </linearGradient>
          <linearGradient id="dr-em" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#13704f" /><stop offset="1" stopColor="#063522" />
          </linearGradient>
        </defs>
        <path d="M22 3 H278 Q292 3 297 29 Q292 55 278 55 H22 Q8 55 3 29 Q8 3 22 3 Z" fill="url(#dr-gold)" />
        <path d="M26 8 H274 Q285 8 289 29 Q285 50 274 50 H26 Q15 50 11 29 Q15 8 26 8 Z" fill="url(#dr-em)" />
        <path d="M30 12 H270 Q279 12 282 29 Q279 46 270 46 H30 Q21 46 18 29 Q21 12 30 12 Z" fill="none" stroke="#E9C978" strokeWidth="0.8" opacity="0.8" />
      </svg>
      {/* the drum rows */}
      <div className="absolute inset-0 pointer-events-none" style={{ perspective: 800 }} aria-hidden>
        <div className="absolute inset-x-0 top-1/2" style={{ transformStyle: 'preserve-3d' }}>
          {labels.map((l, i) => {
            const d = i - pos;
            if (Math.abs(d) > 4.5) return null;
            const near = Math.max(0, 1 - Math.abs(d));
            const sel = near > 0.5;
            return (
              <div
                key={`${i}-${l}`}
                className="absolute inset-x-4 flex items-center justify-center whitespace-nowrap px-6"
                style={{
                  top: -DRUM_ITEM_H / 2,
                  height: DRUM_ITEM_H,
                  transform: `rotateX(${-d * STEP_DEG}deg) translateZ(${RADIUS}px) scale(${1 + 0.12 * near})`,
                  backfaceVisibility: 'hidden',
                  fontFamily: "'Noto Naskh Arabic', 'Amiri', serif",
                  fontSize: '1.15rem',
                  fontWeight: sel ? 800 : 700,
                  color: sel ? '#FCE9A8' : '#4a3a17',
                  opacity: sel ? 1 : Math.max(0.15, 0.85 - 0.22 * Math.abs(d)),
                  textShadow: sel ? '0 1px 0 #6b4f17, 0 2px 4px rgba(0,0,0,0.45)' : '0 1px 0 rgba(255,255,255,0.6)',
                }}
              >
                {l}
              </div>
            );
          })}
        </div>
      </div>
      {rod('left')}
      {rod('right')}
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
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2" aria-label={label}>
      <DrumReel labels={labels} index={from} label={`${label}: من`} onIndex={(i) => { f.current = i; onChange(i, Math.max(i, t.current)); }} />
      <span className="text-base font-bold text-amber-600">إلى</span>
      <DrumReel labels={labels} index={to} label={`${label}: إلى`} onIndex={(i) => { t.current = i; onChange(Math.min(f.current, i), i); }} />
    </div>
  );
}
