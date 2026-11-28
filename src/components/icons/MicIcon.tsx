// Big mic in a plum circle with a gold rim. Gold at rest, rose-violet when `active`.
export default function MicIcon({ active = false, className }: { active?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="29" fill="#2B1F3A" stroke="#C9A96B" strokeWidth="3" />
      <g style={{ color: active ? '#C98BBE' : '#C9A96B', transition: 'color 150ms' }} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <rect x="26" y="14" width="12" height="22" rx="6" fill="currentColor" stroke="none" />
        <path d="M20 31a12 12 0 0 0 24 0M32 43v7M25 50h14" />
      </g>
      {active && <circle cx="32" cy="32" r="26" fill="none" stroke="#6B4A8A" strokeWidth="2" />}
    </svg>
  );
}
