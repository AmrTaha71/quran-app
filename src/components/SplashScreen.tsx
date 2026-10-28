import { useEffect, useState } from 'react';

// Branded launch screen for "روابط الذكر الحكيم" — the artwork
// ITSELF, not a redraw: the centerpiece is /icon-512.png, the very
// image that is also the app icon (generated at build time from the
// base64 artwork in scripts/logo-art). The artwork already carries
// the app name in gold calligraphy, so the splash adds only the
// tagline below it — no second name, no progress bar, no %.
//
// Interface kept compatible with the old splash so App.tsx needs no
// changes: `duration` (default 2000ms) is how long the splash stays
// fully visible, then it fades 500ms and calls `onFinish`. `message`
// overrides the tagline (the auth flash passes its own line).
export default function SplashScreen({ onFinish, duration = 2000, message }: { onFinish: () => void; duration?: number; message?: string }) {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const show = setTimeout(() => setFadeOut(true), duration);
    const done = setTimeout(onFinish, duration + 500);
    return () => { clearTimeout(show); clearTimeout(done); };
  }, [duration, onFinish]);

  return (
    <div
      dir="rtl"
      lang="ar"
      aria-hidden="true"
      className="rq-splash"
      style={{ opacity: fadeOut ? 0 : 1 }}
    >
      <style>{`
        .rq-splash {
          position: fixed; inset: 0; z-index: 100;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          background:
            radial-gradient(ellipse 90% 65% at 50% 38%, rgba(255, 235, 180, 0.10), rgba(255, 235, 180, 0) 60%),
            linear-gradient(160deg, #0b7a5e 0%, #065f46 45%, #043d30 100%);
          font-family: 'Noto Naskh Arabic', 'Traditional Naskh Arabic', serif;
          transition: opacity 500ms ease;
        }
        .rq-splash-pattern { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.055; }
        .rq-splash-frame-outer {
          position: absolute; inset: 16px;
          border: 1px solid rgba(240, 200, 90, 0.45);
          border-radius: 24px;
          animation: rq-splash-frame-in 1.1s ease both;
        }
        .rq-splash-frame-inner {
          position: absolute; inset: 23px;
          border: 1px solid rgba(240, 200, 90, 0.22);
          border-radius: 19px;
        }
        .rq-splash-corner {
          position: absolute; width: 10px; height: 10px;
          background: #f0c85a; transform: rotate(45deg);
          box-shadow: 0 0 10px rgba(240, 200, 90, 0.7);
        }
        .rq-splash-corner.tl { top: 11px; right: 11px; }
        .rq-splash-corner.tr { top: 11px; left: 11px; }
        .rq-splash-corner.bl { bottom: 11px; right: 11px; }
        .rq-splash-corner.br { bottom: 11px; left: 11px; }
        .rq-splash-inner {
          position: relative; z-index: 1;
          display: flex; flex-direction: column; align-items: center;
          padding: 32px 24px; max-width: 92vw; text-align: center;
        }
        .rq-splash-glow {
          position: absolute; left: 50%; top: 38%; width: 340px; height: 340px;
          transform: translate(-50%, -50%);
          background: radial-gradient(circle, rgba(240, 200, 90, 0.20), rgba(240, 200, 90, 0) 65%);
          animation: rq-splash-glow 3.2s ease-in-out infinite alternate;
          pointer-events: none;
        }
        .rq-splash-logo {
          width: min(300px, 76vw);
          animation: rq-splash-rise 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
          animation-delay: 0.05s;
        }
        .rq-splash-logo > * { width: 100%; height: auto; display: block; border-radius: 24px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35); }
        .rq-splash-divider {
          display: flex; align-items: center; gap: 12px; width: min(240px, 60vw);
          margin: 26px 0 18px;
          animation: rq-splash-rise 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
          animation-delay: 0.35s;
        }
        .rq-splash-divider::before, .rq-splash-divider::after {
          content: ''; flex: 1; height: 1px;
          background: linear-gradient(90deg, rgba(240, 200, 90, 0), #f0c85a, rgba(240, 200, 90, 0));
          transform-origin: center;
          animation: rq-splash-open 1s ease both;
          animation-delay: 0.35s;
        }
        .rq-splash-divider i {
          width: 8px; height: 8px; background: #f0c85a; transform: rotate(45deg); flex: none;
        }
        .rq-splash-tagline {
          margin: 0; color: rgba(248, 241, 222, 0.92);
          font-size: clamp(17px, 4.5vw, 22px); line-height: 1.6;
          animation: rq-splash-rise 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
          animation-delay: 0.75s;
        }
        @keyframes rq-splash-rise {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes rq-splash-open {
          from { transform: scaleX(0); opacity: 0; }
          to { transform: scaleX(1); opacity: 1; }
        }
        @keyframes rq-splash-frame-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes rq-splash-glow {
          from { opacity: 0.7; }
          to { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .rq-splash *, .rq-splash *::before, .rq-splash *::after { animation: none !important; }
        }
      `}</style>

      {/* Faint arabesque lattice: 8-point stars tiled over the gradient. */}
      <svg className="rq-splash-pattern" aria-hidden="true">
        <defs>
          <pattern id="rq-splash-arabesque" width="96" height="96" patternUnits="userSpaceOnUse">
            <g fill="none" stroke="#f0c85a" strokeWidth="1">
              <rect x="28" y="28" width="40" height="40" />
              <rect x="28" y="28" width="40" height="40" transform="rotate(45 48 48)" />
              <circle cx="48" cy="48" r="6" />
            </g>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#rq-splash-arabesque)" />
      </svg>

      <div className="rq-splash-frame-outer" />
      <div className="rq-splash-frame-inner" />
      <i className="rq-splash-corner tl" />
      <i className="rq-splash-corner tr" />
      <i className="rq-splash-corner bl" />
      <i className="rq-splash-corner br" />

      <div className="rq-splash-inner">
        <div className="rq-splash-glow" />
        <div className="rq-splash-logo">
          <img src="/icon-512.png" alt="روابط الذكر الحكيم" />
        </div>
        <div className="rq-splash-divider"><i /></div>
        <p className="rq-splash-tagline">{message || 'احفظها بالتربيط'}</p>
      </div>
    </div>
  );
}
