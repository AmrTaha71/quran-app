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
  juzStatusesFromSet,
  type JuzStatus,
} from '../lib/homeFeatures';
import { useReadOnReturn } from '../lib/useReadOnReturn';
import { listWeakWords } from '../lib/wordMistakes';
import { loadTestHistoryV1 } from '../lib/testHistory';
import { weeklyAccuracy } from '../lib/weeklyAccuracy';
import { containingUnit } from '../lib/testRanges';
import { getGlobalAyahNumber } from '../lib/surahs';

// 15.5: steadiness from OBSERVED facts only (not SRS stages, still
// provisional): a memorized juz with words you still miss («أخطائي»)
// is «قيد التثبيت»; one with none is «ثابت».
function readWeakByJuz(): Map<number, number> {
  const m = new Map<number, number>();
  try {
    for (const w of listWeakWords()) {
      const j = containingUnit('juz', getGlobalAyahNumber(w.surah, w.ayah));
      m.set(j, (m.get(j) || 0) + 1);
    }
  } catch { /* empty map */ }
  return m;
}
function readWeeks() { try { return weeklyAccuracy(loadTestHistoryV1(), 6); } catch { return []; } }

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
  memorized,
  onJumpToAyah,
}: {
  run: number;
  /** Item 5.2: every memorized ayah id — the map's source of truth. */
  memorized: Set<number>;
  onJumpToAyah: (surah: number, ayah: number) => void;
}) {
  const entries = juzStatusesFromSet(memorized);
  const total = memorized.size;
  const counts = countJuzByStatus(entries);
  const weakByJuz = useReadOnReturn(readWeakByJuz);
  const weeks = useReadOnReturn(readWeeks);
  const anyWeek = weeks.some((w) => w.avg !== null);
  return (
    <div className="rounded-2xl glass-card polish-card p-4">
      <p className="font-bold text-ink text-base flex items-center gap-2 mb-1">
        <MapIcon className="w-5 h-5 text-emerald-700" />
        خريطة حفظي
      </p>
      <p className="text-sm text-ink-2 mb-3">
        {total > 0
          ? `حفظت ${toArabicIndic(total)} آية — ${toArabicIndic(counts.memorized)} ${counts.memorized === 1 ? 'جزء كامل' : 'أجزاء كاملة'}${run > 0 ? ` (منها ${toArabicIndic(run)} متصلة من أول المصحف)` : ''}`
          : 'لسه مفيش آيات متسجّلة محفوظة — اضغط أي جزء تبدأ منه'}
      </p>
      <div className="grid grid-cols-6 sm:grid-cols-10 gap-2">
        {entries.map((e) => (
          <button
            key={e.juz}
            type="button"
            onPointerDown={pressFeedback}
            onClick={() => onJumpToAyah(e.startSurah, e.startAyah)}
            title={`الجزء ${toArabicIndic(e.juz)} — يبدأ من سورة ${e.startSurahName} آية ${toArabicIndic(e.startAyah)} — ${STATUS_WORD[e.status]}`}
            aria-label={`الجزء ${e.juz} — ${STATUS_WORD[e.status]}${e.status === 'memorized' ? (weakByJuz.get(e.juz) ? ' — قيد التثبيت' : ' — ثابت') : ''}`}
            className={`py-2 rounded-lg font-bold polish-press polish-focus ${CELL_CLASS[e.status]}${e.status === 'memorized' && weakByJuz.get(e.juz) ? ' ring-2 ring-emerald-600 ring-offset-1' : ''}`}
          >
            <span className="block text-lg leading-tight font-display-ar">{toArabicIndic(e.juz)}</span>
            {/* Compact map (2026-11-06): not-yet tiles show the number only —
                the legend below already explains the grey tile. */}
            {e.status !== 'not-yet' && (
              <span className="block text-[11px] leading-tight font-semibold">
                {e.status === 'memorized' ? (weakByJuz.get(e.juz) ? 'قيد التثبيت' : 'ثابت') : STATUS_WORD[e.status]}
              </span>
            )}
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
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm grad-amber-door ring-2 ring-emerald-600 inline-block" />
          محفوظ وفيه كلمات بتغلط فيها (قيد التثبيت)
        </span>
      </div>
      {anyWeek && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-ink mb-2">دقتك في التسميع — آخر ٦ أسابيع</p>
          <div className="flex items-end gap-2 h-24" dir="rtl">
            {weeks.map((w) => (
              <div key={w.weeksAgo} className="flex-1 flex flex-col items-center justify-end h-full">
                <span className="text-[11px] text-ink-2">{w.avg === null ? '' : `${toArabicIndic(w.avg)}٪`}</span>
                <span className="w-full rounded-t-md bg-emerald-600" style={{ height: `${w.avg === null ? 0 : Math.max(4, w.avg * 0.7)}%` }} />
                <span className="text-[10px] text-ink-2 mt-1">{w.weeksAgo === 0 ? 'الأسبوع ده' : `قبل ${toArabicIndic(w.weeksAgo)}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
