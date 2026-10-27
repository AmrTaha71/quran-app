import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { SURAHS, SURAH_AYAH_COUNTS } from '../lib/surahs';
import { UnitKind, EndKind, RangePoint, unitMax, unitLabel, containingUnit, unitStartGlobal, resolveRange, rangeSummary, SURAH_START_GLOBAL, globalToPoint } from '../lib/testRanges';
import { normalizeArabic, normalizeWords } from '../lib/arabicNormalize';
import { currentSpeechLocale } from '../lib/LanguageContext';
import BottomNav from '../components/BottomNav';
import {
  BookOpen, Eye, Check, X, ChevronLeft, ChevronRight, RotateCcw,
  Mic, Square, Award, Home,
} from 'lucide-react';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test';

interface TestAyah {
  id: number;
  surah_no: number;
  ayah_no: number;
  ayah_text: string;
}

interface TestRecord {
  date: string;
  surah: number;
  surahName: string;
  from: number;
  to: number;
  total: number;
  correct: number;
  // Cross-surah ranges (unit mode): start = surah/from, end below.
  startGlobal?: number;
  endGlobal?: number;
  endSurah?: number;
  endSurahName?: string;
  endAyah?: number;
}

const HISTORY_KEY = 'quran-test-history';
const TARGET_KEY = 'quran-mushaf-target';
// Quiet gap after the last heard word before the reading is judged:
// the user has paused, so the utterance is (probably) complete.
const QUIET_GAP_MS = 1500;
// Self-correction window after a mismatch, in seconds (the user's spec).
const CORRECT_WINDOW_S = 5;

function loadHistory(): TestRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    // Shape-validate: a corrupt record used to render NaN% in the list.
    return arr.filter((r) => r && typeof r.correct === 'number' && typeof r.total === 'number' && Number.isFinite(r.correct) && Number.isFinite(r.total));
  } catch {
    return [];
  }
}

// Unfinished-test progress (persist + resume): leaving mid-test
// used to destroy the test silently, because progress lived only in
// component state. Now every grade/skip/index change saves here, and
// the setup screen offers to resume it.
const PROGRESS_KEY = 'quran-test-progress';
interface TestProgress {
  surah: number;
  from: number;
  to: number;
  index: number;
  grades: boolean[];
  skipped: boolean[];
  startGlobal?: number;
  endGlobal?: number;
  endSurah?: number;
  endAyah?: number;
}
function loadProgress(): TestProgress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p.surah === 'number' && typeof p.from === 'number' && typeof p.to === 'number' && typeof p.index === 'number' && Array.isArray(p.grades) && Array.isArray(p.skipped)) {
      // Old records (single-surah) carry no globals: derive them so
      // resume always runs on a global range.
      const base = SURAH_START_GLOBAL[p.surah - 1] || 1;
      if (typeof p.startGlobal !== 'number') p.startGlobal = base + p.from - 1;
      if (typeof p.endGlobal !== 'number') p.endGlobal = base + p.to - 1;
      if (typeof p.endSurah !== 'number') p.endSurah = p.surah;
      if (typeof p.endAyah !== 'number') p.endAyah = p.to;
      return p as TestProgress;
    }
    return null;
  } catch {
    return null;
  }
}
function saveProgress(p: TestProgress) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch {}
}

// Expected ayah words, keeping the original (diacritized) form for
// display and the normalized form for comparison. Tokens with no
// Arabic letter in them (ayah-end markers, digits) are dropped
// defensively so they can never count as "missed" words.
function expectedWordList(ayahText: string): { orig: string; norm: string }[] {
  return ayahText
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ orig: w, norm: cleanToken(normalizeArabic(w)) }))
    .filter((x) => x.norm.length > 0 && /[\u0621-\u064A]/.test(x.norm));
}

// Spoken tokens for comparison: the normalizer strips diacritics but
// NOT punctuation, so a transcript "والله،" never equaled "والله".
// Strip every non-Arabic letter from both sides before aligning.
function cleanToken(t: string): string {
  return t.replace(/[^\u0621-\u064A]/g, '');
}
function spokenTokens(text: string): string[] {
  return normalizeWords(text).map(cleanToken).filter(Boolean);
}

// Greedy in-order alignment: every expected word must appear in the
// spoken words, in order. Extra spoken words (basmalah, isti'adha,
// a repeated word) are ignored — they never consume an expected word.
// A skipped or misspoken word stays unmatched: that is the wrong part.
// Joined words: mushaf tokens are sometimes written joined
// (يَـٰٓأَيُّهَا -> one token) while speech splits them (يا + أيها),
// and vice versa (مِن + مَّا spoken as one مما, with the ن assimilated
// into the م). A bounded 2-token lookahead on both sides handles
// these without ever matching out of order.
function alignWords(expected: string[], spoken: string[]): { matched: boolean[]; allMatched: boolean } {
  const matched = new Array(expected.length).fill(false);
  let j = 0;
  let i = 0;
  while (i < expected.length) {
    let found = -1;
    for (let k = j; k < spoken.length; k++) {
      if (spoken[k] === expected[i]) { found = k; break; }
    }
    if (found >= 0) { matched[i] = true; j = found + 1; i++; continue; }
    let joined = -1;
    for (let k = j; k + 1 < spoken.length; k++) {
      if (spoken[k] + spoken[k + 1] === expected[i]) { joined = k; break; }
    }
    if (joined >= 0) { matched[i] = true; j = joined + 2; i++; continue; }
    if (i + 1 < expected.length) {
      const pair = expected[i] + expected[i + 1];
      const assimilated = expected[i].endsWith('ن') && expected[i + 1].startsWith('م')
        ? expected[i].slice(0, -1) + expected[i + 1]
        : '';
      let foundPair = -1;
      for (let k = j; k < spoken.length; k++) {
        if (spoken[k] === pair || (assimilated && spoken[k] === assimilated)) { foundPair = k; break; }
      }
      if (foundPair >= 0) { matched[i] = true; matched[i + 1] = true; j = foundPair + 1; i += 2; continue; }
    }
    i++;
  }
  return { matched, allMatched: matched.every(Boolean) };
}

// ---- Sounds (WebAudio, no files) -------------------------------------
// The AudioContext is created/resumed inside the mic-start tap (a user
// gesture), so later timer-triggered playback is allowed by autoplay
// policies. The wrong sound is deliberately unmistakable — the user
// corrected "gentle" to a clear wrong-answer "تن": a low, dissonant
// square-wave buzz, clearly audible, but short and free of high
// frequencies, so it is not painful or harsh.
let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}
function playWrongBuzzer() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.setValueAtTime(0.22, t + 0.45);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    gain.connect(ctx.destination);
    // Two detuned low square waves: the beating between them is the
    // classic wrong-answer buzz.
    [138, 146].forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 0.8, t + 0.45);
      o.connect(gain);
      o.start(t);
      o.stop(t + 0.55);
    });
  } catch {}
}
function playCorrectChime() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    gain.connect(ctx.destination);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    o.frequency.linearRampToValueAtTime(1320, t + 0.2);
    o.connect(gain);
    o.start(t);
    o.stop(t + 0.3);
  } catch {}
}

// Mic-graded self-test (تسميع) v2.
//
// Flow per ayah: the text stays HIDDEN. The user taps the Mic button
// and recites; the live transcript is compared word by word with the
// expected ayah (same cross-rasm normalization as search). All words
// correct -> the ayah reveals in GREEN. A mismatch -> a 5-second
// window to self-correct (still listening; a corrected reading that
// matches counts as correct). Still wrong after 5s -> the wrong-answer
// buzzer plays and ONLY the wrong part (the mismatched/missing words)
// reveals in RED, flashing — never the whole ayah.
//
// When the live engine is unavailable, the page falls back to v1's
// manual self-grading (reveal + صح/خطأ) with a clear notice, and never
// spends OpenAI balance silently.
//
// Implementation note (learned from a past blank-screen regression):
// no useCallback here at all. Recognition handlers only touch refs
// and setState setters, never render-scope state values, so they can
// never read a stale ayah, index, or grade.
type MicState = 'idle' | 'listening' | 'correcting' | 'done-correct' | 'done-wrong';

export default function SelfTestPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const [phase, setPhase] = useState<'setup' | 'testing' | 'done'>('setup');
  const [surah, setSurah] = useState(2);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(5);
  // Unit mode: start at the beginning of a surah/juz/hizb/quarter and
  // end at the end of that unit, or at the end of a juz/hizb/surah.
  const [startKind, setStartKind] = useState<UnitKind>('surah');
  const [startNum, setStartNum] = useState(2);
  const [endKind, setEndKind] = useState<EndKind>('same');
  const [endNum, setEndNum] = useState(2);
  const [rangeStart, setRangeStart] = useState<RangePoint | null>(null);
  const [rangeEnd, setRangeEnd] = useState<RangePoint | null>(null);
  const unitPreview = resolveRange(startKind, startNum, endKind, endNum);
  const unitPreviewValid = unitPreview.end.global >= unitPreview.start.global;
  const [ayahs, setAyahs] = useState<TestAyah[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grades, setGrades] = useState<boolean[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<TestRecord[]>(loadHistory);

  // Mic flow state (per ayah; reset on every ayah change).
  const [micSupported] = useState(() => {
    try {
      return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    } catch {
      return false;
    }
  });
  const [micState, setMicState] = useState<MicState>('idle');
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [countdown, setCountdown] = useState(CORRECT_WINDOW_S);
  const [wrongIndices, setWrongIndices] = useState<number[]>([]);
  const [wrongByAyah, setWrongByAyah] = useState<Record<number, string[]>>({});
  const [skipped, setSkipped] = useState<boolean[]>([]);
  const [micError, setMicError] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [savedProgress, setSavedProgress] = useState<TestProgress | null>(loadProgress);

  // Manual preference survives ayah changes (the old code reset it
  // every ayah, so a manual user had to re-tap it each time).
  const manualPreferredRef = useRef(false);

  // Refs: the single source of truth inside recognition callbacks.
  const recRef = useRef<any>(null);
  const userStopRef = useRef(false);
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windowTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveRef = useRef({
    ayah: null as TestAyah | null,
    finals: '',
    micState: 'idle' as MicState,
    grades: [] as boolean[],
    skipped: [] as boolean[],
    correctingTargets: [] as string[],
    windowStartLen: 0,
  });

  const surahCount = SURAH_AYAH_COUNTS[surah - 1] || 1;
  const surahName = SURAHS.find((s) => s.no === surah)?.name || '';

  const clearTimers = () => {
    if (quietTimerRef.current) { clearTimeout(quietTimerRef.current); quietTimerRef.current = null; }
    if (windowTimerRef.current) { clearInterval(windowTimerRef.current); windowTimerRef.current = null; }
  };

  const stopRec = () => {
    userStopRef.current = true;
    try { recRef.current?.stop(); } catch {}
    recRef.current = null;
  };

  // Reset every per-ayah mic/manual state (called on ayah change, on
  // test start, and when the user stops listening mid-ayah).
  const resetMicState = () => {
    stopRec();
    clearTimers();
    liveRef.current.finals = '';
    liveRef.current.micState = 'idle';
    setMicState('idle');
    setTranscript('');
    setInterim('');
    setCountdown(CORRECT_WINDOW_S);
    setWrongIndices([]);
    setMicError('');
    setManualMode(manualPreferredRef.current);
  };

  // Stop everything on unmount. This MUST go through stopRec (not a
  // bare stop()): stop() fires onend asynchronously, and onend
  // restarts recognition unless userStopRef is set — the old bare
  // stop() here left the mic running on a detached page. Deps [] on
  // purpose: only refs are touched.
  useEffect(() => () => {
    stopRec();
    clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Progress for the CURRENT range: globals are the truth (a range
  // can span surahs), surah/from/to stay as the display start/end.
  const makeProgress = (index0: number, grades0: boolean[], skipped0: boolean[]): TestProgress => {
    const s = rangeStart || globalToPoint((SURAH_START_GLOBAL[surah - 1] || 1) + from - 1);
    const e = rangeEnd || globalToPoint((SURAH_START_GLOBAL[surah - 1] || 1) + to - 1);
    return { surah: s.surah, from: s.ayah, to: e.ayah, index: index0, grades: grades0, skipped: skipped0, startGlobal: s.global, endGlobal: e.global, endSurah: e.surah, endAyah: e.ayah };
  };

  // Global-range test (unit mode + resume): verse ids are sequential
  // 1..6236 in surah order, so id range = global ayah range.
  const startTestGlobal = async (startGlobal: number, endGlobal: number, restore: { index: number; grades: boolean[]; skipped: boolean[] } | null = null) => {
    const lo = Math.max(1, Math.min(startGlobal, endGlobal, 6236));
    const hi = Math.min(Math.max(startGlobal, endGlobal), 6236);
    const startPt = globalToPoint(lo);
    const endPt = globalToPoint(hi);
    setSurah(startPt.surah);
    setError('');
    setLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from('quran_verses')
        .select('id, surah_no, ayah_no, ayah_text')
        .gte('id', lo)
        .lte('id', hi)
        .order('id', { ascending: true });
      if (qErr) throw qErr;
      if (!data || data.length === 0) {
        setError('لم أجد آيات في هذا النطاق — جرّب نطاقًا آخر');
        setLoading(false);
        return;
      }
      setFrom(startPt.ayah);
      setTo(endPt.ayah);
      setRangeStart(startPt);
      setRangeEnd(endPt);
      setAyahs(data as TestAyah[]);
      const n = data.length;
      const fresh = new Array(n).fill(false);
      const grades0 = restore && Array.isArray(restore.grades) && restore.grades.length === n ? restore.grades.map(Boolean) : fresh;
      const skipped0 = restore && Array.isArray(restore.skipped) && restore.skipped.length === n ? restore.skipped.map(Boolean) : fresh.slice();
      const index0 = restore ? Math.max(0, Math.min(restore.index, n - 1)) : 0;
      setGrades(grades0);
      liveRef.current.grades = grades0;
      setSkipped(skipped0);
      liveRef.current.skipped = skipped0;
      setWrongByAyah({});
      setWrongIndices([]);
      setIndex(index0);
      setRevealed(false);
      liveRef.current.ayah = (data as TestAyah[])[index0];
      resetMicState();
      const prog: TestProgress = { surah: startPt.surah, from: startPt.ayah, to: endPt.ayah, index: index0, grades: grades0, skipped: skipped0, startGlobal: lo, endGlobal: hi, endSurah: endPt.surah, endAyah: endPt.ayah };
      saveProgress(prog);
      setSavedProgress(prog);
      setPhase('testing');
    } catch {
      setError('تعذر تحميل الآيات — تأكد من الاتصال بالإنترنت');
    } finally {
      setLoading(false);
    }
  };

  // Manual mode wrapper: single-surah ayah range -> global range.
  const startTest = async (surahNo: number = surah, fromNo: number = from, toNo: number = to, restore: { index: number; grades: boolean[]; skipped: boolean[] } | null = null) => {
    const count = SURAH_AYAH_COUNTS[surahNo - 1] || 1;
    const lo = Math.max(1, Math.min(fromNo, toNo, count));
    const hi = Math.min(Math.max(fromNo, toNo), count);
    const base = SURAH_START_GLOBAL[surahNo - 1] || 1;
    return startTestGlobal(base + lo - 1, base + hi - 1, restore);
  };

  const resumeTest = () => {
    const p = savedProgress;
    if (!p) return;
    if (typeof p.startGlobal === 'number' && typeof p.endGlobal === 'number') {
      void startTestGlobal(p.startGlobal, p.endGlobal, { index: p.index, grades: p.grades, skipped: p.skipped });
    } else {
      void startTest(p.surah, p.from, p.to, { index: p.index, grades: p.grades, skipped: p.skipped });
    }
  };

  // Manual v1 grading (fallback path + manual override): grades the
  // current ayah and advances, or finishes on the last one.
  const grade = (ok: boolean) => {
    // Manual grading was silent while the mic path plays sounds —
    // parity: the same chime/buzzer, fired from the tap gesture so
    // autoplay policies allow it.
    if (ok) playCorrectChime(); else playWrongBuzzer();
    const next = [...liveRef.current.grades];
    next[index] = ok;
    liveRef.current.grades = next;
    setGrades(next);
    // Grading an ayah clears its skipped flag (e.g. going back to a
    // skipped ayah and grading it must not leave it "skipped").
    const nextSkipped = [...liveRef.current.skipped];
    nextSkipped[index] = false;
    liveRef.current.skipped = nextSkipped;
    setSkipped(nextSkipped);
    if (index + 1 < ayahs.length) {
      const nextAyah = ayahs[index + 1];
      liveRef.current.ayah = nextAyah;
      setIndex(index + 1);
      setRevealed(false);
      resetMicState();
      saveProgress(makeProgress(index + 1, next, nextSkipped));
    } else {
      finishTest(next);
    }
  };

  const finishTest = (finalGrades: boolean[]) => {
    stopRec();
    clearTimers();
    const correct = finalGrades.filter(Boolean).length;
    const skippedCount = liveRef.current.skipped.filter(Boolean).length;
    const attempted = Math.max(0, ayahs.length - skippedCount);
    const rec: TestRecord = {
      date: new Date().toISOString().slice(0, 10),
      surah,
      surahName,
      from,
      to,
      total: attempted,
      correct,
      startGlobal: rangeStart?.global,
      endGlobal: rangeEnd?.global,
      endSurah: rangeEnd?.surah,
      endSurahName: rangeEnd ? (SURAHS.find((s) => s.no === rangeEnd.surah)?.name || '') : undefined,
      endAyah: rangeEnd?.ayah,
    };
    const nextHistory = [rec, ...history].slice(0, 20);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory)); } catch {}
    setHistory(nextHistory);
    setPhase('done');
    try { localStorage.removeItem(PROGRESS_KEY); } catch {}
    setSavedProgress(null);
  };

  // ---- Mic engine ----------------------------------------------------
  const gradeMic = (ok: boolean) => {
    const ayah = liveRef.current.ayah;
    if (!ayah) return;
    stopRec();
    clearTimers();
    const next = [...liveRef.current.grades];
    next[index] = ok;
    liveRef.current.grades = next;
    setGrades(next);
    const nextSkipped = [...liveRef.current.skipped];
    nextSkipped[index] = false;
    liveRef.current.skipped = nextSkipped;
    setSkipped(nextSkipped);
    saveProgress(makeProgress(index, next, nextSkipped));
    if (ok) {
      playCorrectChime();
      liveRef.current.micState = 'done-correct';
      setMicState('done-correct');
    } else {
      playWrongBuzzer();
      const expected = expectedWordList(ayah.ayah_text);
      const spoken = spokenTokens(liveRef.current.finals);
      const { matched } = alignWords(expected.map((w) => w.norm), spoken);
      setWrongIndices(expected.map((_, i) => i).filter((i) => !matched[i]));
      setWrongByAyah((prev) => ({ ...prev, [index]: expected.filter((_, i) => !matched[i]).map((w) => w.orig) }));
      liveRef.current.micState = 'done-wrong';
      setMicState('done-wrong');
    }
  };

  const evaluateNow = () => {
    const ayah = liveRef.current.ayah;
    if (!ayah) return;
    if (liveRef.current.micState !== 'listening' && liveRef.current.micState !== 'correcting') return;
    const expected = expectedWordList(ayah.ayah_text);
    const spoken = spokenTokens(liveRef.current.finals);
    if (spoken.length === 0) return;
    // During the correction window, only the words that were wrong
    // count — and only from speech AFTER the window opened. The old
    // code re-checked the whole accumulated transcript, so reciting
    // in pieces across the window passed without a full reading.
    if (liveRef.current.micState === 'correcting') {
      const targets = liveRef.current.correctingTargets;
      if (targets.length > 0) {
        const { allMatched } = alignWords(targets, spoken.slice(liveRef.current.windowStartLen));
        if (allMatched) gradeMic(true);
      }
      return;
    }
    const { allMatched, matched } = alignWords(expected.map((w) => w.norm), spoken);
    if (allMatched) {
      gradeMic(true);
      return;
    }
    // Mismatch: open the 5s correction window (still listening).
    // Record what was wrong and where the transcript stood, so the
    // window judges only the correction, not the old speech.
    if (liveRef.current.micState === 'listening') {
      liveRef.current.correctingTargets = expected.filter((_, i) => !matched[i]).map((w) => w.norm);
      liveRef.current.windowStartLen = spoken.length;
      liveRef.current.micState = 'correcting';
      setMicState('correcting');
      setCountdown(CORRECT_WINDOW_S);
      if (windowTimerRef.current) clearInterval(windowTimerRef.current);
      let left = CORRECT_WINDOW_S;
      windowTimerRef.current = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          if (windowTimerRef.current) clearInterval(windowTimerRef.current);
          windowTimerRef.current = null;
          gradeMic(false);
        } else {
          setCountdown(left);
        }
      }, 1000);
    }
  };

  // The "خلصت، قيّمها" button: unlike the timer paths (which must
  // stay silent), a tap with zero spoken words gets a hint instead
  // of silently doing nothing.
  const evaluatePressed = () => {
    if (spokenTokens(liveRef.current.finals).length === 0 && (liveRef.current.micState === 'listening' || liveRef.current.micState === 'correcting')) {
      setMicError('لسه ما سمعت حاجة — اقرأ الآية الأول وبعدين اضغط "خلصت، قيّمها"');
      return;
    }
    evaluateNow();
  };

  const scheduleQuietEvaluate = () => {
    if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
    quietTimerRef.current = setTimeout(() => { evaluateNow(); }, QUIET_GAP_MS);
  };

  const startMic = () => {
    const ayah = liveRef.current.ayah;
    if (!ayah) return;
    // Warm the audio context inside this tap so the later grading
    // sounds (timer-triggered) are allowed to play.
    getAudioCtx();
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setMicError('المتصفح ده مش بيدعم التسميع بالميكروفون — قيّم يدوي بدل كده');
      return;
    }
    if (liveRef.current.micState === 'listening' || liveRef.current.micState === 'correcting') return;
    setMicError('');
    liveRef.current.finals = '';
    liveRef.current.correctingTargets = [];
    liveRef.current.windowStartLen = 0;
    setTranscript('');
    setInterim('');
    setWrongIndices([]);
    userStopRef.current = false;
    const rec = new SR();
    rec.lang = currentSpeechLocale();
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        // isFinal lives on the RESULT, not its first alternative —
        // reading it off the alternative made every final look
        // interim, so mic grading could never fire (same bug as
        // follow-the-imam). Check both for quirk engines.
        const res = e.results[i];
        const r = res[0];
        if (res.isFinal || r.isFinal) {
          liveRef.current.finals = `${liveRef.current.finals} ${r.transcript}`.trim();
          setTranscript(liveRef.current.finals);
          // Spoken enough words to cover the ayah? Judge at once.
          const expectedLen = expectedWordList(liveRef.current.ayah?.ayah_text || '').length;
          if (spokenTokens(liveRef.current.finals).length >= expectedLen) {
            evaluateNow();
          } else {
            scheduleQuietEvaluate();
          }
        } else {
          interimText += `${r.transcript} `;
        }
      }
      if (interimText.trim()) setInterim(interimText.trim());
    };
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed') {
        setMicError('الميكروفون مقفول — اسمح بيه من إعدادات المتصفح، أو قيّم يدوي بدل كده');
      } else if (e.error === 'network') {
        setMicError('الاستماع المباشر محتاج إنترنت — أو قيّم يدوي بدل كده');
      } else {
        setMicError('تعذر الاستماع — جرّب تاني أو قيّم يدوي بدل كده');
      }
      stopRec();
      clearTimers();
      liveRef.current.micState = 'idle';
      setMicState('idle');
    };
    rec.onend = () => {
      // Browsers pause recognition after silence; resume while the
      // user is still mid-ayah, unless they stopped or were graded.
      if (!userStopRef.current && (liveRef.current.micState === 'listening' || liveRef.current.micState === 'correcting')) {
        try {
          rec.start();
        } catch {
          setMicError('الاستماع وقف — اضغط الميكروفون تاني');
          liveRef.current.micState = 'idle';
          setMicState('idle');
        }
      }
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setMicError('تعذر بدء الاستماع — جرّب تاني أو قيّم يدوي بدل كده');
      recRef.current = null;
      return;
    }
    liveRef.current.micState = 'listening';
    setMicState('listening');
  };

  // Advance after a mic grade (the user reads the green ayah / red
  // wrong part first, then moves on deliberately — no auto-advance).
  const nextAfterMic = () => {
    if (index + 1 < ayahs.length) {
      const nextAyah = ayahs[index + 1];
      liveRef.current.ayah = nextAyah;
      setIndex(index + 1);
      setRevealed(false);
      resetMicState();
      saveProgress(makeProgress(index + 1, liveRef.current.grades, liveRef.current.skipped));
    } else {
      finishTest(liveRef.current.grades);
    }
  };

  const goToAyah = (i: number) => {
    if (i < 0 || i >= ayahs.length) return;
    liveRef.current.ayah = ayahs[i];
    setIndex(i);
    setRevealed(false);
    resetMicState();
    saveProgress(makeProgress(i, liveRef.current.grades, liveRef.current.skipped));
  };

  // Skipping is its own state now: a skipped ayah is NOT a failed
  // one — it leaves the missed list and the score, and is reported
  // separately as "تخطيت".
  const skipAyah = () => {
    const nextSkipped = [...liveRef.current.skipped];
    nextSkipped[index] = true;
    liveRef.current.skipped = nextSkipped;
    setSkipped(nextSkipped);
    if (index + 1 < ayahs.length) {
      saveProgress(makeProgress(index + 1, liveRef.current.grades, nextSkipped));
      goToAyah(index + 1);
    } else {
      finishTest(liveRef.current.grades);
    }
  };

  const correct = grades.filter(Boolean).length;
  const skippedCount = skipped.filter(Boolean).length;
  const attempted = Math.max(0, ayahs.length - skippedCount);
  const missed = ayahs.filter((_, i) => !grades[i] && !skipped[i]);
  const pct = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
  const currentDone = revealed || micState === 'done-correct' || micState === 'done-wrong';

  const openInMushaf = (surahNo: number, ayahNo: number) => {
    try { localStorage.setItem(TARGET_KEY, JSON.stringify({ surah: surahNo, ayah: ayahNo })); } catch {}
    onNavigate('mushaf');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-stone-50/30 pb-24">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-emerald-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-lg">
            <Mic className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-accent-800">سمّع لنفسك</h1>
            <p className="text-sm text-accent-500">{micSupported ? 'سمّع من حفظك، والبرنامج يصحح لك بالميكروفون' : 'سمّع من حفظك، وقيّم نفسك يدوي (جهازك مش بيدعم الميكروفون)'}</p>
          </div>
          <button onClick={() => onNavigate('app')}
            className="mr-auto flex items-center gap-1.5 px-3 py-2 text-sm text-accent-600 hover:bg-gray-100 rounded-lg">
            <Home className="w-5 h-5" /> لوحتي
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {phase === 'setup' && (
          <div className="space-y-5">
            {savedProgress && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl shadow-sm p-5">
                <p className="font-bold text-accent-800 mb-1">عندك اختبار غير مكتمل</p>
                <p className="text-sm text-accent-600 mb-3">
                  {savedProgress.endSurah && savedProgress.endSurah !== savedProgress.surah
                    ? <>من سورة {SURAHS.find((s) => s.no === savedProgress.surah)?.name || ''} آية {savedProgress.from.toLocaleString('ar-EG')} إلى سورة {SURAHS.find((s) => s.no === savedProgress.endSurah)?.name || ''} آية {(savedProgress.endAyah || savedProgress.to).toLocaleString('ar-EG')}</>
                    : <>سورة {SURAHS.find((s) => s.no === savedProgress.surah)?.name || ''} — من آية {savedProgress.from.toLocaleString('ar-EG')} إلى آية {savedProgress.to.toLocaleString('ar-EG')}</>}
                  ، واقف عند الآية رقم {savedProgress.index + 1}
                </p>
                <div className="flex gap-3">
                  <button onClick={resumeTest}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl">
                    استكمال الاختبار
                  </button>
                  <button onClick={() => { try { localStorage.removeItem(PROGRESS_KEY); } catch {} setSavedProgress(null); }}
                    className="px-5 py-2.5 bg-white border border-gray-200 text-accent-700 font-bold rounded-xl">
                    تجاهل
                  </button>
                </div>
              </div>
            )}
            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 space-y-4">
              <h2 className="font-bold text-accent-800">بالوحدة: من أول … إلى نهاية …</h2>
              <p className="text-sm text-accent-500 leading-relaxed">
                ابدأ من أول سورة أو جزء أو حزب أو ربع، واخلص عند نهاية نفس الوحدة، أو عند نهاية حزب أو جزء أو سورة.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-bold text-accent-700">يبدأ من أول</span>
                  <select value={startKind}
                    onChange={(e) => {
                      const k = e.target.value as UnitKind;
                      const n = k === 'surah' ? 2 : 1;
                      setStartKind(k);
                      setStartNum(n);
                      if (endKind !== 'same') setEndNum(containingUnit(endKind, unitStartGlobal(k, n)));
                    }}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300">
                    <option value="surah">سورة</option>
                    <option value="juz">جزء</option>
                    <option value="hizb">حزب</option>
                    <option value="quarter">ربع</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-accent-700">{startKind === 'surah' ? 'السورة' : startKind === 'juz' ? 'رقم الجزء' : startKind === 'hizb' ? 'رقم الحزب' : 'رقم الربع'}</span>
                  {startKind === 'surah' ? (
                    <select value={startNum} onChange={(e) => setStartNum(Number(e.target.value))}
                      className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300">
                      {SURAHS.map((s) => (<option key={s.no} value={s.no}>{s.no} — سورة {s.name}</option>))}
                    </select>
                  ) : (
                    <input type="number" min={1} max={unitMax(startKind)} value={startNum}
                      onChange={(e) => setStartNum(Math.max(1, Math.min(unitMax(startKind), Number(e.target.value) || 1)))}
                      className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                  )}
                </label>
              </div>
              <p className="text-sm text-accent-500">
                يبدأ من: سورة {SURAHS.find((s) => s.no === unitPreview.start.surah)?.name || ''} آية {unitPreview.start.ayah.toLocaleString('ar-EG')} ({unitLabel(startKind, startNum)})
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-bold text-accent-700">لغاية نهاية</span>
                  <select value={endKind}
                    onChange={(e) => {
                      const k = e.target.value as EndKind;
                      setEndKind(k);
                      if (k !== 'same') setEndNum(containingUnit(k, unitStartGlobal(startKind, startNum)));
                    }}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300">
                    <option value="same">نفس الوحدة</option>
                    <option value="hizb">حزب</option>
                    <option value="juz">جزء</option>
                    <option value="surah">سورة</option>
                  </select>
                </label>
                {endKind !== 'same' && (
                  <label className="block">
                    <span className="text-sm font-bold text-accent-700">{endKind === 'surah' ? 'السورة' : endKind === 'juz' ? 'رقم الجزء' : 'رقم الحزب'}</span>
                    {endKind === 'surah' ? (
                      <select value={endNum} onChange={(e) => setEndNum(Number(e.target.value))}
                        className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300">
                        {SURAHS.map((s) => (<option key={s.no} value={s.no}>{s.no} — سورة {s.name}</option>))}
                      </select>
                    ) : (
                      <input type="number" min={1} max={unitMax(endKind)} value={endNum}
                        onChange={(e) => setEndNum(Math.max(1, Math.min(unitMax(endKind), Number(e.target.value) || 1)))}
                        className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                    )}
                  </label>
                )}
              </div>
              {unitPreviewValid ? (
                <p className="text-sm font-bold text-emerald-700">{rangeSummary(unitPreview.start, unitPreview.end)}</p>
              ) : (
                <p className="text-sm text-red-600 font-semibold">نهاية النطاق قبل بدايته — اختر نهاية أبعد (جزء/حزب/سورة أكبر)</p>
              )}
              {error && <p className="text-sm text-red-600 font-semibold">{error}</p>}
              <button onClick={() => void startTestGlobal(unitPreview.start.global, unitPreview.end.global)} disabled={loading || !unitPreviewValid}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-lg font-bold rounded-xl shadow">
                {loading ? 'جارٍ تحميل الآيات…' : 'ابدأ التسميع من الوحدة'}
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 space-y-4">
              <h2 className="font-bold text-accent-800">أو يدوي: سورة وآيات</h2>
              <label className="block">
                <span className="text-sm font-bold text-accent-700">السورة</span>
                <select value={surah}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setSurah(n);
                    setFrom(1);
                    setTo(Math.min(5, SURAH_AYAH_COUNTS[n - 1] || 1));
                  }}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300">
                  {SURAHS.map((s) => (
                    <option key={s.no} value={s.no}>{s.no} — سورة {s.name}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-bold text-accent-700">من آية</span>
                  <input type="number" min={1} max={surahCount} value={from}
                    onChange={(e) => setFrom(Number(e.target.value) || 1)}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-accent-700">إلى آية</span>
                  <input type="number" min={1} max={surahCount} value={to}
                    onChange={(e) => setTo(Number(e.target.value) || 1)}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                </label>
              </div>
              <p className="text-sm text-accent-500">
                سورة {surahName} فيها {surahCount.toLocaleString('ar-EG')} آية — النطاق المختار: {Math.max(1, Math.min(from, to, surahCount)).toLocaleString('ar-EG')} إلى {Math.min(Math.max(from, to), surahCount).toLocaleString('ar-EG')}
              </p>
              {error && <p className="text-sm text-red-600 font-semibold">{error}</p>}
              <button onClick={() => void startTest()} disabled={loading}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-lg font-bold rounded-xl shadow">
                {loading ? 'جارٍ تحميل الآيات…' : 'ابدأ التسميع'}
              </button>
              <p className="text-xs text-accent-400 leading-relaxed">
                {micSupported
                  ? 'الآية بتفضل مخفية. اضغط الميكروفون وسمّعها من حفظك: لو صحّت تنزل لك بالأخضر، ولو غلطت تاخد ٥ ثواني تصلحها، وبعدها يظهر لك الجزء الغلط بس بالأحمر. لو المتصفح مش بيدعم الميكروفون، هتقيّم نفسك يدوي زي قبل كده.'
                  : 'المتصفح ده مش بيدعم التسميع بالميكروفون — نص الآية لا يظهر إلا بعد أن تسمّعها وتضغط "أظهر الآية"، ثم تقيّم نفسك: صح أو خطأ.'}
              </p>
            </div>

            {history.length > 0 && (
              <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5">
                <h2 className="font-bold text-accent-800 mb-3">نتائجك السابقة</h2>
                <ul className="space-y-2">
                  {history.slice(0, 5).map((h, i) => (
                    <li key={i} className="flex items-center justify-between text-sm gap-2">
                      <span className="text-accent-700">{h.endSurahName && h.endSurah !== h.surah ? <>من سورة {h.surahName} آية {h.from} إلى سورة {h.endSurahName} آية {h.endAyah}</> : <>سورة {h.surahName} — آيات {h.from} إلى {h.to}</>}</span>
                      <span className="font-bold text-emerald-700 whitespace-nowrap">{h.correct}/{h.total} ({h.total > 0 ? Math.round((h.correct / h.total) * 100) : 0}٪)</span>
                      <span className="text-accent-400 whitespace-nowrap">{h.date}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {phase === 'testing' && ayahs[index] && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm font-bold">
              <span className="text-accent-700">سورة {SURAHS.find((s) => s.no === ayahs[index].surah_no)?.name || ''} — آية {ayahs[index].ayah_no}</span>
              <span className="text-emerald-700">آية {index + 1} من {ayahs.length}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${((index + (currentDone ? 1 : 0)) / ayahs.length) * 100}%` }} />
            </div>

            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-6 text-center">
              {/* Fallback: no live engine, or the user chose manual for
                  this ayah — the exact v1 reveal + self-grade flow. */}
              {(!micSupported || manualMode) ? (
                <>
                  {!micSupported && (
                    <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">
                      المتصفح ده مش بيدعم التسميع بالميكروفون — قيّم نفسك يدوي:
                    </p>
                  )}
                  {!revealed ? (
                    <>
                      <Eye className="w-10 h-10 text-emerald-300 mx-auto mb-3" />
                      <p className="text-lg font-bold text-accent-700 leading-relaxed">
                        سمّع الآية {ayahs[index].ayah_no} من حفظك الآن
                      </p>
                      <p className="text-sm text-accent-400 mt-1">النص مخفي عمدًا — عندما تنتهي اضغط الزر</p>
                      <button onClick={() => setRevealed(true)}
                        className="mt-5 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white text-lg font-bold rounded-xl shadow">
                        أظهر الآية
                      </button>
                      {micSupported && (
                        <button onClick={() => { manualPreferredRef.current = false; setManualMode(false); }}
                          className="mt-3 block mx-auto text-sm font-bold text-accent-500 hover:text-accent-700 underline">
                          أو سمّع بالميكروفون بدل كده
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-2xl leading-[2.2] font-bold text-accent-800" dir="rtl">{ayahs[index].ayah_text}</p>
                      <p className="text-sm text-accent-500 mt-4">طابق ما سمّعته بالنص — ثم قيّم نفسك بصدق:</p>
                      <div className="flex gap-3 mt-4">
                        <button onClick={() => grade(true)}
                          className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-bold rounded-xl flex items-center justify-center gap-2">
                          <Check className="w-6 h-6" /> صح
                        </button>
                        <button onClick={() => grade(false)}
                          className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white text-lg font-bold rounded-xl flex items-center justify-center gap-2">
                          <X className="w-6 h-6" /> خطأ
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : micState === 'done-correct' ? (
                <>
                  <p className="text-lg font-bold text-emerald-700 mb-3">ما شاء الله — صح!</p>
                  <p className="text-2xl leading-[2.2] font-bold text-emerald-700" dir="rtl">{ayahs[index].ayah_text}</p>
                  <button onClick={nextAfterMic}
                    className="mt-5 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-bold rounded-xl shadow">
                    {index + 1 < ayahs.length ? 'الآية اللي بعدها' : 'إنهاء التسميع'}
                  </button>
                </>
              ) : micState === 'done-wrong' ? (
                <>
                  <p className="text-lg font-bold text-red-600 mb-1">في جزء محتاج مراجعة:</p>
                  <p className="text-sm text-accent-500 mb-4">الآية كاملة، والكلمات اللي غلطت فيها أو نسيتها بالأحمر — وهتلاقي الآية في قائمة المراجعة آخر التسميع:</p>
                  <p className="text-2xl leading-[2.2] font-bold" dir="rtl">
                    {expectedWordList(ayahs[index].ayah_text).map((w, i) => (
                      <span key={i} className={wrongIndices.includes(i) ? 'text-red-600 tasmii-flash' : 'text-accent-800'}>{w.orig} </span>
                    ))}
                  </p>
                  <button onClick={nextAfterMic}
                    className="mt-5 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-bold rounded-xl shadow">
                    {index + 1 < ayahs.length ? 'الآية اللي بعدها' : 'إنهاء التسميع'}
                  </button>
                </>
              ) : (
                <>
                  {micState === 'idle' && (
                    <>
                      <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Mic className="w-10 h-10 text-emerald-700" />
                      </div>
                      <p className="text-lg font-bold text-accent-700 leading-relaxed">
                        سمّع الآية {ayahs[index].ayah_no} من حفظك الآن
                      </p>
                      <p className="text-sm text-accent-400 mt-1">النص مخفي عمدًا — اضغط الميكروفون واقرأ بصوتك</p>
                      <button onClick={startMic}
                        className="mt-5 px-8 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-bold rounded-xl shadow flex items-center justify-center gap-2 mx-auto">
                        <Mic className="w-6 h-6" /> سمّع الآية بصوتك
                      </button>
                      <button onClick={() => { manualPreferredRef.current = true; setManualMode(true); }}
                        className="mt-3 text-sm font-bold text-accent-500 hover:text-accent-700 underline">
                        أو قيّم نفسك يدوي بدل الميكروفون
                      </button>
                    </>
                  )}
                  {(micState === 'listening' || micState === 'correcting') && (
                    <>
                      <div className="flex items-center justify-center gap-2 mb-3">
                        <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                        <p className="text-lg font-bold text-accent-700">
                          {micState === 'listening' ? 'بسمعك… اقرأ الآية' : 'لسه بسمعك…'}
                        </p>
                      </div>
                      {micState === 'correcting' && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                          <p className="text-base font-bold text-amber-800">
                            في حاجة محتاجة تتصلح — كمّل أو صلّح، عندك {countdown.toLocaleString('ar-EG')} ثواني
                          </p>
                          <button onClick={() => gradeMic(false)}
                            className="mt-1 text-sm font-bold text-amber-700 underline">
                            خلاص، وريني الغلط
                          </button>
                        </div>
                      )}
                      {(transcript || interim) && (
                        <p className="text-sm text-accent-500 leading-relaxed mb-4" dir="rtl">
                          سمعت: {transcript}{interim ? ` ${interim}` : ''}
                        </p>
                      )}
                      <div className="flex gap-3 justify-center">
                        <button onClick={() => evaluatePressed()}
                          className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold rounded-xl shadow">
                          خلصت، قيّمها
                        </button>
                        <button onClick={() => resetMicState()}
                          className="px-5 py-3 bg-gray-100 hover:bg-gray-200 text-accent-700 text-base font-bold rounded-xl flex items-center gap-2">
                          <Square className="w-4 h-4" /> قف
                        </button>
                      </div>
                    </>
                  )}
                  {micError && (
                    <p className="text-sm text-red-600 font-semibold mt-4">{micError}</p>
                  )}
                  {micError && (
                    <button onClick={() => { stopRec(); clearTimers(); manualPreferredRef.current = true; setManualMode(true); }}
                      className="mt-2 text-sm font-bold text-accent-600 underline">
                      قيّم يدوي بدل كده
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-between">
              <button onClick={() => goToAyah(index - 1)}
                disabled={index === 0}
                className="flex items-center gap-1 px-4 py-2 text-sm font-bold text-accent-600 hover:bg-gray-100 rounded-lg disabled:opacity-30">
                <ChevronRight className="w-5 h-5" /> الآية السابقة
              </button>
              <button onClick={skipAyah}
                className="flex items-center gap-1 px-4 py-2 text-sm font-bold text-accent-600 hover:bg-gray-100 rounded-lg">
                {index + 1 < ayahs.length ? (<>تخطي الآية <ChevronLeft className="w-5 h-5" /></>) : 'إنهاء التسميع'}
              </button>
            </div>
            <p className="text-center text-sm text-accent-400">النتيجة حتى الآن: {correct} صح من {index + (currentDone ? 1 : 0)} آية</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-5">
            <div className="bg-gradient-to-l from-emerald-600 to-teal-700 rounded-2xl p-6 shadow-lg text-white text-center">
              <Award className="w-12 h-12 mx-auto mb-2 text-amber-200" />
              <p className="text-2xl font-bold">نتيجتك: {correct} من {attempted} ({pct}٪)</p>
              <p className="text-emerald-50 mt-2 leading-relaxed">
                {pct >= 90 ? 'ما شاء الله — حفظ متقن، ثبّت الله ما حفظت' : pct >= 60 ? 'تقدّم طيب — راجع الآيات التي أخطأت فيها ثم أعد التسميع' : 'لا بأس — التعثر أول طريق الإتقان، راجع الآيات ثم أعد المحاولة'}
              </p>
              {skippedCount > 0 && (
                <p className="text-emerald-50/90 text-sm mt-1">تخطيت {skippedCount.toLocaleString('ar-EG')} آية — مش محسوبة في النتيجة</p>
              )}
            </div>

            {missed.length > 0 && (
              <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-5">
                <h2 className="font-bold text-accent-800 mb-3">آيات تحتاج مراجعة ({missed.length})</h2>
                <ul className="space-y-2">
                  {ayahs.map((a, i) => (!grades[i] && !skipped[i] ? (
                    <li key={a.id} className="text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-accent-700">سورة {SURAHS.find((s) => s.no === a.surah_no)?.name || ''} — آية {a.ayah_no}</span>
                        <button onClick={() => openInMushaf(a.surah_no, a.ayah_no)}
                          className="flex items-center gap-1 px-3 py-1.5 text-sm font-bold text-emerald-700 bg-emerald-50 rounded-lg">
                          <BookOpen className="w-4 h-4" /> افتح في المصحف
                        </button>
                      </div>
                      {wrongByAyah[i]?.length ? <p className="text-red-600 text-xs mt-1">الكلمات الغلط: {wrongByAyah[i].join(' ')}</p> : null}
                    </li>
                  ) : null))}
                </ul>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setPhase('setup')}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2">
                <RotateCcw className="w-5 h-5" /> تسميع جديد
              </button>
              <button onClick={() => onNavigate('app')}
                className="flex-1 py-3 bg-white border border-gray-200 text-accent-700 font-bold rounded-xl">
                العودة إلى لوحتي
              </button>
            </div>
          </div>
        )}
      </div>

      <BottomNav current="test" onNavigate={onNavigate} />
    </div>
  );
}
