// صفحة جدو — flat colour portrait (2026-11-13, replaces the outline
// drawing): a kindly old man, bald on top, white hair at the sides, full
// white beard and moustache, round glasses, no eyes. App palette.
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
        {/* soft glow behind the head */}
        <circle cx="60" cy="52" r="40" fill="#FFFFFF" opacity="0.10" />
        {/* shoulders */}
        <path d="M10 124 Q14 92 60 92 Q106 92 110 124 Z" fill="#F4EBD3" />
        {/* side hair: soft clouds */}
        <path d="M34 34 Q22 38 24 52 Q22 64 32 68 Q38 60 38 46 Z" fill="#FBFBF7" />
        <path d="M86 34 Q98 38 96 52 Q98 64 88 68 Q82 60 82 46 Z" fill="#FBFBF7" />
        {/* ears */}
        <ellipse cx="33" cy="60" rx="4.5" ry="6" fill="#EDB296" />
        <ellipse cx="87" cy="60" rx="4.5" ry="6" fill="#EDB296" />
        {/* head: round and soft */}
        <path d="M35 56 Q34 22 60 22 Q86 22 85 56 Q86 84 60 86 Q34 84 35 56 Z" fill="#F6C9AC" />
        {/* cheeks */}
        <circle cx="44" cy="66" r="6" fill="#F2A693" opacity="0.55" />
        <circle cx="76" cy="66" r="6" fill="#F2A693" opacity="0.55" />
        {/* beard: full and round */}
        <path d="M34 62 Q28 92 44 104 Q52 112 60 110 Q68 112 76 104 Q92 92 86 62 Q80 74 60 74 Q40 74 34 62 Z" fill="#FBFBF7" />
        <path d="M46 92 Q52 98 60 96 Q68 98 74 92" fill="none" stroke="#E9ECE6" strokeWidth="2" strokeLinecap="round" />
        {/* gentle smile under the moustache */}
        <path d="M54 76 Q60 81 66 76" fill="none" stroke="#D98E78" strokeWidth="2" strokeLinecap="round" />
        {/* moustache: two soft curls */}
        <path d="M60 68 Q52 62 44 68 Q40 71 42 75 Q52 78 60 72 Q68 78 78 75 Q80 71 76 68 Q68 62 60 68 Z" fill="#FFFFFF" />
        {/* bushy brows */}
        <path d="M41 44 Q48 39 56 44" fill="none" stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M64 44 Q72 39 79 44" fill="none" stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" />
        {/* glasses: thin and light */}
        <g fill="rgba(255,255,255,0.45)" stroke="#C9A24A" strokeWidth="1.4">
          <circle cx="49" cy="55" r="8" /><circle cx="71" cy="55" r="8" />
        </g>
        <path d="M57 55 Q60 52.5 63 55" fill="none" stroke="#C9A24A" strokeWidth="1.4" strokeLinecap="round" />
      </g>
      <circle cx="60" cy="60" r="57" fill="none" stroke="#E2C46E" strokeWidth="1.5" opacity="0.8" />
    </svg>
  );
}
