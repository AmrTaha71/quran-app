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
  const boxes = allBoxes;
  if (boxes.length === 0) return null;
  // 2026-11-19 (Dr. Amr): ONE continuous band — like a snake / train. Boxes are
  // grouped into lines using ALL the ayah's words (so each line's top/height is
  // stable while the band grows); each line is drawn as a single strip from the
  // first word of the ayah (right end) to the word being recited now (left
  // end). With no `currentWord` the whole ayah is covered (static mark).
  const fitted = boxes.map((b) => insetHighlightBox(b));
  const order = fitted.map((_, i) => i).sort((a, b) => fitted[a].top - fitted[b].top);
  const lines: number[][] = [];
  for (const i of order) {
    const line = lines.find((l) => Math.abs(fitted[l[0]].top - fitted[i].top) < fitted[i].height * 0.6);
    if (line) line.push(i); else lines.push([i]);
  }
  const strips: { key: string; left: number; top: number; width: number; height: number }[] = [];
  lines.forEach((line, li) => {
    const t = line.reduce((a, i) => a + fitted[i].top, 0) / line.length;
    const h = line.reduce((a, i) => a + fitted[i].height, 0) / line.length;
    const used = currentWord === undefined ? line : line.filter((i) => boxes[i].wordNo - 1 <= currentWord);
    if (used.length === 0) return;
    const l = Math.min(...used.map((i) => fitted[i].left));
    const r = Math.max(...used.map((i) => fitted[i].left + fitted[i].width));
    strips.push({ key: `ln-${li}`, left: l, top: t, width: r - l, height: h });
  });
  return (<>
    {strips.map((f) => (
      <div key={f.key} className="mushaf-hl mushaf-hl-in"
        style={{ left: `${f.left}%`, top: `${f.top}%`, width: `${f.width}%`, height: `${f.height}%`, boxShadow: 'none', borderRadius: 6,
          transition: 'left 160ms linear, width 160ms linear' }} />
    ))}
  </>);
}
