import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { SURAHS, SURAH_AYAH_COUNTS } from '../lib/surahs';
import { UnitKind, EndKind, RangePoint, unitMax, unitLabel, containingUnit, unitStartGlobal, resolveRange, rangeSummary, SURAH_START_GLOBAL, globalToPoint } from '../lib/testRanges';
import { normalizeArabic, normalizeWords } from '../lib/arabicNormalize';
import { currentSpeechLocale } from '../lib/LanguageContext';
import { getStoredLinkGender } from '../lib/linkAudio';
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
// Correction timing (2026-10-28, the user's words): the user picks
// both the wait before the correction is spoken (2-10s, default 3)
// and how fast the correct word is pronounced — according to his
// own recitation speed. The wait is the ayah-mode self-correction
// window and the continuous stall threshold; the mid-flow interrupt
// stays immediate (that is the automatic reply he asked for —
// delaying it would defeat it). The rate applies to both engines:
// the generated voice (OpenAI speed) and the browser TTS fallback
// (utterance rate), so the choice never silently changes meaning.
type VerifyLevel = 'beginner' | 'intermediate' | 'advanced';
type CorrRate = 'slow' | 'normal' | 'fast' | 'veryFast';
const CORR_RATE_VALUE: Record<CorrRate, number> = { slow: 0.8, normal: 1.0, fast: 1.25, veryFast: 1.5 };
const CORR_RATE_LABEL: Record<CorrRate, string> = { slow: 'بطيء', normal: 'عادي', fast: 'سريع', veryFast: 'سريع جدًا' };
const CORR_DELAY_MIN = 2;
const CORR_DELAY_MAX = 10;
const CORR_DELAY_DEFAULT = 3;
// Recitation mode: 'ayah' grades one ayah at a time (the original
// flow); 'continuous' lets the user recite the whole range without
// stopping at each ayah, and reports missed words per ayah at the end.
type ReciteMode = 'ayah' | 'continuous';

// Self-test settings (verification level + recitation mode) persist
// across visits, so the user picks them once.
const SETTINGS_KEY = 'quran-test-settings';
function loadTestSettings(): { level: VerifyLevel; mode: ReciteMode; corrDelay: number; corrRate: CorrRate } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const level: VerifyLevel = p.level === 'intermediate' || p.level === 'advanced' ? p.level : 'beginner';
      const mode: ReciteMode = p.mode === 'continuous' ? 'continuous' : 'ayah';
      const corrDelay = typeof p.corrDelay === 'number' && Number.isFinite(p.corrDelay)
        ? Math.min(CORR_DELAY_MAX, Math.max(CORR_DELAY_MIN, Math.round(p.corrDelay)))
        : CORR_DELAY_DEFAULT;
      const corrRate: CorrRate = p.corrRate === 'slow' || p.corrRate === 'fast' || p.corrRate === 'veryFast' ? p.corrRate : 'normal';
      return { level, mode, corrDelay, corrRate };
    }
  } catch {}
  return { level: 'beginner', mode: 'ayah', corrDelay: CORR_DELAY_DEFAULT, corrRate: 'normal' };
}

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

// Strict alignment (intermediate/advanced levels): the same greedy
// in-order match as alignWords, but spoken words that are skipped over
// (extra words: a repeated word, an added word, isti'adha after the
// start) are collected as extras instead of being silently ignored.
// Joined-word merges consume their spoken tokens, so they are never
// extras. A strict pass needs allMatched AND zero extras.
function alignWordsStrict(expected: string[], spoken: string[]): { matched: boolean[]; allMatched: boolean; extras: string[] } {
  const matched = new Array(expected.length).fill(false);
  const extras: string[] = [];
  let j = 0;
  let i = 0;
  const consumeThrough = (k: number, count: number) => {
    for (let t = j; t < k; t++) extras.push(spoken[t]);
    j = k + count;
  };
  while (i < expected.length) {
    let found = -1;
    for (let k = j; k < spoken.length; k++) {
      if (spoken[k] === expected[i]) { found = k; break; }
    }
    if (found >= 0) { consumeThrough(found, 1); matched[i] = true; i++; continue; }
    let joined = -1;
    for (let k = j; k + 1 < spoken.length; k++) {
      if (spoken[k] + spoken[k + 1] === expected[i]) { joined = k; break; }
    }
    if (joined >= 0) { consumeThrough(joined, 2); matched[i] = true; i++; continue; }
    if (i + 1 < expected.length) {
      const pair = expected[i] + expected[i + 1];
      const assimilated = expected[i].endsWith('ن') && expected[i + 1].startsWith('م')
        ? expected[i].slice(0, -1) + expected[i + 1]
        : '';
      let foundPair = -1;
      for (let k = j; k < spoken.length; k++) {
        if (spoken[k] === pair || (assimilated && spoken[k] === assimilated)) { foundPair = k; break; }
      }
      if (foundPair >= 0) { consumeThrough(foundPair, 1); matched[i] = true; matched[i + 1] = true; i += 2; continue; }
    }
    i++;
  }
  // Trailing spoken words after the last match are extras too.
  for (let t = j; t < spoken.length; t++) extras.push(spoken[t]);
  return { matched, allMatched: matched.every(Boolean), extras };
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
    // Louder and clearer than before (the user asked for a more
    // obvious wrong sound): gain 0.22 -> 0.40, and TWO pulses
    // (0-0.35s, 0.5-0.9s) so it cannot be mistaken for a tap or a
    // notification. Still no high frequencies, so it stays unharsh.
    gain.gain.setValueAtTime(0.40, t);
    gain.gain.setValueAtTime(0.40, t + 0.35);
    gain.gain.setValueAtTime(0.001, t + 0.45);
    gain.gain.setValueAtTime(0.40, t + 0.50);
    gain.gain.setValueAtTime(0.40, t + 0.80);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.90);
    gain.connect(ctx.destination);
    // Two detuned low square waves: the beating between them is the
    // classic wrong-answer buzz.
    [138, 146].forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 0.8, t + 0.85);
      o.connect(gain);
      o.start(t);
      o.stop(t + 0.90);
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
// Spoken correction (2026-10-28): after a failed ayah the app SAYS
// the correct words aloud, in a gendered voice — male for a man,
// female for a woman — via the generate-voice engine (the same
// extremely-human onyx/nova voices as link voices), with browser
// Arabic TTS as an instant fallback so the correction never waits
// on the network. The mic is always stopped before any correction
// plays, so the device never "hears" its own correction.
function speakCorrection(words: string[], rate = 1.0) {
  if (words.length === 0) return;
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(words.join(' '));
    u.lang = 'ar-SA';
    u.rate = rate;
    window.speechSynthesis.speak(u);
  } catch {}
}
function cancelCorrectionSpeech() {
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch {}
}

// Mic-graded self-test (تسميع) v2.
//
// Flow per ayah: the text stays HIDDEN. The user taps the Mic button
// and recites; the live transcript is compared word by word with the
// expected ayah (same cross-rasm normalization as search). All words
// correct -> the ayah reveals in GREEN. A mismatch -> a correction
// window to self-correct (still listening; a corrected reading that
// matches counts as correct): the user's chosen correction delay
// (default 3s, set in إعدادات التسميع). Still wrong after the window
// -> the wrong-answer buzzer plays, the wrong part shows in RED, and
// the app SPEAKS the correct words aloud in his gender's voice at
// his chosen rate (prefetched during the window, TTS fallback).
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
  const [countdown, setCountdown] = useState(() => loadTestSettings().corrDelay);
  const [wrongIndices, setWrongIndices] = useState<number[]>([]);
  const [wrongByAyah, setWrongByAyah] = useState<Record<number, string[]>>({});
  const [skipped, setSkipped] = useState<boolean[]>([]);
  const [micError, setMicError] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [savedProgress, setSavedProgress] = useState<TestProgress | null>(loadProgress);
  // Verification level + recitation mode (setup choices, persisted).
  const [verifyLevel, setVerifyLevel] = useState<VerifyLevel>(() => loadTestSettings().level);
  const [reciteMode, setReciteMode] = useState<ReciteMode>(() => loadTestSettings().mode);
  const [corrDelay, setCorrDelay] = useState<number>(() => loadTestSettings().corrDelay);
  const [corrRate, setCorrRate] = useState<CorrRate>(() => loadTestSettings().corrRate);
  // The mode of the test actually running (resume always runs ayah
  // mode, whatever the setup preference says).
  const [testMode, setTestMode] = useState<ReciteMode>('ayah');
  // Extra spoken words (strict levels only): current ayah's extras,
  // per-ayah extras for the review list, and continuous-mode extras.
  const [wrongExtras, setWrongExtras] = useState<string[]>([]);
  const [extraByAyah, setExtraByAyah] = useState<Record<number, string[]>>({});
  const [contExtras, setContExtras] = useState<string[]>([]);
  // Continuous-mode display state (matched words / current ayah).
  const [contListening, setContListening] = useState(false);
  const [contProgress, setContProgress] = useState({ matched: 0, total: 0, ayahIdx: 0 });

  // ---- Spoken correction machinery (2026-10-28) -------------------
  // Gender for the correction voice: profile first, localStorage
  // mirror ('quran-user-gender', written by Settings) while it
  // loads, female side when unknown — the same policy as link
  // voices. Male user -> male voice, female user -> female voice.
  const [corrGender, setCorrGender] = useState<'male' | 'female'>(() => getStoredLinkGender(null));
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user.id;
      if (!uid) return;
      supabase.from('user_profiles').select('gender').eq('user_id', uid).maybeSingle()
        .then(({ data: p }) => {
          if (p?.gender === 'male' || p?.gender === 'female') {
            setCorrGender(p.gender);
            try { localStorage.setItem('quran-user-gender', p.gender); } catch {}
          }
        });
    }).catch(() => {});
  }, []);
  // Ayah mode: the correction audio prefetched during the 3s window
  // (so it is ready the moment the window expires), keyed by ayah
  // position + words. A newer fetch invalidates older results.
  const corrAudioRef = useRef<HTMLAudioElement | null>(null);
  const corrFetchTokenRef = useRef(0);
  const corrPendingRef = useRef<{ index: number; wordsKey: string; url: string | null } | null>(null);
  const [correctionAudioByAyah, setCorrectionAudioByAyah] = useState<Record<number, string>>({});
  // Continuous mode: the 3s stall timer, the prompt in progress, the
  // prefetched prompt audio, and the last spoken prompt (replayable).
  const contStallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contPromptingRef = useRef(false);
  const contPromptAudioRef = useRef<HTMLAudioElement | null>(null);
  const contPrefetchRef = useRef<{ key: string; url: string | null } | null>(null);
  const contPromptedKeyRef = useRef('');
  // Teacher state (2026-10-28): expected indices already credited
  // (matched once, or fixed by repeating a prompted word — credit is
  // monotonic, so a later re-alignment never un-credits a word he
  // already said right), the norms of fixed words (excluded from
  // strict extras), and the words from the last prompt that he is
  // expected to say back after the resume.
  const contCreditedRef = useRef<Set<number>>(new Set());
  const contFixedNormsRef = useRef<Set<string>>(new Set());
  const contAwaitingRef = useRef<{ indices: number[]; norms: string[]; baseLen: number } | null>(null);
  const [contPrompting, setContPrompting] = useState(false);
  const [contLastPrompt, setContLastPrompt] = useState<string[]>([]);
  const stopCorrAudio = () => {
    try { corrAudioRef.current?.pause(); } catch {}
    corrAudioRef.current = null;
  };
  const fetchCorrectionAudio = async (words: string[], token: number): Promise<string | null> => {
    if (words.length === 0) return null;
    const url = await requestCorrectionAudio(words);
    if (token !== corrFetchTokenRef.current) return null;
    return url;
  };
  // Raw gendered-voice generation (no token): used by the prefetch
  // path above and by mid-flow interrupts, where the correction
  // cannot be prefetched (the miss is only known when it happens).
  const requestCorrectionAudio = async (words: string[]): Promise<string | null> => {
    if (words.length === 0) return null;
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ text: words.join(' '), voice: corrGender, speed: CORR_RATE_VALUE[liveRef.current.corrRate] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.audioUrl) return null;
      return data.audioUrl;
    } catch { return null; }
  };
  // Play a correction: prefetched gendered audio when ready, browser
  // TTS otherwise (instant, so the 3s promise always holds). If the
  // audio element is refused playback (timer-driven playback can be
  // gesture-gated on some phones), fall back to TTS rather than
  // staying silent.
  const playCorrection = (words: string[], audioUrl?: string | null) => {
    cancelCorrectionSpeech();
    stopCorrAudio();
    if (audioUrl) {
      const a = new Audio(audioUrl);
      corrAudioRef.current = a;
      a.play().catch(() => { speakCorrection(words, CORR_RATE_VALUE[liveRef.current.corrRate]); });
    } else speakCorrection(words, CORR_RATE_VALUE[liveRef.current.corrRate]);
  };

  const applySettings = (level: VerifyLevel, mode: ReciteMode, delay: number = corrDelay, rate: CorrRate = corrRate) => {
    const d = Math.min(CORR_DELAY_MAX, Math.max(CORR_DELAY_MIN, Math.round(delay)));
    setVerifyLevel(level);
    setReciteMode(mode);
    setCorrDelay(d);
    setCorrRate(rate);
    liveRef.current.level = level;
    liveRef.current.mode = mode;
    liveRef.current.corrDelay = d;
    liveRef.current.corrRate = rate;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ level, mode, corrDelay: d, corrRate: rate })); } catch {}
  };

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
    level: loadTestSettings().level,
    mode: loadTestSettings().mode,
    corrDelay: loadTestSettings().corrDelay,
    corrRate: loadTestSettings().corrRate,
    // Continuous mode: one recognition session over the whole range.
    contListening: false,
    contFinals: '',
    contExpected: [] as { norm: string; orig: string; ayahIdx: number }[],
    contStrict: false,
  });

  const surahCount = SURAH_AYAH_COUNTS[surah - 1] || 1;
  const surahName = SURAHS.find((s) => s.no === surah)?.name || '';

  const clearTimers = () => {
    if (quietTimerRef.current) { clearTimeout(quietTimerRef.current); quietTimerRef.current = null; }
    if (windowTimerRef.current) { clearInterval(windowTimerRef.current); windowTimerRef.current = null; }
    // Never let a spoken correction bleed into the next ayah or
    // keep playing after the user stops.
    cancelCorrectionSpeech();
    stopCorrAudio();
  };

  const stopRec = () => {
    userStopRef.current = true;
    try { recRef.current?.stop(); } catch {}
    recRef.current = null;
  };

  // If the user leaves the test mid-correction, silence everything
  // (refs only here — all declared above, so no TDZ risk).
  useEffect(() => () => {
    cancelCorrectionSpeech();
    try { corrAudioRef.current?.pause(); } catch {}
    try { contPromptAudioRef.current?.pause(); } catch {}
    if (contStallTimerRef.current) clearTimeout(contStallTimerRef.current);
  }, []);

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
    setCountdown(liveRef.current.corrDelay);
    setWrongIndices([]);
    setWrongExtras([]);
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
  const startTestGlobal = async (startGlobal: number, endGlobal: number, restore: { index: number; grades: boolean[]; skipped: boolean[] } | null = null, forceMode?: ReciteMode) => {
    // Capture the mode up front: the setup chips stay tappable while
    // ayahs load, and a mid-load switch must not hijack this test.
    // Resume forces ayah mode; fresh starts use the setup choice.
    const modeAtStart = forceMode ?? reciteMode;
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
      // Continuous mode: one listening session over the whole range.
      // No per-ayah progress is saved (a continuous test resumes as
      // a fresh recitation, not mid-stream).
      if (modeAtStart === 'continuous') {
        const expected: { norm: string; orig: string; ayahIdx: number }[] = [];
        (data as TestAyah[]).forEach((a, ai) => {
          expectedWordList(a.ayah_text).forEach((w) => expected.push({ norm: w.norm, orig: w.orig, ayahIdx: ai }));
        });
        liveRef.current.contExpected = expected;
        liveRef.current.contFinals = '';
        liveRef.current.contListening = false;
        liveRef.current.contStrict = liveRef.current.level !== 'beginner';
        setTestMode('continuous');
        setIndex(0);
        setRevealed(false);
        setWrongByAyah({});
        setExtraByAyah({});
        setContExtras([]);
        setContProgress({ matched: 0, total: expected.length, ayahIdx: 0 });
        setContListening(false);
        // Teacher state is per-test: a new range starts with a clean
        // slate (no carried-over credits, prompts, or expectations).
        contCreditedRef.current = new Set();
        contFixedNormsRef.current = new Set();
        contAwaitingRef.current = null;
        contPromptedKeyRef.current = '';
        contPrefetchRef.current = null;
        setContLastPrompt([]);
        setTranscript('');
        setInterim('');
        setMicError('');
        try { localStorage.removeItem(PROGRESS_KEY); } catch {}
        setSavedProgress(null);
        setPhase('testing');
        return;
      }
      setTestMode('ayah');
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
      setExtraByAyah({});
      setContExtras([]);
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
  const startTest = async (surahNo: number = surah, fromNo: number = from, toNo: number = to, restore: { index: number; grades: boolean[]; skipped: boolean[] } | null = null, forceMode?: ReciteMode) => {
    const count = SURAH_AYAH_COUNTS[surahNo - 1] || 1;
    const lo = Math.max(1, Math.min(fromNo, toNo, count));
    const hi = Math.min(Math.max(fromNo, toNo), count);
    const base = SURAH_START_GLOBAL[surahNo - 1] || 1;
    return startTestGlobal(base + lo - 1, base + hi - 1, restore, forceMode);
  };

  const resumeTest = () => {
    const p = savedProgress;
    if (!p) return;
    // Resume is always ayah-by-ayah (continuous tests save no
    // mid-stream progress), without touching the saved preference.
    if (typeof p.startGlobal === 'number' && typeof p.endGlobal === 'number') {
      void startTestGlobal(p.startGlobal, p.endGlobal, { index: p.index, grades: p.grades, skipped: p.skipped }, 'ayah');
    } else {
      void startTest(p.surah, p.from, p.to, { index: p.index, grades: p.grades, skipped: p.skipped }, 'ayah');
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
      // A self-correction voids the prefetched correction audio.
      corrFetchTokenRef.current++;
      corrPendingRef.current = null;
      playCorrectChime();
      liveRef.current.micState = 'done-correct';
      setMicState('done-correct');
    } else {
      playWrongBuzzer();
      const expected = expectedWordList(ayah.ayah_text);
      const spoken = spokenTokens(liveRef.current.finals);
      // Strict levels also flag extra spoken words; beginners are
      // only judged on missing/wrong words (اللحن الجلي).
      const strict = liveRef.current.level !== 'beginner';
      const result = strict
        ? alignWordsStrict(expected.map((w) => w.norm), spoken)
        : { ...alignWords(expected.map((w) => w.norm), spoken), extras: [] as string[] };
      setWrongIndices(expected.map((_, i) => i).filter((i) => !result.matched[i]));
      const wrongWords = expected.filter((_, i) => !result.matched[i]).map((w) => w.orig);
      setWrongByAyah((prev) => ({ ...prev, [index]: wrongWords }));
      setWrongExtras(result.extras);
      if (result.extras.length > 0) setExtraByAyah((prev) => ({ ...prev, [index]: result.extras }));
      // The app corrects him aloud: after the 3s window expires, or
      // when he taps "show me the mistake", the correct words are
      // spoken in his gender's voice (prefetched gendered audio when
      // ready, browser TTS otherwise). The mic is already stopped,
      // so this cannot feed back into recognition.
      const pending = corrPendingRef.current;
      playCorrection(wrongWords, pending && pending.index === index && pending.wordsKey === wrongWords.join('|') ? pending.url : null);
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
    // During the correction window, beginners only re-say the words
    // that were wrong — and only from speech AFTER the window
    // opened. The old code re-checked the whole accumulated
    // transcript, so reciting in pieces across the window passed
    // without a full reading. Strict levels instead demand a clean
    // re-recitation of the whole ayah (no missing, no extra words).
    if (liveRef.current.micState === 'correcting') {
      const windowSpoken = spoken.slice(liveRef.current.windowStartLen);
      if (liveRef.current.level !== 'beginner') {
        const { allMatched, extras } = alignWordsStrict(expected.map((w) => w.norm), windowSpoken);
        if (allMatched && extras.length === 0) gradeMic(true);
      } else {
        const targets = liveRef.current.correctingTargets;
        if (targets.length > 0) {
          const { allMatched } = alignWords(targets, windowSpoken);
          if (allMatched) gradeMic(true);
        }
      }
      return;
    }
    const strict = liveRef.current.level !== 'beginner';
    const result = strict
      ? alignWordsStrict(expected.map((w) => w.norm), spoken)
      : { ...alignWords(expected.map((w) => w.norm), spoken), extras: [] as string[] };
    if (result.allMatched && result.extras.length === 0) {
      gradeMic(true);
      return;
    }
    // Mismatch: open the correction window (still listening).
    // Record what was wrong and where the transcript stood, so the
    // window judges only the correction, not the old speech.
    // Prefetch the gendered correction audio NOW, during the 3s
    // window, so it is ready the moment the window expires.
    if (liveRef.current.micState === 'listening') {
      liveRef.current.correctingTargets = expected.filter((_, i) => !result.matched[i]).map((w) => w.norm);
      const wrongOrig = expected.filter((_, i) => !result.matched[i]).map((w) => w.orig);
      const token = ++corrFetchTokenRef.current;
      corrPendingRef.current = { index, wordsKey: wrongOrig.join('|'), url: null };
      void fetchCorrectionAudio(wrongOrig, token).then((url) => {
        if (url && token === corrFetchTokenRef.current && corrPendingRef.current?.index === index) {
          corrPendingRef.current.url = url;
          setCorrectionAudioByAyah((prev) => ({ ...prev, [index]: url }));
        }
      });
      liveRef.current.windowStartLen = spoken.length;
      liveRef.current.micState = 'correcting';
      setMicState('correcting');
      const windowS = liveRef.current.corrDelay;
      setCountdown(windowS);
      if (windowTimerRef.current) clearInterval(windowTimerRef.current);
      let left = windowS;
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

  // ---- Continuous mode -------------------------------------------
  // One listening session over the whole range: no per-ayah stops.
  // Progress = greedy in-order coverage of the range's expected
  // words; the report at the end lists missed words per ayah (and,
  // on strict levels, the extra spoken words as one global note —
  // extras cannot be reliably attributed to a single ayah mid-flow).
  // Continuous alignment with monotonic credit: the fresh greedy
  // alignment is OR-ed with every index ever credited (matched once,
  // or fixed by repeating a prompt). Re-running the aligner from
  // scratch after an out-of-order repetition could otherwise
  // un-credit a word he already said right.
  const contEffectiveMatched = (): { matched: boolean[]; lastMatchedIdx: number } => {
    const expected = liveRef.current.contExpected;
    const spoken = spokenTokens(liveRef.current.contFinals);
    const strict = liveRef.current.contStrict;
    const result = strict
      ? alignWordsStrict(expected.map((w) => w.norm), spoken)
      : { ...alignWords(expected.map((w) => w.norm), spoken) };
    const matched = result.matched.map((m, i) => m || contCreditedRef.current.has(i));
    result.matched.forEach((m, i) => { if (m) contCreditedRef.current.add(i); });
    let lastMatchedIdx = -1;
    matched.forEach((m, i) => { if (m) lastMatchedIdx = i; });
    return { matched, lastMatchedIdx };
  };
  const updateContProgress = () => {
    const expected = liveRef.current.contExpected;
    const { matched, lastMatchedIdx } = contEffectiveMatched();
    let matchedCount = 0;
    matched.forEach((m) => { if (m) matchedCount++; });
    const ayahIdx = lastMatchedIdx >= 0 ? expected[lastMatchedIdx].ayahIdx : 0;
    setContProgress({ matched: matchedCount, total: expected.length, ayahIdx });
    return { matched, allMatched: matched.every(Boolean) };
  };

  const stopContinuousMic = () => {
    cancelContPrompt();
    stopRec();
    liveRef.current.contListening = false;
    setContListening(false);
  };

  // ---- Continuous stall prompt (2026-10-28) -----------------------
  // The user asked for corrections in continuous mode too, within
  // 3 seconds. Interrupting a flowing recitation would be wrong, so
  // the trigger is a STALL: no speech result for 3s while words are
  // owed. Pausing the mic before speaking is essential — if the
  // recognizer heard its own correction it would falsely match it
  // as the user's recitation. Resume is guarded so a user stop or
  // finish during the prompt never restarts listening.
  const contOwedWords = (): { words: string[]; indices: number[]; norms: string[]; isMiss: boolean } => {
    const expected = liveRef.current.contExpected;
    const empty = { words: [] as string[], indices: [] as number[], norms: [] as string[], isMiss: false };
    if (expected.length === 0) return empty;
    const { matched, lastMatchedIdx } = contEffectiveMatched();
    let firstMissIdx = -1;
    for (let i = 0; i < lastMatchedIdx; i++) {
      if (!matched[i]) { firstMissIdx = i; break; }
    }
    if (firstMissIdx >= 0) {
      const ayahIdx = expected[firstMissIdx].ayahIdx;
      const indices: number[] = [];
      expected.forEach((w, i) => {
        if (i < lastMatchedIdx && !matched[i] && w.ayahIdx === ayahIdx) indices.push(i);
      });
      return {
        words: indices.map((i) => expected[i].orig),
        indices,
        norms: indices.map((i) => expected[i].norm),
        isMiss: true,
      };
    }
    if (lastMatchedIdx + 1 < expected.length) {
      const i = lastMatchedIdx + 1;
      return { words: [expected[i].orig], indices: [i], norms: [expected[i].norm], isMiss: false };
    }
    return empty;
  };
  const cancelContPrompt = () => {
    if (contStallTimerRef.current) { clearTimeout(contStallTimerRef.current); contStallTimerRef.current = null; }
    try { contPromptAudioRef.current?.pause(); } catch {}
    contPromptAudioRef.current = null;
    cancelCorrectionSpeech();
    contPromptingRef.current = false;
    setContPrompting(false);
    contAwaitingRef.current = null;
  };
  const speakContPrompt = (words: string[], fixIdx?: number[], fixNorms?: string[]) => {
    if (words.length === 0 || contPromptingRef.current) return;
    const key = words.join('|');
    contPromptedKeyRef.current = key;
    setContLastPrompt(words);
    contPromptingRef.current = true;
    setContPrompting(true);
    userStopRef.current = true;
    try { recRef.current?.stop(); } catch {}
    recRef.current = null;
    liveRef.current.contListening = false;
    setContListening(false);
    // These words are expected back from him right after the
    // resume: saying them credits the fix (see checkContFix). A
    // replay passes no fix args and leaves the expectation alone.
    if (fixIdx && fixIdx.length > 0) {
      contAwaitingRef.current = {
        indices: fixIdx,
        norms: fixNorms ?? [],
        baseLen: spokenTokens(liveRef.current.contFinals).length,
      };
    }
    const resumeAfterPrompt = () => {
      try { contPromptAudioRef.current?.pause(); } catch {}
      contPromptAudioRef.current = null;
      cancelCorrectionSpeech();
      if (!contPromptingRef.current) return;
      contPromptingRef.current = false;
      setContPrompting(false);
      startContinuousMic();
    };
    const playTtsFallback = () => {
      try {
        if ('speechSynthesis' in window) {
          const u = new SpeechSynthesisUtterance(words.join(' '));
          u.lang = 'ar-SA';
          u.rate = CORR_RATE_VALUE[liveRef.current.corrRate];
          u.onend = resumeAfterPrompt;
          u.onerror = resumeAfterPrompt;
          window.speechSynthesis.speak(u);
        } else resumeAfterPrompt();
      } catch { resumeAfterPrompt(); }
    };
    const playUrl = (url: string) => {
      const a = new Audio(url);
      contPromptAudioRef.current = a;
      a.onended = resumeAfterPrompt;
      a.onerror = resumeAfterPrompt;
      a.play().catch(playTtsFallback);
    };
    const url = contPrefetchRef.current?.key === key ? contPrefetchRef.current.url : null;
    cancelCorrectionSpeech();
    if (url) {
      playUrl(url);
    } else {
      // No prefetched audio (a mid-flow interrupt cannot be
      // prefetched — the miss is only known when it happens):
      // generate the human-sounding voice now (~1-2s for a few
      // words) while the "correcting" indicator shows. Browser TTS
      // is only the failure fallback, never the default, because
      // the user asked for a human-sounding voice, not a robotic one.
      void requestCorrectionAudio(words).then((genUrl) => {
        if (!contPromptingRef.current) return;
        if (genUrl) {
          contPrefetchRef.current = { key, url: genUrl };
          playUrl(genUrl);
        } else playTtsFallback();
      });
    }
  };
  // After every continuous result, (re)arm the 3s stall prompt. Any
  // new result — final or interim — resets the clock, so a slow but
  // ongoing recitation is never interrupted. The owed words are
  // prefetched in the background, so the prompt is ready on time.
  // A prompt never repeats for unchanged owed words (no nagging);
  // the replay button covers "say it again".
  const scheduleContStallPrompt = () => {
    if (!liveRef.current.contListening || contPromptingRef.current) return;
    if (contStallTimerRef.current) { clearTimeout(contStallTimerRef.current); contStallTimerRef.current = null; }
    const owed = contOwedWords();
    if (owed.words.length === 0) return;
    const key = owed.words.join('|');
    if (key !== contPrefetchRef.current?.key) {
      const token = ++corrFetchTokenRef.current;
      contPrefetchRef.current = { key, url: null };
      void fetchCorrectionAudio(owed.words, token).then((url) => {
        if (url && token === corrFetchTokenRef.current && contPrefetchRef.current?.key === key) {
          contPrefetchRef.current.url = url;
        }
      });
    }
    contStallTimerRef.current = setTimeout(() => {
      contStallTimerRef.current = null;
      if (!liveRef.current.contListening || contPromptingRef.current) return;
      const now = contOwedWords();
      if (now.words.length === 0) return;
      if (now.words.join('|') === contPromptedKeyRef.current) return;
      speakContPrompt(now.words, now.indices, now.norms);
    }, liveRef.current.corrDelay * 1000);
  };
  // Did he say back the prompted words after the resume? The fresh
  // tokens since the prompt must contain them in order. A bounded
  // window (first 20 fresh tokens): if he moved on without saying
  // them, they stay missed — the teacher does not wait forever,
  // and the replay button still offers them on demand.
  const checkContFix = () => {
    const aw = contAwaitingRef.current;
    if (!aw) return;
    const tokens = spokenTokens(liveRef.current.contFinals);
    const fresh = tokens.slice(aw.baseLen);
    if (fresh.length > 20) { contAwaitingRef.current = null; return; }
    let p = 0;
    for (let t = 0; t < fresh.length && p < aw.norms.length; t++) {
      if (fresh[t] === aw.norms[p]) p++;
    }
    if (p === aw.norms.length) {
      aw.indices.forEach((i) => contCreditedRef.current.add(i));
      aw.norms.forEach((n) => contFixedNormsRef.current.add(n));
      contAwaitingRef.current = null;
    }
  };
  // Mid-flow miss interrupt (2026-10-28, the user's words): as soon
  // as a passed-over miss is CONFIRMED — a later word matched, so
  // he demonstrably moved past it — stop him at once and correct
  // him, even if he never pauses. One correction at a time (while
  // a fix is awaited, new misses wait for the next stall prompt),
  // and a miss corrected once is never re-interrupted.
  const checkContMissInterrupt = () => {
    if (!liveRef.current.contListening || contPromptingRef.current) return;
    if (contAwaitingRef.current) return;
    const owed = contOwedWords();
    // Only a confirmed passed-over miss interrupts mid-flow. The
    // "next word" case is not a mistake — it is the stall prompt's
    // job, after 3s of silence.
    if (!owed.isMiss || owed.words.length === 0) return;
    const key = owed.words.join('|');
    if (key === contPromptedKeyRef.current) return;
    if (contStallTimerRef.current) { clearTimeout(contStallTimerRef.current); contStallTimerRef.current = null; }
    speakContPrompt(owed.words, owed.indices, owed.norms);
  };

  // Grade the whole range from the accumulated continuous transcript.
  // Returns true when every ayah was fully covered.
  const gradeContinuousNow = (): boolean => {
    const expected = liveRef.current.contExpected;
    const spoken = spokenTokens(liveRef.current.contFinals);
    const strict = liveRef.current.contStrict;
    const result = strict
      ? alignWordsStrict(expected.map((w) => w.norm), spoken)
      : { ...alignWords(expected.map((w) => w.norm), spoken), extras: [] as string[] };
    const { matched } = contEffectiveMatched();
    const ayahCount = expected.length ? expected[expected.length - 1].ayahIdx + 1 : 0;
    const gradesArr = new Array(ayahCount).fill(true);
    const missedByAyah: Record<number, string[]> = {};
    expected.forEach((w, i) => {
      if (!matched[i]) {
        gradesArr[w.ayahIdx] = false;
        (missedByAyah[w.ayahIdx] ||= []).push(w.orig);
      }
    });
    liveRef.current.grades = gradesArr;
    setGrades(gradesArr);
    const noSkips = new Array(ayahCount).fill(false);
    liveRef.current.skipped = noSkips;
    setSkipped(noSkips);
    setWrongByAyah(missedByAyah);
    setExtraByAyah({});
    // A repeated fix word is not an "extra": he said it because the
    // app asked him to, so it must not appear in the extras note.
    setContExtras(result.extras.filter((e) => !contFixedNormsRef.current.has(e)));
    finishTest(gradesArr);
    return gradesArr.every(Boolean);
  };

  const finishContinuousPressed = () => {
    if (spokenTokens(liveRef.current.contFinals).length === 0) {
      setMicError('لسه ما سمعت حاجة — سمّع النطاق الأول وبعدين اضغط "أنهيت التسميع"');
      return;
    }
    stopContinuousMic();
    const allOk = gradeContinuousNow();
    if (allOk) playCorrectChime(); else playWrongBuzzer();
  };

  const startContinuousMic = () => {
    getAudioCtx();
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setMicError('المتصفح ده مش بيدعم التسميع بالميكروفون — جرّب وضع "آية آية" اليدوي بدل كده');
      return;
    }
    if (liveRef.current.contListening) return;
    setMicError('');
    // Do NOT wipe contFinals here: the test start already cleared it,
    // and a stop/resume must continue the same transcript.
    setTranscript(liveRef.current.contFinals);
    setInterim('');
    userStopRef.current = false;
    const rec = new SR();
    rec.lang = currentSpeechLocale();
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        // Same isFinal fix as the ayah path: it lives on the result.
        const res = e.results[i];
        const r = res[0];
        if (res.isFinal || r.isFinal) {
          liveRef.current.contFinals = `${liveRef.current.contFinals} ${r.transcript}`.trim();
          setTranscript(liveRef.current.contFinals);
          checkContFix();
          const { allMatched } = updateContProgress();
          if (allMatched) {
            // Range fully recited: finish on its own, with a chime.
            stopContinuousMic();
            playCorrectChime();
            gradeContinuousNow();
          } else {
            // Mid-flow correction: a confirmed miss stops him at
            // once, even if he never pauses (see checkContMissInterrupt).
            checkContMissInterrupt();
          }
        } else {
          interimText += `${r.transcript} `;
        }
      }
      if (interimText.trim()) setInterim(interimText.trim());
      // Every result — final or interim — rearms the 3s stall
      // prompt, so only true silence triggers a correction.
      scheduleContStallPrompt();
    };
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed') {
        setMicError('الميكروفون مقفول — اسمح بيه من إعدادات المتصفح');
      } else if (e.error === 'network') {
        setMicError('الاستماع المباشر محتاج إنترنت');
      } else {
        setMicError('تعذر الاستماع — جرّب تاني');
      }
      stopContinuousMic();
    };
    rec.onend = () => {
      // Browsers pause recognition after silence; resume while the
      // user is still mid-range, unless they stopped or finished.
      if (!userStopRef.current && liveRef.current.contListening) {
        try {
          rec.start();
        } catch {
          setMicError('الاستماع وقف — اضغط الميكروفون تاني');
          stopContinuousMic();
        }
      }
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setMicError('تعذر بدء الاستماع — جرّب تاني');
      recRef.current = null;
      return;
    }
    liveRef.current.contListening = true;
    setContListening(true);
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
            <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5 space-y-4">
              <h2 className="font-bold text-accent-800">إعدادات التسميع</h2>
              <div>
                <p className="text-sm font-bold text-accent-700 mb-2">مستوى التدقيق</p>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => applySettings('beginner', reciteMode)}
                    className={`py-2.5 rounded-xl font-bold ${verifyLevel === 'beginner' ? 'bg-amber-600 text-white shadow' : 'bg-white border border-gray-200 text-accent-700'}`}>
                    مبتدئ
                  </button>
                  <button onClick={() => applySettings('intermediate', reciteMode)}
                    className={`py-2.5 rounded-xl font-bold ${verifyLevel === 'intermediate' ? 'bg-amber-600 text-white shadow' : 'bg-white border border-gray-200 text-accent-700'}`}>
                    متوسط
                  </button>
                  <button onClick={() => applySettings('advanced', reciteMode)}
                    className={`py-2.5 rounded-xl font-bold ${verifyLevel === 'advanced' ? 'bg-amber-600 text-white shadow' : 'bg-white border border-gray-200 text-accent-700'}`}>
                    متقدم
                  </button>
                </div>
                <p className="text-sm text-accent-500 mt-2 leading-relaxed">
                  {verifyLevel === 'beginner'
                    ? 'يوقف عند الخطأ في الكلمات فقط: الكلمة الناقصة أو المختلفة (اللحن الجلي). الكلمة الزائدة لا توقفه.'
                    : verifyLevel === 'intermediate'
                    ? 'يوقف عند أي خطأ في الكلمات: ناقصة أو مختلفة أو زائدة.'
                    : 'نفس تدقيق المتوسط — والسرعة دلوقتي بتتظبط من فترة التريث وسرعة النطق تحت.'}
                </p>
              </div>
              <div>
                <p className="text-sm font-bold text-accent-700 mb-2">سرعة التصحيح</p>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm text-accent-700">فترة التريث قبل النطق:</span>
                  <button onClick={() => applySettings(verifyLevel, reciteMode, corrDelay - 1, corrRate)} disabled={corrDelay <= CORR_DELAY_MIN}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg font-bold disabled:opacity-40">-</button>
                  <span className="text-sm font-bold text-accent-800 min-w-[70px] text-center">{corrDelay.toLocaleString('ar-EG')} ثواني</span>
                  <button onClick={() => applySettings(verifyLevel, reciteMode, corrDelay + 1, corrRate)} disabled={corrDelay >= CORR_DELAY_MAX}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg font-bold disabled:opacity-40">+</button>
                </div>
                <p className="text-sm font-bold text-accent-700 mb-2">سرعة نطق الكلمة الصحيحة:</p>
                <div className="grid grid-cols-4 gap-2">
                  {(['slow', 'normal', 'fast', 'veryFast'] as CorrRate[]).map((r) => (
                    <button key={r} onClick={() => applySettings(verifyLevel, reciteMode, corrDelay, r)}
                      className={`py-2.5 rounded-xl font-bold ${corrRate === r ? 'bg-amber-600 text-white shadow' : 'bg-white border border-gray-200 text-accent-700'}`}>
                      {CORR_RATE_LABEL[r]}
                    </button>
                  ))}
                </div>
                <p className="text-sm text-accent-500 mt-2 leading-relaxed">
                  فترة التريث هي المهلة اللي بتاخدها تصلح لنفسك قبل ما البرنامج ينطق التصحيح (في آية آية)، أو مدة سكوتك قبل ما ينبهك (في المتصل). أما المقاطعة الفورية للغلطة المؤكدة وانت ماشي فبتفضل فورية — دي الرد التلقائي.
                </p>
              </div>
              <div>
                <p className="text-sm font-bold text-accent-700 mb-2">طريقة التسميع</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => applySettings(verifyLevel, 'ayah')}
                    className={`py-2.5 rounded-xl font-bold ${reciteMode === 'ayah' ? 'bg-amber-600 text-white shadow' : 'bg-white border border-gray-200 text-accent-700'}`}>
                    آية آية
                  </button>
                  <button onClick={() => applySettings(verifyLevel, 'continuous')} disabled={!micSupported}
                    className={`py-2.5 rounded-xl font-bold disabled:opacity-40 ${reciteMode === 'continuous' ? 'bg-amber-600 text-white shadow' : 'bg-white border border-gray-200 text-accent-700'}`}>
                    متصل
                  </button>
                </div>
                <p className="text-sm text-accent-500 mt-2 leading-relaxed">
                  {reciteMode === 'ayah'
                    ? 'تسمّع كل آية لوحدها، وتتصحح قبل ما تنتقل للي بعدها.'
                    : 'سمّع النطاق كله على بعضه من غير توقف عند كل آية — من أول آية لآخر آية في النطاق، أو حتى نهاية السورة لو ده اختيارك. ولو غلطت في كلمة وانت ماشي، البرنامج يوقفك على طول وينطقها لك بصوت رجالي أو نسائي حسب حسابك، وتقولها وراه وتكمل؛ ولو وقفت ' + corrDelay.toLocaleString('ar-EG') + ' ثواني وعندك كلمة ناقصة، ينطقها لك برضه. التقرير يطلع في الآخر بالكلمات الناقصة في كل آية.'}
                </p>
                {!micSupported && (
                  <p className="text-sm text-amber-700 mt-1">الوضع المتصل يحتاج ميكروفون — جهازك مش بيدعمه، فالاختيار ده مقفول.</p>
                )}
              </div>
              <p className="text-xs text-accent-400 leading-relaxed">
                ملحوظة بأمانة: التدقيق كله على مستوى الكلمات — البرنامج بيسمع الكلمات مش الأصوات، فما بيقيس أحكام التجويد (اللحن الخفي).
              </p>
            </div>

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
                className="w-full py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-lg font-bold rounded-xl shadow">
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
                className="w-full py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-lg font-bold rounded-xl shadow">
                {loading ? 'جارٍ تحميل الآيات…' : 'ابدأ التسميع'}
              </button>
              <p className="text-xs text-accent-400 leading-relaxed">
                {micSupported
                  ? 'الآية بتفضل مخفية. اضغط الميكروفون وسمّعها من حفظك: لو صحّت تنزل لك بالأخضر، ولو غلطت تاخد ' + corrDelay.toLocaleString('ar-EG') + ' ثواني تصلحها، وبعدها يظهر لك الجزء الغلط بالأحمر وينطقه لك البرنامج بصوت رجالي أو نسائي حسب حسابك. لو المتصفح مش بيدعم الميكروفون، هتقيّم نفسك يدوي زي قبل كده.'
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

        {phase === 'testing' && testMode === 'continuous' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm font-bold">
              <span className="text-accent-700">
                {rangeStart && rangeEnd ? (
                  rangeStart.surah === rangeEnd.surah
                    ? <>سورة {SURAHS.find((s) => s.no === rangeStart.surah)?.name || ''} — من آية {rangeStart.ayah} إلى آية {rangeEnd.ayah}</>
                    : <>من سورة {SURAHS.find((s) => s.no === rangeStart.surah)?.name || ''} آية {rangeStart.ayah} إلى سورة {SURAHS.find((s) => s.no === rangeEnd.surah)?.name || ''} آية {rangeEnd.ayah}</>
                ) : 'تسميع متصل'}
              </span>
              <span className="text-emerald-700">كلمة {contProgress.matched.toLocaleString('ar-EG')} من {contProgress.total.toLocaleString('ar-EG')}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${contProgress.total > 0 ? (contProgress.matched / contProgress.total) * 100 : 0}%` }} />
            </div>

            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-6 text-center">
              {!contListening ? (
                <>
                  <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Mic className="w-10 h-10 text-emerald-700" />
                  </div>
                  <p className="text-lg font-bold text-accent-700 leading-relaxed">
                    سمّع النطاق كله على بعضه من حفظك الآن
                  </p>
                  <p className="text-sm text-accent-400 mt-1">النص مخفي عمدًا — اضغط الميكروفون واقرأ من غير توقف، ولو خلصت اضغط "أنهيت التسميع"</p>
                  <button onClick={startContinuousMic}
                    className="mt-5 px-8 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-bold rounded-xl shadow flex items-center justify-center gap-2 mx-auto">
                    <Mic className="w-6 h-6" /> {transcript ? 'كمّل التسميع المتصل' : 'ابدأ التسميع المتصل'}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                    <p className="text-lg font-bold text-accent-700">بسمعك… كمّل من غير توقف</p>
                  </div>
                  {ayahs[contProgress.ayahIdx] && (
                    <p className="text-sm font-bold text-emerald-700 mb-4">
                      الآن عند: سورة {SURAHS.find((s) => s.no === ayahs[contProgress.ayahIdx].surah_no)?.name || ''} — آية {ayahs[contProgress.ayahIdx].ayah_no}
                    </p>
                  )}
                  {contPrompting && (
                    <p className="text-sm font-bold text-blue-700 mb-4">بصحح لك… اسمع الكلمة الصح، وبعدها كمّل</p>
                  )}
                  {contLastPrompt.length > 0 && !contPrompting && (
                    <button onClick={() => speakContPrompt(contLastPrompt)}
                      className="mb-4 px-5 py-2.5 bg-white border border-blue-200 hover:bg-blue-50 text-blue-700 text-sm font-bold rounded-xl">
                      🔊 أعد سماع التصحيح
                    </button>
                  )}
                  {(transcript || interim) && (
                    <p className="text-sm text-accent-500 leading-relaxed mb-4" dir="rtl">
                      سمعت: {transcript}{interim ? ` ${interim}` : ''}
                    </p>
                  )}
                  <div className="flex gap-3 justify-center">
                    <button onClick={finishContinuousPressed}
                      className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold rounded-xl shadow">
                      أنهيت التسميع
                    </button>
                    <button onClick={stopContinuousMic}
                      className="px-5 py-3 bg-gray-100 hover:bg-gray-200 text-accent-700 text-base font-bold rounded-xl flex items-center gap-2">
                      <Square className="w-4 h-4" /> قف
                    </button>
                  </div>
                </>
              )}
              {micError && (
                <p className="text-sm text-red-600 font-semibold mt-4">{micError}</p>
              )}
            </div>
            <button onClick={() => { stopContinuousMic(); setPhase('setup'); }}
              className="block mx-auto text-sm font-bold text-accent-500 hover:text-accent-700 underline">
              إلغاء التسميع والعودة للإعدادات
            </button>
          </div>
        )}

        {phase === 'testing' && testMode === 'ayah' && ayahs[index] && (
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
                  {wrongExtras.length > 0 && (
                    <p className="text-sm text-amber-700 mt-3">كلمات زائدة سمعتها: {wrongExtras.join(' ')}</p>
                  )}
                  {(wrongByAyah[index]?.length ?? 0) > 0 && (
                    <button onClick={() => playCorrection(wrongByAyah[index] ?? [], correctionAudioByAyah[index] ?? null)}
                      className="mt-3 px-5 py-2.5 bg-white border border-red-200 hover:bg-red-50 text-red-700 text-sm font-bold rounded-xl">
                      🔊 أعد سماع التصحيح
                    </button>
                  )}
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
                      {extraByAyah[i]?.length ? <p className="text-amber-600 text-xs mt-1">كلمات زائدة: {extraByAyah[i].join(' ')}</p> : null}
                    </li>
                  ) : null))}
                </ul>
              </div>
            )}

            {contExtras.length > 0 && testMode === 'continuous' && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 leading-relaxed">
                كلمات زائدة سمعتها أثناء التسميع المتصل: {contExtras.join(' ')}
              </p>
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
