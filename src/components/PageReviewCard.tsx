// 17.3 (phase 6): «مراجعة الصفحات» in لوحتي. The page queue over the user's
// «محفوظي» (lib/pageReview.ts): pages with open mistakes first, then the
// longest without a recital. One button opens the self-test on the first
// page in the queue (same sessionStorage contract as the other cards).
// Hidden until «محفوظي» is declared. Gold/emerald only.
import { BookOpen, Play } from 'lucide-react';
import { useReadOnReturn } from '../lib/useReadOnReturn';
import { pressFeedback } from '../lib/pressFeedback';
import { loadHifzCorpus } from '../lib/hifzCorpus';
import { loadPageReview, pageQueue, pagesOfCorpus, type QueuedPage } from '../lib/pageReview';
import { pageStartGlobal, pageEndGlobal } from '../lib/reviewPages';
import { TEST_RANGE_CHOICE_KEY, TEST_RANGE_PRESET_KEY } from '../lib/homeFeatures';
import { toArabicIndic } from '../lib/numerals';

function readQueue(): { queue: QueuedPage[]; pages: number } | null {
  try {
    const corpus = loadHifzCorpus();
    if (!corpus || corpus.size === 0) return null;
    const pages = pagesOfCorpus(corpus);
    return { queue: pageQueue(pages, loadPageReview()), pages: pages.length };
  } catch { return null; }
}

export default function PageReviewCard({ onNavigate }: { onNavigate: (r: 'test') => void }) {
  const data = useReadOnReturn(readQueue);
  if (!data) return null;
  const first = data.queue[0];
  const open = data.queue.filter((q) => q.open).length;
  const start = () => {
    if (!first) return;
    try {
      sessionStorage.setItem(TEST_RANGE_PRESET_KEY, JSON.stringify({
        startGlobal: pageStartGlobal(first.page),
        endGlobal: pageEndGlobal(first.page),
        label: `مراجعة صفحة ${toArabicIndic(first.page)}`,
      }));
      sessionStorage.setItem(TEST_RANGE_CHOICE_KEY, 'juz');
    } catch { /* the test page still opens */ }
    onNavigate('test');
  };
  return (
    <div className="rounded-2xl border border-hairline-emerald bg-emerald-50 p-5 mb-4">
      <p className="font-bold text-ink text-base flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-emerald-800" />
        مراجعة الصفحات
      </p>
      {!first ? (
        <p className="text-base text-ink-2 mt-3">كل صفحات محفوظك ({toArabicIndic(data.pages)}) متراجعة. برافو.</p>
      ) : (
        <>
          <p className="text-base text-ink mt-3">
            عليك {toArabicIndic(data.queue.length)} صفحة من {toArabicIndic(data.pages)}{open > 0 ? `، منها ${toArabicIndic(open)} فيها أخطاء` : ''}
          </p>
          <p className="text-sm text-ink-2 mt-1">
            اللي عليها الدور: صفحة {toArabicIndic(first.page)} {first.open ? '(فيها أخطاء)' : first.last ? '(الأقدم من غير تسميع)' : '(لسه ما سمّعتهاش)'}
          </p>
          <button type="button" onPointerDown={pressFeedback} onClick={start}
            className="mt-4 w-full py-3.5 grad-emerald-door glass-door-highlight text-white font-bold rounded-xl flex items-center justify-center gap-2 text-base polish-press polish-focus">
            <Play className="w-5 h-5" />
            سمّع صفحة {toArabicIndic(first.page)}
          </button>
        </>
      )}
    </div>
  );
}
