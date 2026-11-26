// Tasmee' "reveal on the Madinah page" (2026-11-20, Dr. Amr, from the
// competitor ad video): the recitation screen shows the real Madinah
// Mushaf page with every word of the tested ayah COVERED by a patch of
// paper colour. A word is uncovered only when the caller says it was
// recited correctly and in its place (`revealed[i]`); wrong / missing
// words stay covered (or show red on the final screen).
//
// Geometry is self-contained: the image keeps its 1240x1754 aspect in a
// box, the word boxes (public/mushaf-boxes/NNN.json, px of that image)
// become percentages of the same box, so no paper-clamp maths is needed.
import { useEffect, useMemo, useRef, useState } from 'react';
import { madinahPageOfAyah } from '../../lib/madinahPageStarts';
import { loadBoxes, type Box } from '../../lib/mushafBoxes';
import { MUSHAF_EDITIONS } from '../../lib/mushafEditions';
import DigitalRevealStage, { useDigitalPage } from './DigitalRevealStage';

// Paper colour of the sufone scans (cream). Slightly warm so the patch
// disappears into the page; measured on page 3: the scans are RGB(255,255,230).
const PAPER = '#ffffe6';

export default function MushafRevealStage({ surah, ayah, revealed, wrong, showAll, onlyWrong }: {
  surah: number;
  ayah: number;
  /** revealed[i] = word i (0-based, in ayah order) was recited correctly in place. */
  revealed: boolean[];
  /** 0-based word indices to paint red once the ayah is finished. */
  wrong?: number[];
  /** Done screens: uncover the whole ayah (wrong words get a red wash). */
  showAll?: boolean;
  /** Item 15.2 (blind mode): on a mistake uncover ONLY the wrong words (red), the rest stays covered. */
  onlyWrong?: boolean;
}) {
  const page = madinahPageOfAyah(surah, ayah);
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const digitalPage = useDigitalPage(madinahPageOfAyah(surah, ayah));

  useEffect(() => {
    let off = false;
    setBoxes(null);
    setLoaded(false);
    void loadBoxes(page).then((b) => { if (!off) { setBoxes(b); setLoaded(true); } });
    return () => { off = true; };
  }, [page]);

  // Every word of the tested ayah on this page (an ayah can continue on the
  // next page; only this page's part is drawn).
  const words = useMemo(() => (boxes || []).filter((b) => b.s === surah && b.a === ayah), [boxes, surah, ayah]);
  // Sticky reveal: a word the caller reported correct stays uncovered for the
  // rest of this ayah, even if the live alignment later re-hypothesises it
  // (interim results get revised). Reset only when the ayah changes.
  const stickyRef = useRef<{ key: string; open: Set<number> }>({ key: '', open: new Set() });
  const stickyKey = `${surah}:${ayah}`;
  if (stickyRef.current.key !== stickyKey) stickyRef.current = { key: stickyKey, open: new Set() };
  revealed.forEach((v, i) => { if (v) stickyRef.current.open.add(i); });
  if (!page) return null;
  const wrongSet = new Set(wrong || []);
  // Not drawable while listening: boxes still loading (never flash the uncovered ayah), the
  // box file failed, or this ayah has no boxes on its start page. Cover the whole page with
  // paper colour; once loaded, say why. Done screens (showAll) show the page as it is.
  const blocked = !showAll && !onlyWrong && (!loaded || words.length === 0);

  // Digital page (preferred, 2026-11-21): same reveal on the clean digital Mushaf page. While it loads, a
  // paper-coloured page (never the uncovered ayah); the scan below stays only for pages without trusted text.
  if (!digitalPage.ready) return <div className="mx-auto w-full max-w-md rounded-xl border border-hairline" style={{ aspectRatio: '1240 / 1754', background: PAPER }} />;
  if (digitalPage.digital && words.length > 0) {
    return (
      <DigitalRevealStage page={page} state={digitalPage} mark={(s, a, w) => {
        if (s !== surah || a !== ayah) return undefined;
        const i = w - 1;
        if (onlyWrong) return wrongSet.has(i) ? 'wrong' : 'hidden';
        if (showAll) return wrongSet.has(i) ? 'wrong' : undefined;
        return revealed[i] || stickyRef.current.open.has(i) ? undefined : 'hidden';
      }} />
    );
  }

  return (
    <div className="mx-auto w-full max-w-md" dir="ltr">
      <div className="relative w-full overflow-hidden rounded-xl border border-hairline shadow-sm bg-[#ffffe6]"
        style={{ aspectRatio: '1240 / 1754' }}>
        {imgOk && (
          <img src={MUSHAF_EDITIONS[0].imageUrl(page)} alt={`صفحة ${page} من مصحف المدينة`}
            className="absolute inset-0 w-full h-full select-none" draggable={false}
            onError={() => setImgOk(false)} />
        )}
        {blocked && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center" style={{ background: PAPER }}>
            {loaded && <p dir="rtl" className="text-base font-bold text-accent-700">ورق المدينة مش متاح للآية دي</p>}
          </div>
        )}
        {words.map((b) => {
          const i = b.w - 1;
          const open = onlyWrong ? wrongSet.has(i) : showAll || !!revealed[i] || stickyRef.current.open.has(i);
          const isWrong = (showAll || onlyWrong) && wrongSet.has(i);
          // Pad: tashkeel and word tails reach a little past the measured box.
          const padX = 0.5, padTop = 1.25, padBot = 0.6;
          const style: React.CSSProperties = {
            left: `${(b.x0 / 1240) * 100 - padX}%`,
            top: `${(b.y0 / 1754) * 100 - padTop}%`,
            width: `${((b.x1 - b.x0) / 1240) * 100 + padX * 2}%`,
            height: `${((b.y1 - b.y0) / 1754) * 100 + padTop + padBot}%`,
          };
          if (!open) {
            return <div key={`${b.s}:${b.a}:${b.w}`} className="absolute" style={{ ...style, background: PAPER }} />;
          }
          // Revealed: nothing drawn (the page shows through) except a soft
          // flash on the word that just opened, and a red wash for wrong words.
          return (
            <div key={`${b.s}:${b.a}:${b.w}`} className={`absolute rounded ${isWrong ? '' : 'mushaf-reveal-pop'}`}
              style={{ ...style, background: isWrong ? 'rgba(220,38,38,0.22)' : 'transparent', pointerEvents: 'none' }} />
          );
        })}
      </div>
    </div>
  );
}
