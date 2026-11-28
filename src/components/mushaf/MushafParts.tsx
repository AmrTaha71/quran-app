// 10.7 (phase 6, first step): the Mushaf page's small self-contained parts,
// moved out of QuranMushafPage.tsx unchanged: the worship timer and the two
// page-image components with their retry/mirror logic.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Clock } from 'lucide-react';

const WORSHIP_STORAGE_KEY = 'quran-worship-seconds';

// Worship timer: counts the time the reader actually spends in the
// Mushaf, and keeps the total across visits (localStorage). It ticks in
// its own component so the once-a-30s update never re-renders the page,
// and it pauses while the tab is hidden, so only real devotion time is
// counted. Render it in exactly ONE place at a time (normal toolbar XOR
// fullscreen pill) — the normal view stays mounted under fullscreen,
// so two instances would double-count.
function formatWorship(totalSeconds: number): string {
  if (totalSeconds < 60) return 'أقل من دقيقة';
  const m = Math.floor(totalSeconds / 60);
  if (m < 60) return `${m} دقيقة`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h} ساعة` : `${h} ساعة و ${mm} دقيقة`;
}

export function WorshipTimer({ dark, flash }: { dark?: boolean; flash?: boolean }) {
  // flash: the pill fades in for a few seconds, then out, again and again.
  const [vis, setVis] = useState(!flash);
  useEffect(() => {
    if (!flash) return;
    let t2: number | undefined;
    const cycle = () => { setVis(true); t2 = window.setTimeout(() => setVis(false), 6000); };
    const t1 = window.setTimeout(cycle, 1500);
    const iv = window.setInterval(cycle, 45000);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); window.clearInterval(iv); };
  }, [flash]);
  const [total, setTotal] = useState<number>(() => {
    try { return Number(localStorage.getItem(WORSHIP_STORAGE_KEY)) || 0; } catch { return 0; }
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setTotal((t) => t + 30);
      try {
        const next = (Number(localStorage.getItem(WORSHIP_STORAGE_KEY)) || 0) + 30;
        localStorage.setItem(WORSHIP_STORAGE_KEY, String(next));
      } catch { /* storage full or blocked */ }
    }, 30000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap transition-opacity duration-700 ${vis ? 'opacity-100' : 'opacity-0'} ${dark ? 'bg-black/60 text-white ring-1 ring-white/40' : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'}`} title="وقتك في التعبّد بحفظ كتاب الله">
      <Clock className="w-4 h-4" />
      بقالك {formatWorship(total)}<span className="hidden sm:inline"> بتتعبد بقراءة القرآن الكريم</span>
    </span>
  );
}

// Facing-page strip image with deterministic presence. A transient
// load failure used to hide the strip silently (onError ->
// display:none), so the strip popped in and out page by page and
// read as a shake while flipping. Now a first failure retries once
// with a cache-busting URL (bypasses any bad cache entry and
// re-attempts transient network failures); a second failure renders
// a placeholder with the facing page number instead of vanishing,
// so the strip is always present. Keyed by facing page at the call
// site, so the attempt state resets on every page turn.
// jsdelivr occasionally answers "Package size exceeded" 404 for files
// that exist (measured ~12% of first attempts from one network); the
// same file is also served from raw.githubusercontent, so after the
// jsdelivr retries the image falls back to the other host instead of
// failing. Only the Madinah sufone path has a known mirror.
function madinahFallbackSrc(src: string): string | null {
  const prefix = 'https://cdn.jsdelivr.net/gh/sufone/medina-mushaf@master/';
  return src.startsWith(prefix) ? src.replace(prefix, 'https://raw.githubusercontent.com/sufone/medina-mushaf/master/') : null;
}

export function FacingStripImg({ src, pageNo, className, style }: {
  src: string;
  pageNo: number;
  className: string;
  style: CSSProperties | undefined;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#f5f0e1]">
        <span className="text-[#8a7a4a] font-bold text-2xl">{pageNo}</span>
      </div>
    );
  }
  const fallback = madinahFallbackSrc(src);
  const url = attempt === 0 ? src : attempt === 1 ? `${src}${src.includes('?') ? '&' : '?'}sw-retry=1` : fallback!;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      onError={() => { if (attempt === 0) setAttempt(1); else if (attempt === 1 && fallback) setAttempt(2); else setFailed(true); }}
      className={`mushaf-scan ${className}`}
      style={style}
    />
  );
}

// Main page image with automatic retries. A single transient failure
// (a network wobble while flipping fast) used to flip the whole page
// straight into the error block, so several pages in one flipping
// session ended up "not loaded", each waiting for a manual retry tap.
// Now the image retries twice on its own — first immediately with a
// cache-busting URL, then once more after a short delay for brief
// network drops — then falls back to the raw.githubusercontent mirror
// for Madinah pages, and only then reports failure, so the existing
// error block + manual retry stay as the last resort, not the first
// response. Keyed by page at the call site, so attempts reset on
// every turn, and the delay timer is cleared on unmount.
export function RetryPageImg({ src, alt, className, style, loading, onLoad, onFinalError }: {
  src: string;
  alt: string;
  className: string;
  style: CSSProperties | undefined;
  loading?: 'eager' | 'lazy';
  onLoad?: (e: { currentTarget: HTMLImageElement }) => void;
  onFinalError: () => void;
}) {
  // FLASH FIX 2026-11-10: the element is no longer remounted per page
  // (that dropped the old frame and showed a blank beat on every turn).
  // It keeps its node and only swaps src, so the previous picture stays
  // painted until the new one is ready; retry attempts reset per src.
  const [attempt, setAttempt] = useState(0);
  const [attemptSrc, setAttemptSrc] = useState(src);
  if (attemptSrc !== src) { setAttemptSrc(src); setAttempt(0); }
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const fallback = madinahFallbackSrc(src);
  const url = attempt === 0 ? src : attempt === 3 && fallback ? fallback : `${src}${src.includes('?') ? '&' : '?'}img-retry=${attempt}`;
  return (
    <img
      src={url}
      alt={alt}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      loading={loading ?? 'eager'}
      onLoad={onLoad}
      onError={() => {
        if (attempt === 0) setAttempt(1);
        else if (attempt === 1) timerRef.current = setTimeout(() => setAttempt(2), 400);
        else if (attempt === 2 && fallback) setAttempt(3);
        else onFinalError();
      }}
      className={`mushaf-scan ${className}`}
      style={style}
    />
  );
}
