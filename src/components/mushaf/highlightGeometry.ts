// W5-F: geometry helper shared by MushafHighlightLayer and the page's tap flash.
/** Trim the dataset's slightly tall/wide boxes so the highlight sits
 *  inside the word: 12% of the height top+bottom, 4% of the width
 *  each side. Taps and zones keep the raw boxes. */
export function insetHighlightBox<T extends { left: number; top: number; width: number; height: number }>(f: T): T {
  if (f.width <= 0 || f.height <= 0) return f;
  const dx = f.width * 0.04;
  const dy = f.height * 0.12;
  return { ...f, left: f.left + dx, top: f.top + dy, width: f.width - 2 * dx, height: f.height - 2 * dy };
}
