// Digital Mushaf page: the words of the page redrawn as text with tajweed colours, each one on
// the exact box of the same word in the Madinah scan (so lines, tap zones and the recitation
// highlight stay identical, and the highlight sits on top of this layer). A word without trusted
// text (see tajweedWords.ts) is simply not covered: the scan's own word shows through.
// Ayah-end medallions and ornaments are not in the boxes, so they stay from the scan.
import { useLayoutEffect, useRef, useState } from 'react';
import { digitalWordsOf, type TajweedMap, type DigitalWord } from '../../lib/tajweedWords';
import { ruleColor, TAJWEED_INK } from '../../lib/tajweedColors';

export type DigitalBox = { key: string; surah: number; ayah: number; wordNo: number; left: number; top: number; width: number; height: number };

const PAPER = '#f8f1de';
const FONT = "'Amiri', 'Noto Naskh Arabic', 'Traditional Naskh Arabic', serif";

function Word({ word, wPx, hPx, box }: { word: DigitalWord; wPx: number; hPx: number; box: DigitalBox }) {
  const inner = useRef<HTMLSpanElement | null>(null);
  const [k, setK] = useState(1);
  const size = Math.max(8, hPx * 0.78);
  // Stretch / squeeze the word to its box width (the scan's widths differ from the font's).
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || wPx <= 0) return;
    const natural = el.offsetWidth; // not affected by transforms
    if (natural > 0) setK(Math.min(1.35, Math.max(0.55, wPx / natural)));
  }, [wPx, size, word]);
  return (
    <div className="absolute flex items-center justify-center overflow-visible"
      style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%`, background: PAPER, boxShadow: `0 0 0 1.5px ${PAPER}` }}>
      <span ref={inner} dir="rtl" style={{ fontFamily: FONT, fontSize: size, lineHeight: 1, whiteSpace: 'nowrap', color: TAJWEED_INK, transform: `scaleX(${k})`, transformOrigin: 'center' }}>
        {word.segs.map((s, i) => <span key={i} style={s.rule ? { color: ruleColor(s.rule) } : undefined}>{s.text}</span>)}
      </span>
    </div>
  );
}

export default function DigitalPageLayer({ boxes, tajweed }: { boxes: DigitalBox[]; tajweed: TajweedMap }) {
  const root = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const upd = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={root} className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {size.w > 0 && boxes.map((b) => {
        const word = digitalWordsOf(tajweed, b.surah, b.ayah)?.[b.wordNo - 1];
        if (!word || b.width <= 0 || b.height <= 0) return null;
        return <Word key={b.key} word={word} box={b} wPx={(b.width / 100) * size.w} hPx={(b.height / 100) * size.h} />;
      })}
    </div>
  );
}
