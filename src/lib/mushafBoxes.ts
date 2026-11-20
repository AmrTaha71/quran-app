// Word boxes of the Madinah page scans (public/mushaf-boxes/NNN.json), moved out of
// MushafRevealStage unchanged so the paper-status hook can share the same cache.
export type Box = { s: number; a: number; w: number; x0: number; y0: number; x1: number; y1: number };

const boxCache: Record<number, Box[]> = {};

export async function loadBoxes(page: number): Promise<Box[] | null> {
  if (boxCache[page]) return boxCache[page];
  try {
    const file = String(page).padStart(3, '0');
    const r = await fetch(`${import.meta.env.BASE_URL || '/'}mushaf-boxes/${file}.json`);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !Array.isArray(j.w)) return null;
    const boxes = (j.w as number[][]).map(([s, a, w, x0, y0, x1, y1]) => ({ s, a, w, x0, y0, x1, y1 }));
    boxCache[page] = boxes;
    return boxes;
  } catch { return null; }
}
