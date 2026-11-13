// صفحة جدو — flat colour portrait (2026-11-13, v6): the reference picture
// (round badge, bald head, white tufts, moustache, big ROUND white beard, no
// nose drawn) in the app palette, turned a little to the right, wearing normal
// round glasses, with a shorter round beard.
// Hand-drawn SVG, no external assets.
export default function GrandpaIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label="جدو">
      <defs>
        <linearGradient id="gp-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2E9A74" /><stop offset="1" stopColor="#0B5D40" />
        </linearGradient>
        <linearGradient id="gp-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F3D77E" /><stop offset="1" stopColor="#C8952A" />
        </linearGradient>
        <clipPath id="gp-clip"><circle cx="60" cy="60" r="58" /></clipPath>
      </defs>
      <circle cx="60" cy="60" r="58" fill="url(#gp-bg)" />
      <g clipPath="url(#gp-clip)">
        {/* soft paper shapes, as in the reference */}
        <g fill="#F4EBD3" opacity="0.14">
          <rect x="8" y="22" width="16" height="12" rx="2" transform="rotate(-20 16 28)" />
          <rect x="96" y="14" width="14" height="14" rx="2" transform="rotate(18 103 21)" />
          <rect x="6" y="72" width="14" height="11" rx="2" transform="rotate(14 13 77)" />
          <rect x="100" y="66" width="12" height="12" rx="2" transform="rotate(-12 106 72)" />
        </g>
        {/* shoulders and collar */}
        <path d="M10 126 Q16 100 60 99 Q106 100 112 126 Z" fill="#0F4A37" />
        <path d="M49 101 L61 117 L73 101 Z" fill="#F4EBD3" />
        {/* head: bald oval, turned a little right */}
        <path d="M40 46 Q38 12 64 12 Q90 14 88 46 Q88 66 74 72 Q58 78 46 68 Q40 60 40 46 Z" fill="#F6C9AC" />
        {/* near-side ear and white tuft */}
        <ellipse cx="40" cy="50" rx="4.5" ry="7" fill="#EBAF92" />
        <path d="M42 24 Q30 28 31 44 Q32 56 40 60 Q45 52 45 40 Q45 30 42 24 Z" fill="#E9EDF2" />
        {/* far-side tuft, small */}
        <path d="M84 28 Q92 32 91 44 Q90 52 85 55 Q86 42 84 28 Z" fill="#E9EDF2" />
        {/* big round beard, two tones like the reference */}
        <path d="M40 54 Q37 80 50 92 Q64 104 78 92 Q91 80 88 54 Q78 69 64 69 Q50 69 40 54 Z" fill="#F4F6F2" />
        <g transform="translate(-3 0)">
        {/* cheeks */}
        <ellipse cx="52" cy="60" rx="4.5" ry="3" fill="#F2A693" opacity="0.55" />
        <ellipse cx="78" cy="60" rx="4.5" ry="3" fill="#F2A693" opacity="0.55" />
        {/* brows and eyes */}
        <path d="M52 32 Q58 29 64 32" fill="none" stroke="#F4F6F2" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M70 32 Q76 29 82 32" fill="none" stroke="#F4F6F2" strokeWidth="2.6" strokeLinecap="round" />
        <ellipse cx="59" cy="44" rx="1.9" ry="2.5" fill="#33261E" />
        <ellipse cx="77" cy="44" rx="1.7" ry="2.4" fill="#33261E" />
        {/* normal glasses, worn on the eyes */}
        <g>
          <circle cx="57" cy="44" r="8.2" fill="#F4EBD3" opacity="0.25" />
          <circle cx="77" cy="44" r="8.2" fill="#F4EBD3" opacity="0.25" />
          <circle cx="57" cy="44" r="8.2" fill="none" stroke="url(#gp-gold)" strokeWidth="2.2" />
          <circle cx="77" cy="44" r="8.2" fill="none" stroke="url(#gp-gold)" strokeWidth="2.2" />
          <path d="M65 42.5 Q67 40.8 69 42.5" fill="none" stroke="url(#gp-gold)" strokeWidth="2" strokeLinecap="round" />
          <path d="M48.8 43 L43 40" fill="none" stroke="url(#gp-gold)" strokeWidth="2" strokeLinecap="round" />
          <path d="M85.2 43 L88 40" fill="none" stroke="url(#gp-gold)" strokeWidth="2" strokeLinecap="round" />
        </g>
        </g>
        {/* moustache */}
        <path d="M64 67 Q56 62 48 67 Q43 73 48 79 Q56 78 64 73 Q72 78 80 79 Q85 73 80 67 Q72 62 64 67 Z" fill="#FFFFFF" />
      </g>
      <circle cx="60" cy="60" r="57" fill="none" stroke="url(#gp-gold)" strokeWidth="2" />
    </svg>
  );
}
