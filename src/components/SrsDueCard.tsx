// بطاقة «مراجعة الكلمات الضعيفة» في لوحتي (SRS step 4, spec 2026-11-20 §6).
// Reads the review table (src/lib/srsStore.ts, key 'quran-srs-v1') through
// getDueWords and shows how many words are due today, plus one button that
// opens the self-test on the first due ayah. The ayah goes through the same
// sessionStorage contract as ReviewDueCard (lib/homeFeatures): preset
// {startGlobal, endGlobal, label} + choice 'juz', then onNavigate('test').
// Nothing due: a calm message, never an error. Gold only (grad-amber-door,
// bg-amber-50, border-hairline-amber); no new colors.
import { useState } from 'react';
import { Play, Repeat } from 'lucide-react';
import { pressFeedback } from '../lib/pressFeedback';
import { getDueWords } from '../lib/srsStore';
import { dueWordsText, firstDueAyah, firstDueAyahText } from '../lib/srsHome';
import { TEST_RANGE_CHOICE_KEY, TEST_RANGE_PRESET_KEY } from '../lib/homeFeatures';

export default function SrsDueCard({
  onNavigate,
}: {
  onNavigate: (r: 'test') => void;
}) {
  // Read once when the page opens, like ReviewDueCard does with the wird.
  const [due] = useState(() => {
    try { return getDueWords(); } catch { return []; }
  });
  const target = firstDueAyah(due);

  const start = () => {
    if (!target) return;
    try {
      sessionStorage.setItem(
        TEST_RANGE_PRESET_KEY,
        JSON.stringify({
          startGlobal: target.startGlobal,
          endGlobal: target.endGlobal,
          label: target.label,
        }),
      );
      sessionStorage.setItem(TEST_RANGE_CHOICE_KEY, 'juz');
    } catch {
      // ignore — the test page still opens on its range door
    }
    onNavigate('test');
  };

  return (
    <div className="rounded-2xl border border-hairline-amber bg-amber-50 p-5 mb-4">
      <p className="font-bold text-ink text-base flex items-center gap-2">
        <Repeat className="w-5 h-5 text-amber-800" />
        مراجعة الكلمات الضعيفة
      </p>

      {!target ? (
        <p className="text-lg text-ink-2 mt-3">مفيش مراجعة النهاردة</p>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-ink-2">المستحق النهاردة</p>
          <p className="text-3xl font-bold text-amber-800 mt-1">{dueWordsText(due.length)}</p>
          <p className="text-sm text-ink-2 mt-2">أول آية: {firstDueAyahText(due)}</p>
          <button
            type="button"
            onPointerDown={pressFeedback}
            onClick={start}
            className="mt-4 w-full py-3.5 grad-amber-door glass-door-highlight text-white font-bold rounded-xl flex items-center justify-center gap-2 text-base polish-press polish-press-depth polish-focus"
          >
            <Play className="w-5 h-5" />
            ابدأ المراجعة
          </button>
        </div>
      )}
    </div>
  );
}
