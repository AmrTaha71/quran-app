import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { SURAHS, SURAH_AYAH_COUNTS } from '../lib/surahs';
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
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Expected ayah words, keeping the original (diacritized) form for
// display and the normalized form for comparison. Tokens with no
// Arabic letter in them (ayah-end markers, digits) are dropped
// defensively so they can never count as "missed" words.
function expectedWordList(ayahText: string): { orig: string; norm: string }[] {
  return ayahText
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ orig: w, norm: normalizeArabic(w) }))
    .filter((x) => x.norm.length > 0 && /[\u0621-\u064A]/.test(x.norm));
}

// Greedy in-order alignment: every expected word must appear in the
// spoken words, in order. Extra spoken words (basmalah, isti'adha,
// a repeated word) are ignored — they never consume an expected word.
// A skipped or misspoken word stays unmatched: that is the wrong part.
function alignWords(expected: string[], spoken: string[]): { matched: boolean[]; allMatched: boolean } {
  const matched = new Array(expected.length).fill(false);
  let j = 0;
  for (let i = 0; i < expected.length; i++) {
    let found = -1;
    for (let k = j; k < spoken.length; k++) {
      if (spoken[k] === expected[i]) { found = k; break; }
    }
    if (found >= 0) { matched[i] = true; j = found + 1; }
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
  const [wrongOrigWords, setWrongOrigWords] = useState<string[]>([]);
  const [micError, setMicError] = useState('');
  const [manualMode, setManualMode] = useState(false);

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
    setWrongOrigWords([]);
    setMicError('');
    setManualMode(false);
  };

  // Stop everything on unmount (mic, timers) so nothing keeps running
  // after leaving the page. Deps [] on purpose: only refs are touched.
  useEffect(() => () => {
    try { recRef.current?.stop(); } catch {}
    if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
    if (windowTimerRef.current) clearInterval(windowTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startTest = async () => {
    const lo = Math.max(1, Math.min(from, surahCount));
    const hi = Math.max(lo, Math.min(to, surahCount));
    setError('');
    setLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from('quran_verses')
        .select('id, surah_no, ayah_no, ayah_text')
        .eq('surah_no', surah)
        .gte('ayah_no', lo)
        .lte('ayah_no', hi)
        .order('ayah_no', { ascending: true });
      if (qErr) throw qErr;
      if (!data || data.length === 0) {
        setError('لم أجد آيات في هذا النطاق — جرّب نطاقًا آخر');
        setLoading(false);
        return;
      }
      setFrom(lo);
      setTo(hi);
      setAyahs(data as TestAyah[]);
      const fresh = new Array(data.length).fill(false);
      setGrades(fresh);
      liveRef.current.grades = fresh;
      setIndex(0);
      setRevealed(false);
      liveRef.current.ayah = (data as TestAyah[])[0];
      resetMicState();
      setPhase('testing');
    } catch {
      setError('تعذر تحميل الآيات — تأكد من الاتصال بالإنترنت');
    } finally {
      setLoading(false);
    }
  };

  // Manual v1 grading (fallback path + manual override): grades the
  // current ayah and advances, or finishes on the last one.
  const grade = (ok: boolean) => {
    const next = [...liveRef.current.grades];
    next[index] = ok;
    liveRef.current.grades = next;
    setGrades(next);
    if (index + 1 < ayahs.length) {
      const nextAyah = ayahs[index + 1];
      liveRef.current.ayah = nextAyah;
      setIndex(index + 1);
      setRevealed(false);
      resetMicState();
    } else {
      finishTest(next);
    }
  };

  const finishTest = (finalGrades: boolean[]) => {
    stopRec();
    clearTimers();
    const correct = finalGrades.filter(Boolean).length;
    const rec: TestRecord = {
      date: new Date().toISOString().slice(0, 10),
      surah,
      surahName,
      from,
      to,
      total: ayahs.length,
      correct,
    };
    const nextHistory = [rec, ...history].slice(0, 20);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory)); } catch {}
    setHistory(nextHistory);
    setPhase('done');
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
    if (ok) {
      playCorrectChime();
      liveRef.current.micState = 'done-correct';
      setMicState('done-correct');
    } else {
      playWrongBuzzer();
      const expected = expectedWordList(ayah.ayah_text);
      const spoken = normalizeWords(liveRef.current.finals);
      const { matched } = alignWords(expected.map((w) => w.norm), spoken);
      setWrongOrigWords(expected.filter((_, i) => !matched[i]).map((w) => w.orig));
      liveRef.current.micState = 'done-wrong';
      setMicState('done-wrong');
    }
  };

  const evaluateNow = () => {
    const ayah = liveRef.current.ayah;
    if (!ayah) return;
    if (liveRef.current.micState !== 'listening' && liveRef.current.micState !== 'correcting') return;
    const expected = expectedWordList(ayah.ayah_text);
    const spoken = normalizeWords(liveRef.current.finals);
    if (spoken.length === 0) return;
    const { allMatched } = alignWords(expected.map((w) => w.norm), spoken);
    if (allMatched) {
      gradeMic(true);
      return;
    }
    // Mismatch: if this is the first one, open the 5s correction
    // window (still listening). If already correcting, the clock just
    // keeps running — the next heard words re-evaluate through here.
    if (liveRef.current.micState === 'listening') {
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
    setTranscript('');
    setInterim('');
    setWrongOrigWords([]);
    userStopRef.current = false;
    const rec = new SR();
    rec.lang = currentSpeechLocale();
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i][0];
        if (r.isFinal) {
          liveRef.current.finals = `${liveRef.current.finals} ${r.transcript}`.trim();
          setTranscript(liveRef.current.finals);
          // Spoken enough words to cover the ayah? Judge at once.
          const expectedLen = expectedWordList(liveRef.current.ayah?.ayah_text || '').length;
          if (normalizeWords(liveRef.current.finals).length >= expectedLen) {
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
  };

  const correct = grades.filter(Boolean).length;
  const missed = ayahs.filter((_, i) => !grades[i]);
  const pct = ayahs.length > 0 ? Math.round((correct / ayahs.length) * 100) : 0;
  const currentDone = revealed || micState === 'done-correct' || micState === 'done-wrong';

  const openInMushaf = (ayahNo: number) => {
    try { localStorage.setItem(TARGET_KEY, JSON.stringify({ surah, ayah: ayahNo })); } catch {}
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
            <p className="text-sm text-accent-500">سمّع من حفظك، والبرنامج يصحح لك بالميكروفون</p>
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
            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 space-y-4">
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
              <button onClick={startTest} disabled={loading}
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
                      <span className="text-accent-700">سورة {h.surahName} — آيات {h.from} إلى {h.to}</span>
                      <span className="font-bold text-emerald-700 whitespace-nowrap">{h.correct}/{h.total} ({Math.round((h.correct / h.total) * 100)}٪)</span>
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
              <span className="text-accent-700">سورة {surahName} — آية {ayahs[index].ayah_no}</span>
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
                  <p className="text-sm text-accent-500 mb-4">الكلمات اللي غلطت فيها أو نسيتها — راجعها، وهتلاقي الآية في قائمة المراجعة آخر التسميع:</p>
                  <p className="text-2xl leading-[2.2] font-bold text-red-600 tasmii-flash" dir="rtl">
                    {wrongOrigWords.length > 0 ? wrongOrigWords.join(' ') : '—'}
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
                      <button onClick={() => setManualMode(true)}
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
                        <button onClick={() => evaluateNow()}
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
                    <button onClick={() => { stopRec(); clearTimers(); setManualMode(true); }}
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
              <button onClick={() => {
                if (index + 1 < ayahs.length) goToAyah(index + 1);
                else finishTest(liveRef.current.grades);
              }}
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
              <p className="text-2xl font-bold">نتيجتك: {correct} من {ayahs.length} ({pct}٪)</p>
              <p className="text-emerald-50 mt-2 leading-relaxed">
                {pct >= 90 ? 'ما شاء الله — حفظ متقن، ثبّت الله ما حفظت' : pct >= 60 ? 'تقدّم طيب — راجع الآيات التي أخطأت فيها ثم أعد التسميع' : 'لا بأس — التعثر أول طريق الإتقان، راجع الآيات ثم أعد المحاولة'}
              </p>
            </div>

            {missed.length > 0 && (
              <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-5">
                <h2 className="font-bold text-accent-800 mb-3">آيات تحتاج مراجعة ({missed.length})</h2>
                <ul className="space-y-2">
                  {missed.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-accent-700">سورة {surahName} — آية {a.ayah_no}</span>
                      <button onClick={() => openInMushaf(a.ayah_no)}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm font-bold text-emerald-700 bg-emerald-50 rounded-lg">
                        <BookOpen className="w-4 h-4" /> افتح في المصحف
                      </button>
                    </li>
                  ))}
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
