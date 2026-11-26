// 15.6(ب) (phase 6): «أهدافك النهاردة» + «أوسمتك» in لوحتي. First rules
// proposed per owner §11.13; they live in lib/goals.ts and can change there.
// Everything is read from real activity (score log, wird days, page queue).
import { Award, CheckCircle2, Circle } from 'lucide-react';
import { useReadOnReturn } from '../lib/useReadOnReturn';
import { dailyGoals, badges, type GoalInput } from '../lib/goals';
import { loadTestHistoryRaw } from '../lib/testHistory';
import { loadWird } from '../lib/wird';
import { loadPageReview } from '../lib/pageReview';
import { loadHifzCorpus } from '../lib/hifzCorpus';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readInput(): GoalInput {
  let testDays: string[] = [];
  try { testDays = loadTestHistoryRaw().filter((e) => e.completed).map((e) => e.ts); } catch { /* none */ }
  let wirdDays: string[] = [];
  try { wirdDays = loadWird().doneDays ?? []; } catch { /* none */ }
  let pages: ReturnType<typeof loadPageReview> = {};
  try { pages = loadPageReview(); } catch { /* none */ }
  let corpusSize = 0;
  try { corpusSize = loadHifzCorpus()?.size ?? 0; } catch { /* 0 */ }
  const recs = Object.values(pages);
  return {
    testDays, wirdDays,
    pageRecitals: recs.map((r) => r.l),
    cleanPages: recs.filter((r) => r.s > 0).length,
    corpusSize, today: todayStr(),
  };
}

export default function GoalsCard() {
  const input = useReadOnReturn(readInput);
  const goals = dailyGoals(input);
  const all = badges(input);
  const earned = all.filter((b) => b.earned);
  const nextBadge = all.find((b) => !b.earned);
  return (
    <div className="rounded-2xl border border-hairline-amber bg-white p-5 mb-4">
      <p className="font-bold text-ink text-base">أهدافك النهاردة</p>
      <ul className="mt-2 space-y-1.5">
        {goals.map((g) => (
          <li key={g.id} className={`flex items-center gap-2 text-base ${g.done ? 'text-emerald-800' : 'text-ink-2'}`}>
            {g.done ? <CheckCircle2 className="w-5 h-5 text-emerald-700" /> : <Circle className="w-5 h-5 text-amber-600" />}
            {g.label}
          </li>
        ))}
      </ul>
      <p className="font-bold text-ink text-base mt-4 flex items-center gap-2"><Award className="w-5 h-5 text-amber-700" /> أوسمتك ({earned.length} من {all.length})</p>
      {earned.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {earned.map((b) => <span key={b.id} title={b.rule} className="px-3 py-1 rounded-full bg-amber-50 border border-hairline-amber text-sm font-semibold text-amber-800">{b.name}</span>)}
        </div>
      )}
      {nextBadge && <p className="text-sm text-ink-2 mt-2">الوسام الجاي: «{nextBadge.name}» — {nextBadge.rule}</p>}
    </div>
  );
}
