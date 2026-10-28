// Big start-page logo: a large SVG version of the luxurious AI logo
// (open gold Mushaf on a stand, gold 8-point star, name below) —
// drawn in code, because PNG files cannot be committed to the repo.
// Used once, at the top of the start page (HomeStartPage).
export default function AppLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 432" className={className} role="img" aria-label="روابط الذكر الحكيم">
      <defs>
        <radialGradient id="applogo-emerald" cx="50%" cy="42%" r="75%">
          <stop offset="0%" stopColor="#0b7a5e" />
          <stop offset="100%" stopColor="#04543c" />
        </radialGradient>
      </defs>
      {/* Cream ornamental frame */}
      <rect x="8" y="8" width="384" height="416" rx="56" fill="#f8f1de" stroke="#f0c85a" strokeWidth="3" />
      <rect x="24" y="24" width="352" height="384" rx="44" fill="none" stroke="#f0c85a" strokeWidth="1.5" />
      {/* Emerald disc */}
      <circle cx="200" cy="185" r="145" fill="url(#applogo-emerald)" />
      <circle cx="200" cy="185" r="135" fill="none" stroke="#f0c85a" strokeWidth="4" />
      <circle cx="200" cy="185" r="127" fill="none" stroke="#f0c85a" strokeWidth="2" />
      {/* 12 gold dots between the rings */}
      <g fill="#f0c85a">
        <circle cx="331" cy="185" r="3.5" /><circle cx="313" cy="250" r="3.5" /><circle cx="265" cy="298" r="3.5" />
        <circle cx="200" cy="316" r="3.5" /><circle cx="135" cy="298" r="3.5" /><circle cx="87" cy="250" r="3.5" />
        <circle cx="69" cy="185" r="3.5" /><circle cx="87" cy="120" r="3.5" /><circle cx="135" cy="72" r="3.5" />
        <circle cx="200" cy="54" r="3.5" /><circle cx="265" cy="72" r="3.5" /><circle cx="313" cy="120" r="3.5" />
      </g>
      {/* Filled 8-point star: square + diamond */}
      <g fill="#f0c85a">
        <rect x="178" y="68" width="44" height="44" />
        <rect x="178" y="68" width="44" height="44" transform="rotate(45 200 90)" />
      </g>
      {/* Open Mushaf: gold binding, cream pages, gold spine, stand */}
      <path d="M200 170 L105 148 L105 240 L200 262 Z" fill="#f0c85a" stroke="#f0c85a" strokeWidth="4" strokeLinejoin="round" />
      <path d="M200 170 L295 148 L295 240 L200 262 Z" fill="#f0c85a" stroke="#f0c85a" strokeWidth="4" strokeLinejoin="round" />
      <path d="M200 182 L120 160 L120 230 L200 250 Z" fill="#f8f1de" />
      <path d="M200 182 L280 160 L280 230 L200 250 Z" fill="#f8f1de" />
      <g stroke="#c9a227" strokeWidth="2" opacity="0.8">
        <line x1="132" y1="172" x2="188" y2="188" />
        <line x1="132" y1="187" x2="188" y2="203" />
        <line x1="132" y1="202" x2="188" y2="218" />
        <line x1="268" y1="172" x2="212" y2="188" />
        <line x1="268" y1="187" x2="212" y2="203" />
        <line x1="268" y1="202" x2="212" y2="218" />
      </g>
      <line x1="200" y1="170" x2="200" y2="262" stroke="#f0c85a" strokeWidth="6" />
      {/* Stand (rehal): crossed legs + foot */}
      <g stroke="#f0c85a" strokeWidth="6" strokeLinecap="round">
        <line x1="162" y1="272" x2="238" y2="308" />
        <line x1="238" y1="272" x2="162" y2="308" />
      </g>
      <line x1="160" y1="312" x2="240" y2="312" stroke="#f0c85a" strokeWidth="4" strokeLinecap="round" />
      {/* Divider + name below the disc */}
      <line x1="140" y1="352" x2="260" y2="352" stroke="#f0c85a" strokeWidth="2" />
      <rect x="196" y="348" width="8" height="8" fill="#f0c85a" transform="rotate(45 200 352)" />
      <text x="200" y="390" textAnchor="middle" fontSize="32" fill="#065f46" fontFamily="serif">روابط الذكر الحكيم</text>
    </svg>
  );
}
