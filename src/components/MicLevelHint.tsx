// Item 2.4: while the mic listens, show a live level bar (on-device ears
// only; the browser speech API gives no audio) and, after a few seconds
// with nothing heard, a gentle hint — instead of 18 silent seconds before
// the "listening stopped" banner. It never stops or grades anything.
import { useEffect, useRef, useState } from 'react';
import { subscribeMicLevel } from '../lib/micLevel';

const NOTHING_HEARD_MS = 5000;
const SOUND_RMS = 0.01;

export default function MicLevelHint({ active, heardSomething }: { active: boolean; heardSomething: boolean }) {
  const [level, setLevel] = useState<number | null>(null);
  const [late, setLate] = useState(false);
  const loudRef = useRef(false);

  useEffect(() => {
    if (!active) { setLevel(null); setLate(false); loudRef.current = false; return; }
    let last = 0;
    const off = subscribeMicLevel((rms) => {
      if (rms > SOUND_RMS) loudRef.current = true;
      const now = performance.now();
      if (now - last < 120) return; // ~8 updates a second is plenty
      last = now;
      setLevel(rms);
    });
    const t = setTimeout(() => setLate(true), NOTHING_HEARD_MS);
    return () => { off(); clearTimeout(t); };
  }, [active]);

  useEffect(() => { if (heardSomething) setLate(false); }, [heardSomething]);

  if (!active) return null;
  const showHint = late && !heardSomething;
  return (
    <div className="mt-2 space-y-1" aria-live="polite">
      {level !== null && (
        <div className="mx-auto h-2 w-40 rounded-full bg-emerald-100 overflow-hidden" aria-hidden="true">
          <div className="h-full bg-emerald-500 transition-[width] duration-100" style={{ width: `${Math.min(100, Math.round(level * 1500))}%` }} />
        </div>
      )}
      {showHint && (
        <p className="text-sm font-semibold text-amber-link">
          {loudRef.current
            ? 'سامع صوت بس لسه مش فاهم كلام — اقرأ بصوت أوضح شوية.'
            : 'مش سامعك — قرّب الموبايل منك واتأكد إن الميكروفون مش مكتوم.'}
        </p>
      )}
    </div>
  );
}
