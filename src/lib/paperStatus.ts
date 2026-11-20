// paperStatus.ts — decides whether the Madinah paper view can be trusted for an
// ayah (no imports, so it is testable in plain Node). The reveal maps the i-th
// recited word to the i-th box of the ayah on its start page, which is only right
// when the app's text and the page's boxes have the SAME number of words.
//   'ok'             counts match: show the paper.
//   'no-boxes'       the ayah has no boxes on its start page: the paper cannot hide
//                    it, so the stage covers the page and says it is unavailable.
//   'count-mismatch' text words != boxes: the i-th word would uncover a neighbour
//                    (shifted), so the caller falls back to the plain text view.
export type PaperStatus = 'ok' | 'no-boxes' | 'count-mismatch';

export function paperStatusOf(boxesOnStartPage: number, textWords: number): PaperStatus {
  if (boxesOnStartPage <= 0) return 'no-boxes';
  return boxesOnStartPage === textWords ? 'ok' : 'count-mismatch';
}
