// الاختبار الشامل (2026-11-11 rebuild): recitation only.
// The user picks a range and a level, then recites from 4 random places.
// Each place shows «سمّع من أول قوله تعالى …» with its first words and no
// surah or ayah number. The app listens, grades each place out of 10
// (words recited correctly, minus hesitation), and the chosen correction
// reciter corrects ONE mistake per place; a second mistake closes the place.
// Tajwid and waqf are not graded yet (the engine cannot detect them).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Check, X } from 'lucide-react';
import { useEscapeClose } from '../lib/useEscape';
import { SURAHS, SURAH_AYAH_COUNTS } from '../lib/surahs';
import { getQuranTextCache, type CachedTextRow } from '../lib/quranTextCache';
import { expectedWordList } from '../lib/expectedWords';
import { alignWords, spokenTokens } from '../pages/SelfTestPage';
import { getEar, QuranModelRecognition } from '../lib/quranEar';
import {
  corrAyahUrl, createJuhaniPlayer, loadCorrReciter, planJuhaniWindows, wholeAyahPlan,
  preloadCorrStandIns, getCorrReciter, CORR_RECITERS, type JuhaniPlayer,
} from '../lib/juhaniCorr';
import {
  LEVELS, EXAM_POSITIONS, POSITION_MAX, EXAM_MAX, rangeOf, fromGlobal, randomInt, readResults, saveResult,
  type RangeScope, type TestLevel, type SavedResult,
} from '../lib/comprehensiveTest';

type Step = 'setup' | 'exam' | 'done';
type Phase = 'idle' | 'listening' | 'correcting' | 'finishing' | 'scored';
type Word = { norm: string; orig: string; ayahIdx: number; wordIdx: number };
type Place = { s: number; a: number; words: Word[]; ayahWordCounts: number[]; prompt: string };
type PlaceResult = { score: number; closed: boolean };

const SCOPE_LABEL: Record<RangeScope, string> = { surah: 'سورة', juz: 'جزء', hizb: 'حزب', quarter: 'ربع' };
const SCOPE_COUNT: Record<RangeScope, number> = { surah: 114, juz: 30, hizb: 60, quarter: 240 };
const PROMPT_WORDS = 6;
// Silence limits while listening. Before the first word he is still
// reading the prompt, so the first limit is longer.
const FIRST_WORD_MS = 12000;
const HESITATION_MS = 4000;
const STALL_MS = 8000;
const MAX_HESITATION_PENALTY = 2;

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

function buildPlaces(scope: RangeScope, num: number, ayat: number, text: Map<string, string>): Place[] {
  const { start, end } = rangeOf(scope, num);
  const out: Place[] = [];
  const used = new Set<number>();
  for (let tries = 0; out.length < EXAM_POSITIONS && tries < 80; tries++) {
    const g = randomInt(start, Math.max(start, end - 1));
    if (used.has(g) && tries < 60) continue;
    const p = fromGlobal(g);
    const avail = Math.min(ayat, SURAH_AYAH_COUNTS[p.s - 1] - p.a + 1, end - g);
    // Prefer places with room for at least 2 ayat; accept anything late on
    // so a very short range still gives 4 places.
    if (avail < Math.min(2, ayat) && tries < 40) continue;
    const words: Word[] = [];
    const counts: number[] = [];
    for (let k = 0; k < avail; k++) {
      const t = text.get(`${p.s}:${p.a + k}`);
      if (!t) break;
      const list = expectedWordList(t);
      counts.push(list.length);
      list.forEach((w, wi) => words.push({ norm: w.norm, orig: w.orig, ayahIdx: k, wordIdx: wi }));
    }
    if (words.length === 0) continue;
    used.add(g);
    out.push({ s: p.s, a: p.a, words, ayahWordCounts: counts, prompt: words.slice(0, PROMPT_WORDS).map((w) => w.orig).join(' ') });
  }
  return out;
}

export default function ComprehensiveTestModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('setup');
  const [scope, setScope] = useState<RangeScope>('juz');
  const [num, setNum] = useState(1);
  const [level, setLevel] = useState<TestLevel>('beginner');
  const [text, setText] = useState<Map<string, string> | null>(null);
  const [history, setHistory] = useState<SavedResult[]>(() => readResults());
  const [places, setPlaces] = useState<Place[]>([]);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [heard, setHeard] = useState(0);
  const [err, setErr] = useState('');
  const [finalTotal, setFinalTotal] = useState(0);

  const phaseRef = useRef<Phase>('idle');
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const placeRef = useRef<Place | null>(null);
  const recRef = useRef<any>(null);
  const finalsRef = useRef('');
  const creditedRef = useRef<Set<number>>(new Set());
  const forgivenRef = useRef<Set<number>>(new Set());
  const correctionsRef = useRef(0);
  const hesitationRef = useRef(0);
  const startedRef = useRef(false);
  const hesitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerRef = useRef<JuhaniPlayer | null>(null);
  const examStartRef = useRef(0);
  const resultsRef = useRef<PlaceResult[]>([]);
  const savedRef = useRef(false);

  useEffect(() => { loadText().then(setText); }, []);

  const lv = LEVELS.find((l) => l.id === level)!;
  const surahName = (n: number) => SURAHS.find((x) => x.no === n)?.name ?? `سورة ${n}`;
  const reciterName = CORR_RECITERS.find((r) => r.folder === getCorrReciter())?.name ?? '';

  const clearTimers = () => {
    if (hesitTimerRef.current) { clearTimeout(hesitTimerRef.current); hesitTimerRef.current = null; }
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
    if (guardTimerRef.current) { clearTimeout(guardTimerRef.current); guardTimerRef.current = null; }
  };

  // Drop the recognizer. The on-device ear is aborted so its queued
  // segments do not hold the shared worker.
  const dropRec = () => {
    const r = recRef.current;
    recRef.current = null;
    try { if (r instanceof QuranModelRecognition) r.abort(); else r?.stop(); } catch { /* ignore */ }
  };

  const saveExam = (all: PlaceResult[], completed: boolean) => {
    if (savedRef.current || all.length === 0) return;
    savedRef.current = true;
    const positions = all.map((r) => r.score);
    const total = positions.reduce((a, b) => a + b, 0);
    saveResult({
      date: new Date().toISOString(), scope, num, level,
      scores: { tasmee: total }, total, max: EXAM_MAX, positions,
      seconds: Math.round((Date.now() - examStartRef.current) / 1000), completed,
    });
    setFinalTotal(total);
    setHistory(readResults());
  };

  const scorePlace = (closed: boolean) => {
    if (phaseRef.current === 'scored') return;
    clearTimers();
    dropRec();
    try { playerRef.current?.stop(); } catch { /* ignore */ }
    const pl = placeRef.current;
    const total = pl ? pl.words.length : 0;
    let good = 0;
    creditedRef.current.forEach((i) => { if (!forgivenRef.current.has(i)) good++; });
    let score = total > 0 ? Math.round((POSITION_MAX * good) / total) : 0;
    score = Math.max(0, score - Math.min(MAX_HESITATION_PENALTY, hesitationRef.current));
    const next = [...resultsRef.current, { score, closed }];
    resultsRef.current = next;
    setResults(next);
    setPhase('scored');
  };

  const firstOwed = (): number => {
    const pl = placeRef.current;
    if (!pl) return -1;
    for (let i = 0; i < pl.words.length; i++) {
      if (!creditedRef.current.has(i) && !forgivenRef.current.has(i)) return i;
    }
    return -1;
  };

  const armSilence = () => {
    if (hesitTimerRef.current) clearTimeout(hesitTimerRef.current);
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    if (phaseRef.current !== 'listening') return;
    if (startedRef.current) {
      hesitTimerRef.current = setTimeout(() => { if (phaseRef.current === 'listening') hesitationRef.current += 1; }, HESITATION_MS);
    }
    stallTimerRef.current = setTimeout(() => {
      if (phaseRef.current !== 'listening') return;
      const owed = firstOwed();
      if (owed >= 0) onMistake([owed]);
    }, startedRef.current ? STALL_MS : FIRST_WORD_MS);
  };

  const beginListening = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const useModel = getEar() === 'model' || !SR;
    const rec: any = useModel ? new QuranModelRecognition() : new SR();
    rec.lang = 'ar-SA';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      if (recRef.current !== rec) return;
      startedRef.current = true;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res && res.isFinal && res[0]) finalsRef.current = `${finalsRef.current} ${res[0].transcript}`.trim();
      }
      evaluate();
      armSilence();
    };
    rec.onerror = (e: any) => {
      if (recRef.current !== rec) return;
      const code = e && e.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setErr('الميكروفون مقفول — اسمح بيه من إعدادات المتصفح');
      } else if (code === 'audio-capture') {
        setErr('الميكروفون مشغول بتطبيق تاني أو مش موجود');
      } else {
        return; // transient (no-speech, network, aborted): onend restarts
      }
      clearTimers();
      dropRec();
      setPhase('idle');
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      if (phaseRef.current === 'finishing') { evaluate(); scorePlace(false); return; }
      if (phaseRef.current === 'listening') { try { rec.start(); } catch { /* already started */ } }
    };
    recRef.current = rec;
    try { rec.start(); } catch { setErr('تعذر بدء الاستماع — جرّب تاني'); recRef.current = null; setPhase('idle'); return; }
    setPhase('listening');
    armSilence();
  };

  const onMistake = (missed: number[]) => {
    const pl = placeRef.current;
    if (!pl || phaseRef.current !== 'listening') return;
    // Second mistake in the same place: the place is closed.
    if (correctionsRef.current >= 1) { scorePlace(true); return; }
    correctionsRef.current = 1;
    missed.forEach((i) => forgivenRef.current.add(i));
    clearTimers();
    dropRec();
    setPhase('correcting');
    const first = pl.words[missed[0]];
    const wrong = missed.filter((i) => pl.words[i].ayahIdx === first.ayahIdx).map((i) => pl.words[i].wordIdx);
    const count = pl.ayahWordCounts[first.ayahIdx];
    const ayahNo = pl.a + first.ayahIdx;
    const resume = () => {
      if (phaseRef.current !== 'correcting') return;
      if (guardTimerRef.current) { clearTimeout(guardTimerRef.current); guardTimerRef.current = null; }
      beginListening();
    };
    // The correction is always the reciter's own recording: the mistaken
    // words when he has word timings for this ayah, else the whole ayah.
    const plan = planJuhaniWindows(pl.s, ayahNo, count, wrong) ?? wholeAyahPlan(count);
    if (!playerRef.current) playerRef.current = createJuhaniPlayer();
    guardTimerRef.current = setTimeout(resume, 30000);
    playerRef.current.play({ url: corrAyahUrl(pl.s, ayahNo), segments: plan.segments, rate: 1, onDone: resume, onFail: resume });
  };

  const evaluate = () => {
    const pl = placeRef.current;
    if (!pl) return;
    const al = alignWords(pl.words.map((w) => w.norm), spokenTokens(finalsRef.current));
    al.matched.forEach((m, i) => { if (m) creditedRef.current.add(i); });
    let last = -1;
    creditedRef.current.forEach((i) => { if (i > last) last = i; });
    setHeard(creditedRef.current.size);
    if (phaseRef.current !== 'listening') return;
    if (firstOwed() < 0) { scorePlace(false); return; }
    const missed: number[] = [];
    for (let i = 0; i < last; i++) {
      if (!creditedRef.current.has(i) && !forgivenRef.current.has(i)) missed.push(i);
    }
    if (missed.length > 0) onMistake(missed);
  };

  const resetPlaceState = (pl: Place) => {
    placeRef.current = pl;
    finalsRef.current = '';
    creditedRef.current = new Set();
    forgivenRef.current = new Set();
    correctionsRef.current = 0;
    hesitationRef.current = 0;
    startedRef.current = false;
    setHeard(0);
    setErr('');
    setPhase('idle');
  };

  const start = () => {
    if (!text) { setErr('نص المصحف لسه ما اتحمّلش — جرّب تاني بعد لحظة'); return; }
    const picks = buildPlaces(scope, num, lv.minAyat, text);
    if (picks.length === 0) { setErr('تعذر اختيار مواضع من النطاق ده'); return; }
    void loadCorrReciter().catch(() => undefined);
    try {
      const list: { surah_no: number; ayah_no: number }[] = [];
      picks.forEach((p) => p.ayahWordCounts.forEach((_, k) => list.push({ surah_no: p.s, ayah_no: p.a + k })));
      preloadCorrStandIns(list);
    } catch { /* best-effort */ }
    setPlaces(picks);
    setIdx(0);
    resultsRef.current = [];
    setResults([]);
    savedRef.current = false;
    examStartRef.current = Date.now();
    resetPlaceState(picks[0]);
    setStep('exam');
  };

  // Mic tap: unlock the correction audio inside the gesture (iOS), then listen.
  const tapMic = () => {
    const pl = placeRef.current;
    if (!pl || phaseRef.current !== 'idle') return;
    setErr('');
    if (!playerRef.current) playerRef.current = createJuhaniPlayer();
    try { playerRef.current.unlock(corrAyahUrl(pl.s, pl.a)); } catch { /* ignore */ }
    beginListening();
  };

  // «خلصت»: let the recognizer deliver what it still holds, then grade.
  const tapDone = () => {
    if (phaseRef.current !== 'listening') return;
    clearTimers();
    setPhase('finishing');
    const rec = recRef.current;
    guardTimerRef.current = setTimeout(() => { if (phaseRef.current === 'finishing') { evaluate(); scorePlace(false); } }, 8000);
    try { rec?.stop(); } catch { evaluate(); scorePlace(false); }
  };

  const nextPlace = () => {
    if (idx + 1 < places.length) {
      setIdx(idx + 1);
      resetPlaceState(places[idx + 1]);
    } else {
      saveExam(resultsRef.current, true);
      setStep('done');
    }
  };

  const stopAll = () => {
    clearTimers();
    dropRec();
    try { playerRef.current?.stop(); } catch { /* ignore */ }
  };

  // Closing mid-test keeps what was graded, marked as not completed.
  const handleClose = () => {
    stopAll();
    if (step === 'exam') saveExam(resultsRef.current, false);
    onClose();
  };
  useEscapeClose(true, handleClose);
  useEffect(() => () => {
    clearTimers();
    dropRec();
    try { playerRef.current?.dispose(); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chart = useMemo(() => history.slice(-12), [history]);
  const place = places[idx];
  const lastResult = phase === 'scored' ? results[results.length - 1] : null;
  const lastSaved = history[history.length - 1];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={handleClose}>
      <div dir="rtl" role="dialog" aria-modal="true" aria-label="اختبار شامل" className="bg-white rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-accent-800">اختبار شامل</h2>
          <button onClick={handleClose} className="text-accent-600 font-bold px-2">إغلاق</button>
        </div>

        {step === 'setup' && (
          <>
            <p className="text-base font-bold text-accent-800 mb-2">أختبرك في أي نطاق؟</p>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {(Object.keys(SCOPE_LABEL) as RangeScope[]).map((k) => (
                <button key={k} onClick={() => { setScope(k); setNum(1); }}
                  className={`py-2 rounded-lg text-sm font-bold ${scope === k ? 'grad-emerald-door text-white' : 'bg-gray-100 text-accent-600'}`}>{SCOPE_LABEL[k]}</button>
              ))}
            </div>
            <select value={num} onChange={(e) => setNum(Number(e.target.value))} className="w-full border border-emerald-200 rounded-lg p-2 mb-4">
              {Array.from({ length: SCOPE_COUNT[scope] }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{scope === 'surah' ? `${n} - ${surahName(n)}` : `${SCOPE_LABEL[scope]} ${n}`}</option>
              ))}
            </select>
            <p className="text-sm text-accent-600 mb-2">المستوى</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {LEVELS.map((l) => (
                <button key={l.id} onClick={() => setLevel(l.id)}
                  className={`py-3 rounded-xl text-sm font-bold ${level === l.id ? 'grad-amber-door text-white' : 'bg-gray-100 text-accent-600'}`}>{l.name}</button>
              ))}
            </div>
            <p className="text-sm text-accent-600 mb-4">{EXAM_POSITIONS} مواضع، كل موضع {lv.minAyat} آيات وعليه {POSITION_MAX} درجات.</p>
            {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
            <button onClick={start} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">ابدأ</button>

            {history.length > 0 && (
              <div className="mt-6">
                <p className="font-bold text-accent-800 mb-2">تطورك</p>
                <div className="flex items-end gap-1 h-28 bg-gray-50 rounded-lg p-2">
                  {chart.map((r, i) => (
                    <div key={i} title={`${r.total} من ${r.max ?? 100}`} className="flex-1 bg-emerald-500 rounded-t" style={{ height: `${Math.max(4, Math.round((r.total / (r.max ?? 100)) * 100))}%` }} />
                  ))}
                </div>
                <p className="text-xs text-accent-600 mt-1">آخر {chart.length} اختبار، آخر نتيجة: {lastSaved.total} من {lastSaved.max ?? 100}</p>
              </div>
            )}
          </>
        )}

        {step === 'exam' && place && (
          <>
            <div className="flex items-center justify-center gap-2 mb-4" aria-label="المواضع">
              {places.map((_, i) => {
                const r = results[i];
                const cls = r ? (r.closed ? 'bg-red-100 text-red-700 border-red-300' : 'bg-emerald-100 text-emerald-800 border-emerald-300')
                  : i === idx ? 'bg-amber-100 text-amber-800 border-amber-400' : 'bg-gray-100 text-accent-600 border-gray-200';
                return (
                  <span key={i} className={`w-11 h-11 rounded-full border-2 flex items-center justify-center text-sm font-bold ${cls}`}>
                    {r ? r.score : i + 1}
                  </span>
                );
              })}
            </div>

            <p className="text-sm text-accent-600 mb-1">الموضع {idx + 1} من {places.length}</p>
            <p className="font-bold text-accent-800 mb-2">سمّع من أول قوله تعالى:</p>
            <div className="bg-gray-50 rounded-xl p-4 border border-emerald-100 mb-4">
              <p className="font-arabic text-2xl text-accent-800 leading-loose text-center">﴿ {place.prompt} … ﴾</p>
            </div>

            {phase === 'idle' && (
              <button onClick={tapMic} className="w-full py-4 grad-emerald-door text-white font-bold rounded-xl text-lg flex items-center justify-center gap-2">
                <Mic className="w-6 h-6" /> اضغط وسمّع
              </button>
            )}
            {phase === 'listening' && (
              <>
                <p className="text-center text-emerald-700 font-bold mb-1">بسمعك…</p>
                <p className="text-center text-sm text-accent-600 mb-3">اتسمع {heard} من {place.words.length} كلمة</p>
                <button onClick={tapDone} className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl">خلصت</button>
              </>
            )}
            {phase === 'correcting' && (
              <p className="text-center text-amber-700 font-bold py-3">{reciterName ? `${reciterName} بيصحّح لك — اسمع وكمّل بعده` : 'اسمع التصحيح وكمّل بعده'}</p>
            )}
            {phase === 'finishing' && <p className="text-center text-accent-600 py-3">بحسب الدرجة…</p>}
            {phase === 'scored' && lastResult && (
              <div className="text-center">
                <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-2 ${lastResult.closed ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {lastResult.closed ? <X className="w-9 h-9" /> : <Check className="w-9 h-9" />}
                </div>
                <p className="text-3xl font-bold text-accent-800">{lastResult.score} <span className="text-base font-normal text-accent-600">من {POSITION_MAX}</span></p>
                {lastResult.closed && <p className="text-sm text-red-700 mt-1">غلطة تانية — الموضع اتقفل</p>}
                <p className="text-sm text-accent-600 mt-2">{surahName(place.s)} — من آية {place.a}</p>
                <button onClick={nextPlace} className="w-full mt-4 py-3 grad-emerald-door text-white font-bold rounded-xl">
                  {idx + 1 < places.length ? 'الموضع التالي' : 'النتيجة'}
                </button>
              </div>
            )}
            {err && <p className="text-sm text-red-600 mt-3">{err}</p>}
          </>
        )}

        {step === 'done' && (
          <div className="text-center">
            <p className="text-5xl font-bold text-emerald-700 mb-1">{finalTotal}</p>
            <p className="text-accent-600 mb-4">من {EXAM_MAX}</p>
            <div className="flex items-center justify-center gap-2 mb-5">
              {results.map((r, i) => (
                <span key={i} className={`w-12 h-12 rounded-full border-2 flex items-center justify-center font-bold ${r.closed ? 'bg-red-100 text-red-700 border-red-300' : 'bg-emerald-100 text-emerald-800 border-emerald-300'}`}>{r.score}</span>
              ))}
            </div>
            <p className="text-xs text-accent-600 mb-4">الدرجة على الحفظ والانطلاق. التجويد والوقف لسه مش داخلين في الدرجة.</p>
            <button onClick={() => setStep('setup')} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">اختبار جديد</button>
          </div>
        )}
      </div>
    </div>
  );
}
