// ساعة الوقت بعجلات (2026-11-12): iOS-style clock picker — hour, minute,
// ص/م — as three spinning reels. Colored (emerald band, gold figures),
// with depth on the numbers (layered text-shadow) and a curved fade so
// the reels read as 3D drums. Output is a 24h "HH:mm" string.
import { useEffect, useRef, useState } from 'react';

const ITEM_H = 48;
const VIEW_H = 192;
const PAD = (VIEW_H - ITEM_H) / 2;

const toArabicDigits = (s: string) => s.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

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

function Reel({ labels, index, onIndex, label }: { labels: string[]; index: number; onIndex: (i: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(index);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = index * ITEM_H;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(el.scrollTop / ITEM_H)));
    if (i !== shown) {
      tick();
      setShown(i);
      onIndex(i);
    }
  }

  return (
    <div className="relative flex-1 min-w-0" style={{ height: VIEW_H, perspective: 600 }}>
      <div className="absolute inset-x-1 top-1/2 -translate-y-1/2 rounded-xl grad-emerald-door shadow-[0_4px_10px_rgba(20,60,45,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] pointer-events-none" style={{ height: ITEM_H }} />
      <div
        ref={ref}
        onScroll={onScroll}
        className="h-full overflow-y-auto snap-y snap-mandatory overscroll-contain relative z-10"
        style={{ scrollbarWidth: 'none', maskImage: 'linear-gradient(to bottom, transparent, #000 28%, #000 72%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, transparent, #000 28%, #000 72%, transparent)' }}
        role="listbox"
        aria-label={label}
      >
        <div style={{ height: PAD }} />
        {labels.map((l, i) => {
          const dist = Math.abs(i - shown);
          const sel = dist === 0;
          return (
            <div
              key={l}
              role="option"
              aria-selected={sel}
              onClick={() => { if (ref.current) ref.current.scrollTop = i * ITEM_H; }}
              className="snap-center flex items-center justify-center text-2xl font-extrabold tabular-nums"
              style={{
                height: ITEM_H,
                color: sel ? '#FFF6DC' : dist === 1 ? '#7A5A1E' : '#9C8A6A',
                transform: `rotateX(${(i - shown) * -14}deg) scale(${sel ? 1.05 : 0.92})`,
                transition: 'transform 120ms ease-out, color 120ms',
                textShadow: sel
                  ? '0 1px 0 #E8C873, 0 2px 0 #C9A24A, 0 3px 4px rgba(0,0,0,0.35)'
                  : '0 1px 0 rgba(255,255,255,0.7), 0 2px 3px rgba(0,0,0,0.18)',
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

/** Returns the chosen time as 24h "HH:mm". `initial` is "HH:mm" (24h). */
export default function ClockWheel({ initial, onChange }: { initial: string; onChange: (hhmm: string) => void }) {
  const [h24, m0] = initial.split(':').map(Number);
  const startPm = h24 >= 12;
  const h12 = ((h24 + 11) % 12) + 1;
  const [hIdx, setHIdx] = useState(h12 - 1);
  const [mIdx, setMIdx] = useState(m0);
  const [pIdx, setPIdx] = useState(startPm ? 1 : 0);

  const hours = Array.from({ length: 12 }, (_, i) => toArabicDigits(String(i + 1)));
  const minutes = Array.from({ length: 60 }, (_, i) => toArabicDigits(String(i).padStart(2, '0')));
  const periods = ['ص', 'م'];

  function emit(h: number, m: number, p: number) {
    const hour12 = h + 1;
    const hour24 = (hour12 % 12) + (p === 1 ? 12 : 0);
    onChange(`${String(hour24).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }

  return (
    <div className="rounded-2xl bg-gradient-to-b from-emerald-50 to-white border border-hairline-emerald p-2" dir="ltr">
      <div className="flex items-stretch gap-1" dir="ltr">
        <Reel labels={hours} index={hIdx} label="ساعة" onIndex={(i) => { setHIdx(i); emit(i, mIdx, pIdx); }} />
        <span className="self-center text-2xl font-extrabold text-amber-600" style={{ textShadow: '0 1px 0 #fff, 0 2px 2px rgba(0,0,0,0.2)' }}>:</span>
        <Reel labels={minutes} index={mIdx} label="دقيقة" onIndex={(i) => { setMIdx(i); emit(hIdx, i, pIdx); }} />
        <Reel labels={periods} index={pIdx} label="ص أو م" onIndex={(i) => { setPIdx(i); emit(hIdx, mIdx, i); }} />
      </div>
    </div>
  );
}
