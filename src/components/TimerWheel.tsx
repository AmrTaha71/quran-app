// بكرة مدة المؤقت (2026-11-12): same iOS-style dark drum as the clock
// picker (DrumReel variant 'clock'), compact with visible curvature.
import { useEffect } from 'react';
import { DrumReel } from './DrumReel';

export default function TimerWheel({
  items,
  initialIndex = 1,
  onChange,
}: {
  items: [number, string][];
  initialIndex?: number;
  onChange: (value: number) => void;
}) {
  useEffect(() => {
    onChange(items[initialIndex][0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="relative rounded-2xl px-3" style={{ background: 'linear-gradient(180deg,#062B1D,#0A3B28 50%,#062B1D)' }}>
<div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-[38px] rounded-xl pointer-events-none" style={{ background: '#145C41', boxShadow: 'inset 0 0 0 1px rgba(226,196,110,0.35)' }} />
      <DrumReel variant="clock" labels={items.map(([, l]) => l)} index={initialIndex} label="مدة المؤقت" onIndex={(i) => onChange(items[i][0])} />
    </div>
  );
}
