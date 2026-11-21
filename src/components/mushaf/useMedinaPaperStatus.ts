import { useEffect, useState } from 'react';
import { expectedWordList } from '../../lib/expectedWords';
import { loadBoxes } from '../../lib/mushafBoxes';
import { madinahPageOfAyah } from '../../lib/madinahPageStarts';
import { paperStatusOf, type PaperStatus } from '../../lib/paperStatus';

/** Status of the paper view for one ayah ('pending' until its page boxes load). A failed
 *  box fetch counts as 'no-boxes' (the stage covers the page rather than leak the ayah). */
export function useMedinaPaperStatus(surah?: number, ayah?: number, text?: string): PaperStatus | 'pending' {
  const [res, setRes] = useState<{ key: string; status: PaperStatus } | null>(null);
  const key = surah && ayah && text ? `${surah}:${ayah}:${text.length}` : '';
  useEffect(() => {
    if (!key || !surah || !ayah || !text) return;
    let off = false;
    void loadBoxes(madinahPageOfAyah(surah, ayah)).then((boxes) => {
      if (off) return;
      const n = boxes ? boxes.filter((b) => b.s === surah && b.a === ayah).length : 0;
      setRes({ key, status: paperStatusOf(n, expectedWordList(text).length) });
    });
    return () => { off = true; };
  }, [key, surah, ayah, text]);
  if (!key) return 'pending';
  return res && res.key === key ? res.status : 'pending';
}
