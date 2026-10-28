import { useId } from 'react';

// EmblemMedallion — the app's logo system (winner of the 2026-10-28
// beauty round: judged by eye from renders at 64/180/360px against
// the other three concepts — classic, modern, calligraphy).
//
// Concept: "a star rising from the open Book". One single fused
// mark, not two floating elements: a solid 8-point star whose bottom
// point sinks into the dip of a bold open Mushaf, so star and book
// read as one gold shape. Built to be gorgeous FIRST at 60px
// home-screen size: only bold elements, gold covering ~40% of the
// disc, cream only as the books' pages (pure negative space), no
// text in the icon variant.
//
// Integration upgrades over the concept draft:
//   - Page edges are bezier curves (Q), not straight lines: the
//     cover and page top edges curl down toward the spine, so the
//     book reads as a book, not a tent.
//   - The name uses the named Noto Naskh Arabic face (already loaded
//     by index.css) instead of a generic serif fallback.
// Variants:
//   - "icon"   (default): the medallion alone on transparency — the
//     home-screen / PWA icon and the header/start-page mark.
//   - "splash": the same medallion on a deep-emerald panel with the
//     app name in gold below it — for the splash screen.
// Palette is gold / emerald / cream only. Self-contained: no imports
// beyond React, no external assets.
export default function EmblemMedallion({
  variant = 'icon',
  className = '',
}: {
  variant?: 'icon' | 'splash';
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const goldId = `medallion-gold-${uid}`;
  const emeraldId = `medallion-emerald-${uid}`;
  const displayFont = "'Noto Naskh Arabic', 'Traditional Naskh Arabic', serif";

  // Shared medallion geometry (viewBox 240, center 120,120).
  const medallion = (
    <>
      {/* Emerald disc: luminous center, dark jewel rim (not flat). */}
      <circle cx="120" cy="120" r="118" fill={`url(#${emeraldId})`} />
      {/* Thick coin frame band + one bright hairline. */}
      <circle cx="120" cy="120" r="110" fill="none" stroke={`url(#${goldId})`} strokeWidth="14" />
      <circle cx="120" cy="120" r="100" fill="none" stroke="#f0c85a" strokeWidth="2.5" opacity="0.9" />
      {/* Filled 8-point star: square + diamond (diamond circumradius
          = square half-side x sqrt(2), so its points poke out of the
          square's edges and the square's corners poke out of the
          diamond — 8 points total). Center (120,88), half-side 25. */}
      <g fill={`url(#${goldId})`}>
        <rect x="95" y="63" width="50" height="50" />
        <polygon points="120,52.6 155.4,88 120,123.4 84.6,88" />
      </g>
      {/* Jewel heart: small emerald diamond at the star's center. */}
      <polygon points="120,79 129,88 120,97 111,88" fill="#065f46" />
      {/* Open Mushaf: bold gold cover, cream pages, gold spine.
          Center (120,146), width 150, height 84. Top edges are
          bezier curves that curl down toward the spine (the star's
          bottom point, 123.4, sinks into the dip, fusing star and
          book into one mark); bottom edges stay straight. */}
      <g fill={`url(#${goldId})`}>
        <path d="M120 120 Q82 116 45 104 L45 188 L120 188 Z" />
        <path d="M120 120 Q158 116 195 104 L195 188 L120 188 Z" />
      </g>
      <g fill="#f8f1de">
        <path d="M120 130 Q87 126 55 116 L55 178 L120 178 Z" />
        <path d="M120 130 Q153 126 185 116 L185 178 L120 178 Z" />
      </g>
      <rect x="116" y="120" width="8" height="68" fill={`url(#${goldId})`} />
    </>
  );

  if (variant === 'splash') {
    return (
      <svg viewBox="0 0 240 300" className={className} role="img" aria-label="روابط الذكر الحكيم">
        <defs>
          <linearGradient id={goldId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f9e08a" />
            <stop offset="45%" stopColor="#f0c85a" />
            <stop offset="100%" stopColor="#c9932b" />
          </linearGradient>
          <radialGradient id={emeraldId} cx="50%" cy="42%" r="72%">
            <stop offset="0%" stopColor="#13946e" />
            <stop offset="55%" stopColor="#065f46" />
            <stop offset="100%" stopColor="#033b2a" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="240" height="300" rx="28" fill="#04402e" />
        {medallion}
        <line x1="84" y1="256" x2="156" y2="256" stroke="#f0c85a" strokeWidth="2" />
        <rect x="116.5" y="252.5" width="7" height="7" fill="#f0c85a" transform="rotate(45 120 256)" />
        <text x="120" y="284" textAnchor="middle" fontSize="21" fill="#f0c85a" fontFamily={displayFont}>
          روابط الذكر الحكيم
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 240 240" className={className} role="img" aria-label="روابط الذكر الحكيم">
      <defs>
        <linearGradient id={goldId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f9e08a" />
          <stop offset="45%" stopColor="#f0c85a" />
          <stop offset="100%" stopColor="#c9932b" />
        </linearGradient>
        <radialGradient id={emeraldId} cx="50%" cy="42%" r="72%">
          <stop offset="0%" stopColor="#13946e" />
          <stop offset="55%" stopColor="#065f46" />
          <stop offset="100%" stopColor="#033b2a" />
        </radialGradient>
      </defs>
      {medallion}
    </svg>
  );
}
