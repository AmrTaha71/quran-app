// Outline icon for «صفحة جدو» (2026-11-11): an elderly man — white hair,
// white beard, glasses, no eyes. Drawn with strokes only, in the current
// colour, so it sits with the lucide icons around it.
export default function GrandpaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {/* hair: thin on top, fuller at the sides */}
      <path d="M6.2 9.2C5.2 6 7.6 3 12 3s6.8 3 5.8 6.2" />
      <path d="M8.6 4.6c.8.5 1.6.7 2.4.6M13 5.2c.9.1 1.7-.1 2.4-.6" />
      {/* face sides and ears */}
      <path d="M6.2 9.2v3.2M17.8 9.2v3.2" />
      <path d="M6.2 10.2c-1 .1-1.2 1.9 0 2.2M17.8 10.2c1 .1 1.2 1.9 0 2.2" />
      {/* glasses */}
      <circle cx="9.4" cy="10.6" r="1.9" />
      <circle cx="14.6" cy="10.6" r="1.9" />
      <path d="M11.3 10.4c.4-.4 1-.4 1.4 0" />
      {/* moustache */}
      <path d="M9.6 14.4c.9-.7 1.6-.7 2.4 0 .8-.7 1.5-.7 2.4 0" />
      {/* beard */}
      <path d="M6.2 12.4c0 5 2.4 8.6 5.8 8.6s5.8-3.6 5.8-8.6" />
      <path d="M9.4 17.2v1.6M12 17.6v2M14.6 17.2v1.6" />
    </svg>
  );
}
