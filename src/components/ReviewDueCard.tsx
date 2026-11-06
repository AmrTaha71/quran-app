// المراجعة المستحقة النهاردة — smart review-due card (Home feature #8).
// Reads the REAL wird state (src/lib/wird.ts, localStorage
// 'quran-wird-v1'): due = review parts (murajaa / manzil) with pages
// > 0 and today not yet marked done. sabaq (جديد) is new memorization,
// never review. One tap starts the review in SelfTest: the exact due
// range is written to sessionStorage 'quran-test-range-preset' (see
// the contract in lib/homeFeatures) and the existing
// 'quran-test-range-choice' = 'juz' flag lands on the juz door,
// where the card names the juz to pick. Nothing due → a kind
// "nothing due — well done" state, never an empty box or an error.
import { useState } from 'react';
import { BookOpen, CalendarCheck, Check, Flame, Play, Settings } from 'lucide-react';
import { pressFeedback } from '../lib/pressFeedback';
import { loadWird } from '../lib/wird';
import { toArabicIndic } from '../lib/numerals';
import {
  dueReview,
  TEST_RANGE_CHOICE_KEY,
  TEST_RANGE_PRESET_KEY,
} from '../lib/homeFeatures';

export default function ReviewDueCard({
  run,
  onNavigate,
  onJumpToAyah,
}: {
  run: number;
  onNavigate: (r: 'test' | 'settings' | 'mushaf') => void;
  onJumpToAyah: (surah: number, ayah: number) => void;
}) {
  const [wird] = useState(loadWird);
  const review = dueReview(wird, run);

  const startReview = () => {
    const range = review.range;
    if (!range) return;
    try {
      sessionStorage.setItem(
        TEST_RANGE_PRESET_KEY,
        JSON.stringify({
          startGlobal: range.startGlobal,
          endGlobal: range.endGlobal,
          label: range.label,
        }),
      );
      sessionStorage.setItem(TEST_RANGE_CHOICE_KEY, 'juz');
    } catch {
      // ignore — the juz door still opens below
    }
    onNavigate('test');
  };

  return (
    <div className="rounded-2xl glass-card polish-card p-4 mb-4">
      <p className="font-bold text-ink text-base flex items-center gap-2">
        <CalendarCheck className="w-5 h-5 text-emerald-700" />
        المراجعة المستحقة النهاردة
      </p>

      {review.doneToday ? (
        // Today is already marked done in the wird (doneDays) — the
        // kind "well done" state, with the real streak when there is one.
        <p className="text-base text-emerald-700 font-bold mt-2 flex items-center gap-2">
          <Check className="w-5 h-5" />
          أنجزت مراجعة النهاردة — أحسنت
          {wird.streak > 0 && (
            <span className="flex items-center gap-1 text-sm font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
              <Flame className="w-4 h-4" />
              {toArabicIndic(wird.streak)} يوم متتالي
            </span>
          )}
        </p>
      ) : !review.hasReviewConfigured ? (
        // No review part configured in the wird at all — nothing is
        // due, and the card says so kindly instead of erroring.
        <div className="mt-2">
          <p className="text-base text-ink-2">مفيش مراجعة مستحقة النهاردة — أحسنت</p>
          <button
            type="button"
            onPointerDown={pressFeedback}
            onClick={() => onNavigate('settings')}
            className="mt-2 text-sm font-semibold text-emerald-700 flex items-center gap-1.5 polish-focus rounded-lg"
          >
            <Settings className="w-4 h-4" />
            ظبط ورد المراجعة من الإعدادات
          </button>
        </div>
      ) : !review.range ? (
        // Review is configured, but nothing is memorized yet (run = 0),
        // so there is no material to review — say so, and offer to start.
        <div className="mt-2">
          <p className="text-base text-ink-2">
            ورد المراجعة مضبوط، بس لسه مفيش محفوظ مسجّل — احفظ أول آياتك وبعدين راجعها
          </p>
          <button
            type="button"
            onPointerDown={pressFeedback}
            onClick={() => onJumpToAyah(1, 1)}
            className="mt-3 w-full py-2.5 grad-emerald-door glass-door-highlight text-white font-semibold rounded-xl flex items-center justify-center gap-2 polish-press polish-press-depth polish-focus"
          >
            <BookOpen className="w-5 h-5" />
            ابدأ الحفظ من أول المصحف
          </button>
        </div>
      ) : (
        // Due today: the real due parts with their page counts, the
        // exact range, and a one-tap start.
        <div className="mt-2">
          <ul className="space-y-1">
            {review.dueParts.map((p) => (
              <li key={p.type} className="text-base text-ink">
                {p.label}: <span className="font-bold">{p.pagesText}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-2 mt-2">
            {review.range.label}
            <span className="block">{review.range.rangeText}</span>
          </p>
          <button
            type="button"
            onPointerDown={pressFeedback}
            onClick={startReview}
            className="mt-3 w-full py-3 grad-amber-door glass-door-highlight text-white font-bold rounded-xl flex items-center justify-center gap-2 text-base polish-press polish-press-depth polish-focus"
          >
            <Play className="w-5 h-5" />
            ابدأ المراجعة
          </button>
        </div>
      )}
    </div>
  );
}
