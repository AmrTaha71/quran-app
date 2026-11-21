// W5-F (2026-11-19): the shared word-highlight layer of the future
// MushafStage (see /home/claude/plan/mushaf-stage-design.md). Pure
// presentation: it receives word boxes ALREADY mapped to the stage's
// container percentages (paper clamp + image->container norm stay in
// the page that owns the geometry) and draws them with the single
// `--mushaf-hl-rgb` colour from index.css.
//
// 2026-11-21 (Dr. Amr): the band glides continuously with the voice (no word-to-word steps) and its
// ends are soft and round (a tapered capsule), not a hard straight cut. `getProgress` returns the
// recitation position in word space (3.4 = 40% through the 4th word); the layer reads it every
// animation frame, eases toward it, and moves the band's leading edge directly in the DOM.
import { useEffect, useRef } from 'react';
import { insetHighlightBox } from './highlightGeometry';

export type HighlightBox = {
  key: string;
  /** 1-based word number inside the ayah (from the box key s:a:w). */
  wordNo: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

type Line = { key: string; top: number; height: number; right: number; words: { k: number; left: number; right: number }[] };

/** Leading (left) edge of a line's band for a recitation position; null = nothing of this line yet. */
function leadingEdge(line: Line, progress: number | undefined): number | null {
  if (progress === undefined) return Math.min(...line.words.map((w) => w.left));
  let edge: number | null = null;
  for (const w of line.words) {
    const c = Math.min(1, Math.max(0, progress - w.k));
    if (c <= 0) continue;
    const e = w.right - c * (w.right - w.left); // RTL: the band eats the word from its right side
    edge = edge === null ? e : Math.min(edge, e);
  }
  return edge;
}

export default function MushafHighlightLayer({ boxes, currentWord, getProgress }: {
  boxes: HighlightBox[];
  /** 0-based index of the word being recited now (whole word covered at once). Omit for a uniform
   *  whole-ayah highlight (search jump / static mark). */
  currentWord?: number;
  /** Continuous recitation position in word space; takes over from `currentWord`. */
  getProgress?: () => number;
}) {
  const fitted = boxes.map((b) => insetHighlightBox(b));
  const order = fitted.map((_, i) => i).sort((a, b) => fitted[a].top - fitted[b].top);
  const groups: number[][] = [];
  for (const i of order) {
    const g = groups.find((l) => Math.abs(fitted[l[0]].top - fitted[i].top) < fitted[i].height * 0.6);
    if (g) g.push(i); else groups.push([i]);
  }
  const lines: Line[] = groups.map((g, li) => ({
    key: `ln-${li}`,
    top: g.reduce((a, i) => a + fitted[i].top, 0) / g.length,
    height: g.reduce((a, i) => a + fitted[i].height, 0) / g.length,
    right: Math.max(...g.map((i) => fitted[i].left + fitted[i].width)),
    words: g.map((i) => ({ k: boxes[i].wordNo - 1, left: fitted[i].left, right: fitted[i].left + fitted[i].width })),
  }));

  const els = useRef<(HTMLDivElement | null)[]>([]);
  const progRef = useRef(getProgress);
  progRef.current = getProgress;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const wordRef = useRef(currentWord);
  wordRef.current = currentWord;

  const paint = (p: number | undefined, soft: boolean) => {
    linesRef.current.forEach((ln, i) => {
      const el = els.current[i];
      if (!el) return;
      const edge = leadingEdge(ln, p);
      if (edge === null) { el.style.opacity = '0'; el.style.width = '0%'; return; }
      el.style.opacity = '1';
      el.style.left = `${edge}%`;
      el.style.width = `${Math.max(0, ln.right - edge)}%`;
      // soft, tapered leading end only while the band is still growing on this line
      const growing = soft && p !== undefined && edge > Math.min(...ln.words.map((w) => w.left)) + 0.01;
      el.style.setProperty('-webkit-mask-image', growing ? 'linear-gradient(to right, transparent 0, #000 16px)' : 'none');
      el.style.maskImage = growing ? 'linear-gradient(to right, transparent 0, #000 16px)' : 'none';
    });
  };

  useEffect(() => {
    const live = !!progRef.current;
    if (!live) { paint(wordRef.current === undefined ? undefined : wordRef.current + 1, false); return; }
    let raf = 0;
    let shown = -1;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const target = progRef.current ? progRef.current() : -1;
      if (target >= 0) {
        // ease toward the voice (~70ms time constant); a big jump (seek / new ayah) snaps
        if (shown < 0 || Math.abs(target - shown) > 3 || target < shown - 0.5) shown = target;
        else shown += (target - shown) * (1 - Math.exp(-dt / 70));
        paint(shown, true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!getProgress, boxes.length, currentWord]);

  if (boxes.length === 0) return null;
  return (<>
    {lines.map((ln, i) => (
      <div key={ln.key} ref={(el) => { els.current[i] = el; }} className="mushaf-hl mushaf-hl-in"
        style={{ left: `${Math.min(...ln.words.map((w) => w.left))}%`, top: `${ln.top}%`, width: `${ln.right - Math.min(...ln.words.map((w) => w.left))}%`, height: `${ln.height}%`,
          boxShadow: 'none', borderRadius: 9999, opacity: getProgress ? 0 : 1 }} />
    ))}
  </>);
}
