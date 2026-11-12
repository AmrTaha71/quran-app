// صفحة جدو — flat colour portrait (2026-11-13, replaces the outline
// drawing): a kindly old man, bald on top, white hair at the sides, full
// white beard and moustache, round glasses, no eyes. App palette.
export default function GrandpaIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label="جدو">
      <defs>
        <linearGradient id="gp-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1B8A62" /><stop offset="1" stopColor="#0B4D33" />
        </linearGradient>
        <clipPath id="gp-clip"><circle cx="60" cy="60" r="58" /></clipPath>
      </defs>
      <circle cx="60" cy="60" r="58" fill="url(#gp-bg)" />
      <g clipPath="url(#gp-clip)">
        {/* shoulders */}
        <path d="M14 122 Q16 92 60 90 Q104 92 106 122 Z" fill="#F4EBD3" />
        <path d="M50 92 L60 104 L70 92 Z" fill="#E2C46E" />
        {/* side hair */}
        <ellipse cx="33" cy="50" rx="8" ry="15" fill="#F7F7F2" />
        <ellipse cx="87" cy="50" rx="8" ry="15" fill="#F7F7F2" />
        {/* ears */}
        <ellipse cx="34" cy="60" rx="4.5" ry="6.5" fill="#E9A888" />
        <ellipse cx="86" cy="60" rx="4.5" ry="6.5" fill="#E9A888" />
        {/* head */}
        <path d="M36 54 Q36 20 60 20 Q84 20 84 54 L84 70 Q84 84 60 84 Q36 84 36 70 Z" fill="#F3BFA0" />
        {/* cheeks */}
        <ellipse cx="45" cy="66" rx="5" ry="3" fill="#EFA58E" opacity="0.7" />
        <ellipse cx="75" cy="66" rx="5" ry="3" fill="#EFA58E" opacity="0.7" />
        {/* beard */}
        <path d="M36 64 Q34 100 60 110 Q86 100 84 64 Q80 76 60 76 Q40 76 36 64 Z" fill="#F7F7F2" />
        <path d="M60 78 Q57 96 60 110 Q72 104 78 90 Q70 82 60 78 Z" fill="#E4E7E2" />
        {/* moustache */}
        <path d="M42 72 Q50 62 60 68 Q70 62 78 72 Q68 76 60 72 Q52 76 42 72 Z" fill="#FFFFFF" />
        {/* glasses */}
        <g fill="rgba(255,255,255,0.35)" stroke="#5E3208" strokeWidth="2.2">
          <circle cx="49" cy="54" r="8" /><circle cx="71" cy="54" r="8" />
        </g>
        <path d="M57 54 Q60 51 63 54" fill="none" stroke="#5E3208" strokeWidth="2.2" />
      </g>
      <circle cx="60" cy="60" r="57" fill="none" stroke="#E2C46E" strokeWidth="2" />
    </svg>
  );
}
