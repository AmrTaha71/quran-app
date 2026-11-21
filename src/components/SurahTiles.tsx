// «في أي سورة؟» (W4-J): 4 surah-name tiles. The question text never names the
// surah or the ayah number; the caller reveals them after the answer.
import { useMemo } from 'react';
import { surahNameOnly, surahTiles } from '../lib/roundTest';

export default function SurahTiles({ correct, pool, onAnswer, title = 'في أي سورة؟' }: {
  correct: number;
  pool?: number[];
  onAnswer: (surah: number) => void;
  title?: string;
}) {
  const tiles = useMemo(() => surahTiles(correct, pool), [correct, pool]);
  return (
    <div>
      <p className="font-bold text-accent-800 mb-3">{title}</p>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((s) => (
          <button key={s} onClick={() => onAnswer(s)} className="py-3 rounded-xl bg-white border border-hairline-emerald text-accent-800 font-bold">{surahNameOnly(s)}</button>
        ))}
      </div>
    </div>
  );
}
