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

export default function MushafHighlightLayer({ boxes, currentWord }: {
  boxes: HighlightBox[];
  /** 0-based index of the word being recited now. Omit for a uniform
   *  whole-ayah highlight (search jump / static mark). */
  currentWord?: number;
}) {
  if (boxes.length === 0) return null;
  return (<>
    {boxes.map((b) => {
      const f = insetHighlightBox(b);
      const state = currentWord === undefined ? ''
        : b.wordNo - 1 === currentWord ? ' mushaf-hl--current'
        : b.wordNo - 1 < currentWord ? ' mushaf-hl--passed' : ' mushaf-hl--ahead';
      return (
        <div key={b.key} className={`mushaf-hl${state}`}
          style={{ left: `${f.left}%`, top: `${f.top}%`, width: `${f.width}%`, height: `${f.height}%` }} />
      );
    })}
  </>);
}
