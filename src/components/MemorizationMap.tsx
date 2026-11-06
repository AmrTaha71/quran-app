// خريطة حفظي — the 30-Juz memorization map (Home feature #1).
// Reads the REAL memorized state: the contiguous from-start run
// (same gate as Lawhati) passed in as `run`; per-Juz status comes
// from lib/homeFeatures (never hardcoded). Tapping a Juz jumps to
// its first ayah in the Mushaf via the existing
// 'quran-mushaf-target' jump. Palette is emerald + gold only:
// memorized = full gold, in progress = light amber tint,
// not yet = grey. No new hue, no BottomNav tab.
import { Map as MapIcon } from 'lucide-react';
import { pressFeedback } from '../lib/pressFeedback';
import { toArabicIndic } from '../lib/numerals';
import {
  countJuzByStatus,
  juzStatuses,
  type JuzStatus,
} from '../lib/homeFeatures';

const CELL_CLASS: Record<JuzStatus, string> = {
  // Full gold (the same grad-amber-door as the gold sub-doors).
  memorized: 'grad-amber-door glass-door-highlight text-white',
  // Light amber tint — clearly below full gold, same hue family.
  'in-progress': 'bg-amber-100 text-amber-900 ring-1 ring-amber-300',
  'not-yet': 'bg-gray-100 text-gray-500',
};

const STATUS_WORD: Record<JuzStatus, string> = {
  memorized: 'محفوظ',
  'in-progress': 'جاري حفظه',
  'not-yet': 'لم يبدأ',
};

export default function MemorizationMap({
  run,
  onJumpToAyah,
}: {
  run: number;
  onJumpToAyah: (surah: number, ayah: number) => void;
}) {
  const entries = juzStatuses(run);
  const counts = countJuzByStatus(entries);
  return (
    <div className="rounded-2xl glass-card polish-card p-4">
      <p className="font-bold text-ink text-base flex items-center gap-2 mb-1">
        <MapIcon className="w-5 h-5 text-emerald-700" />
        خريطة حفظي
      </p>
      <p className="text-sm text-ink-2 mb-3">
        {run > 0
          ? `حفظت ${toArabicIndic(run)} آية من أول المصحف — ${toArabicIndic(counts.memorized)} ${counts.memorized === 1 ? 'جزء كامل' : 'أجزاء كاملة'}`
          : 'لسه مفيش محفوظ مسجّل من أول المصحف — اضغط أي جزء تبدأ منه'}
      </p>
      <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
        {entries.map((e) => (
          <button
            key={e.juz}
            type="button"
            onPointerDown={pressFeedback}
            onClick={() => onJumpToAyah(e.startSurah, e.startAyah)}
            title={`الجزء ${toArabicIndic(e.juz)} — يبدأ من سورة ${e.startSurahName} آية ${toArabicIndic(e.startAyah)} — ${STATUS_WORD[e.status]}`}
            aria-label={`الجزء ${e.juz} — ${STATUS_WORD[e.status]}`}
            className={`py-2 rounded-lg font-bold polish-press polish-focus ${CELL_CLASS[e.status]}`}
          >
            <span className="block text-lg leading-tight">{toArabicIndic(e.juz)}</span>
            <span className="block text-[11px] leading-tight font-semibold">
              {STATUS_WORD[e.status]}
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm grad-amber-door inline-block" />
          محفوظ
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-amber-100 ring-1 ring-amber-300 inline-block" />
          جاري حفظه
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-gray-100 inline-block" />
          لم يبدأ بعد
        </span>
      </div>
    </div>
  );
}
