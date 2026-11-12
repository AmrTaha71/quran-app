// ساعة الوقت بعجلات (2026-11-12): iOS-style clock picker — hour, minute,
// ص/م — as three spinning reels. Colored (emerald band, gold figures),
// with depth on the numbers (layered text-shadow) and a curved fade so
// the reels read as 3D drums. Output is a 24h "HH:mm" string.
import { useState } from 'react';
import { DrumReel } from './DrumReel';

const toArabicDigits = (s: string) => s.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

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
    <div className="relative rounded-2xl px-3" style={{ background: "#1C1C1E" }} dir="ltr">
      <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-[38px] rounded-xl pointer-events-none" style={{ background: '#2C2C2E' }} />
<div className="flex items-stretch gap-1" dir="ltr">
        <DrumReel variant="clock" className="flex-1" labels={hours} index={hIdx} label="ساعة" onIndex={(i) => { setHIdx(i); emit(i, mIdx, pIdx); }} />
        <span className="self-center text-2xl font-extrabold text-[#F5F5F7]">:</span>
        <DrumReel variant="clock" className="flex-[1.2]" labels={minutes} index={mIdx} label="دقيقة" onIndex={(i) => { setMIdx(i); emit(hIdx, i, pIdx); }} />
        <DrumReel variant="clock" className="flex-[0.8]" labels={periods} index={pIdx} label="ص أو م" onIndex={(i) => { setPIdx(i); emit(hIdx, mIdx, i); }} />
      </div>
    </div>
  );
}
