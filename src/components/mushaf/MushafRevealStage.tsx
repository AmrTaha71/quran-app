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
import { useEffect, useMemo, useState } from 'react';
import { madinahPageOfAyah } from '../../lib/madinahPageStarts';

type Box = { s: number; a: number; w: number; x0: number; y0: number; x1: number; y1: number };

const boxCache: Record<number, Box[]> = {};

async function loadBoxes(page: number): Promise<Box[] | null> {
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

// Paper colour of the sufone scans (cream). Slightly warm so the patch
// disappears into the page; measured on page 3: the scans are RGB(255,255,230).
const PAPER = '#ffffe6';

export default function MushafRevealStage({ surah, ayah, revealed, wrong, showAll }: {
  surah: number;
  ayah: number;
  /** revealed[i] = word i (0-based, in ayah order) was recited correctly in place. */
  revealed: boolean[];
  /** 0-based word indices to paint red once the ayah is finished. */
  wrong?: number[];
  /** Done screens: uncover the whole ayah (wrong words get a red wash). */
  showAll?: boolean;
}) {
  const page = madinahPageOfAyah(surah, ayah);
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [imgOk, setImgOk] = useState(true);

  useEffect(() => {
    let off = false;
    setBoxes(null);
    void loadBoxes(page).then((b) => { if (!off) setBoxes(b); });
    return () => { off = true; };
  }, [page]);

  // Every word of the tested ayah on this page (an ayah can continue on the
  // next page; only this page's part is drawn).
  const words = useMemo(() => (boxes || []).filter((b) => b.s === surah && b.a === ayah), [boxes, surah, ayah]);
  if (!page) return null;
  const wrongSet = new Set(wrong || []);

  return (
    <div className="mx-auto w-full max-w-md" dir="ltr">
      <div className="relative w-full overflow-hidden rounded-xl border border-hairline shadow-sm bg-[#ffffe6]"
        style={{ aspectRatio: '1240 / 1754' }}>
        {imgOk && (
          <img src={`https://cdn.jsdelivr.net/gh/sufone/medina-mushaf@master/png-d150/${page}.png`} alt={`صفحة ${page} من مصحف المدينة`}
            className="absolute inset-0 w-full h-full select-none" draggable={false}
            onError={() => setImgOk(false)} />
        )}
        {words.map((b) => {
          const i = b.w - 1;
          const open = showAll || !!revealed[i];
          const isWrong = showAll && wrongSet.has(i);
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
