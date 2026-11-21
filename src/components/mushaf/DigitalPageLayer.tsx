// Digital Mushaf page: the words of the page redrawn as text with tajweed colours, each one on
// the exact box of the same word in the Madinah scan (so lines, tap zones and the recitation
// highlight stay identical, and the highlight sits on top of this layer). A word without trusted
// text (see tajweedWords.ts) is simply not covered: the scan's own word shows through.
// Ayah-end medallions and ornaments are not in the boxes, so they stay from the scan.
import { useLayoutEffect, useRef, useState } from 'react';
import { digitalWordsOf, type TajweedMap, type DigitalWord } from '../../lib/tajweedWords';
import { ruleColor, TAJWEED_INK } from '../../lib/tajweedColors';
import { adaptRuleColor, type MushafTheme } from '../../lib/mushafThemes';
import { SURAHS } from '../../lib/surahs';

export type DigitalBox = { key: string; surah: number; ayah: number; wordNo: number; left: number; top: number; width: number; height: number };

const PAPER = '#f8f1de';
const FONT = "'Amiri Quran', 'Amiri', 'Noto Naskh Arabic', 'Traditional Naskh Arabic', serif";

function Word({ word, wPx, hPx, box, theme, uniform }: { word: DigitalWord; wPx: number; hPx: number; box: DigitalBox; theme?: MushafTheme; uniform?: number | null }) {
  const inner = useRef<HTMLSpanElement | null>(null);
  const [fit, setFit] = useState({ size: Math.max(8, hPx * 0.95), k: 1 });
  // Largest font that keeps the line's shape: start from almost the box height, shrink only if the word is
  // wider than its box (so a long word is never squeezed to a sliver), then stretch / squeeze a little (0.8-1.25)
  // to land exactly on the scan's box width.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || wPx <= 0 || hPx <= 0) return;
    // Standalone page (`uniform` set): ONE font size for the whole page like a typeset line; each word is only
    // stretched / squeezed a little to fill its box. Overlay mode keeps the per-word fit.
    const base = uniform ? uniform : Math.max(8, hPx * 0.95);
    el.style.fontSize = `${base}px`;
    const natural = el.offsetWidth; // not affected by transforms
    if (natural <= 0) return;
    const size = uniform ? uniform : Math.max(8, natural > wPx * 1.25 ? base * (wPx * 1.25) / natural : base);
    const at = natural * (size / base);
    setFit({ size, k: uniform ? Math.min(1.35, Math.max(0.78, wPx / at)) : Math.min(1.25, Math.max(0.8, wPx / at)) });
  }, [wPx, hPx, word, uniform]);
  return (
    <div className="absolute flex items-center justify-center overflow-visible"
      style={theme
        ? { left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }
        : { left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%`, background: PAPER, boxShadow: `0 0 0 1.5px ${PAPER}` }}>
      <span ref={inner} dir="rtl" style={{ fontFamily: FONT, fontSize: fit.size, lineHeight: 1, whiteSpace: 'nowrap', color: theme ? theme.ink : TAJWEED_INK, ...(theme ? { WebkitTextStroke: '0.018em currentColor', textRendering: 'geometricPrecision' as const, WebkitFontSmoothing: 'antialiased' as const } : {}), transform: `scaleX(${fit.k})`, transformOrigin: 'center' }}>
        {word.segs.map((s, i) => <span key={i} style={s.rule ? { color: adaptRuleColor(ruleColor(s.rule), !!theme?.dark) } : undefined}>{s.text}</span>)}
      </span>
    </div>
  );
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toArDigits = (n: number) => String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
const BASMALA = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };

type Px = { l: number; t: number; w: number; h: number; cy: number; box: DigitalBox };

/** True when every word box of the page has trusted digital text, so the scan can be left out entirely. */
export function pageIsFullyDigital(boxes: { surah: number; ayah: number; wordNo: number }[], tajweed: TajweedMap): boolean {
  return boxes.length > 0 && boxes.every((b) => !!digitalWordsOf(tajweed, b.surah, b.ayah)?.[b.wordNo - 1]);
}

/** Standalone page furniture computed from the word boxes alone (same 15-line grid as the printed Mushaf). */
function Furniture({ boxes, tajweed, theme, size }: { boxes: DigitalBox[]; tajweed: TajweedMap; theme: MushafTheme; size: { w: number; h: number } }) {
  const px: Px[] = boxes.filter((b) => b.width > 0 && b.height > 0).map((b) => {
    const l = (b.left / 100) * size.w, t = (b.top / 100) * size.h, w = (b.width / 100) * size.w, h = (b.height / 100) * size.h;
    return { l, t, w, h, cy: t + h / 2, box: b };
  });
  if (px.length === 0) return null;
  const hMed = median(px.map((p) => p.h));
  // rows: cluster by centre
  const sorted = [...px].sort((a, b) => a.cy - b.cy);
  const rows: Px[][] = [];
  for (const p of sorted) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(r[0].cy - p.cy) < hMed * 0.6) r.push(p); else rows.push([p]);
  }
  const rowY = rows.map((r) => r.reduce((a, p) => a + p.cy, 0) / r.length);
  const diffs = rowY.slice(1).map((y, i) => y - rowY[i]).filter((d) => d > hMed * 0.9);
  const pitch = diffs.length ? median(diffs.filter((d) => d < median(diffs) * 1.5)) : hMed * 1.4;
  const minL = Math.min(...px.map((p) => p.l)), maxR = Math.max(...px.map((p) => p.l + p.w));
  const textW = maxR - minL;

  const furniture: React.ReactNode[] = [];
  const headerYs: number[] = [];
  rows.forEach((r, ri) => {
    const first = [...r].sort((a, b) => b.l + b.w - (a.l + a.w))[0].box;
    if (first.ayah === 1 && first.wordNo === 1) {
      const y = rowY[ri];
      const hasBasmalaLine = first.surah !== 1 && first.surah !== 9;
      const hy = hasBasmalaLine ? y - 2 * pitch : y - pitch;
      headerYs.push(hy);
      const name = SURAHS.find((x) => x.no === first.surah)?.name ?? '';
      furniture.push(
        <div key={`hd-${first.surah}`} className="absolute flex items-center justify-center rounded-md"
          style={{ left: minL, width: textW, top: hy - pitch * 0.4, height: pitch * 0.8, border: `1.5px solid ${theme.frame}`, background: theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)', color: theme.accent, fontFamily: FONT, fontSize: pitch * 0.5, lineHeight: 1 }}>
          <span dir="rtl">{name.startsWith('سورة') ? name : `سورة ${name}`}</span>
        </div>
      );
      if (hasBasmalaLine) {
        furniture.push(
          <div key={`bs-${first.surah}`} className="absolute flex items-center justify-center"
            style={{ left: minL, width: textW, top: y - pitch - pitch * 0.45, height: pitch * 0.9, color: theme.ink, fontFamily: FONT, fontSize: pitch * 0.55, lineHeight: 1 }}>
            <span dir="rtl">{BASMALA}</span>
          </div>
        );
      }
    }
  });

  // ayah-end medallions, in the gap after the ayah's last word
  rows.forEach((r) => {
    const byRight = [...r].sort((a, b) => b.l + b.w - (a.l + a.w));
    byRight.forEach((p, i) => {
      const words = digitalWordsOf(tajweed, p.box.surah, p.box.ayah);
      if (!words || p.box.wordNo !== words.length) return;
      const next = byRight[i + 1];
      const d = Math.min(p.h * 0.85, pitch * 0.7);
      const gap = next ? p.l - (next.l + next.w) : 0;
      const cx = next && gap > d * 0.6 ? p.l - gap / 2 : p.l - d / 2 - 1;
      furniture.push(
        <div key={`mk-${p.box.key}`} className="absolute flex items-center justify-center rounded-full"
          style={{ left: cx - d / 2, top: p.cy - d / 2, width: d, height: d, border: `1.5px solid ${theme.accent}`, color: theme.accent, fontFamily: FONT, fontSize: d * 0.5, lineHeight: 1 }}>
          <span>{toArDigits(p.box.ayah)}</span>
        </div>
      );
    });
  });

  // frame around the text block
  const top = Math.min(rowY[0], ...headerYs) - pitch * 0.6;
  const bottom = rowY[rowY.length - 1] + pitch * 0.6;
  const padX = Math.min(pitch * 0.8, size.w * 0.06);
  return (
    <>
      <div className="absolute rounded-lg" style={{ left: minL - padX, width: textW + 2 * padX, top, height: bottom - top, border: `2px solid ${theme.frame}`, boxShadow: `inset 0 0 0 4px ${theme.bg}, inset 0 0 0 5px ${theme.frame}` }} />
      {furniture}
    </>
  );
}

export default function DigitalPageLayer({ boxes, tajweed, theme }: { boxes: DigitalBox[]; tajweed: TajweedMap; theme?: MushafTheme }) {
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
  // Standalone page: one font size for the whole page = what fits the tighter words (20th percentile), capped by line height.
  const [uni, setUni] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!theme || size.w <= 0) return;
    const calc = () => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return;
      ctx.font = `100px ${FONT}`;
      const fits: number[] = [];
      const hs: number[] = [];
      for (const b of boxes) {
        const w = digitalWordsOf(tajweed, b.surah, b.ayah)?.[b.wordNo - 1];
        if (!w || b.width <= 0 || b.height <= 0) continue;
        const nat = ctx.measureText(w.segs.map((x) => x.text).join('')).width;
        if (nat > 0) fits.push((100 * (b.width / 100) * size.w) / nat);
        hs.push((b.height / 100) * size.h);
      }
      if (!fits.length) return;
      fits.sort((x, y) => x - y);
      setUni(Math.max(8, Math.min(fits[Math.floor(fits.length * 0.2)], median(hs) * 0.9)));
    };
    calc();
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) calc(); }).catch(() => {});
    return () => { alive = false; };
  }, [theme, boxes, tajweed, size]);
  // `theme` set = standalone page: plain coloured page, no scan under it. Without it, the words are drawn on
  // paper patches over the scan (used for the few pages that still have an ayah without trusted text).
  return (
    <div ref={root} className="absolute inset-0 pointer-events-none" aria-hidden="true" style={theme ? { background: theme.bg } : undefined}>
      {size.w > 0 && theme && <Furniture boxes={boxes} tajweed={tajweed} theme={theme} size={size} />}
      {size.w > 0 && boxes.map((b) => {
        const word = digitalWordsOf(tajweed, b.surah, b.ayah)?.[b.wordNo - 1];
        if (!word || b.width <= 0 || b.height <= 0) return null;
        return <Word key={b.key} word={word} box={b} theme={theme} uniform={theme ? uni : null} wPx={(b.width / 100) * size.w} hPx={(b.height / 100) * size.h} />;
      })}
    </div>
  );
}
