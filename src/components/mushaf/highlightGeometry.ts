// W5-F: geometry helper shared by MushafHighlightLayer and the page's tap flash.
/** 2026-11-19: the boxes are now measured on the page ink itself
 *  (public/mushaf-boxes, 64 px tall on a 89 px line pitch), so only a
 *  hair is trimmed vertically (3% top+bottom) and nothing sideways —
 *  the old 12%/4% trim cut the tops of the letters. Taps keep the raw
 *  boxes. */
export function insetHighlightBox<T extends { left: number; top: number; width: number; height: number }>(f: T): T {
  if (f.width <= 0 || f.height <= 0) return f;
  const dx = 0;
  const dy = f.height * 0.03;
  return { ...f, left: f.left + dx, top: f.top + dy, width: f.width - 2 * dx, height: f.height - 2 * dy };
}
