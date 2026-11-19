// W5-F (2026-11-19): the shared word-highlight layer of the future
// MushafStage (see /home/claude/plan/mushaf-stage-design.md). Pure
// presentation: it receives word boxes ALREADY mapped to the stage's
// container percentages (paper clamp + image->container norm stay in
// the page that owns the geometry) and draws them with the single
// `--mushaf-hl-rgb` colour from index.css. Any audio source (recorded
// reciter, live imam follow, read-along) only has to supply
// `currentWord`; the look is identical everywhere.
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

export default function MushafHighlightLayer({ boxes: allBoxes, currentWord }: {
  boxes: HighlightBox[];
  /** 0-based index of the word being recited now. Omit for a uniform
   *  whole-ayah highlight (search jump / static mark). */
  currentWord?: number;
}) {
  let boxes = allBoxes;
  if (boxes.length === 0) return null;
  // 2026-11-19 (Dr. Amr): while an audio source is tracking (imam / recorded
  // reciter) the band runs from the FIRST word of the ayah to the word being
  // recited now and grows with it; the next ayah starts a new band.
  if (currentWord !== undefined) boxes = boxes.filter((b) => b.wordNo - 1 <= currentWord);
  if (boxes.length === 0) return null;
  // 2026-11-19: no gaps between words — the highlight runs as one
  // continuous band along each line. Boxes on the same line are stretched
  // to meet their neighbour at the midpoint of the gap.
  const fitted = boxes.map((b) => insetHighlightBox(b));
  const order = fitted.map((_, i) => i).sort((a, b) => fitted[a].top - fitted[b].top);
  const lines: number[][] = [];
  for (const i of order) {
    const line = lines.find((l) => Math.abs(fitted[l[0]].top - fitted[i].top) < fitted[i].height * 0.6);
    if (line) line.push(i); else lines.push([i]);
  }
  for (const line of lines) {
    // One common top/height per line, so the band is a straight strip.
    const t = line.reduce((a, i) => a + fitted[i].top, 0) / line.length;
    const h = line.reduce((a, i) => a + fitted[i].height, 0) / line.length;
    for (const i of line) { fitted[i].top = t; fitted[i].height = h; }
    line.sort((a, b) => fitted[a].left - fitted[b].left);
    for (let k = 0; k < line.length - 1; k++) {
      const a = fitted[line[k]]; const b = fitted[line[k + 1]];
      const aRight = a.left + a.width;
      const gap = b.left - aRight;
      if (gap > 0 && gap < 6) {
        const mid = aRight + gap / 2;
        a.width = mid - a.left;
        const bRight = b.left + b.width;
        b.left = mid; b.width = bRight - mid;
      }
    }
  }
  return (<>
    {boxes.map((b, bi) => {
      const f = fitted[bi];
      const state = '';
      return (
        <div key={b.key} className={`mushaf-hl${state}`}
          style={{ left: `${f.left}%`, top: `${f.top}%`, width: `${f.width}%`, height: `${f.height}%`, boxShadow: 'none', borderRadius: 4 }} />
      );
    })}
  </>);
}
