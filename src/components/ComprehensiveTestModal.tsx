// الاختبار الشامل (2026-11-07): step-by-step test with a range and a
// level chosen by the user. Quiz parts (المتشابهات) are graded by the app.
// Recitation and recall parts are graded by the user against a checklist
// (the app cannot grade voice yet). Results are kept locally so the user
// can see the score and its change over time.
import DrumPicker from './DrumReel';
import { unitPickLabel } from '../lib/testRanges';
import { useEffect, useMemo, useState } from 'react';
import { useEscapeClose } from '../lib/useEscape';
import { SURAHS, surahLabel } from '../lib/surahs';
import BANK from '../data/mutashabihat-famous.json';
import { getQuranTextCache, type CachedTextRow } from '../lib/quranTextCache';
import {
  LEVELS, PARTS, rangeOf, fromGlobal, randomInt, readResults, saveResult, totalOf,
  type RangeScope, type TestLevel, type PartId, type SavedResult,
} from '../lib/comprehensiveTest';

type Step = 'setup' | 'tasmee' | 'mutashabihat' | 'rabt' | 'tajweed' | 'tilawa' | 'done';
type Question = { clue: string; options: { s: number; a: number }[]; correct: number };

const SCOPE_LABEL: Record<RangeScope, string> = { surah: 'سورة', juz: 'جزء', hizb: 'حزب', quarter: 'ربع' };
const SCOPE_COUNT: Record<RangeScope, number> = { surah: 114, juz: 30, hizb: 60, quarter: 240 };
const STEP_ORDER: Step[] = ['tasmee', 'mutashabihat', 'rabt', 'tajweed', 'tilawa'];

let textMap: Promise<Map<string, string> | null> | null = null;
function loadText(): Promise<Map<string, string> | null> {
  if (!textMap) {
    textMap = getQuranTextCache().getAll(6000).then((rows: CachedTextRow[] | null) => {
      if (!rows) return null;
      const m = new Map<string, string>();
      for (const r of rows) m.set(`${r.surah_no}:${r.ayah_no}`, r.ayah_text);
      return m;
    }).catch(() => null);
  }
  return textMap;
}

function buildQuestions(count: number): Question[] {
  const pool = [...(BANK as { clue: string; answers: string[] }[])];
  const out: Question[] = [];
  while (out.length < count && pool.length > 0) {
    const item = pool.splice(randomInt(0, pool.length - 1), 1)[0];
    const right = item.answers[randomInt(0, item.answers.length - 1)].split(':').map(Number);
    const opts: { s: number; a: number }[] = [{ s: right[0], a: right[1] }];
    while (opts.length < 4) {
      const g = randomInt(1, 6236);
      const p = fromGlobal(g);
      if (item.answers.includes(`${p.s}:${p.a}`)) continue;
      if (opts.some((o) => o.s === p.s && o.a === p.a)) continue;
      opts.push(p);
    }
    // shuffle options and find the correct index
    const shuffled = opts.map((o) => ({ o, k: Math.random() })).sort((x, y) => x.k - y.k).map((x) => x.o);
    out.push({ clue: item.clue, options: shuffled, correct: shuffled.findIndex((o) => o.s === right[0] && o.a === right[1]) });
  }
  return out;
}

export default function ComprehensiveTestModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('setup');
  const [scope, setScope] = useState<RangeScope>('juz');
  const [num, setNum] = useState(1);
  const [level, setLevel] = useState<TestLevel>('beginner');
  const [starts, setStarts] = useState<{ s: number; a: number }[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [qCorrect, setQCorrect] = useState(0);
  const [scores, setScores] = useState<Partial<Record<PartId, number>>>({});
  const [text, setText] = useState<Map<string, string> | null>(null);
  const [history, setHistory] = useState<SavedResult[]>(() => readResults());
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [rabtIdx, setRabtIdx] = useState(0);

  useEffect(() => { loadText().then(setText); }, []);
  useEscapeClose(true, onClose);

  const lv = LEVELS.find((l) => l.id === level)!;
  const part = PARTS.find((p) => p.id === (step as PartId));

  function start() {
    const { start: a, end: b } = rangeOf(scope, num);
    const picks: { s: number; a: number }[] = [];
    for (let i = 0; i < lv.positions; i++) {
      const g = randomInt(a, Math.max(a, b - 2));
      picks.push(fromGlobal(g));
    }
    setStarts(picks);
    setQuestions(buildQuestions(lv.mutQuestions));
    setScores({});
    setQIndex(0);
    setQCorrect(0);
    setRabtIdx(0);
    setChecks({});
    setStep('tasmee');
  }

  function goNext(current: PartId, value?: number) {
    const nextScores = value === undefined ? scores : { ...scores, [current]: value };
    setScores(nextScores);
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) {
      setChecks({});
      setStep(STEP_ORDER[idx + 1]);
    } else {
      const zero: Record<PartId, number> = { tasmee: 0, mutashabihat: 0, rabt: 0, tajweed: 0, tilawa: 0 };
      const merged: Record<PartId, number> = { ...zero };
      for (const p of PARTS) merged[p.id] = nextScores[p.id] ?? 0;
      const total = totalOf(merged);
      const r: SavedResult = { date: new Date().toISOString(), scope, num, level, scores: merged, total };
      saveResult(r);
      setHistory(readResults());
      setStep('done');
    }
  }

  function answerQuiz(choice: number) {
    const correct = choice === questions[qIndex].correct;
    const nextCorrect = qCorrect + (correct ? 1 : 0);
    if (qIndex + 1 < questions.length) {
      setQCorrect(nextCorrect);
      setQIndex(qIndex + 1);
    } else {
      // Each quiz question is worth 25 / number of questions points.
      const pts = Math.round((nextCorrect / questions.length) * 25);
      setQCorrect(nextCorrect);
      goNext('mutashabihat', pts);
    }
  }

  const surahName = (n: number) => surahLabel(n);
  const textOf = (s: number, a: number) => text?.get(`${s}:${a}`) ?? '';

  // Self-graded parts: user taps a points value from 0 to max.
  function selfGradeBox(id: PartId, max: number, checklist: string[]) {
    const checkedCount = checklist.filter((c) => checks[c]).length;
    const suggested = Math.round((checkedCount / checklist.length) * max);
    return (
      <div className="space-y-3">
        {checklist.length > 0 && (
          <div className="space-y-2">
            {checklist.map((c) => (
              <button key={c} onClick={() => setChecks({ ...checks, [c]: !checks[c] })}
                className={`w-full text-right py-3 px-4 rounded-xl border ${checks[c] ? 'bg-emerald-50 border-emerald-400 text-emerald-800' : 'bg-white border-hairline-emerald text-accent-700'}`}>
                {checks[c] ? '✓ ' : '○ '}{c}
              </button>
            ))}
            <p className="text-sm text-accent-600">الدرجة: {suggested} من {max}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: max + 1 }, (_, i) => i).filter((v) => v % Math.max(1, Math.round(max / 10)) === 0 || v === max).map((v) => (
            <button key={v} onClick={() => goNext(id, v)}
              className="px-3 py-2 rounded-lg bg-gray-100 text-accent-800 font-bold">{v}</button>
          ))}
        </div>
        <button onClick={() => goNext(id, suggested)}
          className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">احفظ الدرجة ({suggested})</button>
      </div>
    );
  }

  const chart = useMemo(() => history.slice(-12), [history]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div dir="rtl" role="dialog" aria-modal="true" aria-label="اختبار شامل" className="bg-white rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-accent-800">اختبار شامل</h2>
          <button onClick={onClose} className="text-accent-600 font-bold px-2">إغلاق</button>
        </div>

        {step === 'setup' && (
          <>
            <p className="text-sm text-accent-600 mb-2">النطاق</p>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {(Object.keys(SCOPE_LABEL) as RangeScope[]).map((k) => (
                <button key={k} onClick={() => { setScope(k); setNum(1); }}
                  className={`py-2 rounded-lg text-sm font-bold ${scope === k ? 'grad-emerald-door text-white' : 'bg-gray-100 text-accent-600'}`}>{SCOPE_LABEL[k]}</button>
              ))}
            </div>
            <div className="mb-4">
              <DrumPicker
                label="اختيار النطاق"
                value={num}
                onChange={(n) => setNum(n)}
                options={Array.from({ length: SCOPE_COUNT[scope] }, (_, i) => i + 1).map((n) => ({
                  value: n,
                  label: scope === 'surah' ? `${n} - ${surahName(n)}` : unitPickLabel(scope, n),
                }))}
              />
            </div>
            <p className="text-sm text-accent-600 mb-2">المستوى</p>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {LEVELS.map((l) => (
                <button key={l.id} onClick={() => setLevel(l.id)}
                  className={`py-3 rounded-xl text-sm font-bold ${level === l.id ? 'grad-amber-door text-white' : 'bg-gray-100 text-accent-600'}`}>{l.name}</button>
              ))}
            </div>
            <button onClick={start} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">احفظ وابدأ</button>

            {history.length > 0 && (
              <div className="mt-6">
                <p className="font-bold text-accent-800 mb-2">تطورك</p>
                <div className="flex items-end gap-1 h-28 bg-gray-50 rounded-lg p-2">
                  {chart.map((r, i) => (
                    <div key={i} title={`${r.total}`} className="flex-1 bg-emerald-500 rounded-t" style={{ height: `${Math.max(4, r.total)}%` }} />
                  ))}
                </div>
                <p className="text-xs text-accent-600 mt-1">آخر {chart.length} اختبار، آخر نتيجة: {history[history.length - 1].total} من 100</p>
              </div>
            )}
          </>
        )}

        {step === 'tasmee' && (
          <>
            <p className="font-bold text-accent-800 mb-1">{PARTS[0].name} — {PARTS[0].max} درجة</p>
            <p className="text-sm text-accent-600 mb-3">ابدأ من المواضع دي، وسمّع {lv.minAyat} لـ {lv.maxAyat} آيات من كل موضع:</p>
            <div className="space-y-2 mb-4">
              {starts.map((p, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 border border-emerald-100">
                  <p className="text-sm font-bold text-accent-700">موضع {i + 1}: {surahName(p.s)} — آية {p.a}</p>
                </div>
              ))}
            </div>
            {selfGradeBox('tasmee', PARTS[0].max, starts.map((p, i) => `الموضع ${i + 1} — سمّعته صح`))}
          </>
        )}

        {step === 'mutashabihat' && (
          <>
            <p className="font-bold text-accent-800 mb-1">{PARTS[1].name} — {PARTS[1].max} درجة</p>
            <p className="text-sm text-accent-600 mb-3">سؤال {qIndex + 1} من {questions.length}: حدّد السورة والآية اللي فيها النص ده</p>
            {questions[qIndex] && (
              <>
                <div className="bg-gray-50 rounded-lg p-4 border border-emerald-100 mb-3">
                  <p className="font-arabic text-xl text-accent-800 leading-loose">{questions[qIndex].clue}</p>
                </div>
                <div className="space-y-2">
                  {questions[qIndex].options.map((o, i) => (
                    <button key={i} onClick={() => answerQuiz(i)}
                      className="w-full text-right py-3 px-4 rounded-xl bg-white border border-hairline-emerald text-accent-800 font-semibold">
                      {surahName(o.s)} — آية {o.a}
                    </button>
                  ))}
                </div>
              </>
            )}
            {questions.length === 0 && <p className="text-accent-600">مفيش أسئلة متاحة الآن.</p>}
          </>
        )}

        {step === 'rabt' && (
          <>
            <p className="font-bold text-accent-800 mb-1">{PARTS[2].name} — {PARTS[2].max} درجة</p>
            <p className="text-sm text-accent-600 mb-3">اكمل الآية اللي بعد الآية دي من الحفظ، ثم قيّم نفسك:</p>
            {starts[rabtIdx] && (
              <div className="bg-gray-50 rounded-lg p-4 border border-emerald-100 mb-3">
                <p className="font-arabic text-lg text-accent-800 leading-loose">{textOf(starts[rabtIdx].s, starts[rabtIdx].a) || `${surahName(starts[rabtIdx].s)} — آية ${starts[rabtIdx].a}`}</p>
                <p className="text-sm text-accent-600 mt-2">الآية اللي بعدها: {surahName(starts[rabtIdx].s)} — آية {starts[rabtIdx].a + 1}</p>
              </div>
            )}
            <div className="flex gap-2 mb-3">
              <button onClick={() => setRabtIdx((i) => (i + 1) % starts.length)} className="flex-1 py-2 bg-gray-100 rounded-lg text-accent-700 font-bold">مكان تاني</button>
            </div>
            {selfGradeBox('rabt', PARTS[2].max, ['ربطت الآية الجاية بصح', 'ربطت بداية الصفحة/المقطع التالي'])}
          </>
        )}

        {step === 'tajweed' && (
          <>
            <p className="font-bold text-accent-800 mb-1">{PARTS[3].name} — {PARTS[3].max} درجة</p>
            <p className="text-sm text-accent-600 mb-3">بنك أسئلة التجويد لسه ما اتعملش، فقيّم نفسك على الأحكام اللي استخرجتها من المقطع:</p>
            {selfGradeBox('tajweed', PARTS[3].max, ['استخرجت أحكام المدود', 'استخرجت أحكام الغنة والإدغام والإقلاب والإخفاء', 'استخرجت أحكام التفخيم والترقيق'])}
          </>
        )}

        {step === 'tilawa' && (
          <>
            <p className="font-bold text-accent-800 mb-1">{PARTS[4].name} — {PARTS[4].max} درجة</p>
            <p className="text-sm text-accent-600 mb-3">اقرأ مقطع بصوتك، وبعدين قيّم نفسك. التطبيق لسه ما بيقيّم الصوت:</p>
            {selfGradeBox('tilawa', PARTS[4].max, ['سلامة المخارج والصفات', 'تطبيق أحكام التجويد', 'حسن الوقف والابتداء'])}
          </>
        )}

        {step === 'done' && (
          <div className="text-center">
            <p className="text-4xl font-bold text-emerald-700 mb-2">{history[history.length - 1]?.total ?? 0}</p>
            <p className="text-accent-600 mb-4">من 100</p>
            <div className="space-y-1 text-right mb-4">
              {PARTS.map((p) => (
                <p key={p.id} className="text-sm text-accent-700">{p.name}: {scores[p.id] ?? 0} من {p.max}</p>
              ))}
            </div>
            <button onClick={() => setStep('setup')} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">اختبار جديد</button>
          </div>
        )}
      </div>
    </div>
  );
}
