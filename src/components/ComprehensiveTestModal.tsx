// الاختبار الشامل (W4-F, 2026-11-19). Every test starts with «أختبرك في أي
// نطاق؟» (surah / juz / first 5 juz / juz 30). Then:
//  - 5 positions x 8 points: 5 words from ONE random reader of the range, the
//    user completes the ayah by voice; the reader corrects ONCE, the 2nd
//    mistake closes the position; ✓/✗ + score after every position.
//  - المتشابهات: oral (the user says the ayat).
//  - التجويد: admin only (question bank, W4-G).  التلاوة: self-graded.
//  «الربط والاستحضار» is out for now. Scores are computed automatically.
import DrumPicker from './DrumReel';
import { unitPickLabel } from '../lib/testRanges';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEscapeClose } from '../lib/useEscape';
import { surahLabel } from '../lib/surahs';
import BANK from '../data/mutashabihat-famous.json';
import { getQuranTextCache, type CachedTextRow } from '../lib/quranTextCache';
import { CORR_RECITERS } from '../lib/juhaniCorr';
import { recitersForRange, planRangeReciters } from '../lib/corrDownload';
import { useIsAdminView } from '../lib/adminPreview';
import type { SkillTier } from '../lib/tajwidSkills';
import { addTestHistoryV1 } from '../lib/testHistory';
import {
  PARTS, MUT_QUESTIONS, activeParts, rangeOf, randomInt, readResults, saveResult, totalOf,
  type PartId, type SavedResult,
} from '../lib/comprehensiveTest';
import DrumSelect from './DrumSelect';
import {
  COMP_COUNT_DEFAULT, COMP_COUNT_OPTIONS, arNum, currentHistoryLevel, pickRoundAyah, positionMax, positionPerfect, positionScore, positionsFinal,
  type PickedAyah, type RoundResult,
} from '../lib/roundTest';
import { pickTajweedQuestions, type TajweedQuestion } from '../lib/tajweedBank';
import RoundRecite, { RoundReveal } from './RoundRecite';
import MutashabihatOral from './MutashabihatOral';

type Step = 'scope' | 'positions' | 'mutashabihat' | 'tajweed' | 'tilawa' | 'done';
type ScopeId = 'surah' | 'juz' | 'first5' | 'juz30';
type Done = { ayah: PickedAyah; result: RoundResult; frac: number; score: number };
type MutQ = { clue: string; answers: string[] };

const SCOPES: { id: ScopeId; label: string }[] = [
  { id: 'surah', label: 'سورة' },
  { id: 'juz', label: 'جزء' },
  { id: 'first5', label: 'أول ٥ أجزاء' },
  { id: 'juz30', label: 'جزء ٣٠' },
];

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

function buildMut(count: number): MutQ[] {
  const pool = [...(BANK as MutQ[])];
  const out: MutQ[] = [];
  while (out.length < count && pool.length > 0) out.push(pool.splice(randomInt(0, pool.length - 1), 1)[0]);
  return out;
}

/** Global ayah range [start, end] (inclusive) of the chosen scope. */
function scopeSpan(id: ScopeId, n: number): { start: number; end: number; label: string } {
  if (id === 'surah') { const r = rangeOf('surah', n); return { start: r.start, end: r.end - 1, label: surahLabel(n) }; }
  if (id === 'juz') { const r = rangeOf('juz', n); return { start: r.start, end: r.end - 1, label: `الجزء ${arNum(n)}` }; }
  if (id === 'first5') return { start: rangeOf('juz', 1).start, end: rangeOf('juz', 5).end - 1, label: 'أول ٥ أجزاء' };
  const r = rangeOf('juz', 30);
  return { start: r.start, end: r.end - 1, label: 'جزء ٣٠' };
}

const tajLevel = (): SkillTier => {
  const l = currentHistoryLevel(true);
  return l === 'master' ? 'hafiz' : l === 'advanced' ? 'veryGood' : 'good' // trial bank has no 'beginner' items yet;
};

export default function ComprehensiveTestModal({ onClose }: { onClose: () => void }) {
  const isAdmin = useIsAdminView();
  const [step, setStep] = useState<Step>('scope');
  const [scopeId, setScopeId] = useState<ScopeId>('juz');
  const [num, setNum] = useState(1);
  const [text, setText] = useState<Map<string, string> | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [reciter, setReciter] = useState('');
  const [count, setCount] = useState(COMP_COUNT_DEFAULT);
  const [positions, setPositions] = useState<Done[]>([]);
  const [cur, setCur] = useState<PickedAyah | null>(null);
  const [showRes, setShowRes] = useState<Done | null>(null);
  const [mut, setMut] = useState<MutQ[]>([]);
  const [mutIdx, setMutIdx] = useState(0);
  const [mutFrac, setMutFrac] = useState<number[]>([]);
  const [tajQ, setTajQ] = useState<TajweedQuestion[]>([]);
  const [tajIdx, setTajIdx] = useState(0);
  const [tajRight, setTajRight] = useState(0);
  const [scores, setScores] = useState<Partial<Record<PartId, number>>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<SavedResult[]>(() => readResults());
  const [saved, setSaved] = useState<SavedResult | null>(null);
  const ctx = useRef<{ span: { start: number; end: number; label: string }; folderAt: (g: number) => string; used: Set<number> } | null>(null);

  useEffect(() => { loadText().then(setText); }, []);
  useEscapeClose(true, onClose);

  const parts = activeParts(isAdmin);
  const maxTotal = parts.reduce((a, p) => a + p.max, 0);
  const reciterName = (f: string) => CORR_RECITERS.find((r) => r.folder === f)?.name ?? f;
  const chart = useMemo(() => history.slice(-12), [history]);

  async function begin() {
    if (!text) { setErr('نص القرآن لسه بيتحمّل — جرّب كمان لحظة'); return; }
    const span = scopeSpan(scopeId, num);
    const options = recitersForRange(span.start, span.end);
    let folderAt: (g: number) => string;
    let chosen = '';
    if (options.length > 0) {
      chosen = options[randomInt(0, options.length - 1)];
      folderAt = () => chosen;
    } else {
      const plan = planRangeReciters(span.start, span.end);
      if (!plan) { setErr('ما فيش قارئ عنده توقيت كلمات للنطاق ده. اختار نطاق تاني.'); return; }
      folderAt = (g) => plan.find((p) => g >= p.start && g <= p.end)?.folder ?? plan[0].folder;
      chosen = plan[0].folder;
    }
    ctx.current = { span, folderAt, used: new Set() };
    setReciter(chosen);
    setErr('');
    setPositions([]);
    setScores({});
    setChecks({});
    setMut(buildMut(MUT_QUESTIONS));
    setMutIdx(0);
    setMutFrac([]);
    setTajQ(pickTajweedQuestions(5, tajLevel()));
    setTajIdx(0);
    setTajRight(0);
    setSaved(null);
    await nextPosition(true);
  }

  async function nextPosition(first = false) {
    const c = ctx.current;
    if (!c || !text) return;
    setBusy(true);
    setShowRes(null);
    const picked = await pickRoundAyah({ start: c.span.start, end: c.span.end }, c.folderAt, text, c.used);
    setBusy(false);
    if (!picked) {
      if (first || positions.length === 0) {
        setErr('النطاق ده ما فيهوش آيات تكفي لموضع (محتاجة أكتر من ٦ كلمات وتوقيت للقارئ). اختار نطاق أكبر.');
        setStep('scope');
        return;
      }
      // Ran out of usable ayat before the chosen count: close with what was played
      // (the /40 is the mean of the played positions, so it stays out of 40).
      setCount(positions.length);
      setScores({ tasmee: positionsFinal(positions.map((p) => p.frac)) });
      setStep('mutashabihat');
      return;
    }
    setCur(picked);
    setStep('positions');
  }

  function onPositionDone(result: RoundResult) {
    if (!cur) return;
    const frac = result.total ? result.credited / result.total : 0;
    const d: Done = { ayah: cur, result, frac, score: positionScore(frac, count) };
    setPositions((p) => [...p, d]);
    setShowRes(d);
  }

  function afterPositions() {
    if (positions.length >= count) {
      setScores({ tasmee: positionsFinal(positions.map((p) => p.frac)) });
      setStep('mutashabihat');
    } else void nextPosition();
  }

  function onMutDone(found: number) {
    const q = mut[mutIdx];
    const frac = q.answers.length ? found / q.answers.length : 0;
    const next = [...mutFrac, frac];
    setMutFrac(next);
    if (mutIdx + 1 < mut.length) setMutIdx(mutIdx + 1);
    else {
      const pts = Math.round((next.reduce((a, b) => a + b, 0) / mut.length) * 25);
      goNext('mutashabihat', pts);
    }
  }

  function answerTajweed(choice: number) {
    const right = tajRight + (choice === tajQ[tajIdx].correct ? 1 : 0);
    setTajRight(right);
    if (tajIdx + 1 < tajQ.length) setTajIdx(tajIdx + 1);
    else goNext('tajweed', Math.round((right / tajQ.length) * partMax('tajweed')));
  }

  function goNext(current: PartId, value: number) {
    const nextScores = { ...scores, [current]: value };
    setScores(nextScores);
    const order: PartId[] = parts.map((p) => p.id).filter((id) => id !== 'tasmee');
    const idx = order.indexOf(current);
    setChecks({});
    if (idx >= 0 && idx < order.length - 1) setStep(order[idx + 1] as Step);
    else finish(nextScores);
  }

  function finish(finalScores: Partial<Record<PartId, number>>) {
    const merged: Record<PartId, number> = { tasmee: 0, mutashabihat: 0, rabt: 0, tajweed: 0, tilawa: 0 };
    for (const p of parts) merged[p.id] = finalScores[p.id] ?? 0;
    const total = Math.round(totalOf(merged) * 10) / 10;
    const span = ctx.current!.span;
    const r: SavedResult = { date: new Date().toISOString(), scope: scopeId === 'surah' ? 'surah' : 'juz', num: scopeId === 'surah' || scopeId === 'juz' ? num : scopeId === 'juz30' ? 30 : 1, level: 'beginner', scores: merged, total, max: maxTotal, label: span.label };
    saveResult(r);
    setHistory(readResults());
    setSaved(r);
    const ear = positions[positions.length - 1]?.result.ear ?? 'manual';
    addTestHistoryV1({
      ts: r.date,
      level: currentHistoryLevel(isAdmin),
      score: Math.round((total / maxTotal) * 100),
      correct: total,
      attempted: maxTotal,
      completed: true,
      mode: 'ayah',
      ear,
      label: `اختبار شامل — ${span.label}`,
      kind: 'comprehensive',
    });
    setStep('done');
  }

  // Self-graded part: tick what was done; the score is computed automatically.
  function selfGradeBox(id: PartId, max: number, checklist: string[]) {
    const score = Math.round((checklist.filter((c) => checks[c]).length / checklist.length) * max);
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          {checklist.map((c) => (
            <button key={c} onClick={() => setChecks({ ...checks, [c]: !checks[c] })}
              className={`w-full text-right py-3 px-4 rounded-xl border ${checks[c] ? 'bg-emerald-50 border-emerald-400 text-emerald-800' : 'bg-white border-hairline-emerald text-accent-700'}`}>
              {checks[c] ? '✓ ' : '○ '}{c}
            </button>
          ))}
          <p className="text-sm text-accent-600">الدرجة: {arNum(score)} من {arNum(max)}</p>
        </div>
        <button onClick={() => goNext(id, score)} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">احفظ</button>
      </div>
    );
  }

  const partMax = (id: PartId) => PARTS.find((p) => p.id === id)!.max;
  const partName = (id: PartId) => PARTS.find((p) => p.id === id)!.name;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div dir="rtl" role="dialog" aria-modal="true" aria-label="اختبار شامل" className="bg-white rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-accent-800">اختبار شامل</h2>
          <button onClick={onClose} className="text-accent-600 font-bold px-2">إغلاق</button>
        </div>

        {step === 'scope' && (
          <>
            <p className="font-bold text-accent-800 mb-3">أختبرك في أي نطاق؟</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {SCOPES.map((k) => (
                <button key={k.id} onClick={() => { setScopeId(k.id); setNum(k.id === 'juz30' ? 30 : 1); }}
                  className={`py-3 rounded-xl text-sm font-bold ${scopeId === k.id ? 'grad-emerald-door text-white' : 'bg-gray-100 text-accent-600'}`}>{k.label}</button>
              ))}
            </div>
            {(scopeId === 'surah' || scopeId === 'juz') && (
              <div className="mb-4">
                <DrumPicker
                  label={scopeId === 'surah' ? 'السورة' : 'الجزء'}
                  value={num}
                  onChange={(n) => setNum(n)}
                  options={Array.from({ length: scopeId === 'surah' ? 114 : 30 }, (_, i) => i + 1).map((n) => ({
                    value: n,
                    label: scopeId === 'surah' ? `${n} - ${surahLabel(n)}` : unitPickLabel('juz', n),
                  }))}
                />
              </div>
            )}
            <div className="mb-3">
              <DrumSelect label="عدد المواضع" value={count} onChange={setCount}
                options={COMP_COUNT_OPTIONS.map((n) => ({ value: n, label: `${arNum(n)} موضع (كل موضع ${arNum(positionMax(n))} درجة)` }))} />
            </div>
            <p className="text-xs text-accent-600 mb-3">التسميع من ٤٠ درجة موزّعة على المواضع اللي تختارها: القارئ بيسمّعك كلمات وانت تكمّل الآية بصوتك. بعدها المتشابهات{isAdmin ? '، التجويد' : ''} والتلاوة.</p>
            {err && <p className="text-sm text-amber-700 mb-3">{err}</p>}
            <button onClick={() => void begin()} disabled={busy || !text} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl disabled:opacity-50">ابدأ</button>

            {history.length > 0 && (
              <div className="mt-6">
                <p className="font-bold text-accent-800 mb-2">تطورك</p>
                <div className="flex items-end gap-1 h-28 bg-gray-50 rounded-lg p-2">
                  {chart.map((r, i) => (
                    <div key={i} title={`${r.total}`} className="flex-1 bg-emerald-500 rounded-t" style={{ height: `${Math.max(4, (r.total / (r.max ?? 100)) * 100)}%` }} />
                  ))}
                </div>
                <p className="text-xs text-accent-600 mt-1">آخر {arNum(chart.length)} اختبار، آخر نتيجة: {arNum(history[history.length - 1].total)} من {arNum(history[history.length - 1].max ?? 100)}</p>
              </div>
            )}
          </>
        )}

        {step === 'positions' && (
          <>
            <p className="font-bold text-accent-800 mb-1">التسميع — الموضع {arNum(Math.min(count, positions.length + (showRes ? 0 : 1)))} من {arNum(count)}</p>
            <p className="text-xs text-accent-600 mb-3">القارئ: {reciterName(reciter)} · غلطة واحدة بيصحّحها، والتانية بتقفل الموضع</p>
            {busy && <p className="text-center text-accent-700 font-bold py-6">بنجهّز الموضع…</p>}
            {!busy && cur && !showRes && <RoundRecite key={positions.length} ayah={cur} corrections={1} onFinish={onPositionDone} />}
            {showRes && (
              <>
                <p className={`text-2xl font-bold mb-2 ${positionPerfect(showRes.result) ? 'text-emerald-700' : 'text-rose-700'}`}>{positionPerfect(showRes.result) ? '✓ صح' : '✗ غلط'}</p>
                <RoundReveal ayah={showRes.ayah} result={showRes.result} />
                <p className="text-sm text-accent-700 mt-1">{surahLabel(showRes.ayah.surah)} — آية {arNum(showRes.ayah.ayah)}</p>
                <p className="text-sm text-accent-800 my-3 font-bold">درجة الموضع: {arNum(showRes.score)} من {arNum(positionMax(count))}{showRes.result.locked ? ' (اتقفل بغلطة تانية)' : ''}</p>
                {err && <p className="text-sm text-amber-700 mb-2">{err}</p>}
                <button onClick={afterPositions} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">
                  {positions.length >= count ? 'كمّل للمتشابهات' : 'الموضع التالي'}
                </button>
              </>
            )}
          </>
        )}

        {step === 'mutashabihat' && mut[mutIdx] && (
          <>
            <p className="font-bold text-accent-800 mb-1">{partName('mutashabihat')} — {arNum(partMax('mutashabihat'))} درجة</p>
            <p className="text-sm text-accent-600 mb-3">سؤال {arNum(mutIdx + 1)} من {arNum(mut.length)}</p>
            <MutashabihatOral key={mutIdx} clue={mut[mutIdx].clue} answers={mut[mutIdx].answers} text={text} onDone={onMutDone} />
          </>
        )}
        {step === 'mutashabihat' && mut.length === 0 && <p className="text-accent-600">مفيش أسئلة متاحة الآن.</p>}

        {step === 'tajweed' && (
          <>
            <p className="font-bold text-accent-800 mb-1">{partName('tajweed')} — {arNum(partMax('tajweed'))} درجة</p>
            <p className="text-xs text-amber-700 mb-3">للأدمن بس — بنك تجريبي، الأسئلة لسه بتتراجع من الدكتور/متخصص.</p>
            {tajQ[tajIdx] ? (
              <>
                <p className="text-sm text-accent-600 mb-2">سؤال {arNum(tajIdx + 1)} من {arNum(tajQ.length)}</p>
                <p className="font-bold text-accent-800 mb-3 leading-loose">{tajQ[tajIdx].question}</p>
                <div className="space-y-2">
                  {tajQ[tajIdx].options.map((o, i) => (
                    <button key={i} onClick={() => answerTajweed(i)} className="w-full text-right py-3 px-4 rounded-xl bg-white border border-hairline-emerald text-accent-800 font-semibold">{o}</button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-accent-600 mb-3">مفيش أسئلة تجويد في البنك للمستوى ده لسه.</p>
                <button onClick={() => goNext('tajweed', 0)} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">كمّل</button>
              </>
            )}
          </>
        )}

        {step === 'tilawa' && (
          <>
            <p className="font-bold text-accent-800 mb-1">{partName('tilawa')} — {arNum(partMax('tilawa'))} درجة</p>
            <p className="text-sm text-accent-600 mb-3">اقرأ مقطع بصوتك، وبعدين قيّم نفسك. التطبيق لسه ما بيقيّم الصوت:</p>
            {selfGradeBox('tilawa', partMax('tilawa'), ['سلامة المخارج والصفات', 'تطبيق أحكام التجويد', 'حسن الوقف والابتداء'])}
          </>
        )}

        {step === 'done' && saved && (
          <div className="text-center">
            <p className="text-4xl font-bold text-emerald-700 mb-2">{arNum(saved.total)}</p>
            <p className="text-accent-600 mb-4">من {arNum(saved.max ?? maxTotal)}</p>
            <div className="space-y-1 text-right mb-4">
              {parts.map((p) => (
                <p key={p.id} className="text-sm text-accent-700">{p.name}: {arNum(saved.scores[p.id] ?? 0)} من {arNum(p.max)}</p>
              ))}
            </div>
            <button onClick={() => { setStep('scope'); setErr(''); }} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">اختبار جديد</button>
          </div>
        )}
      </div>
    </div>
  );
}
