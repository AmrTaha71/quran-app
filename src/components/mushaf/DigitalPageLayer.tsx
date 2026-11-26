// Digital Mushaf page: the words of the page redrawn as text with tajweed colours, each one on
// the exact box of the same word in the Madinah scan (so lines, tap zones and the recitation
// highlight stay identical, and the highlight sits on top of this layer). A word without trusted
// text (see tajweedWords.ts) is simply not covered: the scan's own word shows through.
// Ayah-end medallions and ornaments are not in the boxes, so they stay from the scan.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { digitalWordsOf, type TajweedMap, type DigitalWord } from '../../lib/tajweedWords';
import { ruleColor, TAJWEED_INK } from '../../lib/tajweedColors';
import { adaptRuleColor, type MushafTheme } from '../../lib/mushafThemes';
import { SURAHS } from '../../lib/surahs';

export type DigitalBox = { key: string; surah: number; ayah: number; wordNo: number; left: number; top: number; width: number; height: number };

const PAPER = '#f8f1de';
// Digits (ayah numbers) are not in the Uthmanic font, so they use a font that has them.
const DIGIT_FONT = "'Amiri Quran', 'Amiri', 'Noto Naskh Arabic', 'Traditional Naskh Arabic', serif";
const FONT = "'KFGQPC Uthmanic Hafs', 'Amiri Quran', 'Amiri', 'Noto Naskh Arabic', 'Traditional Naskh Arabic', serif";

function Word({ word, wPx, hPx, box, theme, uniform, tint }: { word: DigitalWord; wPx: number; hPx: number; box: DigitalBox; theme?: MushafTheme; uniform?: number | null; tint?: string }) {
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
    setFit({ size, k: uniform ? Math.min(1.5, Math.max(0.78, wPx / at)) : Math.min(1.25, Math.max(0.8, wPx / at)) });
  }, [wPx, hPx, word, uniform]);
  return (
    <div className="absolute flex items-center justify-center overflow-visible"
      style={theme
        ? { left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }
        : { left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%`, background: PAPER, boxShadow: `0 0 0 1.5px ${PAPER}` }}>
      <span ref={inner} dir="rtl" style={{ fontFamily: FONT, fontSize: fit.size, lineHeight: 1, whiteSpace: 'nowrap', color: theme ? theme.ink : TAJWEED_INK, ...(theme ? { WebkitTextStroke: '0.014em currentColor', textRendering: 'geometricPrecision' as const, WebkitFontSmoothing: 'antialiased' as const } : {}), transform: `scaleX(${fit.k})`, transformOrigin: 'center' }}>
        {word.segs.map((s, i) => <span key={i} style={tint ? { color: tint } : s.rule ? { color: adaptRuleColor(ruleColor(s.rule), !!theme?.dark) } : undefined}>{s.text}</span>)}
      </span>
    </div>
  );
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toArDigits = (n: number) => String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
const BASMALA = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };


/** Standalone page: make every full line start and end on the same edges (like the printed Mushaf). Each full
 *  line's boxes are remapped linearly so the line (plus its ayah-end medallion when the line ends an ayah)
 *  spans exactly the page's text edges; short lines (surah ends, headers) are left alone. */
function justifyBoxes(boxes: DigitalBox[], tajweed: TajweedMap, size: { w: number; h: number }): DigitalBox[] {
  const ok = boxes.filter((b) => b.width > 0 && b.height > 0);
  if (ok.length < 8 || size.w <= 0) return boxes;
  const px = ok.map((b) => ({ b, l: (b.left / 100) * size.w, r: ((b.left + b.width) / 100) * size.w, cy: ((b.top + b.height / 2) / 100) * size.h, h: (b.height / 100) * size.h }));
  const hMed = median(px.map((p) => p.h));
  const d = hMed * 0.85;
  const rows: typeof px[] = [];
  for (const p of [...px].sort((a, c) => a.cy - c.cy)) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(r[0].cy - p.cy) < hMed * 0.6) r.push(p); else rows.push([p]);
  }
  const info = rows.map((r) => {
    const byR = [...r].sort((a, c) => c.r - a.r);
    const last = byR[byR.length - 1];
    const words = digitalWordsOf(tajweed, last.b.surah, last.b.ayah);
    const endsAyah = !!words && last.b.wordNo === words.length;
    const extL = last.l - (endsAyah ? d + 1 : 0);
    const extR = byR[0].r;
    return { r, extL, extR, w: extR - extL };
  });
  const maxW = Math.max(...info.map((i) => i.w));
  const full = info.filter((i) => i.w >= maxW * 0.9);
  if (full.length < 3) return boxes;
  const pageR = median(full.map((i) => i.extR));
  const pageL = median(full.map((i) => i.extL));
  const map = new Map<string, DigitalBox>();
  for (const i of info) {
    if (i.w < (pageR - pageL) * 0.85 || i.w <= 0) continue;
    const k = (pageR - pageL) / i.w;
    if (k > 1.12 || k < 0.9) continue;
    for (const p of i.r) {
      const nl = pageR - (i.extR - p.l) * k, nr = pageR - (i.extR - p.r) * k;
      map.set(p.b.key, { ...p.b, left: (nl / size.w) * 100, width: ((nr - nl) / size.w) * 100 });
    }
  }
  return boxes.map((b) => map.get(b.key) ?? b);
}

type Px = { l: number; t: number; w: number; h: number; cy: number; box: DigitalBox };

/** True when every word box of the page has trusted digital text, so the scan can be left out entirely. */
export function pageIsFullyDigital(boxes: { surah: number; ayah: number; wordNo: number }[], tajweed: TajweedMap): boolean {
  return boxes.length > 0 && boxes.every((b) => !!digitalWordsOf(tajweed, b.surah, b.ayah)?.[b.wordNo - 1]);
}

/** Standalone page furniture computed from the word boxes alone (same 15-line grid as the printed Mushaf). */
function Furniture({ boxes, tajweed, theme, size, compact }: { boxes: DigitalBox[]; tajweed: TajweedMap; theme: MushafTheme; size: { w: number; h: number }; compact?: boolean }) {
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
      const label = name.startsWith('سورة') ? name : `سورة ${name}`;
      furniture.push(compact ? (
        <div key={`hd-${first.surah}`} className="absolute flex items-center justify-center"
          style={{ left: minL, width: textW, top: hy - pitch * 0.46, height: pitch * 0.92, border: `2px solid ${theme.accent}`, borderRadius: 8, background: theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(176,138,40,0.10)', boxShadow: `inset 0 0 0 3px ${theme.bg}, inset 0 0 0 4px ${theme.frame}`, overflow: 'hidden' }}>
          <div className="absolute inset-y-0 left-0" style={{ width: '17%', backgroundImage: `repeating-linear-gradient(45deg, ${theme.frame} 0 1.5px, transparent 1.5px 6px), repeating-linear-gradient(-45deg, ${theme.frame} 0 1.5px, transparent 1.5px 6px)`, opacity: 0.45 }} />
          <div className="absolute inset-y-0 right-0" style={{ width: '17%', backgroundImage: `repeating-linear-gradient(45deg, ${theme.frame} 0 1.5px, transparent 1.5px 6px), repeating-linear-gradient(-45deg, ${theme.frame} 0 1.5px, transparent 1.5px 6px)`, opacity: 0.45 }} />
          <span dir="rtl" className="relative px-5" style={{ background: theme.bg, borderRadius: 6, color: theme.accent, fontFamily: FONT, fontSize: pitch * 0.56, lineHeight: 1.25, WebkitTextStroke: '0.02em currentColor' }}>{label}</span>
        </div>
      ) : (
        <div key={`hd-${first.surah}`} className="absolute flex items-center justify-center rounded-md"
          style={{ left: minL, width: textW, top: hy - pitch * 0.4, height: pitch * 0.8, border: `1.5px solid ${theme.frame}`, background: theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)', color: theme.accent, fontFamily: FONT, fontSize: pitch * 0.5, lineHeight: 1 }}>
          <span dir="rtl">{label}</span>
        </div>
      ));
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
          style={{ left: cx - d / 2, top: p.cy - d / 2, width: d, height: d, border: `2.5px solid ${theme.accent}`, boxShadow: compact ? `inset 0 0 0 2px ${theme.bg}, inset 0 0 0 3px ${theme.frame}` : undefined, color: theme.accent, fontFamily: DIGIT_FONT, fontSize: d * 0.5, lineHeight: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', lineHeight: 1, textAlign: 'center' }}>{toArDigits(p.box.ayah)}</span>
        </div>
      );
    });
  });

  // frame around the text block
  const top = Math.min(rowY[0], ...headerYs) - pitch * 0.6;
  const bottom = rowY[rowY.length - 1] + pitch * 0.6;
  const padX = Math.min(pitch * 0.8, size.w * 0.06);
  if (compact) {
    // Pages 1 and 2: an ornamental frame filling the page, like the Madinah Mushaf.
    const mx = size.w * 0.035, my = size.h * 0.03, band = Math.max(12, size.w * 0.028);
    // 8-point star (two squares) with a centre ring: corner / mid-edge ornament, drawn only in theme colours.
    const star = (style: React.CSSProperties, k: string, r: number) => (
      <svg key={k} className="absolute" width={r * 2} height={r * 2} viewBox="-20 -20 40 40" style={style}>
        <circle r="19" fill={theme.bg} stroke={theme.accent} strokeWidth="1.6" />
        <rect x="-11" y="-11" width="22" height="22" fill="none" stroke={theme.accent} strokeWidth="1.6" />
        <rect x="-11" y="-11" width="22" height="22" fill="none" stroke={theme.accent} strokeWidth="1.6" transform="rotate(45)" />
        <circle r="4.2" fill={theme.accent} />
        <circle r="7.6" fill="none" stroke={theme.frame} strokeWidth="1" />
      </svg>
    );
    const beads = `radial-gradient(circle, ${theme.frame} 1.3px, transparent 1.7px)`;
    const R = band * 0.95;
    return (
      <>
        <div className="absolute rounded-xl" style={{ left: mx, top: my, right: mx, bottom: my, border: `2px solid ${theme.accent}`, backgroundImage: beads, backgroundSize: '9px 9px', backgroundPosition: 'center' }} />
        <div className="absolute rounded-lg" style={{ left: mx + band, top: my + band, right: mx + band, bottom: my + band, background: theme.bg, border: `1.5px solid ${theme.accent}`, boxShadow: `inset 0 0 0 4px ${theme.bg}, inset 0 0 0 5px ${theme.frame}, inset 0 0 0 9px ${theme.bg}, inset 0 0 0 9.6px ${theme.frame}` }} />
        {star({ left: mx - R, top: my - R }, 'c1', R)}
        {star({ left: size.w - mx - R, top: my - R }, 'c2', R)}
        {star({ left: mx - R, top: size.h - my - R }, 'c3', R)}
        {star({ left: size.w - mx - R, top: size.h - my - R }, 'c4', R)}
        {star({ left: size.w / 2 - R * 1.25, top: my - R * 1.25 }, 'c5', R * 1.25)}
        {star({ left: size.w / 2 - R * 1.25, top: size.h - my - R * 1.25 }, 'c6', R * 1.25)}
        <div className="absolute flex items-center justify-center gap-2" style={{ left: size.w * 0.22, right: size.w * 0.22, top: Math.min(bottom + pitch * 0.9, size.h - my - band - pitch * 0.9), height: pitch * 0.5 }}>
          <div style={{ flex: 1, height: 1.5, background: `linear-gradient(to left, ${theme.accent}, transparent)` }} />
          <div style={{ width: pitch * 0.16, height: pitch * 0.16, transform: 'rotate(45deg)', background: theme.accent }} />
          <div style={{ width: pitch * 0.3, height: pitch * 0.3, transform: 'rotate(45deg)', border: `1.5px solid ${theme.accent}`, background: theme.bg }} />
          <div style={{ width: pitch * 0.16, height: pitch * 0.16, transform: 'rotate(45deg)', background: theme.accent }} />
          <div style={{ flex: 1, height: 1.5, background: `linear-gradient(to right, ${theme.accent}, transparent)` }} />
        </div>
        {furniture}
      </>
    );
  }
  // Regular pages: a thin, quiet double-line frame in the reader's theme colour (hairline outside, finer line inside,
  // small corner diamonds). Colours come only from `theme`, so it follows whatever palette the reader picked.
  const fl = minL - padX, fw = textW + 2 * padX, g = 4;
  const dm = Math.max(5, pitch * 0.2);
  const corner = (style: React.CSSProperties, k: string) => (
    <div key={k} className="absolute" style={{ width: dm, height: dm, transform: 'rotate(45deg)', background: theme.bg, border: `1px solid ${theme.frame}`, ...style }} />
  );
  return (
    <>
      <div className="absolute rounded-md" style={{ left: fl, width: fw, top, height: bottom - top, border: `1.25px solid ${theme.frame}` }} />
      <div className="absolute rounded-sm" style={{ left: fl + g, width: fw - 2 * g, top: top + g, height: bottom - top - 2 * g, border: `0.5px solid ${theme.frame}`, opacity: 0.55 }} />
      {corner({ left: fl - dm / 2, top: top - dm / 2 }, 'k1')}
      {corner({ left: fl + fw - dm / 2, top: top - dm / 2 }, 'k2')}
      {corner({ left: fl - dm / 2, top: top + (bottom - top) - dm / 2 }, 'k3')}
      {corner({ left: fl + fw - dm / 2, top: top + (bottom - top) - dm / 2 }, 'k4')}
      {furniture}
    </>
  );
}

export default function DigitalPageLayer({ boxes: rawBoxes, tajweed, theme, page, wordMark }: { boxes: DigitalBox[]; tajweed: TajweedMap; theme?: MushafTheme; page?: number;
  /** Tasmee' reveal: 'hidden' = word not drawn (its box and the ayah medallion stay), 'wrong' = drawn in red. */
  wordMark?: (b: DigitalBox) => 'hidden' | 'wrong' | undefined }) {
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
  const boxes = useMemo(() => (theme ? justifyBoxes(rawBoxes, tajweed, size) : rawBoxes), [rawBoxes, tajweed, theme, size]);
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
      setUni(Math.max(8, Math.min(fits[Math.floor(fits.length * 0.3)], median(hs) * 0.9)));
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
      {size.w > 0 && theme && <Furniture boxes={boxes} tajweed={tajweed} theme={theme} size={size} compact={!!page && page <= 2} />}
      {size.w > 0 && boxes.map((b) => {
        const word = digitalWordsOf(tajweed, b.surah, b.ayah)?.[b.wordNo - 1];
        if (!word || b.width <= 0 || b.height <= 0) return null;
        const mark = wordMark?.(b);
        if (mark === 'hidden') return null;
        return <Word key={b.key} word={word} box={b} theme={theme} uniform={theme ? uni : null} tint={mark === 'wrong' ? '#dc2626' : undefined} wPx={(b.width / 100) * size.w} hPx={(b.height / 100) * size.h} />;
      })}
    </div>
  );
}
