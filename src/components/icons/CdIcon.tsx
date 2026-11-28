// Shiny CD for the listen entry. Rotation + sheen are CSS-only and run only
// when `spinning` (class names contain "animate-" so reduced-motion turns them off).
export default function CdIcon({ spinning = false, className }: { spinning?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="cd-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4A2F66" />
          <stop offset="0.5" stopColor="#C9A96B" />
          <stop offset="1" stopColor="#2B1F3A" />
        </linearGradient>
        <linearGradient id="cd-sheen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFF4D6" stopOpacity="0" />
          <stop offset="0.5" stopColor="#FFF4D6" stopOpacity="0.85" />
          <stop offset="1" stopColor="#FFF4D6" stopOpacity="0" />
        </linearGradient>
        <clipPath id="cd-clip"><circle cx="32" cy="32" r="29" /></clipPath>
      </defs>
      <g className={spinning ? 'animate-cd-spin' : undefined} style={{ transformOrigin: '32px 32px' }}>
        <circle cx="32" cy="32" r="29" fill="url(#cd-body)" stroke="#C9A96B" strokeWidth="1.5" />
        <circle cx="32" cy="32" r="21" fill="none" stroke="#FFF4D6" strokeOpacity="0.25" />
        <circle cx="32" cy="32" r="14" fill="none" stroke="#FFF4D6" strokeOpacity="0.18" />
      </g>
      <g clipPath="url(#cd-clip)">
        <rect x="-10" y="0" width="22" height="64" fill="url(#cd-sheen)" className={spinning ? 'animate-cd-sheen' : undefined} />
      </g>
      <circle cx="32" cy="32" r="8" fill="#F4EDE4" stroke="#C9A96B" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="3" fill="#2B1F3A" />
    </svg>
  );
}
