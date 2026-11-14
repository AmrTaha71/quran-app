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

/** Mushaf: an open Quran — two facing pages, a gilded centre spine and a small star on the right page. */
export function MushafIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M12 6.2C10 4.6 7 4.2 3.8 4.8v13c3.2-.6 6.2-.2 8.2 1.4 2-1.6 5-2 8.2-1.4v-13C17 4.2 14 4.6 12 6.2Z" />
      <path d="M12 6.2v13" />
      <path d="M6 8.4c1.3-.2 2.7-.1 4 .3M6 11.2c1.3-.2 2.7-.1 4 .3M6 14c1.3-.2 2.7-.1 4 .3" />
      <path d="m16 8.2.8 1.6 1.7.2-1.3 1.2.3 1.7-1.5-.8-1.5.8.3-1.7-1.3-1.2 1.7-.2Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Recite-to-me: an ear with sound waves. */
export function EarListenIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M8 18.5c-1-1.2-1.2-2.2-1.2-3.5C6.8 11.5 9 11 9 8.6A3.6 3.6 0 0 1 12.6 5 3.6 3.6 0 0 1 16.2 8.6c0 2.4-3 3-3 5.4 0 1.5-.8 2.6-1.8 3" />
      <path d="M9.6 9.6a2.6 2.6 0 0 1 2.6-2.6" />
      <path d="M18.6 6.4a6.4 6.4 0 0 1 0 6.4M20.8 4.4a9.4 9.4 0 0 1 0 10.4" />
    </svg>
  );
}
