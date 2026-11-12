// صفحة جدو — flat colour portrait (2026-11-13, replaces the outline
// drawing): a kindly old man, bald on top, white hair at the sides, full
// white beard and moustache, no eyes. App palette.
export default function GrandpaIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label="جدو">
      <defs>
        <linearGradient id="gp-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3FA784" /><stop offset="1" stopColor="#176B4B" />
        </linearGradient>
        <clipPath id="gp-clip"><circle cx="60" cy="60" r="58" /></clipPath>
      </defs>
      <circle cx="60" cy="60" r="58" fill="url(#gp-bg)" />
      <g clipPath="url(#gp-clip)">
        {/* shoulders and collar */}
        <path d="M8 126 Q12 96 60 96 Q108 96 112 126 Z" fill="#1F5A45" />
        <path d="M48 98 L60 112 L72 98 Z" fill="#F4EBD3" />
        {/* ears, small, tucked behind the hair */}
        <ellipse cx="37" cy="56" rx="3.5" ry="6" fill="#EDB296" />
        <ellipse cx="83" cy="56" rx="3.5" ry="6" fill="#EDB296" />
        {/* head: tall egg, bald */}
        <path d="M39 52 Q38 14 60 14 Q82 14 81 52 Q81 72 60 74 Q39 72 39 52 Z" fill="#F6C9AC" />
        {/* side hair: soft tufts over the ears */}
        <path d="M40 30 Q30 34 31 48 Q31 58 37 62 Q41 52 41 40 Z" fill="#FBFBF7" />
        <path d="M80 30 Q90 34 89 48 Q89 58 83 62 Q79 52 79 40 Z" fill="#FBFBF7" />
        {/* long beard */}
        <path d="M38 54 Q32 86 46 104 Q54 114 60 114 Q66 114 74 104 Q88 86 82 54 Q78 64 60 64 Q42 64 38 54 Z" fill="#FBFBF7" />
        <path d="M60 66 Q58 92 60 114 Q68 112 74 104 Q82 92 82 70 Q74 66 60 66 Z" fill="#EEF0EB" />
        {/* nose */}
        <path d="M57 48 Q60 44 63 48 Q64 56 60 57 Q56 56 57 48 Z" fill="#EDB296" />
        {/* drooping moustache */}
        <path d="M60 58 Q52 54 45 60 Q41 64 43 70 Q50 68 55 64 Q58 62 60 62 Q62 62 65 64 Q70 68 77 70 Q79 64 75 60 Q68 54 60 58 Z" fill="#FFFFFF" />
        {/* cheeks */}
        <ellipse cx="46" cy="52" rx="4" ry="2.5" fill="#F2A693" opacity="0.5" />
        <ellipse cx="74" cy="52" rx="4" ry="2.5" fill="#F2A693" opacity="0.5" />
        {/* brows */}
        <path d="M45 40 Q50 37 55 40" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
        <path d="M65 40 Q70 37 75 40" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx="60" cy="60" r="57" fill="none" stroke="#E2C46E" strokeWidth="1.5" opacity="0.8" />
    </svg>
  );
}
