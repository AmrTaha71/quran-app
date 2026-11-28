// Search-by-voice mark: an outline mic in a rounded square with a small magnifier.
// Different from the recitation mic (MicIcon) on purpose: this one searches, it does not recite.
export default function SearchMicIcon({ active = false, className }: { active?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="56" height="56" rx="16" fill="#2B1F3A" stroke="#C9A96B" strokeWidth="3" />
      <g fill="none" stroke={active ? '#C98BBE' : '#C9A96B'} strokeWidth="3.5" strokeLinecap="round" style={{ transition: 'stroke 150ms' }}>
        <rect x="22" y="13" width="14" height="24" rx="7" />
        <path d="M16 30a13 13 0 0 0 26 0M29 43v6M23 49h12" />
        <circle cx="44" cy="44" r="6" />
        <line x1="48.5" y1="48.5" x2="53" y2="53" />
      </g>
    </svg>
  );
}
