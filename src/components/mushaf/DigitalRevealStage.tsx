// Tasmee' reveal on the DIGITAL Mushaf page (2026-11-21, Dr. Amr): the page is drawn as a clean digital
// page (same look as the reader) and the words being tested are simply not drawn until they are recited
// correctly; the ayah-end medallions and every other ayah stay visible, like the competitor's ad.
import { useEffect, useMemo, useState } from 'react';
import DigitalPageLayer, { pageIsFullyDigital, type DigitalBox } from './DigitalPageLayer';
import { loadBoxes, type Box } from '../../lib/mushafBoxes';
import { loadTajweed, type TajweedMap } from '../../lib/tajweedWords';
import { loadThemeId, themeById } from '../../lib/mushafThemes';

export type DigitalPageState = { ready: boolean; digital: boolean; boxes: Box[]; tajweed: TajweedMap | null };

/** Boxes + tajweed text of one Madinah page; `digital` = every word of the page has trusted digital text. */
export function useDigitalPage(page: number | null | undefined): DigitalPageState {
  const [st, setSt] = useState<DigitalPageState>({ ready: false, digital: false, boxes: [], tajweed: null });
  useEffect(() => {
    let off = false;
    if (!page) { setSt({ ready: true, digital: false, boxes: [], tajweed: null }); return; }
    setSt((p) => (p.ready ? { ...p, ready: false } : p));
    void Promise.all([loadBoxes(page), loadTajweed()]).then(([b, t]) => {
      if (off) return;
      const boxes = b || [];
      const digital = !!t && boxes.length > 0 && pageIsFullyDigital(boxes.map((x) => ({ surah: x.s, ayah: x.a, wordNo: x.w })), t);
      setSt({ ready: true, digital, boxes, tajweed: t || null });
    }).catch(() => { if (!off) setSt({ ready: true, digital: false, boxes: [], tajweed: null }); });
    return () => { off = true; };
  }, [page]);
  return st;
}

export default function DigitalRevealStage({ page, state, mark }: {
  page: number;
  state: DigitalPageState;
  /** 'hidden' = word not drawn yet, 'wrong' = drawn red, undefined = drawn normally. */
  mark: (surah: number, ayah: number, wordNo: number) => 'hidden' | 'wrong' | undefined;
}) {
  const theme = useMemo(() => ({ ...themeById(loadThemeId()) }), []);
  const boxes = useMemo<DigitalBox[]>(() => state.boxes.map((b) => ({
    key: `${b.s}:${b.a}:${b.w}`, surah: b.s, ayah: b.a, wordNo: b.w,
    left: (b.x0 / 1240) * 100, top: (b.y0 / 1754) * 100,
    width: ((b.x1 - b.x0) / 1240) * 100, height: ((b.y1 - b.y0) / 1754) * 100,
  })), [state.boxes]);
  return (
    <div className="mx-auto w-full max-w-md" dir="ltr">
      <div className="relative w-full overflow-hidden rounded-xl border border-hairline shadow-sm"
        style={{ aspectRatio: '1240 / 1754', background: theme.bg }}>
        {state.ready && state.tajweed && (
          <DigitalPageLayer boxes={boxes} tajweed={state.tajweed} theme={theme} page={page}
            wordMark={(b) => mark(b.surah, b.ayah, b.wordNo)} />
        )}
      </div>
    </div>
  );
}
