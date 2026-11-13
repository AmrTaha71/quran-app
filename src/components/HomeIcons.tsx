// Home-tile icons drawn here (lucide has no mosque with a round dome, and
// no "headphones + mic" for سمّع لي). Same 24px stroke style as lucide.
import type { SVGProps } from 'react';

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Mosque: round dome with crescent, two minarets, arched door. */
export function MosqueIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M7 13a5 5 0 0 1 10 0" />
      <path d="M12 8V6" />
      <path d="M13.3 3.6a1.6 1.6 0 1 1-1.9-.6 1.2 1.2 0 0 0 1.9.6z" />
      <path d="M6.5 13v7M17.5 13v7" />
      <path d="M10.2 20v-3a1.8 1.8 0 0 1 3.6 0v3" />
      <path d="M3.2 20V10M20.8 20V10" />
      <path d="M2.2 10l1-2.8 1 2.8zM19.8 10l1-2.8 1 2.8z" fill="currentColor" />
      <path d="M1.5 20h21" />
    </svg>
  );
}

/** Reciter: head with headphones on the ears and a mic in front of the mouth. */
export function ListenerMicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="11" r="4" />
      <path d="M5.5 12.5a6.5 6.5 0 0 1 13 0" />
      <rect x="3.6" y="11.2" width="3" height="5.2" rx="1.4" fill="currentColor" />
      <rect x="17.4" y="11.2" width="3" height="5.2" rx="1.4" fill="currentColor" />
      <path d="M19 16.4c0 2.6-2.3 4-5.2 4" />
      <rect x="10.3" y="19" width="3.6" height="3" rx="1.5" fill="currentColor" />
    </svg>
  );
}
