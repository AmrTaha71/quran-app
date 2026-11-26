// بطاقة «مراجعة الكلمات الضعيفة» في لوحتي (SRS step 4, spec 2026-11-20 §6).
// Reads the review table (src/lib/srsStore.ts, key 'quran-srs-v1') through
// getDueWords and shows how many words are due today, plus one button that
// opens the self-test on the first due ayah. The ayah goes through the same
// sessionStorage contract as ReviewDueCard (lib/homeFeatures): preset
// {startGlobal, endGlobal, label} + choice 'juz' + the one-shot review-session
// flag (step 5), then onNavigate('test').
// Nothing due: a calm message, never an error. Gold only (grad-amber-door,
// bg-amber-50, border-hairline-amber); no new colors.
import { useReadOnReturn } from '../lib/useReadOnReturn';
import { Play, Repeat } from 'lucide-react';
import { pressFeedback } from '../lib/pressFeedback';
import { getDueWords, suspectCount } from '../lib/srsStore';
import { listWeakWords, type WeakWord } from '../lib/wordMistakes';
import { dueWordsText, daySession } from '../lib/srsHome';
import { SRS_DAILY_LIMIT } from '../lib/srs';
import { SRS_STORE_KEY } from '../lib/srsStore';
import { TEST_RANGE_CHOICE_KEY, TEST_RANGE_PRESET_KEY } from '../lib/homeFeatures';
import { SRS_REVIEW_SESSION_KEY } from '../lib/srsTasmee';

function readWeak(): WeakWord[] { try { return listWeakWords(); } catch { return []; } }
function readDue() { try { return getDueWords(Date.now(), SRS_DAILY_LIMIT); } catch { return []; } }
// 4.26: how many words the review table holds at all, and how many are only
// «مشكوك» (one isolated miss, 4.5ب), so the user sees the system working.
function readTable() {
  let inTable = 0;
  try { inTable = Object.keys(JSON.parse(localStorage.getItem(SRS_STORE_KEY) ?? '{}') as object).length; } catch { /* 0 */ }
  let doubtful = 0;
  try { doubtful = suspectCount(); } catch { /* 0 */ }
  return { inTable, doubtful };
}

export default function SrsDueCard({
  onNavigate,
}: {
  onNavigate: (r: 'test') => void;
}) {
  // 6.12: read when the page opens and again whenever it comes back.
  const due = useReadOnReturn(readDue);
  // 15.4(أ): today's due at a glance: the words you keep missing («أخطائي»)
  // plus the review words due today, under one «اختبار اليوم» entry.
  const weakList = useReadOnReturn(readWeak);
  const table = useReadOnReturn(readTable);
  const weak = weakList.length;
  const total = due.length + weak;
  // 15.4ب: one session from what is due: your mistakes first, then the
  // oldest review words, capped at the daily limit, as one stretch of ayat.
  const target = daySession(weakList, due, { limit: SRS_DAILY_LIMIT });

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
      // One-shot flag: tells the self-test this run is a review from the card,
      // so right answers on due words move them forward (srsTasmee.ts).
      sessionStorage.setItem(SRS_REVIEW_SESSION_KEY, '1');
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

      {total > 0 && (
        <p className="text-base text-ink mt-3" data-testid="due-today">
          النهاردة عندك {dueWordsText(total)}: {dueWordsText(weak)} من أخطائك + {dueWordsText(due.length)} للمراجعة
        </p>
      )}
      {!target ? (
        <p className="text-lg text-ink-2 mt-3">مفيش مراجعة النهاردة</p>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-ink-2">جلسة النهاردة: أخطاءك الأول، وبعدين الأقدم من غير تسميع (لحد {dueWordsText(SRS_DAILY_LIMIT)} في اليوم)</p>
          <p className="text-base font-bold text-amber-800 mt-1">{target.label}</p>
          <p className="text-sm text-ink-2 mt-1">فيها {dueWordsText(target.words)}{target.fromMistakes > 0 ? `، منها ${dueWordsText(target.fromMistakes)} من أخطائك` : ''}</p>
          <button
            type="button"
            onPointerDown={pressFeedback}
            onClick={start}
            className="mt-4 w-full py-3.5 grad-amber-door glass-door-highlight text-white font-bold rounded-xl flex items-center justify-center gap-2 text-base polish-press polish-press-depth polish-focus"
          >
            <Play className="w-5 h-5" />
            اختبار اليوم
          </button>
        </div>
      )}
      {(table.inTable > 0 || table.doubtful > 0) && (
        <p className="text-xs text-ink-2 mt-3" data-testid="srs-table-count">
          في المراجعة الذكية: {dueWordsText(table.inTable)}{table.doubtful > 0 ? ` + ${dueWordsText(table.doubtful)} مشكوك فيها (غلطة واحدة، بتدخل لو اتكررت)` : ''}
        </p>
      )}
    </div>
  );
}
