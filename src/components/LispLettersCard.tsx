// Item 17.1: pick the letters you say differently (a lisp) so the ear
// never stops you on them. Stored on this device only.
import { useState } from 'react';
import { LISP_CHOICES, loadLispLetters, saveLispLetters } from '../lib/lispLetters';

export default function LispLettersCard() {
  const [picked, setPicked] = useState<string[]>(loadLispLetters);
  const toggle = (l: string) => {
    const next = picked.includes(l) ? picked.filter((x) => x !== l) : [...picked, l];
    setPicked(next);
    saveLispLetters(next);
  };
  return (
    <div dir="rtl" className="rounded-xl border border-hairline bg-white p-3 space-y-2 mt-3">
      <p className="font-bold text-accent-900">حروف بتنطقها بطريقتك (لثغة)</p>
      <p className="text-sm text-accent-700 leading-relaxed">
        لو في حرف بتنطقه بشكل مختلف (زي الراء)، اختاره هنا. الكلمة اللي تفرق في الحرف ده بس هتتحسب صح:
        مش هتوقفك، ومش هتتحسب غلطة، ومش هتدخل في الدرجة.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {LISP_CHOICES.map((l) => {
          const on = picked.includes(l);
          return (
            <button key={l} type="button" onClick={() => toggle(l)} aria-pressed={on}
              className={`min-w-[44px] min-h-[44px] rounded-lg text-lg font-bold border ${on ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-accent-800 border-hairline'}`}>
              {l}
            </button>
          );
        })}
      </div>
      {picked.length > 0 && <p className="text-xs text-accent-700">مختار: {picked.join('، ')}</p>}
    </div>
  );
}
