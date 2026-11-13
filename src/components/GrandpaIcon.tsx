// صفحة جدو — flat colour portrait (2026-11-13, v5): same composition as the
// reference (round badge, bald head with white tufts, big white beard and
// moustache, shoulders), in the app palette (emerald, gold, cream). He is
// turned to the right and holds his glasses a little way out from his face.
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
          <rect x="8" y="20" width="16" height="12" rx="2" transform="rotate(-20 16 26)" />
          <rect x="96" y="12" width="14" height="14" rx="2" transform="rotate(18 103 19)" />
          <rect x="6" y="74" width="14" height="11" rx="2" transform="rotate(14 13 79)" />
          <rect x="100" y="70" width="12" height="12" rx="2" transform="rotate(-12 106 76)" />
        </g>
        {/* shoulders and collar */}
        <path d="M8 124 Q14 100 56 99 Q104 100 112 124 Z" fill="#0F4A37" />
        <path d="M46 100 L58 116 L70 100 Z" fill="#F4EBD3" />
        <g transform="translate(-9 4)">
        {/* far-side hair tuft (small: he is turned right) */}
        <path d="M80 30 Q90 32 90 44 Q90 52 84 56 Q82 46 80 30 Z" fill="#F4F6F2" />
        {/* head: tall bald oval, shifted right */}
        <path d="M38 46 Q36 14 62 13 Q88 14 86 46 Q86 66 72 74 Q56 80 44 68 Q38 60 38 46 Z" fill="#F6C9AC" />
        {/* ear on the near side (left) */}
        <ellipse cx="38" cy="50" rx="4.5" ry="7" fill="#EBAF92" />
        <ellipse cx="38.5" cy="50.5" rx="2" ry="4" fill="#D99779" />
        {/* near-side hair tuft over the ear */}
        <path d="M40 26 Q28 30 29 46 Q30 58 38 62 Q42 54 43 42 Q43 32 40 26 Z" fill="#FFFFFF" />
        <path d="M37 60 Q32 68 38 74 Q43 70 45 62 Z" fill="#E9ECE6" />
        {/* beard */}
        <path d="M40 58 Q34 92 52 108 Q64 118 76 108 Q92 94 86 58 Q82 70 62 70 Q46 70 40 58 Z" fill="#FFFFFF" />
        <path d="M64 70 Q60 96 64 112 Q80 108 88 92 Q92 76 87 61 Q80 70 64 70 Z" fill="#E4E8E1" />
        {/* nose, turned toward the right */}
        <path d="M76 46 Q86 50 86 57 Q84 62 77 60 Q72 54 76 46 Z" fill="#EBAF92" />
        {/* cheek */}
        <ellipse cx="55" cy="57" rx="4" ry="2.6" fill="#F2A693" opacity="0.5" />
        {/* moustache */}
        <path d="M66 62 Q58 57 50 63 Q46 69 50 75 Q57 73 62 69 Q66 67 69 67 Q73 67 77 70 Q83 74 87 71 Q89 65 83 62 Q74 56 66 62 Z" fill="#FFFFFF" />
        {/* brows and eyes */}
        <path d="M52 38 Q57 35 62 38" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
        <path d="M71 38 Q76 35 81 38" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="58" cy="46" rx="2" ry="2.7" fill="#33261E" />
        <ellipse cx="75" cy="46" rx="1.8" ry="2.6" fill="#33261E" />
        {/* the glasses: lifted off the face, tilted, held by the arm */}
        <g transform="rotate(-10 92 27)">
          <circle cx="83" cy="27" r="7.5" fill="#F4EBD3" opacity="0.3" />
          <circle cx="100" cy="27" r="7.5" fill="#F4EBD3" opacity="0.3" />
          <circle cx="83" cy="27" r="7.5" fill="none" stroke="url(#gp-gold)" strokeWidth="2.2" />
          <circle cx="100" cy="27" r="7.5" fill="none" stroke="url(#gp-gold)" strokeWidth="2.2" />
          <path d="M90.5 25.5 Q91.5 24 92.5 25.5" fill="none" stroke="url(#gp-gold)" strokeWidth="2" strokeLinecap="round" />
          <path d="M107.5 27 L109 40" fill="none" stroke="url(#gp-gold)" strokeWidth="2" strokeLinecap="round" />
        </g>
        {/* hand pinching the arm of the glasses */}
        <ellipse cx="105" cy="45" rx="6.5" ry="5" fill="#F0B898" />
        <path d="M99 42 Q103 38 108 40" fill="none" stroke="#E2A183" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M100 48 Q104 52 110 49" fill="none" stroke="#E2A183" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      </g>
      <circle cx="60" cy="60" r="57" fill="none" stroke="url(#gp-gold)" strokeWidth="2" />
    </svg>
  );
}
