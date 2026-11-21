// Continuous tasmee' on the digital Mushaf: the whole range is hidden on its page(s); each word appears as it
// is recited. The page follows the ayah being recited. Pages without trusted digital text show nothing.
import { useMemo } from 'react';
import DigitalRevealStage, { useDigitalPage } from './DigitalRevealStage';
import { madinahPageOfAyah } from '../../lib/madinahPageStarts';
import { expectedWordList } from '../../lib/expectedWords';

type RangeAyah = { surah_no: number; ayah_no: number; ayah_text: string };

export default function ContinuousReveal({ ayahs, ayahIdx, mask }: { ayahs: RangeAyah[]; ayahIdx: number; mask: boolean[] }) {
  // `surah:ayah:wordNo` -> index in the flat expected-word list (same order the matcher uses).
  const idxOf = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    ayahs.forEach((a) => expectedWordList(a.ayah_text).forEach((_, wi) => { m.set(`${a.surah_no}:${a.ayah_no}:${wi + 1}`, n++); }));
    return m;
  }, [ayahs]);
  const cur = ayahs[Math.min(Math.max(ayahIdx, 0), ayahs.length - 1)];
  const page = cur ? madinahPageOfAyah(cur.surah_no, cur.ayah_no) : null;
  const state = useDigitalPage(page);
  if (!page || !state.ready || !state.digital) return null;
  return (
    <DigitalRevealStage page={page} state={state} mark={(s, a, w) => {
      const i = idxOf.get(`${s}:${a}:${w}`);
      if (i === undefined) return undefined;
      return mask[i] ? undefined : 'hidden';
    }} />
  );
}
