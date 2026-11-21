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
  const [fit, setFit] = useState({ size: Math.max(8, hPx * 0.95), k: 1 });
  // Largest font that keeps the line's shape: start from almost the box height, shrink only if the word is
  // wider than its box (so a long word is never squeezed to a sliver), then stretch / squeeze a little (0.8-1.25)
  // to land exactly on the scan's box width.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || wPx <= 0 || hPx <= 0) return;
    const base = Math.max(8, hPx * 0.95);
    el.style.fontSize = `${base}px`;
    const natural = el.offsetWidth; // not affected by transforms
    if (natural <= 0) return;
    const size = Math.max(8, natural > wPx * 1.25 ? base * (wPx * 1.25) / natural : base);
    const at = natural * (size / base);
    setFit({ size, k: Math.min(1.25, Math.max(0.8, wPx / at)) });
  }, [wPx, hPx, word]);
  return (
    <div className="absolute flex items-center justify-center overflow-visible"
      style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%`, background: PAPER, boxShadow: `0 0 0 1.5px ${PAPER}` }}>
      <span ref={inner} dir="rtl" style={{ fontFamily: FONT, fontSize: fit.size, lineHeight: 1, whiteSpace: 'nowrap', color: TAJWEED_INK, transform: `scaleX(${fit.k})`, transformOrigin: 'center' }}>
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
