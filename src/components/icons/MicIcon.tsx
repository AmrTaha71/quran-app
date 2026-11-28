// Recitation mic: plum disc, gold mic, and three equaliser bars under it.
// The bars only move while the button is pressed (CSS in index.css), so they read as "listening".
export default function MicIcon({ active = false, className }: { active?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 64 72" className={className} aria-hidden="true" focusable="false">
      <circle cx="32" cy="30" r="28" fill="#2B1F3A" stroke="#C9A96B" strokeWidth="3" />
      <g style={{ color: active ? '#C98BBE' : '#C9A96B', transition: 'color 150ms' }} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <rect x="26" y="12" width="12" height="22" rx="6" fill="currentColor" stroke="none" />
        <path d="M20 29a12 12 0 0 0 24 0M32 41v6M25 47h14" />
      </g>
      {active && <circle cx="32" cy="30" r="25" fill="none" stroke="#6B4A8A" strokeWidth="2" />}
      <g fill="#C9A96B">
        <rect className="voice-bar" x="18" y="62" width="5" height="8" rx="2" style={{ animationDelay: '0s' }} />
        <rect className="voice-bar" x="29.5" y="62" width="5" height="8" rx="2" style={{ animationDelay: '0.15s' }} />
        <rect className="voice-bar" x="41" y="62" width="5" height="8" rx="2" style={{ animationDelay: '0.3s' }} />
      </g>
    </svg>
  );
}
