import { useState, useRef, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { SURAHS, SURAH_AYAH_COUNTS } from '../lib/surahs';
import { getQuranTextCache, shouldShowOfflineNotice, isOffline } from '../lib/quranTextCache';
import { UnitKind, EndKind, RangePoint, unitMax, unitLabel, containingUnit, unitStartGlobal, resolveRange, rangeSummary, SURAH_START_GLOBAL, globalToPoint } from '../lib/testRanges';
import { normalizeArabic, normalizeWords, digitTokenToOpaque, muqattaatLetters, MUQATTAAT_NAME_TO_LETTER, MUQATTAAT_ALIF_LAM_MEEM_SECONDS, correctionSpeechText, muqattaatWindowMatches, muqattaatIsLetterPiece, muqattaatAlifLamMeemBlocked } from '../lib/arabicNormalize';
import { overshootOwed, isOpaqueToken, normLevSim } from '../lib/overshoot';
import { withTimeout, withPrecedingContextWord } from '../lib/corrPrompt';
import { buildCase, parseIosVersion, TAXONOMY_LABELS, TAXONOMY_VALUES, type PlanEntry, type ActualAyah, type ActualEntry, type VoiceTags, type RecorderEvent, type FixedTaxonomy } from '../lib/recorder';
import { corrAudioCacheKey, AudioUrlCache, CORR_AUDIO_CACHE_VERSION, MemoryCorrAudioBackend, createIndexedDBBackend } from '../lib/corrAudioStore';
import { wbwWordUrl, refUnitForWord, isRefUnitEnabled } from '../lib/refWordUnits';
import { checkMic } from '../lib/micCheck';
import type { MicCheckResult } from '../lib/micCheck';
import type { CorrAudioBackend } from '../lib/corrAudioStore';
import { getStoredLinkGender } from '../lib/linkAudio';
import { formatAr } from '../lib/numerals';
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
// Iteration 2 continuous-prompt audio cache: PERSISTENT (IndexedDB
// blobs) with a synchronous in-memory mirror for the prompt path.
// 500 entries, oldest-first eviction — short corrections are tens
// of KB, so worst-case storage is ~15MB. The version lives in the
// key (see CORR_AUDIO_CACHE_VERSION): bump it when the voice engine
// or model changes and old entries miss + refill gradually.
// The iOS TTS onstart watchdog (3s) is long enough for a working
// engine to fire onstart, far below the 18s prompt watchdog.
const CONT_AUDIO_CACHE_CAP = 500;
const CONT_TTS_ONSTART_WATCHDOG_MS = 3000;
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

// Position payload for the server-verified correction mode (v12):
// one (seeded quran_verses id, word position within the ayah) per
// missed expected word, in order. The context predecessor is NEVER
// sent — the server derives it from the first position (wordPos - 1
// in the same ayah), exactly the withPrecedingContextWord rule.
// Returns null on any invalid index (caller falls back to free
// text) — never a crash, never a guessed position.
interface CorrPosition { id: number; w: number; }
function corrPositionsForRange(
  indices: number[],
  expected: { ayahIdx: number }[],
  ayahs: TestAyah[],
): CorrPosition[] | null {
  if (indices.length === 0) return null;
  const out: CorrPosition[] = [];
  for (const i of indices) {
    const e = expected[i];
    if (!e) return null;
    const ayah = ayahs[e.ayahIdx];
    if (!ayah) return null;
    let w = 0;
    for (let j = 0; j < i; j++) if (expected[j].ayahIdx === e.ayahIdx) w++;
    out.push({ id: ayah.id, w });
  }
  return out;
}

// Spoken tokens for comparison: the normalizer strips diacritics but
// NOT punctuation, so a transcript "والله،" never equaled "والله".
// Strip every non-Arabic letter from both sides before aligning.
function cleanToken(t: string): string {
  return t.replace(/[^\u0621-\u064A]/g, '');
}
function spokenTokens(text: string): string[] {
  const out: string[] = [];
  for (const w of normalizeWords(text)) {
    const c = cleanToken(w);
    if (c) { out.push(c); continue; }
    // P1 opaque: a numeral that maps to no digit-word is kept
    // (honest heard counts/display), never matched, never a strict
    // extra — cleanToken would otherwise delete it silently.
    const opaque = digitTokenToOpaque(w);
    if (opaque) out.push(opaque);
  }
  return out;
}

// R1 (Claude-2): isOpaqueToken, normLevSim, OVERSHOOT_BASMALAH and
// OVERSHOOT_ISTIADHA moved to src/lib/overshoot.ts (single source of
// truth, shared by the component and the runners). They are imported
// at the top of this file; see overshoot.ts for their definitions.

// ---- D1 diagnostics (transcript-truth) -------------------------------
// (a) App shell, recorded next to the build stamp and the raw
// transcript line so the next device test settles speech-recognition
// existence PER SHELL (Safari tab vs installed PWA vs Chrome-on-iOS
// vs in-app webview). Detection is deliberately conservative: a shell
// is only named when its signal is present; anything ambiguous is
// 'unknown shell', never a guessed webview label. Signals:
//   - standalone: matchMedia('(display-mode: standalone)') or the
//     iOS navigator.standalone flag (installed PWA, any browser).
//   - chrome-ios / firefox-ios / edge-ios: CriOS / FxiOS / EdgiOS
//     UA tokens (WKWebView shells, not Safari).
//   - safari-tab: a Version/ + Safari UA with no Chrome-family token
//     (the Safari app; most WKWebView UAs lack Version/, so they
//     fall through to 'unknown shell' instead of being mislabeled).
// The value is a mount-time snapshot: installing the app mid-test
// does not change it, which is correct for a test session that
// starts fresh in one shell.
// (b) Raw heard line, capped for display only: the transcript state
// already holds the engine's RAW text (normalization happens only
// inside spokenTokens at grading time, never in the displayed
// string), so this line is verbatim engine output, not normalized
// text — the distinction the next device test's verbatim collection
// (T1/T2) depends on. Capping keeps head (the opening) and tail
// (the latest words) and drops the middle, so a full-Surah run does
// not render tens of thousands of characters. Grading reads the
// full transcript from refs; display capping changes nothing there.
function detectAppShell(): string {
  try {
    const nav = window.navigator as any;
    const ua = ((nav && nav.userAgent) || '').toLowerCase();
    const standaloneMM = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
    if (standaloneMM || nav?.standalone === true) return 'standalone';
    if (ua.includes('crios')) return 'chrome-ios';
    if (ua.includes('fxios')) return 'firefox-ios';
    if (ua.includes('edgios')) return 'edge-ios';
    if (ua.includes('version/') && ua.includes('safari') && !ua.includes('chrome') && !ua.includes('crios') && !ua.includes('fxios') && !ua.includes('edgios')) return 'safari-tab';
    return 'unknown shell';
  } catch {
    return 'unknown shell';
  }
}
function capHeardLine(raw: string): string {
  const chars = Array.from(raw || '');
  if (chars.length <= 320) return raw || '';
  return `${chars.slice(0, 120).join('')} … ${chars.slice(-180).join('')}`;
}

// Single-token forms for an expected word pair spoken as one token
// (assimilation across the word boundary). Only real, attested
// patterns, and only where the first word's final letter is actually
// sakinah in recitation:
//   * nun sakinah + يرملون (idgham: the ن drops — من يقول -> ميقول،
//     أن لا -> ألا، إن ما -> إما) or + ب (iqlab: the ن becomes م —
//     من بعد -> ممبعد — or drops, as ASR writes no shadda: مبعد).
//     Restricted to من/أن/إن/عن/لن (with a leading و/ف, or أ+و/ف),
//     so voweled-ن words never assimilate: كان + يقول as كايقول
//     stays a miss, and the old rule's كان + ما -> كاما false match
//     is fixed. (لمن/ممن as first word is a deliberate gap.)
//   * lam sakinah in قل/بل/هل + ر/ل (idgham: قل رب -> قرب،
//     بل رفعه -> برفعه). وقال/جعل never assimilate: their lam is
//     voweled. Exact concatenation is checked by the caller.
// A geminate written single (لكم ما -> لكما) is deliberately NOT
// accepted: لكما/منهما are real words, so that spelling is a
// plausible wrong word, not just an assimilation.
const NUN_WORDS = ['من', 'ان', 'عن', 'لن'];
function pairBase(w: string): string {
  let b = w;
  for (;;) {
    if (NUN_WORDS.includes(b)) return b;
    if (b.startsWith('و') || b.startsWith('ف')) { b = b.slice(1); continue; }
    if (b.startsWith('اف') || b.startsWith('او')) { b = b.slice(2); continue; }
    return b;
  }
}
function assimilatedPairForms(a: string, b: string): string[] {
  const forms: string[] = [];
  if (a.endsWith('ن') && NUN_WORDS.includes(pairBase(a))) {
    if (/^[يرملون]/.test(b)) forms.push(a.slice(0, -1) + b);
    else if (b.startsWith('ب')) forms.push(a.slice(0, -1) + 'م' + b, a.slice(0, -1) + b);
  }
  const lamBase = a.replace(/^[وف]/, '');
  if ((lamBase === 'قل' || lamBase === 'بل' || lamBase === 'هل') && a.endsWith('ل') && /^[رل]/.test(b)) {
    forms.push(a.slice(0, -1) + b);
  }
  return forms;
}

// A mushaf word spoken split across tokens: the parts concatenate
// to it. A boundary ا+ا may collapse to one ا: ها + أنتم is spoken
// for هأنتم, where the mushaf merges ها's ا with أنتم's أ.
function splitMatches(parts: string[], expected: string): boolean {
  const collapsible = parts.slice(0, -1).map((p, b) => p.endsWith('ا') && parts[b + 1].startsWith('ا'));
  const total = 1 << Math.max(0, parts.length - 1);
  for (let mask = 0; mask < total; mask++) {
    let ok = true;
    let s = '';
    for (let p = 0; p < parts.length; p++) {
      let part = parts[p];
      if (p > 0 && (mask & (1 << (p - 1)))) {
        if (!collapsible[p - 1]) { ok = false; break; }
        part = part.slice(1);
      }
      s += part;
    }
    if (ok && s === expected) return true;
  }
  return false;
}

// Greedy in-order alignment: every expected word must appear in the
// spoken words, in order. Extra spoken words (basmalah, isti'adha,
// a repeated word) are ignored — they never consume an expected word.
// A skipped or misspoken word stays unmatched: that is the wrong part.
// Joined words: mushaf tokens are sometimes written joined
// (يَـٰٓأَيُّهَا -> one token) while speech splits them (يا + أيها),
// and vice versa (مِن + مَّا spoken as one مما, with the ن assimilated
// into the م; see assimilatedPairForms for the full set). A bounded
// 2- and 3-token lookahead on both sides handles these without ever
// matching out of order.
// Muqatta'at letter-name matching (2026-10-28): an expected
// opening token also matches when spoken as its letter names
// (ألف لام ميم for الم) or as a canonical-equal single token
// (طاها for طه، ياس for يس، الاما for الم — the seeded rasm
// variants). Gated on the expected token canonicalizing into the
// closed 14-token set, and for الم additionally on the next
// expected word being a genuine opening second word (see
// arabicNormalize: ألم "did-not" normalizes to الم too, and must
// never match letter names). Runs are searched in order like the
// other attempts; in strict mode skipped tokens before the run
// become extras via consumeThrough, exactly as for joins.
function muqattaatMatchAt(expected: string[], i: number, spoken: string[], j: number): { start: number; count: number } | null {
  const letters = muqattaatLetters(expected[i]);
  if (!letters) return null;
  // End-of-list الم is not gated (see muqattaatAlifLamMeemBlocked):
  // no ayah ends with the word ألم, so the gate only applies when a
  // next expected word exists to disambiguate against.
  if (letters === 'الم' && i + 1 < expected.length) {
    if (!MUQATTAAT_ALIF_LAM_MEEM_SECONDS.includes(expected[i + 1])) return null;
  }
  // Round-2 generalized shapes (single letters, joined names, ال-names,
  // dagger singles, mixed runs, و-bridges, fragments): one
  // target-directed window parse (see arabicNormalize). Tried FIRST,
  // before the name run and the single-token canonical path: a single
  // spoken token can shadow a longer run that starts earlier. The one
  // case in the Quran: الر spoken as ال-names (الألف اللام الراء) —
  // the last name alone canonicalizes to الر (the canonical rule
  // drops ا after a letter), so the single-token path matched it and
  // stranded the first two names as strict extras, while the window
  // path consumes all three. The window parse subsumes both older
  // paths (every name run and every single-token spelling parses as
  // a window); they remain below as fallbacks for any window-bound
  // edge. Only reached when the الم gate above passed, so the gate
  // covers these shapes exactly as it covers the name run. Longest
  // window at the earliest start wins: a token like لام is ambiguous
  // (name لام, or dagger-ل + م), so the shortest matching window can
  // strand the rest of the run as strict extras (ألف و لام و ميم
  // matched as ألف + لا + م, leaving و ميم) — the longest window
  // consumes the whole run. A longer window can only match by
  // spelling the target in full, so preferring it cannot swallow a
  // following ordinary word.
  for (let k = j; k < spoken.length; k++) {
    for (let len = Math.min(14, spoken.length - k); len >= 1; len--) {
      if (muqattaatWindowMatches(spoken.slice(k, k + len), letters)) return { start: k, count: len };
    }
  }
  for (let k = j; k < spoken.length; k++) {
    if (k + letters.length <= spoken.length) {
      let ok = true;
      for (let t = 0; t < letters.length; t++) {
        if (MUQATTAAT_NAME_TO_LETTER[spoken[k + t]] !== letters[t]) { ok = false; break; }
      }
      if (ok) return { start: k, count: letters.length };
    }
    if (muqattaatLetters(spoken[k]) === letters) return { start: k, count: 1 };
  }
  return null;
}

function alignWords(expected: string[], spoken: string[]): { matched: boolean[]; allMatched: boolean; positions: number[]; consumed: number[] } {
  const matched = new Array(expected.length).fill(false);
  // E2: spoken index each expected word matched at (-1 if unmatched).
  // Recording only — the match decisions below are untouched.
  const positions = new Array(expected.length).fill(-1);
  // F1: how many spoken tokens each match consumed (exact = 1, join =
  // joinedCount, muq = run length, pair = 1 for both entries).
  // Recording only, like positions: the overshoot anchor needs the
  // END of the consumed span (positions[i] + consumed[i] - 1), not
  // the start — anchoring at the start counted a match's own
  // fragments (letter names, split pieces) as new words.
  const consumed = new Array(expected.length).fill(1);
  let j = 0;
  let i = 0;
  while (i < expected.length) {
    let found = -1;
    for (let k = j; k < spoken.length; k++) {
      if (spoken[k] === expected[i]) { found = k; break; }
    }
    if (found >= 0) { matched[i] = true; positions[i] = found; j = found + 1; i++; continue; }
    let joined = -1;
    let joinedCount = 2;
    // Prefix prefilter (coordinator amendment, semantics-preserving):
    // splitMatches can only succeed when the first part is a prefix
    // of the expected word (only later parts may lose a leading ا),
    // so non-prefix candidates skip the allocation-heavy call. Without
    // this, the no-match worst case at 6000 words was ~6.1s vs ~0.44s
    // baseline; with it, it returns to near baseline.
    // Round-2 join guard: a join whose pieces are ALL letter pieces
    // is a letter recitation, not a split word — so for a gated-out
    // الم (the word ألم, e.g. 105:1) it must not match here. The
    // gate already closes the name/window paths; without this guard
    // the join path silently bypassed it (ا ل م matched 105:1's الم
    // via 3-token concatenation). Word-fragment splits (أ + لم)
    // keep working: their pieces are not all letter pieces. The
    // loop keeps scanning past a rejected candidate.
    const joinBlocked = muqattaatAlifLamMeemBlocked(expected[i], i + 1 < expected.length ? expected[i + 1] : '');
    for (let k = j; k + 1 < spoken.length; k++) {
      if (expected[i].startsWith(spoken[k]) && splitMatches([spoken[k], spoken[k + 1]], expected[i]) &&
          !(joinBlocked && muqattaatIsLetterPiece(spoken[k]) && muqattaatIsLetterPiece(spoken[k + 1]))) { joined = k; break; }
    }
    if (joined < 0) {
      for (let k = j; k + 2 < spoken.length; k++) {
        if (expected[i].startsWith(spoken[k]) && splitMatches([spoken[k], spoken[k + 1], spoken[k + 2]], expected[i]) &&
            !(joinBlocked && muqattaatIsLetterPiece(spoken[k]) && muqattaatIsLetterPiece(spoken[k + 1]) && muqattaatIsLetterPiece(spoken[k + 2]))) { joined = k; joinedCount = 3; break; }
      }
    }
    // Four fragments (e.g. للمتقين heard as ل ل م تقين): same
    // exact-concatenation rule as the 2/3-part joins, so a 4-part
    // join can only pass when four consecutive spoken tokens form
    // the expected word exactly — it cannot invent a word the user
    // did not say, and the all-letter-piece guard above still bars
    // letter recitations from matching a gated-out الم.
    if (joined < 0) {
      for (let k = j; k + 3 < spoken.length; k++) {
        if (expected[i].startsWith(spoken[k]) && splitMatches([spoken[k], spoken[k + 1], spoken[k + 2], spoken[k + 3]], expected[i]) &&
            !(joinBlocked && muqattaatIsLetterPiece(spoken[k]) && muqattaatIsLetterPiece(spoken[k + 1]) && muqattaatIsLetterPiece(spoken[k + 2]) && muqattaatIsLetterPiece(spoken[k + 3]))) { joined = k; joinedCount = 4; break; }
      }
    }
    if (joined >= 0) { matched[i] = true; positions[i] = joined; consumed[i] = joinedCount; j = joined + joinedCount; i++; continue; }
    const muq = muqattaatMatchAt(expected, i, spoken, j);
    if (muq) { matched[i] = true; positions[i] = muq.start; consumed[i] = muq.count; j = muq.start + muq.count; i++; continue; }
    if (i + 1 < expected.length) {
      const pair = expected[i] + expected[i + 1];
      const forms = assimilatedPairForms(expected[i], expected[i + 1]);
      let foundPair = -1;
      for (let k = j; k < spoken.length; k++) {
        if (spoken[k] === pair || forms.includes(spoken[k])) { foundPair = k; break; }
      }
      if (foundPair >= 0) { matched[i] = true; matched[i + 1] = true; positions[i] = foundPair; positions[i + 1] = foundPair; j = foundPair + 1; i += 2; continue; }
    }
    i++;
  }
  return { matched, allMatched: matched.every(Boolean), positions, consumed };
}

// Strict alignment (intermediate/advanced levels): the same greedy
// in-order match as alignWords, but spoken words that are skipped over
// (extra words: a repeated word, an added word, isti'adha after the
// start) are collected as extras instead of being silently ignored.
// Joined-word merges consume their spoken tokens, so they are never
// extras. A strict pass needs allMatched AND zero extras.
function alignWordsStrict(expected: string[], spoken: string[]): { matched: boolean[]; allMatched: boolean; extras: string[]; positions: number[]; consumed: number[] } {
  const matched = new Array(expected.length).fill(false);
  const positions = new Array(expected.length).fill(-1);
  // F1: consumed counts, same sites as alignWords (see above).
  const consumed = new Array(expected.length).fill(1);
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
    if (found >= 0) { consumeThrough(found, 1); matched[i] = true; positions[i] = found; i++; continue; }
    let joined = -1;
    let joinedCount = 2;
    // Prefix prefilter (coordinator amendment, semantics-preserving):
    // splitMatches can only succeed when the first part is a prefix
    // of the expected word (only later parts may lose a leading ا),
    // so non-prefix candidates skip the allocation-heavy call. Without
    // this, the no-match worst case at 6000 words was ~6.1s vs ~0.44s
    // baseline; with it, it returns to near baseline.
    // Round-2 join guard (same as alignWords): an all-letter-piece
    // join is a letter recitation, so it must not match a gated-out
    // الم via the join path. Word-fragment splits keep working.
    const joinBlocked = muqattaatAlifLamMeemBlocked(expected[i], i + 1 < expected.length ? expected[i + 1] : '');
    for (let k = j; k + 1 < spoken.length; k++) {
      if (expected[i].startsWith(spoken[k]) && splitMatches([spoken[k], spoken[k + 1]], expected[i]) &&
          !(joinBlocked && muqattaatIsLetterPiece(spoken[k]) && muqattaatIsLetterPiece(spoken[k + 1]))) { joined = k; break; }
    }
    if (joined < 0) {
      for (let k = j; k + 2 < spoken.length; k++) {
        if (expected[i].startsWith(spoken[k]) && splitMatches([spoken[k], spoken[k + 1], spoken[k + 2]], expected[i]) &&
            !(joinBlocked && muqattaatIsLetterPiece(spoken[k]) && muqattaatIsLetterPiece(spoken[k + 1]) && muqattaatIsLetterPiece(spoken[k + 2]))) { joined = k; joinedCount = 3; break; }
      }
    }
    // Four fragments, same exact-concatenation rule and letter-piece
    // guard as the 2/3-part joins (see alignWords).
    if (joined < 0) {
      for (let k = j; k + 3 < spoken.length; k++) {
        if (expected[i].startsWith(spoken[k]) && splitMatches([spoken[k], spoken[k + 1], spoken[k + 2], spoken[k + 3]], expected[i]) &&
            !(joinBlocked && muqattaatIsLetterPiece(spoken[k]) && muqattaatIsLetterPiece(spoken[k + 1]) && muqattaatIsLetterPiece(spoken[k + 2]) && muqattaatIsLetterPiece(spoken[k + 3]))) { joined = k; joinedCount = 4; break; }
      }
    }
    if (joined >= 0) { consumeThrough(joined, joinedCount); matched[i] = true; positions[i] = joined; consumed[i] = joinedCount; i++; continue; }
    const muq = muqattaatMatchAt(expected, i, spoken, j);
    if (muq) { consumeThrough(muq.start, muq.count); matched[i] = true; positions[i] = muq.start; consumed[i] = muq.count; i++; continue; }
    if (i + 1 < expected.length) {
      const pair = expected[i] + expected[i + 1];
      const forms = assimilatedPairForms(expected[i], expected[i + 1]);
      let foundPair = -1;
      for (let k = j; k < spoken.length; k++) {
        if (spoken[k] === pair || forms.includes(spoken[k])) { foundPair = k; break; }
      }
      if (foundPair >= 0) { consumeThrough(foundPair, 1); matched[i] = true; matched[i + 1] = true; positions[i] = foundPair; positions[i + 1] = foundPair; i += 2; continue; }
    }
    i++;
  }
  // Trailing spoken words after the last match are extras too.
  for (let t = j; t < spoken.length; t++) extras.push(spoken[t]);
  // P1: opaque numeral tokens are never extras — they are ASR
  // artifacts (Safari wrote "2", the user did not say it), so
  // counting one as an extra would penalize the engine's rendering,
  // not the recitation. They stay visible in heard counts/display.
  return { matched, allMatched: matched.every(Boolean), extras: extras.filter((t) => !isOpaqueToken(t)), positions, consumed };
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
// Correction text goes through correctionSpeechText: muqatta'at
// tokens are spoken as letter names, other words keep their form
// with only Quranic annotation marks stripped (see arabicNormalize).
// Browser-TTS voice pick (S4 voice safety): the old code set lang
// only, so which voice spoke a timer-triggered correction was device
// luck — on some devices no Arabic voice was picked at all and the
// correction played silent or in the wrong language. Prefer an
// ar-SA voice, then ar-EG, then any Arabic voice; null means "let
// the engine pick by lang" (voices load asynchronously, so an empty
// list early in the session is not an error).
function pickArabicTtsVoice(): SpeechSynthesisVoice | null {
  try {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;
    const ar = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('ar'));
    if (ar.length === 0) return null;
    return ar.find((v) => v.lang.toLowerCase().startsWith('ar-sa'))
      || ar.find((v) => v.lang.toLowerCase().startsWith('ar-eg'))
      || ar[0];
  } catch {
    return null;
  }
}
// DIAG (Claude P0-5): speakCorrection is module-level, outside the
// component, so its TTS start/end cannot reach the component's event
// log directly. An optional listener bridges it: the component
// registers its log push on mount and clears it on unmount. Null by
// default, so behaviour without a listener is exactly unchanged.
type DiagTtsFn = (kind: 'tts-start' | 'tts-end' | 'tts-error', label: string) => void;
let diagTtsListener: DiagTtsFn | null = null;
function speakCorrection(words: string[], rate = 1.0, onFailed?: () => void) {
  if (words.length === 0) return;
  try {
    // D2: no TTS engine at all used to be a silent return — the
    // caller can now show the visible fallback instead (R5).
    if (!('speechSynthesis' in window)) { try { onFailed?.(); } catch {} return; }
    window.speechSynthesis.cancel();
    // One retry with the engine default voice: if the picked Arabic
    // voice errors (timer-triggered playback on some phones), the
    // correction must still be heard rather than silently lost.
    // If the default voice errors too, the correction is lost: the
    // caller reports it visibly instead of staying silent.
    const speakOnce = (voice: SpeechSynthesisVoice | null) => {
      try {
        const u = new SpeechSynthesisUtterance(correctionSpeechText(words));
        u.lang = 'ar-SA';
        u.rate = rate;
        if (voice) u.voice = voice;
        u.onstart = () => { try { diagTtsListener?.('tts-start', 'tts-correction'); } catch {} };
        u.onend = () => { try { diagTtsListener?.('tts-end', 'tts-correction'); } catch {} };
        u.onerror = () => { try { diagTtsListener?.('tts-error', 'tts-correction'); } catch {} if (voice) speakOnce(null); else { try { onFailed?.(); } catch {} } };
        window.speechSynthesis.speak(u);
      } catch { try { onFailed?.(); } catch {} }
    };
    speakOnce(pickArabicTtsVoice());
  } catch { try { onFailed?.(); } catch {} }
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
  // Ref mirror of ayahs (v12): position-mode call sites run from
  // timeouts and listeners that must see the current range, not a
  // stale render closure. Set alongside setAyahs, never in a deps
  // array (TDZ rule: refs are read at call time, not render time).
  const ayahsRef = useRef<TestAyah[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grades, setGrades] = useState<boolean[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Phase 1 offline notice: true only when the test's texts were
  // served from the IndexedDB text cache while the device reports
  // offline (an online cache hit is just fast, silent).
  const [textOfflineNotice, setTextOfflineNotice] = useState(false);
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
  // D1 diagnostics: shell + build stamp + SR presence, all recorded
  // next to the raw transcript line. micSupported and appShell are
  // mount-time snapshots (see detectAppShell); the stamp comes from
  // the Vite define (Vercel commit short hash, 'dev' fallback) and
  // can never break the build when the SHA is absent.
  const [appShell] = useState(detectAppShell);
  const BUILD_SHA = typeof __BUILD_SHA__ === 'string' && __BUILD_SHA__ ? __BUILD_SHA__ : 'dev';
  const stampLine = `نسخة: ${BUILD_SHA} • الواجهة: ${appShell} • الميكروفون: ${micSupported ? 'present' : 'absent'}`;
  // D1 shell-aware mic-absent wording (R7): when SR is absent AND
  // the shell is known, name the shell and the actionable move
  // (open in Safari) instead of only the generic message. The claim
  // is scoped to this device in this shell ("غير متاح على هذا
  // الجهاز") — standalone absence is version-dependent, so it is
  // never asserted as a universal fact. Unknown shells keep the
  // generic wording. No iOS Settings path is written here (R8: the
  // exact recovery path is unverified, so copy stays generic).
  const micAbsentMessage = (suffix: string): string => {
    if (appShell === 'standalone') return `في التطبيق المثبت، التسميع بالميكروفون غير متاح على هذا الجهاز — جرّب فتح التطبيق في تبويب سفاري${suffix}`;
    if (appShell === 'chrome-ios') return `في كروم على آيفون، التسميع بالميكروفون غير متاح على هذا الجهاز — جرّب سفاري${suffix}`;
    if (appShell === 'firefox-ios' || appShell === 'edge-ios') return `في هذا المتصفح، التسميع بالميكروفون غير متاح على هذا الجهاز — جرّب سفاري${suffix}`;
    return `المتصفح ده مش بيدعم التسميع بالميكروفون${suffix}`;
  };
  const micAbsentSetupNote = appShell === 'standalone'
    ? 'الوضع المتصل يحتاج ميكروفون — في التطبيق المثبت، التسميع بالميكروفون غير متاح على هذا الجهاز، فالاختيار ده مقفول — جرّب فتح التطبيق في تبويب سفاري.'
    : appShell === 'chrome-ios'
    ? 'الوضع المتصل يحتاج ميكروفون — في كروم على آيفون، التسميع بالميكروفون غير متاح على هذا الجهاز، فالاختيار ده مقفول — جرّب سفاري.'
    : 'الوضع المتصل يحتاج ميكروفون — جهازك مش بيدعمه، فالاختيار ده مقفول.';
  // D1 empty-transcript honesty (reporting only; matching untouched):
  // a continuous run that ends with zero matched words must not be
  // reported as a 0% ayah-by-ayah failure list. contZeroMatch gates
  // the done screen to an honest panel; contMatchedWords /
  // contHeardWords feed the done diagnostic line. Cleared on every
  // new test start (startTestGlobal) and on "تسميع جديد".
  const [contZeroMatch, setContZeroMatch] = useState(false);
  // E1 full-transcript diagnostic (done screen only): the capped line
  // (head 120 + tail 180 chars) made the 2026-10-28 device screenshot
  // undecodable in the middle, and a mixed Arabic+digit line under
  // dir=rtl leaves the true token order ambiguous (is "لام ميم 1000"
  // the transcript order, or a display-order artifact?). The done
  // screen therefore offers the FULL untruncated text plus a numbered
  // token list (number = logical order, so no reader can mistake the
  // order whatever the display direction). Listening cards keep the
  // capped line unchanged. Cleared on every new test start and on
  // "تسميع جديد", like contZeroMatch.
  const [showFullHeard, setShowFullHeard] = useState(false);
  const [contMatchedWords, setContMatchedWords] = useState(0);
  const [contHeardWords, setContHeardWords] = useState(0);
  // DIAG (Claude P0-5): on-screen event log + Copy JSON export.
  // Recording only: every push below is a log call, never a branch
  // condition, so grading, matching, interrupts and prompts are
  // untouched. Events cap at 2000 (oldest dropped, flag set); the
  // finals list is uncapped because replay needs every final.
  // `rel` is ms since the current test started (performance.now);
  // `t` is the wall-clock epoch ms. Timestamps come from the same
  // clock the watchdog uses, so log order matches engine order.
  type DiagEvent = { k: string; t: number; rel: number; text?: string; final?: boolean; code?: string; label?: string; ok?: boolean; msFromPrompt?: number; fetchMs?: number; timeoutMs?: number; hit?: boolean; hits?: number; misses?: number; hitRatio?: number; entries?: number; skipped?: number; storageBytes?: number | null; reason?: string; words?: string[]; indices?: number[]; trigger?: string; ayah?: number };
  const DIAG_EVENT_CAP = 2000;
  const DIAG_DISPLAY_CAP = 500;
  const diagEventsRef = useRef<DiagEvent[]>([]);
  const diagFinalsRef = useRef<string[]>([]);
  const diagStartRef = useRef(0);
  const diagTruncatedRef = useRef(false);
  const diagRangeRef = useRef<{ surah: number; from: number; to: number; startGlobal: number; endGlobal: number; level: string; mode: string; corrDelay: number; corrRate: string } | null>(null);
  // RECORDER (Phase 0): ONE wall-clock reference per session. The
  // per-event `rel` offsets already use performance.now() (never
  // Date.now(), whose device clock can shift); this single Date.now()
  // exists only to link sessions (case date + id).
  const diagStartWallRef = useRef(0);
  const [micPerm, setMicPerm] = useState('unknown');
  const micPermRef = useRef('unknown');
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagCopied, setDiagCopied] = useState('');
  const diagPush = (k: string, extra?: Partial<DiagEvent>) => {
    try {
      const ev: DiagEvent = { k, t: Date.now(), rel: diagStartRef.current ? Math.round(performance.now() - diagStartRef.current) : 0, ...(extra || {}) };
      const arr = diagEventsRef.current;
      if (arr.length >= DIAG_EVENT_CAP) { arr.shift(); diagTruncatedRef.current = true; }
      arr.push(ev);
    } catch {}
  };
  const diagClear = () => {
    diagEventsRef.current = [];
    diagFinalsRef.current = [];
    diagTruncatedRef.current = false;
    diagStartRef.current = performance.now();
    diagStartWallRef.current = Date.now();
    recPromptDedupeRef.current = new Set();
    recAyahFinalsRef.current = {};
    setDiagOpen(false);
    setDiagCopied('');
  };
  // Display-only microphone permission hint (never gates anything).
  const diagPermRefresh = () => {
    try {
      const nav = navigator as any;
      if (nav?.permissions?.query) {
        nav.permissions.query({ name: 'microphone' }).then((r: any) => {
          const s = r?.state || 'unknown';
          micPermRef.current = s;
          setMicPerm(s);
        }).catch(() => {});
      }
    } catch {}
  };
  // Bridge the module-level speakCorrection TTS events into this log.
  useEffect(() => {
    diagTtsListener = (kind, label) => diagPush(kind, { label });
    return () => { diagTtsListener = null; };
  }, []);
  // R5 (Claude-2) LOCALITY GUARANTEE: this export NEVER leaves the
  // device on its own. Its only outputs are the user's explicit
  // clipboard copy (diagCopyJson below: clipboard API with a
  // textarea fallback) — there is no fetch, no supabase call, no
  // beacon and no auto-send anywhere on the diag paths (verified by
  // grep over diagPush/diagExport/diagCopyJson and the panel). The
  // recitation transcript inside the JSON is the user's own speech;
  // it moves only when the user pastes it somewhere themselves.
  // Export shape (format 'quran-test-diag/v1', documented in the
  // followup-diag evidence file): meta + settings + range + the
  // recorded outcome (grades, wrongByAyah) + the full event list +
  // every chosen final transcript + the expected ayah texts, so an
  // offline runner can replay the finals through the real aligners.
  const diagExport = () => ({
    format: 'quran-test-diag/v1',
    version: BUILD_SHA,
    shell: appShell,
    ua: (() => { try { return navigator.userAgent; } catch { return ''; } })(),
    micPermission: micPermRef.current,
    settings: diagRangeRef.current ? { level: diagRangeRef.current.level, mode: diagRangeRef.current.mode, corrDelay: diagRangeRef.current.corrDelay, corrRate: diagRangeRef.current.corrRate } : null,
    range: diagRangeRef.current ? { surah: diagRangeRef.current.surah, from: diagRangeRef.current.from, to: diagRangeRef.current.to, startGlobal: diagRangeRef.current.startGlobal, endGlobal: diagRangeRef.current.endGlobal } : null,
    grades,
    wrongByAyah,
    events: diagEventsRef.current,
    finals: diagFinalsRef.current,
    expected: ayahs.map((a) => ({ surah: a.surah_no, ayah: a.ayah_no, text: a.ayah_text })),
    truncated: diagTruncatedRef.current,
  });
  const diagCopyJson = async () => {
    try {
      diagPermRefresh();
      const text = JSON.stringify(diagExport(), null, 2);
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) {
          // Next-patch: execCommand reports success, and the old code
          // ignored it — a silent failure (possible on Safari) showed
          // a false success toast. On failure, show the full JSON in
          // a textarea for manual copying and do NOT claim success.
          // N3' (Claude reply 7): the manual layer gets a FIXED id
          // and any previous copy is removed first, so repeated
          // taps cannot stack layers; it is also removed on
          // unmount (see the cleanup effect). 16px + explicit
          // background: Safari zooms on focus below 16px, and a
          // transparent background shows the page behind the text.
          document.getElementById('quran-diag-manual-copy')?.remove();
          document.getElementById('quran-diag-manual-close')?.remove();
          const manual = document.createElement('textarea');
          manual.id = 'quran-diag-manual-copy';
          manual.value = text;
          manual.readOnly = true;
          manual.style.cssText = 'position:fixed;inset:10px;z-index:9999;width:calc(100vw - 20px);height:calc(100dvh - 20px);font-size:16px;background:#ffffff;color:#111827;';
          document.body.appendChild(manual);
          manual.select();
          manual.setSelectionRange(0, manual.value.length);
          const close = document.createElement('button');
          close.id = 'quran-diag-manual-close';
          close.textContent = 'إغلاق';
          close.style.cssText = 'position:fixed;top:16px;left:16px;z-index:10000;padding:8px 14px;border-radius:10px;background:#065f46;color:#fff;font-weight:bold;';
          close.onclick = () => { manual.remove(); close.remove(); };
          document.body.appendChild(close);
          setDiagCopied('تعذر النسخ التلقائي — انسخ النص المعروض يدويًا ثم اضغط إغلاق. اضغط مطوّلًا ثم «تحديد الكل»');
          return;
        }
      }
      setDiagCopied('تم نسخ سجل التشخيص — الصقه في أي مكان');
    } catch {
      setDiagCopied('تعذر النسخ — افتح السجل وانسخه يدويًا');
    }
  };
  // RECORDER (Phase 0): recording-mode state. Default OFF. When OFF,
  // nothing below runs: no prompt/interrupt events, no plan UI, no
  // classification, no case export — the test behaves exactly as
  // today (the toggle itself is the only setup-screen addition).
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const [recTags, setRecTags] = useState<VoiceTags>({ dialect: '', gender: '', pace: 'normal', noise: 'low' });
  const [recPlan, setRecPlan] = useState<PlanEntry[]>([]);
  const [recActual, setRecActual] = useState<Record<string, ActualAyah>>({});
  const [recConsent, setRecConsent] = useState(false);
  const [recCaseCopied, setRecCaseCopied] = useState('');
  const [plDraft, setPlDraft] = useState<{ surah: number; ayah: number; spoken: string; expected: string; type: FixedTaxonomy }>({ surah: 2, ayah: 1, spoken: '', expected: '', type: 'substitution' });
  const [unDraft, setUnDraft] = useState<Record<string, { spoken: string; expected: string; type: FixedTaxonomy; free: string }>>({});
  const [scDraft, setScDraft] = useState<Record<string, string>>({});
  // Snapshot fixed at test start (plan + tags + wall clock). A
  // resumed test re-snapshots from the current setup screen: the
  // plan/tags are the tester's current ones, while the diag log
  // itself continues (diagClear is skipped on restore).
  const recSessionRef = useRef<{ recording: boolean; plan: PlanEntry[]; tags: VoiceTags; wall: number } | null>(null);
  // Ayah-mode finals per "surah:ayah" (continuous finals already
  // live in diagFinalsRef). Filled only while recording.
  const recAyahFinalsRef = useRef<Record<string, string[]>>({});
  const recPromptDedupeRef = useRef<Set<string>>(new Set());
  const toggleRecording = () => {
    const next = !recording;
    setRecording(next);
    recordingRef.current = next;
    if (next && !recTags.gender) {
      const g = corrGender === 'male' ? 'male' : corrGender === 'female' ? 'female' : '';
      if (g) setRecTags((t) => ({ ...t, gender: g }));
    }
  };
  // RECORDER: first-class prompt/interrupt events. Only when
  // recording is ON (OFF path pushes nothing — diag output
  // identical to today). Ayah-mode prompts dedupe by (ayah,
  // words): one ayah has one evaluation, so a repeat is a
  // re-fire, not a new episode. Continuous prompts are NOT
  // deduped here: distinct stall episodes for the same words are
  // distinct prompts (speakContPrompt's own gating already
  // prevents overlaps), and replays pass no trigger at all.
  const recPushPrompt = (trigger: 'confirmed-miss' | 'overshoot' | 'stall' | 'ayah-mode' | 'interim-miss', words: string[], indices: number[], ayahPos?: number) => {
    if (!recordingRef.current) return;
    try {
      if (trigger === 'ayah-mode') {
        const key = `${ayahPos ?? -1}|${words.join('|')}`;
        if (recPromptDedupeRef.current.has(key)) return;
        recPromptDedupeRef.current.add(key);
      }
      const extra: Partial<DiagEvent> = { words, indices, trigger };
      if (ayahPos !== undefined) extra.ayah = ayahPos;
      diagPush('prompt', extra);
      // Interrupts are the mid-flow subset: confirmed-miss,
      // overshoot, and interim-miss only. Stall and ayah-mode
      // prompts never interrupt a live recitation.
      if (trigger === 'confirmed-miss' || trigger === 'overshoot' || trigger === 'interim-miss') diagPush('interrupt', extra);
    } catch {}
  };
  // RECORDER: assemble the case preview/export from the finished
  // test. Pure lib call; returns status + reasons + cases (empty
  // when the range cannot be a case, e.g. multi-surah).
  const recBuildPreview = () => {
    const sess = recSessionRef.current;
    const range = diagRangeRef.current;
    if (!sess || !range) return { cases: [] as Record<string, unknown>[], status: 'partial' as const, reasons: ['no recorded session'], droppedOutOfRange: 0 };
    const endSurah = globalToPoint(range.endGlobal).surah;
    const ua = (() => { try { return navigator.userAgent; } catch { return ''; } })();
    const finalsByAyah: Record<string, string> = {};
    for (const [k, arr] of Object.entries(recAyahFinalsRef.current)) finalsByAyah[k] = arr.join(' ');
    return buildCase({
      build: BUILD_SHA,
      shell: appShell,
      ua,
      iosVersion: parseIosVersion(ua),
      sessionWall: sess.wall,
      settings: { level: range.level, mode: range.mode, corrDelay: range.corrDelay, corrRate: range.corrRate },
      range: { surah: range.surah, from: range.from, to: range.to, startGlobal: range.startGlobal, endGlobal: range.endGlobal, endSurah },
      ayahs: ayahs.map((a) => ({ surah: a.surah_no, ayah: a.ayah_no, text: a.ayah_text, orig: expectedWordList(a.ayah_text).map((w) => w.orig) })),
      grades,
      wrongByAyah,
      skipped,
      finalsByAyah: range.mode === 'ayah' ? finalsByAyah : null,
      finalsJoined: range.mode === 'continuous' ? diagFinalsRef.current.join(' ') : null,
      events: diagEventsRef.current.filter((e) => e.k === 'prompt' || e.k === 'interrupt').map((e) => ({ k: e.k as 'prompt' | 'interrupt', words: e.words ?? [], indices: e.indices ?? [], trigger: (e.trigger ?? 'stall') as 'confirmed-miss' | 'overshoot' | 'stall' | 'ayah-mode' | 'interim-miss', rel: e.rel, ayah: e.ayah })),
      plan: sess.plan,
      actual: recActual,
      consent: recConsent,
      voiceTags: sess.tags,
      zeroMatch: contZeroMatch,
      eventsTruncated: diagTruncatedRef.current,
    });
  };
  // RECORDER: case export through the SAME copy pattern as diag
  // (clipboard first, execCommand, full-JSON manual textarea on
  // failure, never a false success toast). Distinct manual-layer
  // ids so it cannot collide with the diag layer. No auto-upload:
  // the JSON leaves the device only when the user pastes it.
  const recCaseCopyJson = async () => {
    const preview = recBuildPreview();
    if (preview.cases.length === 0) {
      setRecCaseCopied(`لا يمكن تصدير حالة: ${preview.reasons.join('؛ ')} — استخدم نسخ JSON التشخيصي بدلًا من ذلك.`);
      return;
    }
    const text = JSON.stringify(preview.cases[0], null, 2);
    try {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) {
          document.getElementById('quran-case-manual-copy')?.remove();
          document.getElementById('quran-case-manual-close')?.remove();
          const manual = document.createElement('textarea');
          manual.id = 'quran-case-manual-copy';
          manual.value = text;
          manual.readOnly = true;
          manual.style.cssText = 'position:fixed;inset:10px;z-index:9999;width:calc(100vw - 20px);height:calc(100dvh - 20px);font-size:16px;background:#ffffff;color:#111827;';
          document.body.appendChild(manual);
          manual.select();
          manual.setSelectionRange(0, manual.value.length);
          const close = document.createElement('button');
          close.id = 'quran-case-manual-close';
          close.textContent = 'إغلاق';
          close.style.cssText = 'position:fixed;top:16px;left:16px;z-index:10000;padding:8px 14px;border-radius:10px;background:#065f46;color:#fff;font-weight:bold;';
          close.onclick = () => { manual.remove(); close.remove(); };
          document.body.appendChild(close);
          setRecCaseCopied('تعذر النسخ التلقائي — انسخ النص المعروض يدويًا ثم اضغط إغلاق. اضغط مطوّلًا ثم «تحديد الكل»');
          return;
        }
      }
      setRecCaseCopied(`تم نسخ حالة الاختبار (${preview.status === 'complete' ? 'مكتملة' : 'جزئية'}) — الصقها لإضافتها إلى المدونة.`);
    } catch {
      setRecCaseCopied('تعذر النسخ — افتح الحالة وانسخها يدويًا');
    }
  };
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [countdown, setCountdown] = useState(() => loadTestSettings().corrDelay);
  const [wrongIndices, setWrongIndices] = useState<number[]>([]);
  const [wrongByAyah, setWrongByAyah] = useState<Record<number, string[]>>({});
  const [skipped, setSkipped] = useState<boolean[]>([]);
  const [micError, setMicError] = useState('');
  // S4 voice safety: a stopped-but-preserved session. micStalled is
  // set only by recoverable stops (no-result watchdog, restart-budget
  // trip, failed restart) — never by permission denials — and means
  // "the transcript survived, tap كمّل to resume it". contStalled is
  // the continuous-mode twin (its transcript already survived stops;
  // the flag only adds the honest banner + resume wording).
  const [micStalled, setMicStalled] = useState(false);
  const [contStalled, setContStalled] = useState(false);
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
  // Segmentation pilot (v0, Al-Mulk only): sequential word-file
  // player for the reference 3-word unit. Separate from corrAudio
  // so the current correction path is untouched; stopped whenever
  // the user moves on or taps the synthetic replay.
  const refUnitAudioRef = useRef<HTMLAudioElement | null>(null);
  const [refUnitPlaying, setRefUnitPlaying] = useState(false);
  const [refUnitFailedIdx, setRefUnitFailedIdx] = useState<number | null>(null);
  // Batch 2: lobby mic check (lib/micCheck.ts). Plain state + plain
  // handler (no useCallback deps, so no TDZ risk): the check runs
  // from a tap, samples ~2.5s of room audio, then releases the mic
  // (the lib stops every track and closes the context) — the
  // session's own recognizer starts fresh afterwards, so no stream
  // is ever shared with a session.
  const [micCheckState, setMicCheckState] = useState<'idle' | 'checking' | 'done'>('idle');
  const [micCheckResult, setMicCheckResult] = useState<MicCheckResult | null>(null);
  const [micCheckLevel, setMicCheckLevel] = useState(0);
  const runMicCheck = () => {
    if (micCheckState === 'checking') return;
    setMicCheckState('checking');
    setMicCheckResult(null);
    setMicCheckLevel(0);
    void checkMic({ onLevel: (lv) => setMicCheckLevel(lv) }).then((r) => {
      setMicCheckResult(r);
      setMicCheckState('done');
    });
  };
  const stopRefUnit = () => {
    // Batch 3 (Claude hole 4): disarm before pausing, same rule
    // as the continuous prompt elements.
    try {
      const a = refUnitAudioRef.current;
      if (a) { a.onended = null; a.onerror = null; }
    } catch {}
    try { refUnitAudioRef.current?.pause(); } catch {}
    refUnitAudioRef.current = null;
    setRefUnitPlaying(false);
  };
  const playRefUnit = () => {
    const ayah = ayahs[index];
    if (!ayah || !isRefUnitEnabled(ayah.surah_no, ayah.ayah_no) || wrongIndices.length === 0) return;
    const words = expectedWordList(ayah.ayah_text);
    if (words.length === 0) return;
    stopCorrAudio();
    cancelCorrectionSpeech();
    stopRefUnit();
    setRefUnitFailedIdx(null);
    const unit = refUnitForWord(words.length, wrongIndices[0]);
    const urls: string[] = [];
    for (let i = unit.start; i <= unit.end; i++) urls.push(wbwWordUrl(ayah.surah_no, ayah.ayah_no, i));
    let k = 0;
    setRefUnitPlaying(true);
    const playNext = () => {
      if (k >= urls.length) { refUnitAudioRef.current = null; setRefUnitPlaying(false); return; }
      const a = new Audio(urls[k]);
      refUnitAudioRef.current = a;
      a.onended = () => { k++; playNext(); };
      a.onerror = () => { stopRefUnit(); setRefUnitFailedIdx(index); };
      a.play().catch(() => { stopRefUnit(); setRefUnitFailedIdx(index); });
    };
    playNext();
  };
  const corrFetchTokenRef = useRef(0);
  const corrPendingRef = useRef<{ index: number; wordsKey: string; url: string | null } | null>(null);
  const [correctionAudioByAyah, setCorrectionAudioByAyah] = useState<Record<number, string>>({});
  // Continuous mode: the 3s stall timer, the prompt in progress, the
  // prefetched prompt audio, and the last spoken prompt (replayable).
  const contStallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contPromptingRef = useRef(false);
  const contPromptAudioRef = useRef<HTMLAudioElement | null>(null);
  // Iteration 2: the single-slot prefetch is replaced by a
  // PERSISTENT content-addressed cache (see corrAudioStore):
  // IndexedDB blobs + this synchronous mirror for the prompt path.
  // The old slot keyed stall audio by WORDS but looked it up by
  // INDICES, so the prefetch never hit — and a race-cached
  // context-word audio could play for a bare-word stall prompt with
  // the same indices. The cache key is (version, voice, rate,
  // spoken words, indices), so neither cross-play can happen.
  // A pending stall fetch is tracked separately so it is not
  // fetched twice. The persistent cache SURVIVES test resets by
  // design (a repeat error in a later round must still hit).
  const contAudioCacheRef = useRef(new AudioUrlCache(CONT_AUDIO_CACHE_CAP));
  const contPrefetchPendingRef = useRef<string | null>(null);
  const corrAudioBackendRef = useRef<CorrAudioBackend | null>(null);
  const corrAudioHydratedRef = useRef(false);
  // Iteration 2 diag counters (session-scoped): prompt-lookup hits
  // vs misses, so the hit ratio can later justify — or kill —
  // surah pre-generation. Storage bytes refresh on hydrate/persist
  // via navigator.storage.estimate() where available.
  const corrCacheHitsRef = useRef(0);
  const corrCacheMissesRef = useRef(0);
  const corrStorageBytesRef = useRef<number | null>(null);
  // Iteration 2 generation token + settled flag (Claude): gen bumps
  // on every prompt entry and on every cancel path, so a stale race
  // branch can never play into a newer prompt or after a cancel.
  const speakGenRef = useRef(0);
  const promptSettledRef = useRef(false);
  const contPromptedKeyRef = useRef('');
  // D2 interrupt-silence machinery (see the continuous section):
  // the no-match watchdog timer, the prompt-completion watchdog
  // timer, the last-match baseline (matched count + spoken tokens +
  // wall clock at the last newly matched word), and the one-shot
  // auto-retry marker for a prompt whose audio failed unheard.
  const contNoMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contLastMatchedCountRef = useRef(0);
  const contLastMatchAtRef = useRef(0);
  const contTokensAtLastMatchRef = useRef(0);
  const contPromptRetryRef = useRef('');
  // One silent fresh-instance restart per stall episode (R2): set
  // when a watchdog trip restarts instead of banner-ing, cleared by
  // the next good result (noteWatchdogResult), so a dead engine
  // costs one restart and then the honest banner — never a loop.
  const silentRestartUsedRef = useRef(false);
  // Ayah-mode correction-audio failure: which ayah index the note
  // belongs to (-1 = none). Guards against a cancel-induced TTS
  // error on a torn-down ayah showing a stale note.
  const ayahCorrFailedForRef = useRef(-1);
  // Teacher state (2026-10-28): expected indices already credited
  // (matched once, or fixed by repeating a prompted word — credit is
  // monotonic, so a later re-alignment never un-credits a word he
  // already said right), the norms of fixed words (excluded from
  // strict extras), and the words from the last prompt that he is
  // expected to say back after the resume.
  const contCreditedRef = useRef<Set<number>>(new Set());
  // Continuous-alignment cache (speed-latency): the raw greedy
  // alignment for the current transcript. contFinals only grows by
  // appending whole finals, so the alignment for an unchanged
  // transcript is identical — yet the baseline recomputed it 3x per
  // final (update + interrupt + stall) and 1x per interim, each time
  // re-tokenizing the whole transcript and re-aligning all ~6000
  // expected words. The cache stores only the RAW result; the
  // effective matched set is still recomputed per call from raw +
  // the monotonic credit set, so credit / awaiting-fix / stall /
  // interrupt behaviour is untouched. Keyed by expected-array
  // identity + finals string + strict flag: any change misses and
  // recomputes exactly once. The cached arrays are never mutated
  // (callers map/filter them into fresh arrays).
  const contAlignCacheRef = useRef<{
    expected: { norm: string; orig: string; ayahIdx: number }[];
    finals: string;
    strict: boolean;
    spoken: string[];
    matched: boolean[];
    extras: string[];
    positions: number[];
    consumed: number[];
  } | null>(null);
  // Cached expected norms: contExpected is built once per test, so
  // mapping it to norms on every alignment call was pure allocation.
  const contExpectedNormsRef = useRef<{
    expected: { norm: string; orig: string; ayahIdx: number }[];
    norms: string[];
  } | null>(null);
  const contFixedNormsRef = useRef<Set<string>>(new Set());
  const contAwaitingRef = useRef<{ indices: number[]; norms: string[]; baseLen: number; key: string } | null>(null);
  // P0-1 later-word-cancel fix: expectations displaced by a newer
  // prompt are PRESERVED here (not silently dropped), so repeating
  // the earlier prompted words still credits them via checkContFix.
  // The old code nulled the expectation when a later word prompted
  // (interrupt loop) or overwrote it (stall path via speakContPrompt):
  // the earlier words stayed missed, and a repeat of exactly those
  // words earned no credit through the fix path. Displacement keeps
  // "one correction at a time" on screen (only the newest prompt
  // shows and vetoes) while no prompted expectation is ever lost.
  // Cleared with the live expectation on cancel / new test, and
  // preserved across a silent restart like the live one.
  const contDisplacedRef = useRef<{ indices: number[]; norms: string[]; baseLen: number; key: string }[]>([]);
  const displaceContAwaiting = () => {
    const aw = contAwaitingRef.current;
    if (aw) contDisplacedRef.current = [...contDisplacedRef.current, aw];
  };
  const [contPrompting, setContPrompting] = useState(false);
  const [contLastPrompt, setContLastPrompt] = useState<string[]>([]);
  // Iteration 2: whether the displayed prompt words carry a prepended
  // context word (miss prompts only) — the banner dims it so the
  // user cannot mistake it for the wrong word. Set only by fix
  // prompts (length check vs fixIdx); replay leaves it alone.
  const [contPromptHasContext, setContPromptHasContext] = useState(false);
  // D2: honest no-match state (grading paused, transcript kept,
  // resume offered) and visible audio-failure notes. The notes are
  // the guarantee: the correct words are always on screen even when
  // every audio path fails.
  const [contNoMatch, setContNoMatch] = useState(false);
  const contNoMatchRef = useRef(false);
  const [contAudioFailed, setContAudioFailed] = useState(false);
  const [ayahAudioFailed, setAyahAudioFailed] = useState(false);
  const stopCorrAudio = () => {
    try { corrAudioRef.current?.pause(); } catch {}
    corrAudioRef.current = null;
  };
  const fetchCorrectionAudio = async (words: string[], token: number, pos?: { shape: 'context' | 'bare'; positions: CorrPosition[] }): Promise<string | null> => {
    if (words.length === 0) return null;
    const url = await requestCorrectionAudio(words, pos);
    if (token !== corrFetchTokenRef.current) return null;
    return url;
  };
  // Batch 2 (S4): the correction token is cached for 5 minutes
  // (far inside the ~1h token life) instead of awaiting
  // getSession() before every prompt — getSession is usually ms
  // but occasionally costs a refresh round trip on the hot path.
  // A 401 clears the cache and retries once with a fresh token,
  // so a rotation inside the window costs one retry, never a
  // silent browser-TTS fallback. Any other failure still degrades
  // to browser TTS via the null return, exactly as before.
  const corrTokenRef = useRef<{ token: string; at: number } | null>(null);
  const getCorrToken = async (): Promise<string> => {
    const cached = corrTokenRef.current;
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.token;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? '';
    corrTokenRef.current = { token, at: Date.now() };
    return token;
  };
  // Raw gendered-voice generation (no token): used by the prefetch
  // path above and by mid-flow interrupts, where the correction
  // cannot be prefetched (the miss is only known when it happens).
  const requestCorrectionAudio = async (words: string[], pos?: { shape: 'context' | 'bare'; positions: CorrPosition[] }): Promise<string | null> => {
    if (words.length === 0) return null;
    try {
      // LOCKDOWN 2026-10-29: generate-voice requires a logged-in user
      // JWT (the public anon key is rejected by the function). A
      // missing session degrades to the existing browser-TTS race
      // via the null return below, same as any other fetch failure.
      // POSITION MODE (v12): when positions are supplied, the
      // server rebuilds the spoken text from seeded quran_verses
      // rows and rejects any mismatch — the user-facing path no
      // longer sends free text. Without positions (derivation
      // failed somewhere upstream) the call falls back to the
      // free-text mode, which the function still accepts — never a
      // crash, never a guessed position.
      // PLAYBACK-RATE CONTRACT (v13): both branches send
      // rateMode:'playback' and NO speed. The server generates a
      // neutral-speed file (1.0 on OpenAI paths) and the element
      // applies the user's corrRate via playbackRate
      // (pitch-preserved) — so one file serves all rates and a
      // rate change never regenerates. Callers WITHOUT the flag
      // (old cached tabs) keep baked-speed behavior server-side.
      const body = pos
        ? JSON.stringify({ mode: 'corr', voice: corrGender, shape: pos.shape, spoken: correctionSpeechText(words), positions: pos.positions, rateMode: 'playback' })
        : JSON.stringify({ text: correctionSpeechText(words), voice: corrGender, rateMode: 'playback' });
      const doFetch = (token: string) => fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body,
      });
      let res = await doFetch(await getCorrToken());
      if (res.status === 401) {
        corrTokenRef.current = null;
        res = await doFetch(await getCorrToken());
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.audioUrl) return null;
      return data.audioUrl;
    } catch { return null; }
  };
  // Iteration 2 persistent-cache plumbing (see corrAudioStore).
  // Backend selection: IndexedDB when available, memory fallback
  // otherwise (still correct, just not durable across visits).
  // Every backend call is swallowed on failure — persistence must
  // never break correction.
  const getCorrAudioBackend = (): CorrAudioBackend => {
    if (!corrAudioBackendRef.current) {
      try {
        corrAudioBackendRef.current = createIndexedDBBackend(undefined, undefined, CONT_AUDIO_CACHE_CAP);
      } catch {
        corrAudioBackendRef.current = new MemoryCorrAudioBackend(CONT_AUDIO_CACHE_CAP);
      }
    }
    return corrAudioBackendRef.current;
  };
  const refreshCorrStorageEstimate = () => {
    try {
      const nav = navigator as Navigator & { storage?: { estimate?: () => Promise<{ usage?: number }> } };
      nav.storage?.estimate?.().then((e) => { corrStorageBytesRef.current = typeof e.usage === 'number' ? e.usage : null; }).catch(() => {});
    } catch {}
  };
  // Hydrate the mirror from IndexedDB once (called on continuous
  // start; no-op afterwards). Old-version rows are deleted
  // opportunistically (they miss by key anyway); empty blobs are
  // skipped. A failure here just means this session starts cold —
  // the race + TTS path still works.
  const hydrateCorrAudioCache = () => {
    if (corrAudioHydratedRef.current) return;
    corrAudioHydratedRef.current = true;
    void (async () => {
      try {
        const entries = await getCorrAudioBackend().loadAll();
        let skipped = 0;
        for (const e of entries) {
          if (!e.blob || e.blob.size === 0 || e.version !== CORR_AUDIO_CACHE_VERSION) {
            skipped++;
            if (e.version !== CORR_AUDIO_CACHE_VERSION) {
              void getCorrAudioBackend().remove(e.key).catch(() => {});
            }
            continue;
          }
          try {
            contAudioCacheRef.current.set(e.key, URL.createObjectURL(e.blob));
          } catch { skipped++; }
        }
        refreshCorrStorageEstimate();
        diagPush('cont-prompt-cache-hydrated', { label: 'cont-prompt-audio', entries: entries.length, skipped });
      } catch {
        diagPush('cont-prompt-cache-hydrated', { label: 'cont-prompt-audio', entries: 0, skipped: 0 });
      }
    })();
  };
  // Persist a winning (or late) human voice: fetch the remote audio
  // as a blob, store it durably, and swap the mirror entry to an
  // object URL so the next repeat plays instantly, even offline.
  // Fire-and-forget: any failure leaves the session mirror intact.
  const persistCorrAudio = (cacheKey: string, remoteUrl: string, voice: string, words: string[], indices: number[], rate: number) => {
    void (async () => {
      try {
        const res = await fetch(remoteUrl);
        if (!res.ok) return;
        const blob = await res.blob();
        if (blob.size === 0) return;
        await getCorrAudioBackend().save({ key: cacheKey, voice, words: words.join(' '), indices, rate, version: CORR_AUDIO_CACHE_VERSION, blob, savedAt: Date.now() });
        try {
          contAudioCacheRef.current.set(cacheKey, URL.createObjectURL(blob));
        } catch {}
        refreshCorrStorageEstimate();
      } catch {}
    })();
  };
  // Play a correction: prefetched gendered audio when ready, browser
  // TTS otherwise (instant, so the 3s promise always holds). If the
  // audio element is refused playback (timer-driven playback can be
  // gesture-gated on some phones), fall back to TTS rather than
  // staying silent. D2: a broken audio URL used to have NO onerror
  // handler, so it played nothing and never fell back — onerror now
  // falls back to TTS like a refused play() does, and if TTS fails
  // too the caller is told via onFailed so the words stay visible
  // with a tappable retry (R5). Every caller here runs after
  // stopRec, so no audio ever plays while a recognizer is alive
  // (321436 discipline); the next mic start is always a fresh
  // instance, never the discarded one.
  const playCorrection = (words: string[], audioUrl?: string | null, onFailed?: () => void) => {
    cancelCorrectionSpeech();
    stopCorrAudio();
    const rate = CORR_RATE_VALUE[liveRef.current.corrRate];
    if (audioUrl) {
      const a = new Audio(audioUrl);
      // v13: the file is neutral-speed; the user's corrRate applies
      // here, pitch-preserved (browser TTS below keeps u.rate).
      // v14 (Claude review): Safari resets playbackRate when the src
      // loads and ignores the unprefixed pitch flag, so set both pitch
      // flags and re-apply the rate after metadata loads.
      const applyCorrRate = () => {
        a.playbackRate = rate;
        a.preservesPitch = true;
        (a as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
      };
      applyCorrRate();
      a.onloadedmetadata = applyCorrRate;
      corrAudioRef.current = a;
      a.onplaying = () => { diagPush('tts-start', { label: 'audio-correction' }); };
      a.onended = () => { diagPush('tts-end', { label: 'audio-correction' }); };
      a.onerror = () => { diagPush('tts-error', { label: 'audio-correction' }); speakCorrection(words, rate, onFailed); };
      a.play().catch(() => { speakCorrection(words, rate, onFailed); });
    } else speakCorrection(words, rate, onFailed);
  };
  // Ayah-mode replay with the R5 visible fallback: the button is the
  // tappable "hear the correction" control, and the failure note
  // names the red words already on screen.
  const replayAyahCorrection = () => {
    stopRefUnit();
    ayahCorrFailedForRef.current = index;
    setAyahAudioFailed(false);
    playCorrection(wrongByAyah[index] ?? [], correctionAudioByAyah[index] ?? null, () => {
      if (ayahCorrFailedForRef.current === index) setAyahAudioFailed(true);
    });
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
  // [P0] Recognition-robustness plumbing: restart budget + pending
  // interim. Only one recognizer runs at a time, so one shared pair
  // serves both ayah and continuous mode.
  const recRestartRef = useRef({ count: 0, windowStart: 0 });
  const lastInterimRef = useRef('');
  // Interim early-window stability (2026-10-30, batch 1): the first
  // unmatched expected index + how many consecutive interim events
  // kept it. A fluent substitution keeps the same miss while the
  // user moves on; a revising interim (ريب→ريبة) changes it and
  // resets the count, so a revision can never trigger the window.
  const interimMissRef = useRef<{ key: string; count: number; firstSeenAt: number }>({ key: '', count: 0, firstSeenAt: 0 });
  // Batch 3 (reviewer verdicts): which path opened the current
  // correction window — 'finals' (evaluateNow mismatch) or
  // 'interim' (early window). The heal diag records it, because
  // an interim-origin window is the new behavior and deserves
  // its own heal-rate watch.
  const corrWindowSourceRef = useRef<'finals' | 'interim' | ''>('');
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windowTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // S4 voice safety timers (see helpers below): the no-result
  // watchdog (last result timestamp + its timer) and the transient
  // safety timer (fires when onend never follows a transient error).
  const lastResultAtRef = useRef(0);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transientSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (watchdogTimerRef.current) { clearTimeout(watchdogTimerRef.current); watchdogTimerRef.current = null; }
    if (transientSafetyTimerRef.current) { clearTimeout(transientSafetyTimerRef.current); transientSafetyTimerRef.current = null; }
    // D2: the continuous no-match / prompt-completion watchdogs are
    // timers too — a stop or ayah change must never leave one armed
    // to fire into a torn-down session.
    if (contNoMatchTimerRef.current) { clearTimeout(contNoMatchTimerRef.current); contNoMatchTimerRef.current = null; }
    if (contPromptTimerRef.current) { clearTimeout(contPromptTimerRef.current); contPromptTimerRef.current = null; }
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
    // Iteration 2: leaving mid-prompt must stale any in-flight race
    // branch, or its late resolution would play into the next screen.
    speakGenRef.current++;
    promptSettledRef.current = true;
    cancelCorrectionSpeech();
    try { corrAudioRef.current?.pause(); } catch {}
    try { contPromptAudioRef.current?.pause(); } catch {}
    if (contStallTimerRef.current) clearTimeout(contStallTimerRef.current);
    // N3': the manual-copy layer (diagCopyJson fallback) is
    // imperative DOM, so it must die with the component, not
    // linger across route changes.
    document.getElementById('quran-diag-manual-copy')?.remove();
    document.getElementById('quran-diag-manual-close')?.remove();
  }, []);

  // Reset every per-ayah mic/manual state (called on ayah change, on
  // test start, and when the user stops listening mid-ayah).
  const resetMicState = () => {
    stopRec();
    clearTimers();
    liveRef.current.finals = '';
    lastInterimRef.current = '';
    liveRef.current.micState = 'idle';
    setMicState('idle');
    setMicStalled(false);
    setTranscript('');
    setInterim('');
    setCountdown(liveRef.current.corrDelay);
    setWrongIndices([]);
    setWrongExtras([]);
    setMicError('');
    setAyahAudioFailed(false);
    ayahCorrFailedForRef.current = -1;
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
    // D1: a new test starts with a clean honesty state (a previous
    // no-match panel must never leak into the next run's done screen).
    setContZeroMatch(false);
    setShowFullHeard(false);
    setContMatchedWords(0);
    setContHeardWords(0);
    // DIAG: tap + fresh-test log reset. A restore keeps appending:
    // a resumed test continues the same session's log.
    if (!restore) diagClear();
    diagPush('tap', { label: 'start-test' });
    diagPermRefresh();
    // Capture the mode up front: the setup chips stay tappable while
    // ayahs load, and a mid-load switch must not hijack this test.
    // Resume forces ayah mode; fresh starts use the setup choice.
    const modeAtStart = forceMode ?? reciteMode;
    const lo = Math.max(1, Math.min(startGlobal, endGlobal, 6236));
    const hi = Math.min(Math.max(startGlobal, endGlobal), 6236);
    const startPt = globalToPoint(lo);
    const endPt = globalToPoint(hi);
    // DIAG: snapshot the range + settings for the export header.
    diagRangeRef.current = { surah: startPt.surah, from: startPt.ayah, to: endPt.ayah, startGlobal: lo, endGlobal: hi, level: liveRef.current.level, mode: modeAtStart, corrDelay: liveRef.current.corrDelay, corrRate: liveRef.current.corrRate };
    // RECORDER: snapshot the recording session at test start
    // (plan + tags + the single wall-clock reference). A resumed
    // test re-snapshots from the current setup screen; the diag
    // log itself continues (diagClear is skipped on restore).
    recSessionRef.current = recordingRef.current
      ? { recording: true, plan: recPlan, tags: recTags, wall: diagStartWallRef.current }
      : null;
    setSurah(startPt.surah);
    setError('');
    setTextOfflineNotice(false);
    setLoading(true);
    try {
      // Phase 1 text cache: a cached range serves with zero network
      // calls (fast, and working offline). Rows are static, so a
      // cache hit is identical to the network result; any cache
      // failure degrades to the network path below, unchanged.
      let data: TestAyah[] | null = null;
      let servedFromCache = false;
      const cachedRange = await getQuranTextCache().getRange(lo, hi);
      if (cachedRange) {
        data = cachedRange as TestAyah[];
        servedFromCache = true;
      } else {
        const { data: netData, error: qErr } = await supabase
          .from('quran_verses')
          .select('id, surah_no, ayah_no, ayah_text')
          .gte('id', lo)
          .lte('id', hi)
          .order('id', { ascending: true });
        if (qErr) throw qErr;
        if (netData) {
          data = netData as TestAyah[];
          void getQuranTextCache().putRows(netData);
        }
      }
      if (!data || data.length === 0) {
        setError('لم أجد آيات في هذا النطاق — جرّب نطاقًا آخر');
        setLoading(false);
        return;
      }
      setTextOfflineNotice(shouldShowOfflineNotice(servedFromCache, typeof navigator !== 'undefined' ? navigator.onLine : undefined));
      setFrom(startPt.ayah);
      setTo(endPt.ayah);
      setRangeStart(startPt);
      setRangeEnd(endPt);
      setAyahs(data as TestAyah[]);
      ayahsRef.current = data as TestAyah[];
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
        contAlignCacheRef.current = null;
        contExpectedNormsRef.current = null;
        contFixedNormsRef.current = new Set();
        contAwaitingRef.current = null;
        contDisplacedRef.current = [];
        contPromptedKeyRef.current = '';
        // NOTE: the persistent audio cache is deliberately NOT
        // cleared here — it survives resets by design (repeat
        // errors in later rounds must still hit). Only the
        // in-flight prefetch marker resets.
        contPrefetchPendingRef.current = null;
        // D2: a new range starts with a clean interrupt-silence
        // slate — no carried-over no-match state, audio-failure
        // note, retry marker, or match baseline.
        contNoMatchRef.current = false;
        setContNoMatch(false);
        setContAudioFailed(false);
        setAyahAudioFailed(false);
        contPromptRetryRef.current = '';
        silentRestartUsedRef.current = false;
        contLastMatchedCountRef.current = 0;
        contTokensAtLastMatchRef.current = 0;
        contLastMatchAtRef.current = 0;
        if (contNoMatchTimerRef.current) { clearTimeout(contNoMatchTimerRef.current); contNoMatchTimerRef.current = null; }
        if (contPromptTimerRef.current) { clearTimeout(contPromptTimerRef.current); contPromptTimerRef.current = null; }
        setContLastPrompt([]);
        setContPromptHasContext(false);
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
      setTextOfflineNotice(false);
      // Honest offline message: the range is not cached, so there is
      // nothing to fall back to. An online failure keeps the old
      // generic message.
      setError(isOffline()
        ? 'لا يوجد اتصال، وهذا النطاق غير محفوظ بعد — جرّب نطاقًا سبق أن فتحته، أو أعد المحاولة عند توفر الاتصال'
        : 'تعذر تحميل الآيات — تأكد من الاتصال بالإنترنت');
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
    setMicStalled(false);
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
      setAyahAudioFailed(false);
      ayahCorrFailedForRef.current = -1;
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
      // D2 (R5, window-expiry path): if the prefetched audio AND the
      // TTS fallback both fail, the failure note + the red words on
      // screen + the replay button are the correction — never
      // silence. The mic is already stopped (above), so this audio
      // cannot kill a live recognizer (321436 discipline).
      ayahCorrFailedForRef.current = index;
      setAyahAudioFailed(false);
      // RECORDER: first-class ayah-mode prompt event (never an
      // interrupt: ayah mode has no mid-flow to interrupt).
      recPushPrompt('ayah-mode', wrongWords, expected.map((_, i) => i).filter((i) => !result.matched[i]), index);
      playCorrection(wrongWords, pending && pending.index === index && pending.wordsKey === wrongWords.join('|') ? pending.url : null, () => {
        if (ayahCorrFailedForRef.current === index) setAyahAudioFailed(true);
      });
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
        if (allMatched && extras.length === 0) { diagPush('corr-window-self-corrected', { label: corrWindowSourceRef.current || 'unknown' }); gradeMic(true); }
      } else {
        const targets = liveRef.current.correctingTargets;
        if (targets.length > 0) {
          const { allMatched } = alignWords(targets, windowSpoken);
          if (allMatched) { diagPush('corr-window-self-corrected', { label: corrWindowSourceRef.current || 'unknown' }); gradeMic(true); }
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
      // Position mode (v12): wrong-word indices into this ayah's
      // expected list + the ayah's seeded id. Bare shape: ayah-mode
      // corrections never prepend a context word. Missing ayah ref
      // falls back to free text (never a crash).
      const wrongIdx = expected.map((_, i) => i).filter((i) => !result.matched[i]);
      const ayahId = liveRef.current.ayah?.id;
      const corrPos = ayahId ? { shape: 'bare' as const, positions: wrongIdx.map((w) => ({ id: ayahId, w })) } : undefined;
      void fetchCorrectionAudio(wrongOrig, token, corrPos).then((url) => {
        if (url && token === corrFetchTokenRef.current && corrPendingRef.current?.index === index) {
          corrPendingRef.current.url = url;
          setCorrectionAudioByAyah((prev) => ({ ...prev, [index]: url }));
        }
      });
      liveRef.current.windowStartLen = spoken.length;
      corrWindowSourceRef.current = 'finals';
      liveRef.current.micState = 'correcting';
      setMicState('correcting');
      const windowS = liveRef.current.corrDelay;
      setCountdown(windowS);
      if (windowTimerRef.current) clearInterval(windowTimerRef.current);
      let left = windowS;
      windowTimerRef.current = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          // S4: expiry evaluates any in-flight correction first
          // (see expireCorrectionWindow) instead of grading false
          // over speech from the window's tail.
          expireCorrectionWindow();
        } else {
          setCountdown(left);
        }
      }, 1000);
    }
  };

  // The "خلصت، قيّمها" button: unlike the timer paths (which must
  // stay silent), a tap with zero spoken words gets a hint instead
  // of silently doing nothing.
  // ---- Recognition robustness helpers (tasmii-100 stream 3) ----
  // The recitation target is Classical/Quranic Arabic, not the UI
  // language: the test locale is fixed here, independent of the
  // interface language (see P7). 'ar-SA' is the vendor's formal
  // Arabic model; 'ar-EG' biases toward Egyptian colloquial
  // phonology/lexicon, which is the wrong target for tajwid
  // recitation. The locale claim is UNVERIFIED against vendor
  // internals — see FINDINGS.md — so this stays one constant a
  // coordinator can flip after the on-device A/B check.
  // S4 DOCUMENTED INCONSISTENCY (deliberately NOT flipped here):
  // follow-the-imam still uses ar-EG via currentSpeechLocale()
  // (QuranMushafPage startFollowListening), while self-test pins
  // ar-SA here. The two features disagree until the V3 per-device
  // A/B counts decide one locale for both — flipping follow
  // silently would change prayer behaviour on unmeasured evidence.
  const TEST_SPEECH_LOCALE = 'ar-SA';
  // Restart budget (same shape as the follow-mode LIVE_RESTART_*
  // budget in QuranMushafPage.tsx): >5 silent restarts in 10s with
  // no result means the mic is dead — stop honestly instead of
  // looping forever. Any result resets the budget (speech = alive).
  const REC_RESTART_MAX = 5;
  const REC_RESTART_WINDOW_MS = 10000;
  const resetRecRestartBudget = () => { recRestartRef.current = { count: 0, windowStart: 0 }; };
  const noteRecResult = () => { recRestartRef.current = { count: 0, windowStart: 0 }; };
  const recRestartAllowed = (): boolean => {
    const now = Date.now();
    if (now - recRestartRef.current.windowStart > REC_RESTART_WINDOW_MS) {
      recRestartRef.current = { count: 0, windowStart: now };
    }
    recRestartRef.current.count += 1;
    return recRestartRef.current.count <= REC_RESTART_MAX;
  };
  const otherArabicLocale = (locale: string): string => (locale === 'ar-SA' ? 'ar-EG' : 'ar-SA');
  // [P5] Alternative-rescue, deliberately narrow so it cannot mask
  // a real mistake: for a FINAL result only, if the top hypothesis
  // does not match any contiguous run of expected words, but a
  // lower-ranked alternative — same token count, so no word is ever
  // inserted or deleted — matches a contiguous expected run
  // exactly (after the same normalization grading uses), use that
  // alternative's transcript instead. A word is credited only when
  // some engine hypothesis literally equals the expected word(s).
  // Confidence is NOT used: it is uncalibrated across vendors and
  // filtering on it would drop correct words (see FINDINGS.md).
  const pickFinalTranscript = (res: any, expectedNorms: string[]): string => {
    const first = res && res[0] ? res[0].transcript || '' : '';
    if (!res || typeof res.length !== 'number' || res.length < 2 || expectedNorms.length === 0) return first;
    const firstTokens = spokenTokens(first);
    if (firstTokens.length === 0) return first;
    const matchesRun = (tokens: string[]): boolean => {
      for (let st = 0; st + tokens.length <= expectedNorms.length; st++) {
        let ok = true;
        for (let t = 0; t < tokens.length; t++) {
          if (expectedNorms[st + t] !== tokens[t]) { ok = false; break; }
        }
        if (ok) return true;
      }
      return false;
    };
    if (matchesRun(firstTokens)) return first;
    for (let a = 1; a < res.length; a++) {
      const alt = res[a] ? res[a].transcript || '' : '';
      const altTokens = spokenTokens(alt);
      if (altTokens.length !== firstTokens.length) continue;
      if (matchesRun(altTokens)) return alt;
    }
    return first;
  };
  // The interim text still pending when a session ends. It is
  // merged into finals ONLY on onend (the words will never
  // finalize) or on an explicit "done" tap (the user asserts the
  // utterance is complete) — never while the session is alive, so
  // a revised interim can never double-count.
  const takePendingInterim = (): string => {
    const t = lastInterimRef.current;
    lastInterimRef.current = '';
    setInterim('');
    return t;
  };

  const evaluatePressed = () => {
    // [P8] Explicit "done" tap: fold the still-pending interim in
    // first, or words spoken without a trailing pause are lost
    // (finals only arrive after a silence gap).
    const pendingInterim = takePendingInterim();
    if (pendingInterim) {
      liveRef.current.finals = `${liveRef.current.finals} ${pendingInterim}`.trim();
      setTranscript(liveRef.current.finals);
    }
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

  // ---- S4 voice-safety helpers -------------------------------------
  // (a) No-result watchdog: 18s (inside the 15-20s brief) with no
  // result at all — not even an interim — after start / the last
  // result means the engine stalled while the UI still says
  // "listening…". The trip NEVER wipes finals: it stops the engine
  // and raises the stalled state, whose كمّل button resumes the
  // same transcript (see resumeMic). A result re-arms the timer, so
  // a slow-but-alive recitation is never interrupted.
  const NO_RESULT_WATCHDOG_MS = 18000;
  // Continuous-prompt audio budget: a mid-flow interrupt cannot be
  // prefetched, so its generate-voice fetch races this timeout —
  // Batch 2 (S2): the timeout no longer gates first sound (TTS
  // starts at once, S1) — it only bounds the window in which a
  // fetch win may pre-empt not-yet-sounded TTS, so 900ms is
  // enough; a slower fetch still lands in the cache for repeats.
  const CORR_AUDIO_TIMEOUT_MS = 900;
  // (b) Transient safety timer: ~3s. The patched code restarts from
  // onend after a transient error; if the engine omits onend, the
  // session used to hang on "retrying" forever. The timer restarts
  // directly, and only gives up (stalled state) on a non-trivial
  // start failure — InvalidStateError means "already running", i.e.
  // the engine is alive after all.
  const TRANSIENT_SAFETY_MS = 3000;
  const clearWatchdog = () => {
    if (watchdogTimerRef.current) { clearTimeout(watchdogTimerRef.current); watchdogTimerRef.current = null; }
  };
  const clearTransientSafety = () => {
    if (transientSafetyTimerRef.current) { clearTimeout(transientSafetyTimerRef.current); transientSafetyTimerRef.current = null; }
  };
  // Honest stop that preserves the transcript. Ayah mode: the finals
  // stay in liveRef (the stalled UI grades or resumes them); the
  // fresh-start button is still offered, so nothing is trapped.
  const tripAyahStalled = (message: string) => {
    stopRec();
    clearTimers();
    liveRef.current.micState = 'idle';
    setMicState('idle');
    setMicStalled(true);
    setMicError(message);
  };
  const tripContStalled = (message: string) => {
    stopContinuousMic();
    setContStalled(true);
    setMicError(message);
  };
  // D2 one silent restart (R2): a watchdog trip first tries ONE
  // fresh recognizer instance before banner-ing, because a 321436
  // death is exactly "alive session, zero events" and the verified
  // remedy is a new instance. Timer-fired rec.start() is already
  // this file's pattern (the transient safety timer restarts from
  // a timer), and a restart here preserves the transcript in both
  // modes (startContinuousMic never wipes contFinals; startMic(true)
  // preserves ayah finals). One attempt per stall episode only:
  // noteWatchdogResult clears the flag on the next good result, so
  // a still-dead engine trips the banner on the next fire instead
  // of looping — worst case the banner arrives one window later
  // (2 x 18s) than today. If the restart itself fails to start, the
  // banner shows at once (no silent delay). The ayah restart from
  // 'correcting' restarts as fresh 'listening' (the window is not
  // restored) — the same as today's banner + كمّل path, which also
  // restarts via startMic(true).
  const trySilentRestart = (): boolean => {
    if (silentRestartUsedRef.current) return false;
    silentRestartUsedRef.current = true;
    diagPush('restart', { label: 'silent' });
    if (liveRef.current.contListening) {
      // Preserve a pending fix expectation across the restart: the
      // token count it measures against is unchanged (finals are
      // preserved), so the expectation stays valid. Displaced
      // expectations are preserved the same way (stopContinuousMic
      // cancels the prompt, which clears both).
      const aw = contAwaitingRef.current;
      const displaced = contDisplacedRef.current;
      stopContinuousMic();
      startContinuousMic();
      if (aw) contAwaitingRef.current = aw;
      if (displaced.length > 0) contDisplacedRef.current = displaced;
      return liveRef.current.contListening;
    }
    const ms = liveRef.current.micState;
    if (ms !== 'listening' && ms !== 'correcting') return false;
    stopRec();
    liveRef.current.micState = 'idle';
    setMicState('idle');
    startMic(true);
    // Merge fix: TS narrows liveRef.current.micState to 'idle' after the
    // assignment above and cannot see through startMic(), which sets it
    // back to 'listening' synchronously (see the rec.start() site below).
    // Assert the declared union type so the comparison is allowed.
    return (liveRef.current.micState as MicState) === 'listening';
  };
  const onWatchdogFire = () => {
    watchdogTimerRef.current = null;
    // Still listening and truly silent for the whole window? Trip.
    // Anything else (stopped, graded, prompting, or a result that
    // landed since arming) is not a stall — re-arming is harmless
    // because every live result re-arms anyway.
    if (liveRef.current.contListening) {
      if (contPromptingRef.current) return;
      if (Date.now() - lastResultAtRef.current >= NO_RESULT_WATCHDOG_MS) {
        if (trySilentRestart()) return;
        tripContStalled('الاستماع وقف من غير نتيجة — اللي سمعته محفوظ، اضغط «كمّل التسميع المتصل» عشان تكمل');
      }
      return;
    }
    const ms = liveRef.current.micState;
    if (ms !== 'listening' && ms !== 'correcting') return;
    if (Date.now() - lastResultAtRef.current < NO_RESULT_WATCHDOG_MS) return;
    if (trySilentRestart()) return;
    tripAyahStalled('الاستماع وقف من غير نتيجة — اللي سمعته محفوظ، اضغط «كمّل» عشان تكمل من غير ما يضيع');
  };
  const armWatchdog = () => {
    clearWatchdog();
    watchdogTimerRef.current = setTimeout(onWatchdogFire, NO_RESULT_WATCHDOG_MS);
  };
  const noteWatchdogResult = () => {
    lastResultAtRef.current = Date.now();
    // A good result ends the stall episode: a later silence earns
    // its own single silent restart.
    silentRestartUsedRef.current = false;
    clearTransientSafety();
    armWatchdog();
  };
  // Arm the transient safety net for one recognizer. onend clears it
  // (the normal restart path); a result clears it too (engine alive).
  // Fires only if the session is still live and still that recognizer.
  const armTransientSafety = (rec: any, onDead: () => void) => {
    clearTransientSafety();
    transientSafetyTimerRef.current = setTimeout(() => {
      transientSafetyTimerRef.current = null;
      if (recRef.current !== rec || userStopRef.current) return;
      if (liveRef.current.contListening) {
        if (contPromptingRef.current) return;
        try { rec.start(); diagPush('rec-start', { label: 'transient-safety', ok: true }); } catch (err: any) {
          if (err && err.name === 'InvalidStateError') return;
          onDead();
        }
        return;
      }
      const ms = liveRef.current.micState;
      if (ms !== 'listening' && ms !== 'correcting') return;
      try { rec.start(); diagPush('rec-start', { label: 'transient-safety', ok: true }); } catch (err: any) {
        if (err && err.name === 'InvalidStateError') return;
        onDead();
      }
    }, TRANSIENT_SAFETY_MS);
  };
  // Window-expiry discipline: the old interval graded false at expiry
  // WITHOUT evaluating speech from the window's tail — a correction
  // spoken just before expiry (quiet timer still pending, or interim
  // never finalized) was silently lost. Expiry now folds the pending
  // interim in, evaluates, and only then grades false if the
  // correction still does not complete the targets.
  const expireCorrectionWindow = () => {
    if (windowTimerRef.current) { clearInterval(windowTimerRef.current); windowTimerRef.current = null; }
    if (liveRef.current.micState !== 'correcting') return;
    const pendingInterim = takePendingInterim();
    if (pendingInterim) {
      liveRef.current.finals = `${liveRef.current.finals} ${pendingInterim}`.trim();
      setTranscript(liveRef.current.finals);
    }
    evaluateNow();
    if (liveRef.current.micState !== 'correcting') return;
    // FALSE-ALARM HEAL (batch 1, TIGHTENED batch 3 on reviewer
    // verdicts — ChatGPT found the hole, Claude concurred): the
    // old code healed at beginner level with the FORGIVING
    // aligner (extras discarded), so a real error followed by
    // its correction (e.g. ملك then مالك) healed to a pass —
    // the wrong word was silently skipped. Healing now ALWAYS
    // uses the strict aligner (allMatched AND zero extras),
    // regardless of user level: every expected word must match
    // and every spoken word must be accounted for (the only
    // carve-out is the strict aligner's own opaque-numeral rule
    // for Safari ASR artifacts). This is deliberately stricter
    // than beginner grading: a false alarm (clean full
    // recitation) still heals, but a true error can never heal.
    // Conservative corner, stated honestly: a recitation that
    // contained a real error AND its correction, with no
    // in-window correction, now grades false where forgiving
    // beginner grading would have passed — the price of never
    // passing a true error. The user re-recites via the done
    // card. Finals here are this ayah's attempt only (startMic
    // resets them), so previous ayahs cannot leak in as extras.
    const healAyah = liveRef.current.ayah;
    if (healAyah) {
      const healExpected = expectedWordList(healAyah.ayah_text);
      const healSpoken = spokenTokens(liveRef.current.finals);
      const healResult = alignWordsStrict(healExpected.map((w) => w.norm), healSpoken);
      if (healResult.allMatched && healResult.extras.length === 0) {
        diagPush('correction-heal', { label: `${corrWindowSourceRef.current || 'unknown'}-healed` });
        gradeMic(true);
        return;
      }
      // Batch 3 follow-up (reviewer diagnostics): failure
      // category, not a user-facing message — so a heal-miss
      // caused purely by an extra word is never presented as
      // proof the user mispronounced a Quranic word.
      // allMatched + extras = failed_extra_word (includes the
      // "repair pattern": wrong word spoken, then the correct
      // word — logged separately below as a shadow metric only,
      // never a grade; it also includes benign extras like
      // isti'adha, so it bounds repair frequency from above).
      // !allMatched + no extras = failed_missing_word (omission).
      // !allMatched + extras = failed_substitution.
      // failed_alignment has no producer in current code paths:
      // every strict-aligner failure maps to one of the three
      // above, so it is reserved, not fabricated.
      const healCategory = healResult.allMatched
        ? 'failed_extra_word'
        : (healResult.extras.length === 0 ? 'failed_missing_word' : 'failed_substitution');
      if (healResult.allMatched && healResult.extras.length > 0) {
        diagPush('heal-repair-shadow', { label: corrWindowSourceRef.current || 'unknown', reason: 'extra-with-full-match' });
      }
      diagPush('correction-heal', { label: `${corrWindowSourceRef.current || 'unknown'}-missed`, reason: healCategory });
    }
    diagPush('corr-window-expired', { label: corrWindowSourceRef.current || 'unknown' });
    gradeMic(false);
  };
  // INTERIM EARLY WINDOW (2026-10-30, batch 1): twin of the
  // window-open block in evaluateNow's mismatch branch — keep in
  // sync. The ONLY difference: windowStartLen counts finals only,
  // so interim words that finalize after the window opens count
  // as window speech (exactly like expiry folding pendingInterim
  // into finals before judging). Grading itself stays finals-based:
  // this opens the window early, it never grades from interim.
  const openCorrectionWindowFromInterim = (expected: { norm: string; orig: string }[], result: { matched: boolean[] }) => {
    const ayah = liveRef.current.ayah;
    if (!ayah || liveRef.current.micState !== 'listening') return;
    interimMissRef.current = { key: '', count: 0, firstSeenAt: 0 };
    liveRef.current.correctingTargets = expected.filter((_, i) => !result.matched[i]).map((w) => w.norm);
    const wrongOrig = expected.filter((_, i) => !result.matched[i]).map((w) => w.orig);
    const token = ++corrFetchTokenRef.current;
    corrPendingRef.current = { index, wordsKey: wrongOrig.join('|'), url: null };
    const wrongIdx = expected.map((_, i) => i).filter((i) => !result.matched[i]);
    const ayahId = ayah.id;
    const corrPos = ayahId ? { shape: 'bare' as const, positions: wrongIdx.map((w) => ({ id: ayahId, w })) } : undefined;
    void fetchCorrectionAudio(wrongOrig, token, corrPos).then((url) => {
      if (url && token === corrFetchTokenRef.current && corrPendingRef.current?.index === index) {
        corrPendingRef.current.url = url;
        setCorrectionAudioByAyah((prev) => ({ ...prev, [index]: url }));
      }
    });
    liveRef.current.windowStartLen = spokenTokens(liveRef.current.finals).length;
    corrWindowSourceRef.current = 'interim';
    liveRef.current.micState = 'correcting';
    setMicState('correcting');
    const windowS = liveRef.current.corrDelay;
    setCountdown(windowS);
    if (windowTimerRef.current) clearInterval(windowTimerRef.current);
    let left = windowS;
    windowTimerRef.current = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        expireCorrectionWindow();
      } else {
        setCountdown(left);
      }
    }, 1000);
    recPushPrompt('interim-miss', wrongOrig, wrongIdx, index);
  };
  // INTERIM TRIGGER (batch 1, TIGHTENED batch 3 on reviewer
  // verdicts): ayah mode only, while listening. Fires only when
  // ALL hold: (a) first unmatched expected word m; (b) STRONG
  // downstream evidence — the next TWO expected words both
  // matched, or one later matched word of 4+ letters (a single
  // short common word — من، في، لا — is too weak to prove the
  // user moved past); (c) something spoken at/after m;
  // (d) the same m AND the same normalized spoken candidate at
  // position m across 2 consecutive interim events (an
  // index-only match let a revising recognizer — ملك→مالك —
  // fire a window for an error that vanished); (e) at least
  // 600ms since the first sighting of this miss (event rates
  // differ by platform; Safari interim is sparse, so this
  // mainly slows over-eager Chrome triggers); (f) interim-
  // inclusive spoken length below expected length. The window
  // still judges finals at expiry, and the strict heal above
  // protects the grade.
  const maybeInterimCorrectionWindow = (interimText: string) => {
    try {
      const ayah = liveRef.current.ayah;
      if (!ayah || liveRef.current.micState !== 'listening' || liveRef.current.mode !== 'ayah') return;
      const expected = expectedWordList(ayah.ayah_text);
      const spokenAll = spokenTokens(`${liveRef.current.finals} ${interimText}`.trim());
      if (spokenAll.length >= expected.length) return;
      const strict = liveRef.current.level !== 'beginner';
      const result = strict
        ? alignWordsStrict(expected.map((w) => w.norm), spokenAll)
        : { ...alignWords(expected.map((w) => w.norm), spokenAll), extras: [] as string[] };
      const resetMiss = () => { interimMissRef.current = { key: '', count: 0, firstSeenAt: 0 }; };
      if (result.allMatched) { resetMiss(); return; }
      const m = result.matched.findIndex((v) => !v);
      if (m < 0 || spokenAll.length <= m) { resetMiss(); return; }
      // Strong downstream evidence (see comment above).
      const later = result.matched.slice(m + 1);
      const laterNorms = expected.slice(m + 1).map((w) => w.norm);
      const twoAnchored = later.length >= 2 && later[0] && later[1];
      const longLater = later.some((v, i) => v && laterNorms[i].length >= 4);
      if (!twoAnchored && !longLater) { resetMiss(); return; }
      // Candidate stability: the spoken token at position m must
      // be the same normalized word across events, not just the
      // same unmatched index.
      const candidate = spokenAll[m];
      const key = `${index}:${m}:${candidate}`;
      const prev = interimMissRef.current;
      const now = Date.now();
      const count = prev.key === key ? prev.count + 1 : 1;
      const firstSeenAt = prev.key === key && prev.firstSeenAt > 0 ? prev.firstSeenAt : now;
      interimMissRef.current = { key, count, firstSeenAt };
      if (count >= 2 && now - firstSeenAt >= 600) {
        openCorrectionWindowFromInterim(expected, result);
      }
    } catch {
      // never let an interim heuristic break listening
    }
  };
  // "Show me the mistake" with the same fold: the user's last words
  // belong in the transcript even when he ends the window himself.
  const showMistakeNow = () => {
    const pendingInterim = takePendingInterim();
    if (pendingInterim) {
      liveRef.current.finals = `${liveRef.current.finals} ${pendingInterim}`.trim();
      setTranscript(liveRef.current.finals);
    }
    gradeMic(false);
  };
  // Grade exactly what was heard in a stalled session (no correction
  // window — the mic is already stopped; gradeMic still speaks the
  // correction aloud for a wrong grade).
  const evaluateStalled = () => {
    const ayah = liveRef.current.ayah;
    if (!ayah) return;
    const expected = expectedWordList(ayah.ayah_text);
    const spoken = spokenTokens(liveRef.current.finals);
    if (spoken.length === 0) return;
    const strict = liveRef.current.level !== 'beginner';
    const result = strict
      ? alignWordsStrict(expected.map((w) => w.norm), spoken)
      : { ...alignWords(expected.map((w) => w.norm), spoken), extras: [] as string[] };
    if (result.allMatched && result.extras.length === 0) gradeMic(true);
    else gradeMic(false);
  };

  // Batch 3 follow-up (reviewer note): iOS getVoices() often
  // returns [] on first call — warm the list AND listen once
  // for voiceschanged, so the warm-up is not a no-op. No
  // spoken utterance (see Batch 3: audible-fragment caution).
  // Plain function (no useCallback deps): call-time resolution
  // makes declaration order irrelevant to its callers.
  const warmTtsVoices = () => {
    try {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.getVoices();
      const once = () => { try { window.speechSynthesis.getVoices(); } catch {} };
      try { window.speechSynthesis.addEventListener('voiceschanged', once, { once: true }); } catch {}
    } catch {}
  };
  const startMic = (preserveArg?: boolean) => {
    // Batch 1: a new listening session resets interim-miss
    // stability — a stale count from a previous attempt on the
    // same ayah must never fire on the first interim event.
    interimMissRef.current = { key: '', count: 0, firstSeenAt: 0 };
    // DIAG: startMic is only reached from mic/كمّل taps (silent
    // restarts route through trySilentRestart, which logs its own
    // 'restart' event first — so a 'resume-mic' here after a
    // 'restart' is the silent restart, not a tap).
    diagPush('tap', { label: preserveArg === true ? 'resume-mic' : 'start-mic' });
    // S4: resume (كمّل) passes exactly true; a tap handler's event
    // object must never count as "preserve" — hence === true.
    const preserveFinals = preserveArg === true;
    const ayah = liveRef.current.ayah;
    if (!ayah) return;
    // Warm the audio context inside this tap so the later grading
    // sounds (timer-triggered) are allowed to play. Also warm the
    // TTS voice list so a later timer-triggered correction can pick
    // a real Arabic voice instead of device luck.
    getAudioCtx();
    warmTtsVoices();
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setMicError(micAbsentMessage(' — قيّم يدوي بدل كده'));
      return;
    }
    if (liveRef.current.micState === 'listening' || liveRef.current.micState === 'correcting') return;
    // A manual (re)start opens a new stall episode (see the
    // continuous twin in startContinuousMic).
    silentRestartUsedRef.current = false;
    setMicError('');
    setMicStalled(false);
    // S4: a fresh start wipes the ayah transcript (old behaviour);
    // a كمّل resume keeps it — that is the whole point of the
    // stalled state (budget trips used to wipe on re-tap).
    if (!preserveFinals) {
      liveRef.current.finals = '';
      setTranscript('');
    } else {
      setTranscript(liveRef.current.finals);
    }
    liveRef.current.correctingTargets = [];
    liveRef.current.windowStartLen = 0;
    setInterim('');
    setWrongIndices([]);
    userStopRef.current = false;
    lastInterimRef.current = '';
    const rec = new SR();
    // [P7] Fixed test locale (see helpers): Quranic recitation,
    // not the UI language, decides the model.
    rec.lang = TEST_SPEECH_LOCALE;
    rec.continuous = true;
    rec.interimResults = true;
    // [P5] Ask for N-best hypotheses; vendors that do not honour
    // this simply return one alternative and pickFinalTranscript
    // degrades to the top hypothesis. Guarded: never throw here.
    try { rec.maxAlternatives = 3; } catch {}
    // DIAG: record-only lifecycle handlers (assigning them changes
    // no recognition behaviour; they only append to the event log).
    rec.onstart = () => { if (recRef.current !== rec) return; diagPush('onstart'); };
    rec.onaudiostart = () => { if (recRef.current !== rec) return; diagPush('onaudiostart'); };
    rec.onspeechstart = () => { if (recRef.current !== rec) return; diagPush('onspeechstart'); };
    rec.onresult = (e: any) => {
      // [P4] Stale-recognizer guard: a late final from a previous
      // session (e.g. after stop() + ayah change) must never land
      // in the new ayah's transcript.
      if (recRef.current !== rec) return;
      noteRecResult();
      // S4: any result — final or interim — proves the engine alive
      // and re-arms the no-result watchdog.
      noteWatchdogResult();
      // A transient network note clears on the next good result.
      setMicError('');
      let interimText = '';
      let sawFinal = false;
      const expectedNorms = expectedWordList(liveRef.current.ayah?.ayah_text || '').map((w) => w.norm);
      for (let i = e.resultIndex; i < e.results.length; i++) {
        // isFinal lives on the RESULT, not its first alternative —
        // reading it off the alternative made every final look
        // interim, so mic grading could never fire (same bug as
        // follow-the-imam). Check both for quirk engines.
        const res = e.results[i];
        const r = res[0];
        if (!r) continue;
        if (res.isFinal || r.isFinal) {
          sawFinal = true;
          // [P5] Narrow alternative-rescue (see helpers).
          const chosen = pickFinalTranscript(res, expectedNorms);
          diagPush('result', { final: true, text: chosen });
          diagFinalsRef.current.push(chosen);
          // RECORDER: ayah-mode finals per ayah (continuous finals
          // already accumulate in diagFinalsRef). Keyed by the live
          // ayah, so the case transcript attributes finals exactly.
          if (recordingRef.current && diagRangeRef.current?.mode === 'ayah') {
            const ay = liveRef.current.ayah;
            if (ay) {
              const key = `${ay.surah_no}:${ay.ayah_no}`;
              const arr = recAyahFinalsRef.current[key] || [];
              arr.push(chosen);
              recAyahFinalsRef.current[key] = arr;
            }
          }
          liveRef.current.finals = `${liveRef.current.finals} ${chosen}`.trim();
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
      // [P2] Interim bookkeeping: a fresh interim replaces the old
      // one; a final-only event clears it (that interim just
      // finalized — leaving it displayed would double-show it
      // next to the finals). An event with neither leaves the
      // still-pending interim untouched (the engine only reports
      // changed results from resultIndex onward).
      if (interimText.trim()) {
        lastInterimRef.current = interimText.trim();
        setInterim(interimText.trim());
        diagPush('result', { final: false, text: interimText.trim() });
        // Batch 1: fluent-substitution fast path — a stable interim
        // miss with downstream matches opens the correction window
        // now instead of waiting for finals (grading stays
        // finals-based; see maybeInterimCorrectionWindow).
        maybeInterimCorrectionWindow(interimText.trim());
      } else if (sawFinal) {
        lastInterimRef.current = '';
        setInterim('');
      }
    };
    rec.onerror = (e: any) => {
      // [P3] Error taxonomy — transient errors must NOT stop the
      // session. 'no-speech' (silence) and 'aborted' end a session
      // that onend restarts; 'network' likewise retries itself.
      // Stopping on them (the old behaviour) dead-ended the test
      // and forced a re-tap that wiped the ayah's finals.
      // The spec guarantees an end event whenever a session ends,
      // so the onend restart below is the retry path — and the S4
      // 3s safety timer below is the backstop when onend never
      // comes (the old code hung on "retrying" forever then).
      if (recRef.current !== rec) return;
      const code = e && e.error;
      diagPush('error', { code: String(code || 'unknown') });
      const stallMessage = 'الاستماع وقف — اللي سمعته محفوظ، اضغط «كمّل» عشان تكمل من غير ما يضيع';
      if (code === 'no-speech' || code === 'aborted') {
        armTransientSafety(rec, () => tripAyahStalled(stallMessage));
        return;
      }
      if (code === 'network') {
        setMicError('الاستماع المباشر محتاج إنترنت — بيحاول تاني لوحده');
        armTransientSafety(rec, () => tripAyahStalled(stallMessage));
        return;
      }
      if (code === 'language-not-supported' && !(rec as any).__triedLocaleFallback) {
        (rec as any).__triedLocaleFallback = true;
        try { rec.lang = otherArabicLocale(rec.lang); rec.start(); diagPush('rec-start', { label: 'locale-fallback', ok: true }); return; } catch { diagPush('rec-start', { label: 'locale-fallback', ok: false }); }
      }
      if (code === 'not-allowed') {
        setMicError('الميكروفون مقفول — اسمح بيه من إعدادات المتصفح، أو قيّم يدوي بدل كده');
      } else if (code === 'audio-capture') {
        setMicError('الميكروفون مشغول بتطبيق تاني أو مش موجود — اقفله ثم اضغط الميكروفون تاني');
      } else if (code === 'service-not-allowed') {
        setMicError('المتصفح منع خدمة الاستماع المباشر على الجهاز ده — جرّب متصفح تاني أو قيّم يدوي بدل كده');
      } else if (code === 'language-not-supported') {
        setMicError('الاستماع المباشر مش بيدعم العربية على الجهاز ده — قيّم يدوي بدل كده');
      } else {
        setMicError('تعذر الاستماع — جرّب تاني أو قيّم يدوي بدل كده');
      }
      stopRec();
      clearTimers();
      liveRef.current.micState = 'idle';
      setMicState('idle');
    };
    rec.onend = () => {
      // [P1/P4] Browsers pause recognition after silence; resume
      // while the user is still mid-ayah, unless they stopped or
      // were graded. The identity check blocks a stale session
      // from restarting after a newer one began (or after stop).
      // S4: a normal onend cancels the transient safety timer —
      // this IS the restart path the timer backstops.
      clearTransientSafety();
      if (recRef.current !== rec || userStopRef.current) return;
      if (liveRef.current.micState !== 'listening' && liveRef.current.micState !== 'correcting') return;
      diagPush('onend');
      // [P1] Rescue the orphaned interim: it will never finalize
      // now, and dropping it loses the last spoken words.
      const orphan = takePendingInterim();
      if (orphan) {
        liveRef.current.finals = `${liveRef.current.finals} ${orphan}`.trim();
        setTranscript(liveRef.current.finals);
        const expectedLen = expectedWordList(liveRef.current.ayah?.ayah_text || '').length;
        if (spokenTokens(liveRef.current.finals).length >= expectedLen) evaluateNow();
        // Grading stopped the session; do not restart into it.
        if (recRef.current !== rec || userStopRef.current) return;
        if (liveRef.current.micState !== 'listening' && liveRef.current.micState !== 'correcting') return;
      }
      // [P4] Budgeted restart: a dead mic used to loop forever.
      // S4: tripping the budget now preserves the transcript and
      // offers كمّل — the old code went idle and the next tap
      // wiped the ayah's finals.
      if (!recRestartAllowed()) {
        tripAyahStalled('الاستماع وقف — اللي سمعته محفوظ، اضغط «كمّل» عشان تكمل من غير ما يضيع');
        return;
      }
      try {
        rec.start();
        diagPush('rec-start', { label: 'onend-restart', ok: true });
      } catch (err: any) {
        // Already running (double onend): not an error, stay live.
        if (err && err.name === 'InvalidStateError') return;
        tripAyahStalled('الاستماع وقف — اللي سمعته محفوظ، اضغط «كمّل» عشان تكمل من غير ما يضيع');
      }
    };
    recRef.current = rec;
    resetRecRestartBudget();
    try {
      rec.start();
      diagPush('rec-start', { label: 'start-mic', ok: true });
    } catch (err: any) {
      diagPush('rec-start', { label: 'start-mic', ok: false, code: err?.name || 'error' });
      setMicError('تعذر بدء الاستماع — جرّب تاني أو قيّم يدوي بدل كده');
      recRef.current = null;
      return;
    }
    liveRef.current.micState = 'listening';
    setMicState('listening');
    // S4: the watchdog clock starts at session start, not at the
    // first result — a session that never yields anything must
    // still trip honestly instead of showing "listening…" forever.
    lastResultAtRef.current = Date.now();
    armWatchdog();
  };

  // S4: resume a stalled ayah session without wiping its transcript.
  const resumeMic = () => startMic(true);

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
  // The single raw alignment shared by updateContProgress,
  // contOwedWords (interrupt + stall) and gradeContinuousNow within
  // one transcript state. Callers that run back-to-back on unchanged
  // finals (the normal case: update, then interrupt check, then
  // stall re-arm, all inside one onresult) now hit the cache instead
  // of re-tokenizing + re-aligning. Incremental tokenization: finals
  // only ever grows by appending " " + a final transcript, and
  // tokenization is local to each whitespace-delimited word
  // (normalizeArabic's replacements never span a space — the only
  // cross-word rule is a lookahead that treats a following space and
  // end-of-string identically), so the old tokens are a prefix of the
  // new tokens. Any shape that is not a clean append falls back to
  // a full tokenize, and any cache-key change falls back to a full
  // alignment — so the raw result is always exactly the baseline's.
  const contRawAlignment = (): { matched: boolean[]; extras: string[]; positions: number[]; consumed: number[]; spoken: string[] } => {
    const expected = liveRef.current.contExpected;
    const finals = liveRef.current.contFinals;
    const strict = liveRef.current.contStrict;
    const cached = contAlignCacheRef.current;
    if (cached && cached.expected === expected && cached.finals === finals && cached.strict === strict) {
      return cached;
    }
    let spoken: string[];
    if (
      cached && cached.expected === expected &&
      finals.length > cached.finals.length &&
      finals.startsWith(cached.finals) &&
      (cached.finals === '' || finals[cached.finals.length] === ' ')
    ) {
      spoken = cached.spoken.concat(spokenTokens(finals.slice(cached.finals.length)));
    } else {
      spoken = spokenTokens(finals);
    }
    let normsEntry = contExpectedNormsRef.current;
    if (!normsEntry || normsEntry.expected !== expected) {
      normsEntry = { expected, norms: expected.map((w) => w.norm) };
      contExpectedNormsRef.current = normsEntry;
    }
    const result = strict
      ? alignWordsStrict(normsEntry.norms, spoken)
      : { ...alignWords(normsEntry.norms, spoken), extras: [] as string[] };
    const entry = { expected, finals, strict, spoken, matched: result.matched, extras: result.extras, positions: result.positions, consumed: result.consumed };
    contAlignCacheRef.current = entry;
    return entry;
  };
  // Q7b (Claude-2, ASSESSED — documented, not changed): this function
  // MUTATES contCreditedRef while being called as a read function
  // (it adds every raw-matched index to the credited set). That is
  // provably safe, not a corruption path, for three reasons: (1) the
  // add is idempotent (a Set — re-adding an index is a no-op), so
  // repeated read calls cannot inflate anything; (2) it only ever
  // adds RAW-MATCHED indices, never unmatched ones, so the credited
  // set can never keep a word matched that the aligner did not match;
  // (3) every consumer uses raw || credited, so adding raw matches
  // to the set changes no consumer's result — the overshoot input
  // (below) and the progress count read the same effective matched
  // either way. The fragility Claude names is real but latent: a
  // future reader must NOT treat contCreditedRef as "fix-only" — it
  // is the UNION of raw-matched-ever and fix-credited (checkContFix's
  // settle adds the fix credits; startTestGlobal resets it). If the
  // aligner ever becomes non-monotonic under transcript append
  // (finals only grow today, so raw matched is append-stable), this
  // merge must be re-examined. No separation of read/mutation is
  // made: the merge is load-bearing for the overshoot wrapper, which
  // relies on this side effect to keep credited current.
  const contEffectiveMatched = (): { matched: boolean[]; lastMatchedIdx: number; positions: number[]; consumed: number[] } => {
    const raw = contRawAlignment();
    const matched = raw.matched.map((m, i) => m || contCreditedRef.current.has(i));
    raw.matched.forEach((m, i) => { if (m) contCreditedRef.current.add(i); });
    let lastMatchedIdx = -1;
    matched.forEach((m, i) => { if (m) lastMatchedIdx = i; });
    return { matched, lastMatchedIdx, positions: raw.positions, consumed: raw.consumed };
  };
  // Live (interim-aware) alignment for the continuous pointer and
  // watchdog ONLY. Safari delivers interim without finals during
  // fluent recitation (finals starvation, proven by the 2026-10-30
  // diag: 17 interim results, finals []), which used to freeze
  // the pointer at ayah 1 and trip the no-match watchdog even
  // though the recognizer heard everything. Interim revises, so
  // live matches NEVER enter contCreditedRef and NEVER touch
  // grading or correction triggers — those stay finals-based.
  const contLiveProgress = (): { count: number; ayahIdx: number; tokens: number } => {
    const expected = liveRef.current.contExpected;
    const finals = liveRef.current.contFinals;
    const interim = lastInterimRef.current.trim();
    const spokenText = interim ? `${finals} ${interim}`.trim() : finals;
    const spoken = spokenTokens(spokenText);
    let normsEntry = contExpectedNormsRef.current;
    if (!normsEntry || normsEntry.expected !== expected) {
      normsEntry = { expected, norms: expected.map((w) => w.norm) };
      contExpectedNormsRef.current = normsEntry;
    }
    const result = liveRef.current.contStrict
      ? alignWordsStrict(normsEntry.norms, spoken)
      : alignWords(normsEntry.norms, spoken);
    let count = 0;
    let lastIdx = -1;
    result.matched.forEach((m, i) => { if (m) { count++; lastIdx = i; } });
    const ayahIdx = lastIdx >= 0 ? expected[lastIdx].ayahIdx : 0;
    return { count, ayahIdx, tokens: spoken.length };
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
    if (contNoMatchTimerRef.current) { clearTimeout(contNoMatchTimerRef.current); contNoMatchTimerRef.current = null; }
    stopRec();
    liveRef.current.contListening = false;
    setContListening(false);
    // Stopping clears the no-match banner (enterContNoMatch sets it
    // again AFTER calling this, so the order there is load-bearing).
    contNoMatchRef.current = false;
    setContNoMatch(false);
  };

  // ---- Continuous no-match watchdog (D2) -------------------------
  // WHY THIS EXISTS — the design truth behind the 0/286 run: a
  // mid-flow interrupt requires a passed-over miss CONFIRMED by a
  // later matched word (contOwedWords only reports isMiss when a
  // word before lastMatchedIdx is unmatched). If NOTHING matches,
  // lastMatchedIdx stays -1, owed is always the "next word"
  // (isMiss=false), and checkContMissInterrupt returns early on
  // every final — by construction, forever. Meanwhile the stall
  // prompt cannot fire either, because every result (final or
  // interim) re-arms its timer, so a flowing but wholly unmatched
  // recitation never counts as "silence". The run therefore ends
  // with every ayah failed and not one interruption: silence was
  // the designed outcome of the no-match case, not a glitch in it.
  // THE FIX: a second watchdog on MATCH PROGRESS, not on results.
  // It trips when the user has audibly recited for a bounded
  // stretch with zero newly matched words, and enters an HONEST
  // paused state (banner + attention sound + best-effort TTS) that
  // stops grading from silently accumulating failures. Finals are
  // never wiped (stopContinuousMic preserves contFinals; resume
  // via startContinuousMic never wipes them either), and the
  // banner's كمّل button resumes from the same transcript.
  // THE BOUNDS ARE BORROWED, NOT INVENTED:
  // - 20 spoken tokens: checkContFix already treats 20 fresh tokens
  //   as "the teacher does not wait forever" (the fix-expectation
  //   window). 20 unmatched tokens in a row is the same bound
  //   applied to matching: fluent recitation reaches it in seconds.
  // - 18s (NO_RESULT_WATCHDOG_MS): the app's existing "engine
  //   stalled" bound, applied here to "engine alive, nothing
  //   matching" — checked on a wall-clock timer, because a slow
  //   reciter may take longer than 18s to speak 20 tokens. The
  //   timer also fires on a stuck non-empty interim (words the
  //   engine shows but never finalizes), which finals-counting
  //   alone would miss.
  // Neither bound changes matching, grading, credit, or the stall
  // threshold: this state only ever PAUSES listening; it never
  // credits, un-credits, or grades a word.
  const CONT_NO_MATCH_TOKENS = 20;
  const clearContNoMatchTimer = () => {
    if (contNoMatchTimerRef.current) { clearTimeout(contNoMatchTimerRef.current); contNoMatchTimerRef.current = null; }
  };
  const clearContPromptTimer = () => {
    if (contPromptTimerRef.current) { clearTimeout(contPromptTimerRef.current); contPromptTimerRef.current = null; }
  };
  const armContNoMatchTimer = () => {
    clearContNoMatchTimer();
    contNoMatchTimerRef.current = setTimeout(() => {
      contNoMatchTimerRef.current = null;
      if (!liveRef.current.contListening || contPromptingRef.current || contNoMatchRef.current) return;
      if (Date.now() - contLastMatchAtRef.current < NO_RESULT_WATCHDOG_MS) { armContNoMatchTimer(); return; }
      const tokens = spokenTokens(liveRef.current.contFinals).length;
      if (tokens > contTokensAtLastMatchRef.current || lastInterimRef.current.trim() !== '') {
        enterContNoMatch();
      } else {
        // True silence with no new speech: the no-result watchdog
        // owns that case. Re-arm so a later stuck interim still
        // trips this watchdog instead of hanging silently.
        armContNoMatchTimer();
      }
    }, NO_RESULT_WATCHDOG_MS);
  };
  const resetContNoMatchBaseline = () => {
    // Baseline = "what matching looked like at the last progress
    // point". At a fresh mic start finals are empty (count 0); at a
    // resume after a prompt or a no-match pause, finals are
    // preserved, so the budget restarts from the CURRENT matched
    // count — never from zero (which would instantly re-trip).
    const { matched } = contEffectiveMatched();
    let count = 0;
    matched.forEach((m) => { if (m) count++; });
    contLastMatchedCountRef.current = count;
    contLastMatchAtRef.current = Date.now();
    contTokensAtLastMatchRef.current = spokenTokens(liveRef.current.contFinals).length;
    armContNoMatchTimer();
  };
  const enterContNoMatch = () => {
    if (contNoMatchRef.current) return;
    clearContNoMatchTimer();
    // Order: stop first (which clears the flag), then set it.
    stopContinuousMic();
    contNoMatchRef.current = true;
    setContNoMatch(true);
    // Audible attention via the gesture-warmed WebAudio path (the
    // buzzer needs no gesture at play time once the context was
    // resumed by the mic tap); TTS for the message is best-effort.
    // The banner below is the guarantee — it shows whether or not
    // either sound is allowed to play.
    playWrongBuzzer();
    try {
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance('مش سامعك كويس — وقّفت التسميع مؤقتًا، واللي سمعته محفوظ');
        u.lang = 'ar-SA';
        const v = pickArabicTtsVoice();
        if (v) u.voice = v;
        u.onstart = () => { diagPush('tts-start', { label: 'nomatch-banner' }); };
        u.onend = () => { diagPush('tts-end', { label: 'nomatch-banner' }); };
        window.speechSynthesis.speak(u);
      }
    } catch {}
  };
  // Called after every continuous final (and every rescued orphan)
  // with the CURRENT matched count. A rise re-baselines; a flat
  // count with 20+ fresh unmatched tokens trips immediately (the
  // fast path for fluent wrong recitation — no 18s wait).
  const noteContMatchProgress = (matchedCount: number) => {
    if (!liveRef.current.contListening || contNoMatchRef.current) return;
    if (matchedCount > contLastMatchedCountRef.current) {
      contLastMatchedCountRef.current = matchedCount;
      contLastMatchAtRef.current = Date.now();
      contTokensAtLastMatchRef.current = spokenTokens(liveRef.current.contFinals).length;
      armContNoMatchTimer();
      return;
    }
    if (spokenTokens(liveRef.current.contFinals).length - contTokensAtLastMatchRef.current >= CONT_NO_MATCH_TOKENS) {
      enterContNoMatch();
    }
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
  // ---- E2: overshoot confirmation for a passed-over next word ----
  // WHY THIS EXISTS — the 23:38 device test (2:1–2:3, stamp 793ecff):
  // the planted substitution هدى للمؤمنين for للمتقين never
  // interrupted, although 5–6 words had matched. The old rule only
  // confirms a miss when a LATER word matches (contOwedWords reports
  // isMiss only for words before lastMatchedIdx). Here the next word
  // للمتقين sits AFTER the last match (هدى), and everything after it
  // — the whole of 2:3 plus out-of-range Ayat al-Kursi words — matched
  // nothing, so no confirming token ever came, and the word stayed
  // "not yet said" (the stall prompt's job) forever. Worse, the stall
  // prompt could not reach it either: contOwedWords anchors at the
  // EARLIEST miss before lastMatched (الم, unmatched because ASR
  // heard only لام ميم), so every stall prompt names الم, never
  // للمتقين, until الم is said or credited.
  // THE PRINCIPLED SIGNAL — overshoot (pigeonhole, not a guess):
  // take the next expected word after the last match, and count the
  // words left in ITS ayah from it onward (remaining). Then look at
  // the spoken tokens strictly after the last matched word's spoken
  // position, and count DISTINCT tokens that are not repeats of an
  // already-matched word. If that count STRICTLY EXCEEDS remaining,
  // the speaker cannot still be inside that ayah: a continuation
  // inside the ayah can contribute at most `remaining` new words
  // before it must either say the owed word (which would match) or
  // leave the ayah. So he has demonstrably moved past the owed word.
  // WHY IT CANNOT FALSE-FIRE on the cases that matter:
  // - Silence / pauses: no new tokens arrive, so the count is 0 and
  //   the check only runs on new finals anyway (never on a timer) —
  //   silence yields a stall prompt, never an interrupt.
  // - A word he is about to say: before he says it, fresh tokens are
  //   silence or repeats (excluded), so the count stays <= remaining.
  // - A single slip followed by a self-correction: the slip is ONE
  //   distinct new token, and remaining >= 1 (the owed word itself
  //   counts), so 1 > remaining is false — the correction itself
  //   matches and no interrupt ever fires. An interrupt needs at
  //   least remaining+1 distinct new words, i.e. strictly more new
  //   words than the ayah has left.
  // - Slow recitation with repeats: repeats of matched words are
  //   excluded from the count, so stumbling on earlier words cannot
  //   accumulate toward confirmation.
  // - Basmalah / isti'adha before the test starts: gated on
  //   lastMatchedIdx >= 0 — with zero matches the no-match watchdog
  //   owns the case, not this check.
  // - Correct recitation: every new word matches and advances
  //   lastMatched, resetting the window; the count never grows.
  // WHAT IT DOES NOT DO: it never credits, un-credits, or grades a
  // word. It only prompts (the same speakContPrompt as every other
  // correction); the word stays missed until the user actually says
  // it after the prompt (checkContFix credit, unchanged).
  // R1 (Claude-2): the overshoot decision lives in src/lib/overshoot.ts
  // (pure function overshootOwed) — this wrapper only feeds it the
  // live alignment state. Call order is preserved exactly:
  // contRawAlignment() first, then contEffectiveMatched() (kept for
  // its side effect of recording raw matches into contCreditedRef),
  // then the pure decision. The wrapper adds no counting of its own;
  // the runners import the same overshootOwed, so a future counting
  // bug cannot hide in a mirror again.
  const contOvershootOwed = (): { words: string[]; indices: number[]; norms: string[] } | null => {
    const expected = liveRef.current.contExpected;
    if (expected.length === 0) return null;
    const raw = contRawAlignment();
    // Kept for its credit-recording side effect (see above); its
    // return value is intentionally unused — the pure function
    // derives effective matched from raw + credited itself.
    contEffectiveMatched();
    return overshootOwed({
      expected,
      spoken: raw.spoken,
      rawMatched: raw.matched,
      rawPositions: raw.positions,
      rawConsumed: raw.consumed,
      credited: contCreditedRef.current,
      prompting: contPromptingRef.current,
    });
  };
  const cancelContPrompt = () => {
    // Iteration 2: cancel is a generation bump — in-flight race
    // branches (fetch-win and timeout-win) check the gen and stay
    // silent, and the settled flag locks the finish path.
    speakGenRef.current++;
    promptSettledRef.current = true;
    if (contStallTimerRef.current) { clearTimeout(contStallTimerRef.current); contStallTimerRef.current = null; }
    // D2: the prompt-completion watchdog MUST die with the prompt —
    // otherwise a late fire would cancel a NEW prompt's speech (its
    // resume path cancels speech before checking the flag).
    clearContPromptTimer();
    // Batch 3 (Claude hole 4): same disarm as resumeAfterPrompt.
    try {
      const a = contPromptAudioRef.current;
      if (a) { a.onended = null; a.onerror = null; a.onplaying = null; a.onstalled = null; }
    } catch {}
    try { contPromptAudioRef.current?.pause(); } catch {}
    contPromptAudioRef.current = null;
    cancelCorrectionSpeech();
    contPromptingRef.current = false;
    setContPrompting(false);
    contAwaitingRef.current = null;
    contDisplacedRef.current = [];
  };
  // D2: a prompt whose audio failed unheard must not silently
  // dedupe-block the same words forever. One auto-retry is armed
  // (the prompted key is cleared, so the next stall/interrupt may
  // prompt again); if the retry ALSO fails, the dedupe holds and
  // only the visible replay remains — no nagging loop. The visible
  // failure note is set in both cases: the words on screen are the
  // correction even when no sound ever plays.
  const noteContPromptAudioFailed = (key: string) => {
    setContAudioFailed(true);
    if (contPromptRetryRef.current !== key) {
      contPromptRetryRef.current = key;
      if (contPromptedKeyRef.current === key) contPromptedKeyRef.current = '';
    }
  };
  const speakContPrompt = (words: string[], fixIdx?: number[], fixNorms?: string[], trigger?: 'stall' | 'confirmed-miss' | 'overshoot') => {
    if (words.length === 0 || contPromptingRef.current) return;
    // Iteration 2: generation token + settled flag + prompt-entry
    // timestamp (detection proxy for the diag voice-start timing).
    const gen = ++speakGenRef.current;
    promptSettledRef.current = false;
    const promptStartedAt = Date.now();
    // RECORDER: first-class prompt event (interrupt too when the
    // trigger is a mid-flow interrupt). Replays pass no trigger
    // and record nothing: a replay is not a new prompt.
    if (trigger) recPushPrompt(trigger, words, fixIdx ?? []);
    // N1 (Claude reply 6, item 6): the dedupe key is built from
    // INDICES, not words — repeated words at different positions
    // (e.g. ذلك twice) used to share one key and wrongly suppress
    // the second-position prompt. Every fix call site passes its
    // indices; only the replay button passes none, and it replays
    // the live awaiting entry's words, so the key falls back to
    // that entry's indices (words only if no expectation is live).
    // Parent amendment: without the awaiting fallback, a replay
    // would flip the stored key to words and a later stall for the
    // same position could re-prompt (duplicate prompt only —
    // grading unaffected, since the key gates prompting alone).
    const key = fixIdx && fixIdx.length > 0 ? fixIdx.join('|') : (contAwaitingRef.current && contAwaitingRef.current.indices.length > 0 ? contAwaitingRef.current.indices.join('|') : words.join('|'));
    contPromptedKeyRef.current = key;
    setContLastPrompt(words);
    // Iteration 2: the context word is dimmed in the banner. Only
    // fix prompts set this: a miss prompt with a prepended context
    // word has exactly one more displayed word than fix indices;
    // stall prompts (equal lengths) clear it; replay (no fixIdx)
    // leaves the last prompt's value alone.
    if (fixIdx && fixIdx.length > 0) setContPromptHasContext(words.length === fixIdx.length + 1);
    // D2: the words are on screen from the first instant of the
    // prompt (see the prompting banner) — the VISIBLE correction
    // never waits on the network, and a fresh prompt clears any
    // stale audio-failure note.
    setContAudioFailed(false);
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
      // A newer expectation displaces (never drops) a live one:
      // the earlier words stay creditable via checkContFix even
      // though the screen now shows only the newer correction.
      displaceContAwaiting();
      contAwaitingRef.current = {
        indices: fixIdx,
        norms: fixNorms ?? [],
        baseLen: spokenTokens(liveRef.current.contFinals).length,
        key,
      };
    }
    // D2 prompt-completion watchdog: TTS/audio that is silently
    // dropped (timer-gated playback on iOS fires NEITHER onend nor
    // onerror) used to strand the session in "prompting" forever —
    // mic stopped, no resume, watchdog blind (it only watches
    // listening sessions), and a manual resume that never cleared
    // the flag, so every later interrupt/stall check early-returned.
    // The bound is the app's existing stall bound (18s): correction
    // audio for a few words is seconds, generation ~1-2s, so 18s
    // without completion IS stalled. On fire: if audio never even
    // started, record the audible failure (visible note + one
    // auto-retry); if audio started but its end event was lost
    // (321436-adjacent), just resume — the user already heard it.
    // Resume always creates a FRESH recognizer (never the discarded
    // instance), which is also the 321436 recovery.
    let promptAudioStarted = false;
    // Batch 2 (S1, fixed): the TTS utterance that pre-emption
    // cancelled, by identity — its late onerror/onend/watchdog
    // must stay silent, or they would settle (and kill) the human
    // audio that replaced it. A NEW utterance after pre-emption
    // (human-audio play failure) is a different object, so it
    // passes these checks and resumes normally.
    let ttsCurrentUtterance: SpeechSynthesisUtterance | null = null;
    let ttsCancelledUtterance: SpeechSynthesisUtterance | null = null;
    // The TTS fallback is once-per-prompt EXCEPT that pre-emption
    // re-arms it: after pre-emption, a human-audio play failure
    // must be able to speak TTS again (the old code's fallback
    // was still live in that corner; a consumed once-guard would
    // strand the prompt until the 18s watchdog).
    let ttsFallbackUsed = false;
    // Iteration 2: the iOS TTS onstart watchdog timer (cleared by
    // resume, so a late fire can never note-fail a finished prompt).
    let ttsOnstartTimer: ReturnType<typeof setTimeout> | null = null;
    // Iteration 2: the SINGLE finish path, locked by the settled
    // flag so onend/onerror/watchdog/TTS-watchdog can never resume
    // twice. The guard comes FIRST: a stale finish must not even
    // pause audio or cancel speech belonging to a newer prompt.
    const resumeAfterPrompt = () => {
      // Batch 3 (Claude hole 5): the prompt-generation epoch.
      // A stale prompt's late handler must never settle a newer
      // prompt — cancelContPrompt bumps the gen, so this check
      // is what makes that bump effective here.
      if (speakGenRef.current !== gen) return;
      if (promptSettledRef.current || !contPromptingRef.current) return;
      promptSettledRef.current = true;
      clearContPromptTimer();
      if (ttsOnstartTimer) { clearTimeout(ttsOnstartTimer); ttsOnstartTimer = null; }
      // Batch 3 (Claude hole 4): disarm the playing element's
      // handlers before pausing, so a late event from it can
      // never settle a newer prompt.
      try {
        const a = contPromptAudioRef.current;
        if (a) { a.onended = null; a.onerror = null; a.onplaying = null; a.onstalled = null; }
      } catch {}
      try { contPromptAudioRef.current?.pause(); } catch {}
      contPromptAudioRef.current = null;
      cancelCorrectionSpeech();
      contPromptingRef.current = false;
      setContPrompting(false);
      startContinuousMic();
    };
    // Batch 3 (Claude holes 1+2+5): watchdogMs lets the
    // pre-emption re-arm use a short 1.5s onstart watchdog
    // (first-use TTS keeps the 3s default). Callers must pass
    // NO other argument: play().catch used to pass its
    // rejection here, which would corrupt the delay.
    const playTtsFallback = (watchdogMs?: number) => {
        try {
          if ('speechSynthesis' in window) {
            if (ttsFallbackUsed) return;
            ttsFallbackUsed = true;
            const u = new SpeechSynthesisUtterance(correctionSpeechText(words));
            ttsCurrentUtterance = u;
            u.lang = 'ar-SA';
            // S4: same Arabic voice pick as ayah corrections — the
            // prompt must not be device luck either.
            const v = pickArabicTtsVoice();
            if (v) u.voice = v;
            u.rate = CORR_RATE_VALUE[liveRef.current.corrRate];
            // Iteration 2: iOS TTS onstart watchdog. speak() outside
            // a gesture may delay or block on iOS, firing neither
            // onstart nor onerror — without this, a blocked TTS
            // would strand the prompt until the 18s watchdog. A
            // dedicated flag (not promptAudioStarted, which playUrl
            // may already have set) proves THIS utterance started.
            let ttsStarted = false;
            const clearTtsWatchdog = () => { if (ttsOnstartTimer) { clearTimeout(ttsOnstartTimer); ttsOnstartTimer = null; } };
            // Batch 3 (Claude hole 1): a cancelled utterance can
            // still fire onstart in the same tick it was
            // cancelled — cancel AGAIN so no blip overlaps the
            // human audio, and never set the started flags.
            u.onstart = () => { if (ttsCancelledUtterance === u) { try { window.speechSynthesis.cancel(); } catch {} return; } if (speakGenRef.current !== gen) return; ttsStarted = true; promptAudioStarted = true; clearTtsWatchdog(); diagPush('tts-start', { label: 'cont-prompt-tts', msFromPrompt: Date.now() - promptStartedAt }); };
            u.onend = () => { if (speakGenRef.current !== gen) return; if (ttsCancelledUtterance === u) return; clearTtsWatchdog(); diagPush('tts-end', { label: 'cont-prompt-tts' }); resumeAfterPrompt(); };
            u.onerror = () => { if (speakGenRef.current !== gen) return; if (ttsCancelledUtterance === u) return; clearTtsWatchdog(); diagPush('tts-error', { label: 'cont-prompt-tts' }); noteContPromptAudioFailed(key); resumeAfterPrompt(); };
            // Batch 3 (Claude hole 2): on WebKit, speak() right
            // after cancel() can be silently dropped — defer
            // 50ms, and never speak into a settled or superseded
            // prompt (a settle inside the 50ms window must win).
            const wd = watchdogMs ?? CONT_TTS_ONSTART_WATCHDOG_MS;
            setTimeout(() => {
              if (promptSettledRef.current || speakGenRef.current !== gen || !contPromptingRef.current) return;
              window.speechSynthesis.speak(u);
              ttsOnstartTimer = setTimeout(() => {
                ttsOnstartTimer = null;
                if (speakGenRef.current !== gen) return;
                if (!ttsStarted && ttsCancelledUtterance !== u) { noteContPromptAudioFailed(key); resumeAfterPrompt(); }
              }, wd);
            }, 50);
          } else { noteContPromptAudioFailed(key); resumeAfterPrompt(); }
        } catch { noteContPromptAudioFailed(key); resumeAfterPrompt(); }
      };
    const playUrl = (url: string, cacheKey?: string) => {
      const a = new Audio(url);
      // v13: the file is neutral-speed; the user's corrRate applies
      // here, pitch-preserved.
      // v14 (Claude review): Safari resets playbackRate when the src
      // loads and ignores the unprefixed pitch flag — see playCorrection.
      const applyContRate = () => {
        a.playbackRate = CORR_RATE_VALUE[liveRef.current.corrRate];
        a.preservesPitch = true;
        (a as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
      };
      applyContRate();
      a.onloadedmetadata = applyContRate;
      contPromptAudioRef.current = a;
      // Batch 3 (Claude hole 3): whether this element actually
      // started playing decides the failure path — started-then-
      // failed settles (no re-speak over a partial play),
      // never-started falls back to TTS.
      let audioStarted = false;
      a.onplaying = () => { if (speakGenRef.current !== gen) return; audioStarted = true; promptAudioStarted = true; diagPush('tts-start', { label: 'cont-prompt-audio', msFromPrompt: Date.now() - promptStartedAt }); };
      a.onended = () => { if (speakGenRef.current !== gen) return; diagPush('tts-end', { label: 'cont-prompt-audio' }); resumeAfterPrompt(); };
      a.onstalled = () => {
        if (speakGenRef.current !== gen) return;
        diagPush('tts-error', { label: 'cont-prompt-audio-stalled' });
        if (audioStarted) { try { a.pause(); } catch {} contPromptAudioRef.current = null; resumeAfterPrompt(); }
        else playTtsFallback(ttsCancelledUtterance ? 1500 : undefined);
      };
      // D2: an audio-file error used to resume WITHOUT trying TTS,
      // unlike a refused play() — now both fall back to TTS, and
      // only a TTS failure as well produces the visible note.
      // Iteration 2: a file error on a CACHED url evicts it (missing
      // or corrupt stored file) so the next prompt refetches; the
      // fallback stays silent to the user (diag only). A refused
      // play() does NOT evict — gesture-gating is not corruption.
      a.onerror = () => {
        if (speakGenRef.current !== gen) return;
        diagPush('tts-error', { label: 'cont-prompt-audio' });
        if (audioStarted) { try { a.pause(); } catch {} contPromptAudioRef.current = null; resumeAfterPrompt(); return; }
        if (cacheKey) {
          contAudioCacheRef.current.delete(cacheKey);
          void getCorrAudioBackend().remove(cacheKey).catch(() => {});
          diagPush('cont-prompt-cache-evict', { label: 'cont-prompt-audio', reason: 'audio-error' });
        }
        playTtsFallback(ttsCancelledUtterance ? 1500 : undefined);
      };
      a.play().catch(() => playTtsFallback(ttsCancelledUtterance ? 1500 : undefined));
    };
    // Iteration 2: audio lookup by (version, voice, SPOKEN WORDS,
    // indices) — rate is deliberately absent (v3): one
    // neutral-speed file serves all corrRates via playbackRate.
    // Not the N1 dedupe key above, which stays indices-only: the
    // same indices with different spoken words (bare vs context)
    // must never share audio. Replay (no fixIdx) falls back to the
    // live awaiting indices, exactly like the dedupe key. The voice
    // here is the same corrGender the fetch sends, so key and
    // audio always agree.
    const audioIndices = fixIdx && fixIdx.length > 0 ? fixIdx : (contAwaitingRef.current && contAwaitingRef.current.indices.length > 0 ? contAwaitingRef.current.indices : []);
    const audioKey = corrAudioCacheKey(CORR_AUDIO_CACHE_VERSION, corrGender, words, audioIndices);
    const url = contAudioCacheRef.current.get(audioKey);
    // Iteration 2 diag: every prompt lookup counts toward the
    // session hit ratio (hits / all lookups) that will later
    // justify — or kill — surah pre-generation.
    if (url) corrCacheHitsRef.current++;
    else corrCacheMissesRef.current++;
    {
      const hits = corrCacheHitsRef.current;
      const misses = corrCacheMissesRef.current;
      diagPush('cont-prompt-cache-lookup', { label: 'cont-prompt-audio', hit: url !== null, hits, misses, hitRatio: hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) / 100 : 0, entries: contAudioCacheRef.current.size, storageBytes: corrStorageBytesRef.current });
    }
    cancelCorrectionSpeech();
    clearContPromptTimer();
    // Iteration 2 verified: this watchdog arms at PROMPT START
    // (before either playback branch below) and is never cleared on
    // a TTS win — only finish (resumeAfterPrompt) or cancel clears
    // it. The settled guard keeps a stale fire from note-failing a
    // prompt that already finished.
    contPromptTimerRef.current = setTimeout(() => {
      contPromptTimerRef.current = null;
      // Batch 3 (Claude hole 5): the 18s watchdog is scoped to
      // its own generation — it must never settle a newer prompt.
      // (Settling a long-playing prompt on timeout stays
      // intentional: a play past 18s is stalled or its end event
      // was lost, and the user already heard it or never will.)
      if (speakGenRef.current !== gen) return;
      if (promptSettledRef.current || !contPromptingRef.current) return;
      if (!promptAudioStarted) noteContPromptAudioFailed(key);
      resumeAfterPrompt();
    }, NO_RESULT_WATCHDOG_MS);
    if (url) {
      playUrl(url, audioKey);
    } else {
      // No prefetched audio (a mid-flow interrupt cannot be
      // prefetched — the miss is only known when it happens):
      // generate the human-sounding voice now (~1-2s for a few
      // words) while the "correcting" indicator shows. Batch 2
      // (S1): browser TTS starts AT ONCE and the fetch runs in
      // parallel — first sound is now TTS startup (~0.2-0.5s),
      // not min(fetch, 2s). The race only decides whether human
      // audio may pre-empt TTS that has not sounded yet; a late
      // fetch result is still cached for repeats, never played
      // over (or after) sounded TTS.
      // Iteration 2: the fetch promise is kept separately so a LATE
      // resolution (after a TTS win) still lands in the short-lived
      // cache — a repeat of the same prompt then plays the human
      // voice instantly. No Audio element is ever built for a late
      // URL: only playUrl builds one, and only after the gen +
      // settled checks below pass. requestCorrectionAudio never
      // rejects (it catches internally and resolves null), so the
      // race below cannot reject either.
      const fetchStart = Date.now();
      // Position mode (v12): missed indices -> seeded (ayah id,
      // word position) pairs. Shape is context iff the spoken words
      // carry exactly one more word than the missed indices (the
      // prepended predecessor); otherwise bare. Any derivation
      // failure falls back to free text — never a crash, never a
      // guessed position.
      const corrPos = corrPositionsForRange(audioIndices, liveRef.current.contExpected, ayahsRef.current);
      const corrShape: 'context' | 'bare' = words.length > audioIndices.length ? 'context' : 'bare';
      const fetchP = requestCorrectionAudio(words, corrPos ? { shape: corrShape, positions: corrPos } : undefined);
      // Batch 2 (S1): TTS starts at once (its once-guard makes the
      // later playTtsFallback calls below no-ops once it has
      // started). The race below now only pre-empts TTS that has
      // NOT sounded: promptAudioStarted is set by TTS onstart and
      // by playUrl onplaying, and in this branch only TTS could
      // have set it. Pre-emption marks the cancelled utterance by
      // identity, clears its onstart watchdog, and re-arms the
      // fallback before cancelling, so the cancelled utterance's
      // late events cannot settle the prompt — while a later
      // human-audio play failure can still speak TTS again.
      playTtsFallback();
      void withTimeout(fetchP, CORR_AUDIO_TIMEOUT_MS).then((result) => {
        if (speakGenRef.current !== gen || promptSettledRef.current || !contPromptingRef.current) return;
        if (result.kind === 'value' && result.value) {
          contAudioCacheRef.current.set(audioKey, result.value);
          diagPush('cont-prompt-audio-ready', { label: 'cont-prompt-audio', fetchMs: Date.now() - fetchStart, msFromPrompt: Date.now() - promptStartedAt });
          if (!promptAudioStarted) {
            ttsCancelledUtterance = ttsCurrentUtterance;
            ttsFallbackUsed = false;
            if (ttsOnstartTimer) { clearTimeout(ttsOnstartTimer); ttsOnstartTimer = null; }
            cancelCorrectionSpeech();
            playUrl(result.value, audioKey);
          }
        } else if (result.kind === 'timeout') {
          diagPush('cont-prompt-tts-timeout', { label: 'cont-prompt-audio', timeoutMs: CORR_AUDIO_TIMEOUT_MS });
          playTtsFallback();
        } else playTtsFallback();
      });
      void fetchP.then((lateUrl) => {
        if (lateUrl) {
          contAudioCacheRef.current.set(audioKey, lateUrl);
          // v3: the entry rate field is base-rate metadata (1.0) —
          // the file is neutral-speed; playbackRate applies at play.
          persistCorrAudio(audioKey, lateUrl, corrGender, words, audioIndices, 1.0);
        }
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
    // Iteration 2: prefetch into the same content-addressed cache
    // the prompt lookup uses (version, voice, spoken words,
    // indices — no rate, v3). The old single slot keyed prefetch
    // by WORDS but looked it up by INDICES, so stall prefetch never
    // hit; unifying the key also fixes that (stall prompts now
    // actually play prefetched audio). A prefetch win persists too,
    // so the next identical stall is instant even across visits.
    const prefetchKey = corrAudioCacheKey(CORR_AUDIO_CACHE_VERSION, corrGender, owed.words, owed.indices);
    if (!contAudioCacheRef.current.get(prefetchKey) && contPrefetchPendingRef.current !== prefetchKey) {
      const token = ++corrFetchTokenRef.current;
      contPrefetchPendingRef.current = prefetchKey;
      // Position mode (v12): stall prompts speak bare owed words
      // (no context prepend on this path), so shape is always bare.
      const stallPos = corrPositionsForRange(owed.indices, liveRef.current.contExpected, ayahsRef.current);
      void fetchCorrectionAudio(owed.words, token, stallPos ? { shape: 'bare', positions: stallPos } : undefined).then((url) => {
        if (url && token === corrFetchTokenRef.current && contPrefetchPendingRef.current === prefetchKey) {
          contAudioCacheRef.current.set(prefetchKey, url);
          // v3: base-rate metadata (1.0) — file is neutral-speed.
          persistCorrAudio(prefetchKey, url, corrGender, owed.words, owed.indices, 1.0);
        }
        if (contPrefetchPendingRef.current === prefetchKey) contPrefetchPendingRef.current = null;
      });
    }
    contStallTimerRef.current = setTimeout(() => {
      contStallTimerRef.current = null;
      if (!liveRef.current.contListening || contPromptingRef.current || contNoMatchRef.current) return;
      const now = contOwedWords();
      if (now.words.length === 0) return;
      // N1: indices-based dedupe key (see speakContPrompt).
      if (now.indices.join('|') === contPromptedKeyRef.current) return;
      speakContPrompt(now.words, now.indices, now.norms, 'stall');
    }, liveRef.current.corrDelay * 1000);
  };
  // Did he say back the prompted words after the resume? The fresh
  // tokens since the prompt must contain them in order. A bounded
  // window (first 20 fresh tokens): if he moved on without saying
  // them, they stay missed — the teacher does not wait forever,
  // and the replay button still offers them on demand.
  const checkContFix = () => {
    const tokens = spokenTokens(liveRef.current.contFinals);
    // The live expectation plus any expectations displaced by later
    // prompts (see displaceContAwaiting): a prompted word the user
    // repeats late still earns its credit, even though a newer prompt
    // superseded it on screen. Each entry measures its own fresh
    // window from its own baseLen; credit and drop are per entry.
    const settle = (entry: { indices: number[]; norms: string[]; baseLen: number; key: string }, remove: () => void) => {
      const fresh = tokens.slice(entry.baseLen);
      // D2: once the user has demonstrably moved on (20 fresh
      // tokens), a later stall may prompt the still-missed words
      // once more — so the drop releases the prompt dedupe, as the
      // old code did for the live expectation. Grading is
      // untouched — the words stay missed until actually repeated.
      if (fresh.length > 20) {
        if (entry.key && contPromptedKeyRef.current === entry.key) contPromptedKeyRef.current = '';
        remove();
        return;
      }
      let p = 0;
      for (let t = 0; t < fresh.length && p < entry.norms.length; t++) {
        if (fresh[t] === entry.norms[p]) p++;
      }
      if (p === entry.norms.length) {
        entry.indices.forEach((i) => contCreditedRef.current.add(i));
        entry.norms.forEach((n) => contFixedNormsRef.current.add(n));
        remove();
      }
    };
    const aw = contAwaitingRef.current;
    if (aw) settle(aw, () => { contAwaitingRef.current = null; });
    // Displaced entries: iterate over a copy (settle may remove).
    for (const d of [...contDisplacedRef.current]) {
      settle(d, () => { contDisplacedRef.current = contDisplacedRef.current.filter((x) => x !== d); });
    }
  };
  // Mid-flow miss interrupt (2026-10-28, the user's words): as soon
  // as a passed-over miss is CONFIRMED — a later word matched, so
  // he demonstrably moved past it — stop him at once and correct
  // him, even if he never pauses. One correction at a time (while
  // a fix is awaited, new misses wait for the next stall prompt),
  // and a miss corrected once is never re-interrupted.
  const checkContMissInterrupt = () => {
    if (!liveRef.current.contListening || contPromptingRef.current || contNoMatchRef.current) return;
    const owed = contOwedWords();
    // Two confirmation signals, strongest first. (1) A confirmed
    // passed-over miss: a later word matched, so he demonstrably
    // moved past it. (2) E2 overshoot: the speaker has uttered
    // strictly more distinct new words than the next word's ayah has
    // left, so he demonstrably moved past the next word even though
    // nothing after it matched. Without (2), a substitution at the
    // end of an ayah followed by a wholly unmatched stretch (the
    // 23:38 للمؤمنين case) can never interrupt.
    // Candidates, strongest first: (1) the confirmed miss, (2) the
    // overshoot next word. A candidate that is blocked (live
    // expectation for the same or a later word, or the dedupe key)
    // does NOT veto the next candidate: the 23:38 shape has BOTH a
    // blocked confirmed miss (الم, awaited from an early stall
    // prompt) and a live overshoot (للمتقين), and the interrupt must
    // still fire for the latter.
    const candidates: { words: string[]; indices: number[]; norms: string[] }[] = [];
    if (owed.isMiss && owed.words.length > 0) {
      candidates.push({ words: owed.words, indices: owed.indices, norms: owed.norms });
    }
    const over = contOvershootOwed();
    if (over) candidates.push(over);
    for (const target of candidates) {
      // One correction at a time — EXCEPT when the speaker has moved
      // beyond the awaited words: a live expectation for an EARLIER
      // word must not veto a current error (the 23:38 shape, where an
      // early stall prompt for الم would otherwise block the للمتقين
      // interrupt forever). Displacing the expectation (inside
      // speakContPrompt's fix branch, below) does not change grading:
      // the earlier words stay missed, a later stall may prompt them
      // again, AND repeating them still credits via checkContFix's
      // displaced entries. An expectation for the same or a later word
      // still blocks this candidate, as before. The expectation is
      // only displaced when this candidate actually prompts (a
      // dedupe-blocked candidate must not disturb it).
      const aw = contAwaitingRef.current;
      if (aw) {
        const awaitedLast = aw.indices.length > 0 ? Math.max(...aw.indices) : -1;
        if (target.indices[0] <= awaitedLast) continue;
      }
      // N1: indices-based dedupe key (see speakContPrompt).
      const key = target.indices.join('|');
      if (key === contPromptedKeyRef.current) continue;
      if (contStallTimerRef.current) { clearTimeout(contStallTimerRef.current); contStallTimerRef.current = null; }
      // Miss interrupts (confirmed + overshoot only — stall prompts
      // never come through here) speak one preceding expected word
      // for context: "هدى للمتقين", not a bare "للمتقين". The fix
      // indices/norms go in unchanged, so grading and fix-credit
      // see exactly the missed words; only the displayed + spoken
      // correction carries the context word.
      // RECORDER: the trigger distinguishes the two interrupt kinds
      // in the case file (confirmed-miss vs overshoot).
      const via = over && target === over ? 'overshoot' : 'confirmed-miss';
      speakContPrompt(withPrecedingContextWord(target.words, target.indices, liveRef.current.contExpected), target.indices, target.norms, via);
      return;
    }
  };

  // D1 honesty finish (reporting only): a continuous run that ends
  // with zero matched words goes to the honest done panel, never to
  // finishTest — so no 0/286 history record and no misleading
  // ayah-by-ayah failure list are created for a run the engine did
  // not actually hear/match. Matching itself is untouched.
  const finishContinuousNoMatch = () => {
    const expected = liveRef.current.contExpected;
    const ayahCount = expected.length ? expected[expected.length - 1].ayahIdx + 1 : 0;
    setContMatchedWords(0);
    setContHeardWords(spokenTokens(liveRef.current.contFinals).length);
    setContZeroMatch(true);
    const noGrades = new Array(ayahCount).fill(false);
    liveRef.current.grades = noGrades;
    setGrades(noGrades);
    const noSkips = new Array(ayahCount).fill(false);
    liveRef.current.skipped = noSkips;
    setSkipped(noSkips);
    setWrongByAyah({});
    setExtraByAyah({});
    setContExtras([]);
    setPhase('done');
  };

  // Grade the whole range from the accumulated continuous transcript.
  // Returns true when every ayah was fully covered.
  const gradeContinuousNow = (): boolean => {
    const expected = liveRef.current.contExpected;
    const raw = contRawAlignment();
    const { matched } = contEffectiveMatched();
    const ayahCount = expected.length ? expected[expected.length - 1].ayahIdx + 1 : 0;
    // D1: record the word counts for the done diagnostic, and guard
    // every caller (not just the finish button): a zero-match
    // transcript must never reach finishTest's 0% history + review
    // list, even if a future caller forgets the finish-button check.
    setContMatchedWords(matched.filter(Boolean).length);
    setContHeardWords(spokenTokens(liveRef.current.contFinals).length);
    if (matched.filter(Boolean).length === 0) {
      finishContinuousNoMatch();
      return false;
    }
    setContZeroMatch(false);
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
    setContExtras(raw.extras.filter((e) => !contFixedNormsRef.current.has(e)));
    finishTest(gradesArr);
    return gradesArr.every(Boolean);
  };

  const finishContinuousPressed = () => {
    // [P8] Same orphaned-interim rescue as the ayah "done" tap.
    const pendingInterim = takePendingInterim();
    if (pendingInterim) {
      liveRef.current.contFinals = `${liveRef.current.contFinals} ${pendingInterim}`.trim();
      setTranscript(liveRef.current.contFinals);
    }
    if (spokenTokens(liveRef.current.contFinals).length === 0) {
      setMicError('لسه ما سمعت حاجة — سمّع النطاق الأول وبعدين اضغط "أنهيت التسميع"');
      return;
    }
    stopContinuousMic();
    // D1 honesty (checked here so no buzzer plays for a no-match
    // run): words were heard but none matched — honest panel, not
    // a failure grade. gradeContinuousNow repeats the guard.
    const { matched } = contEffectiveMatched();
    if (matched.filter(Boolean).length === 0) {
      finishContinuousNoMatch();
      return;
    }
    const allOk = gradeContinuousNow();
    if (allOk) playCorrectChime(); else playWrongBuzzer();
  };

  const startContinuousMic = () => {
    // DIAG: tap (button text is ابدأ vs كمّل by transcript state;
    // silent restarts route through trySilentRestart, which logs
    // its own 'restart' event first).
    diagPush('tap', { label: liveRef.current.contFinals ? 'resume-cont' : 'start-cont' });
    getAudioCtx();
    // Batch 3 follow-up: voiceschanged-aware warm-up (see
    // warmTtsVoices) — iOS often returns [] on first getVoices.
    warmTtsVoices();
    // Iteration 2: hydrate the persistent correction-audio cache
    // (no-op after the first call) so repeat prompts can hit it.
    hydrateCorrAudioCache();
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setMicError(micAbsentMessage(' — جرّب وضع "آية آية" اليدوي بدل كده'));
      return;
    }
    if (liveRef.current.contListening) return;
    // D2: a prompt whose audio never completed used to leave
    // contPromptingRef true across a manual resume (the prompt
    // watchdog above normally prevents this, but a tap during a
    // stuck prompt must also recover): every later interrupt/stall
    // check early-returns while the flag is set, so a manual start
    // clears the stale prompt state. The words stay replayable via
    // contLastPrompt, and the no-match baseline restarts below.
    if (contPromptingRef.current) {
      clearContPromptTimer();
      contPromptingRef.current = false;
      setContPrompting(false);
    }
    contNoMatchRef.current = false;
    setContNoMatch(false);
    // D2: do NOT clear contAudioFailed here. A failed prompt's note
    // must survive the resume that follows it — the note sits above
    // the replay button while listening, and only a NEW prompt
    // (speakContPrompt) or a new test clears it. Clearing it on
    // start would make the failure visible for zero seconds.
    // A manual (re)start opens a new stall episode, so it earns its
    // own single silent restart like any fresh session.
    silentRestartUsedRef.current = false;
    setMicError('');
    // Do NOT wipe contFinals here: the test start already cleared it,
    // and a stop/resume must continue the same transcript.
    setTranscript(liveRef.current.contFinals);
    setInterim('');
    userStopRef.current = false;
    lastInterimRef.current = '';
    const rec = new SR();
    // [P7] Fixed test locale (see helpers).
    rec.lang = TEST_SPEECH_LOCALE;
    rec.continuous = true;
    rec.interimResults = true;
    // [P5] N-best hypotheses (degrades to top hypothesis if ignored).
    try { rec.maxAlternatives = 3; } catch {}
    // DIAG: record-only lifecycle handlers (see the ayah path).
    rec.onstart = () => { if (recRef.current !== rec) return; diagPush('onstart'); };
    rec.onaudiostart = () => { if (recRef.current !== rec) return; diagPush('onaudiostart'); };
    rec.onspeechstart = () => { if (recRef.current !== rec) return; diagPush('onspeechstart'); };
    rec.onresult = (e: any) => {
      // [P4] Stale-recognizer guard (see ayah path).
      if (recRef.current !== rec) return;
      noteRecResult();
      // S4: any result re-arms the no-result watchdog.
      noteWatchdogResult();
      setMicError('');
      let interimText = '';
      let sawFinal = false;
      const expectedNorms = liveRef.current.contExpected.map((w) => w.norm);
      for (let i = e.resultIndex; i < e.results.length; i++) {
        // Same isFinal fix as the ayah path: it lives on the result.
        const res = e.results[i];
        const r = res[0];
        if (!r) continue;
        if (res.isFinal || r.isFinal) {
          sawFinal = true;
          // [P5] Narrow alternative-rescue (see helpers).
          const chosen = pickFinalTranscript(res, expectedNorms);
          diagPush('result', { final: true, text: chosen });
          diagFinalsRef.current.push(chosen);
          liveRef.current.contFinals = `${liveRef.current.contFinals} ${chosen}`.trim();
          setTranscript(liveRef.current.contFinals);
          checkContFix();
          const { matched: progMatched, allMatched } = updateContProgress();
          if (allMatched) {
            // Range fully recited: finish on its own, with a chime.
            stopContinuousMic();
            playCorrectChime();
            gradeContinuousNow();
          } else {
            // D2: match-progress checkpoint BEFORE the interrupt
            // check — if this final completes 20 unmatched tokens
            // (or the wall-clock leg already tripped), the session
            // pauses into the honest no-match state instead of
            // silently accumulating another failure, and the
            // interrupt below early-returns (listening is false).
            noteContMatchProgress(progMatched.filter(Boolean).length);
            // Mid-flow correction: a confirmed miss stops him at
            // once, even if he never pauses (see checkContMissInterrupt).
            checkContMissInterrupt();
          }
        } else {
          interimText += `${r.transcript} `;
        }
      }
      // [P2] Interim bookkeeping (see ayah path).
      if (interimText.trim()) {
        lastInterimRef.current = interimText.trim();
        setInterim(interimText.trim());
        diagPush('result', { final: false, text: interimText.trim() });
        // Live progress from interim (see contLiveProgress): the
        // pointer and watchdog must follow what the recognizer
        // hears NOW, not only confirmed finals. Mirrors
        // noteContMatchProgress, but on live values; never touches
        // contFinals, contCreditedRef, grading, or correction.
        if (liveRef.current.contListening && !contNoMatchRef.current) {
          const live = contLiveProgress();
          if (live.count > contLastMatchedCountRef.current) {
            contLastMatchedCountRef.current = live.count;
            contLastMatchAtRef.current = Date.now();
            contTokensAtLastMatchRef.current = live.tokens;
            setContProgress({ matched: live.count, total: liveRef.current.contExpected.length, ayahIdx: live.ayahIdx });
            armContNoMatchTimer();
          } else if (live.tokens - contTokensAtLastMatchRef.current >= CONT_NO_MATCH_TOKENS) {
            enterContNoMatch();
          }
        }
      } else if (sawFinal) {
        lastInterimRef.current = '';
        setInterim('');
      }
      // Every result — final or interim — rearms the 3s stall
      // prompt, so only true silence triggers a correction.
      scheduleContStallPrompt();
    };
    rec.onerror = (e: any) => {
      // [P3] Same taxonomy as the ayah path: transient errors do
      // not stop the session; the onend restart is the retry, and
      // the accumulated continuous transcript survives it.
      // S4: the 3s safety timer backstops a missing onend here too,
      // and its dead-end preserves (never wipes) the transcript.
      if (recRef.current !== rec) return;
      const code = e && e.error;
      diagPush('error', { code: String(code || 'unknown') });
      if (code === 'no-speech' || code === 'aborted') {
        armTransientSafety(rec, () => tripContStalled('الاستماع وقف — اللي سمعته محفوظ، اضغط «كمّل التسميع المتصل» عشان تكمل'));
        return;
      }
      if (code === 'network') {
        setMicError('الاستماع المباشر محتاج إنترنت — بيحاول تاني لوحده');
        armTransientSafety(rec, () => tripContStalled('الاستماع وقف — اللي سمعته محفوظ، اضغط «كمّل التسميع المتصل» عشان تكمل'));
        return;
      }
      if (code === 'language-not-supported' && !(rec as any).__triedLocaleFallback) {
        (rec as any).__triedLocaleFallback = true;
        try { rec.lang = otherArabicLocale(rec.lang); rec.start(); diagPush('rec-start', { label: 'locale-fallback', ok: true }); return; } catch { diagPush('rec-start', { label: 'locale-fallback', ok: false }); }
      }
      if (code === 'not-allowed') {
        setMicError('الميكروفون مقفول — اسمح بيه من إعدادات المتصفح');
      } else if (code === 'audio-capture') {
        setMicError('الميكروفون مشغول بتطبيق تاني أو مش موجود — اقفله ثم اضغط الميكروفون تاني');
      } else if (code === 'service-not-allowed') {
        setMicError('المتصفح منع خدمة الاستماع المباشر على الجهاز ده — جرّب متصفح تاني');
      } else if (code === 'language-not-supported') {
        setMicError('الاستماع المباشر مش بيدعم العربية على الجهاز ده');
      } else {
        setMicError('تعذر الاستماع — جرّب تاني');
      }
      stopContinuousMic();
    };
    rec.onend = () => {
      // [P1/P4] Same restart discipline as the ayah path: rescue
      // the orphaned interim, re-grade if it completes the range,
      // then restart under budget — never for a stale session.
      // S4: a normal onend cancels the transient safety timer.
      clearTransientSafety();
      if (recRef.current !== rec || userStopRef.current) return;
      if (!liveRef.current.contListening) return;
      diagPush('onend');
      const orphan = takePendingInterim();
      if (orphan) {
        liveRef.current.contFinals = `${liveRef.current.contFinals} ${orphan}`.trim();
        setTranscript(liveRef.current.contFinals);
        checkContFix();
        const { matched: progMatched, allMatched } = updateContProgress();
        if (allMatched) {
          stopContinuousMic();
          playCorrectChime();
          gradeContinuousNow();
          return;
        }
        // D2: same match-progress checkpoint as the live path.
        noteContMatchProgress(progMatched.filter(Boolean).length);
        // Parity with the live-result path: rescued words can
        // confirm a passed-over miss, which interrupts at once.
        checkContMissInterrupt();
        if (recRef.current !== rec || userStopRef.current || !liveRef.current.contListening) return;
      }
      if (!recRestartAllowed()) {
        tripContStalled('الاستماع وقف — اللي سمعته محفوظ، اضغط «كمّل التسميع المتصل» عشان تكمل');
        return;
      }
      try {
        rec.start();
        diagPush('rec-start', { label: 'onend-restart', ok: true });
      } catch (err: any) {
        if (err && err.name === 'InvalidStateError') return;
        tripContStalled('الاستماع وقف — اللي سمعته محفوظ، اضغط «كمّل التسميع المتصل» عشان تكمل');
      }
    };
    recRef.current = rec;
    resetRecRestartBudget();
    try {
      rec.start();
      diagPush('rec-start', { label: 'start-cont', ok: true });
    } catch (err: any) {
      diagPush('rec-start', { label: 'start-cont', ok: false, code: err?.name || 'error' });
      setMicError('تعذر بدء الاستماع — جرّب تاني');
      recRef.current = null;
      return;
    }
    liveRef.current.contListening = true;
    setContListening(true);
    // S4: watchdog clock starts at session start (also after every
    // prompt resume, which re-enters here), and a resume clears the
    // stalled banner — the transcript itself was never wiped.
    setContStalled(false);
    lastResultAtRef.current = Date.now();
    armWatchdog();
    // D2: the no-match baseline restarts with every (re)start, from
    // the CURRENT matched count — never from zero on a resume.
    resetContNoMatchBaseline();
  };

  // Advance after a mic grade (the user reads the green ayah / red
  // wrong part first, then moves on deliberately — no auto-advance).
  const nextAfterMic = () => {
    stopRefUnit();
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
  // D1 raw heard line (display-capped; see capHeardLine): finals +
  // pending interim, verbatim as the engine returned them. The old
  // unbounded "سمعت:" renders are replaced by this capped line so
  // a full-Surah transcript cannot flood the UI.
  const heardRawText = transcript && interim ? `${transcript} ${interim}`.trim() : (transcript || interim);
  const heardCapped = capHeardLine(heardRawText);
  // E1 diagnostic pieces, shared by both done-screen branches below
  // (only one branch renders at a time). The token list is rendered
  // dir=ltr with an explicit number per token, so the logical order
  // is unambiguous even when the raw line mixes Arabic words and
  // Latin digits. Raw tokens are verbatim (whitespace split only, no
  // normalization), so their count can exceed the graded heard count
  // whenever normalization drops a token — that difference itself is
  // diagnostic. A per-ayah heard-tokens breakdown is deliberately NOT
  // built here: continuous grading works on one flat word list, so
  // per-ayah heard spans would require threading consumption spans
  // through the grader; the numbered full list plus the existing
  // per-ayah wrong-words list on this screen decode the same facts
  // without touching grading.
  // P0-4: the numbered token list is built ONLY on the done screen
  // with the full text open — on every other render it is empty, so
  // a long run never pays the split + chip render per keystroke.
  // Rendered chips are capped at 400 (the full text above stays
  // complete and copyable via the toggle).
  const heardFullTokens = useMemo(() => {
    if (phase !== 'done' || !showFullHeard) return [] as string[];
    return heardRawText.split(/\s+/).filter(Boolean);
  }, [phase, showFullHeard, heardRawText]);
  const HEARD_CHIP_CAP = 400;
  const fullHeardToggle = (
    <button type="button" onClick={() => setShowFullHeard((v) => !v)} className="mt-2 text-sm font-bold text-emerald-700 hover:underline">
      {showFullHeard ? 'إخفاء النص الكامل' : 'عرض النص الكامل'}
    </button>
  );
  const fullHeardContent = showFullHeard ? (heardFullTokens.length > 0 ? (
    <div className="mt-3 space-y-2">
      <p dir="rtl" className="text-sm leading-relaxed bg-white border border-gray-200 rounded-xl p-3 select-text break-words text-accent-700">{heardRawText}</p>
      <p className="text-xs text-accent-600">الكلمات الخام (قبل التطبيع، بالترتيب كما سمعها الجهاز): {heardFullTokens.length} — الرقم قبل كل كلمة هو ترتيبها، فلا يلتبس الترتيب باتجاه العرض.{heardFullTokens.length > HEARD_CHIP_CAP ? ` (عرض أول ${HEARD_CHIP_CAP} كلمة فقط — النص الكامل أعلاه)` : ''}</p>
      <div dir="ltr" className="flex flex-wrap gap-1">
        {heardFullTokens.slice(0, HEARD_CHIP_CAP).map((t, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs text-accent-700"><span dir="ltr">{i + 1}</span><bdi>{t}</bdi></span>
        ))}
      </div>
    </div>
  ) : (
    <p className="text-xs text-accent-600 mt-2">لا يوجد نص مسموع لعرضه.</p>
  )) : null;

  const openInMushaf = (surahNo: number, ayahNo: number) => {
    try { localStorage.setItem(TARGET_KEY, JSON.stringify({ surah: surahNo, ayah: ayahNo })); } catch {}
    onNavigate('mushaf');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-stone-50/30 pb-24">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-emerald-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-lg">
            <Mic className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-accent-800">سمّع لنفسك</h1>
            <p className="text-sm text-accent-600">{micSupported ? 'سمّع من حفظك، والبرنامج يصحح لك بالميكروفون' : 'سمّع من حفظك، وقيّم نفسك يدوي (جهازك مش بيدعم الميكروفون)'}</p>
          </div>
          <button onClick={() => onNavigate('app')} aria-label="العودة إلى لوحتي"
            className="mr-auto icon-action flex items-center gap-1.5 px-3 py-2 text-sm text-accent-600 hover:bg-gray-100 rounded-lg">
            <Home className="w-5 h-5" /> لوحتي
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {phase === 'setup' && (
          <div className="space-y-5">
            <p className="text-xs text-accent-500 text-center">{stampLine}</p>
            {/* Batch 1: the old unsupported note was a small line
                buried in the settings card. A user on a voiceless
                browser deserves this banner first, not last. */}
            {!micSupported && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl shadow-sm p-5">
                <p className="font-bold text-amber-800 mb-1">متصفحك مش بيدعم التسميع المباشر</p>
                <p className="text-sm text-accent-600 leading-relaxed">افتح التطبيق من Safari على iPhone/iPad عشان تسمّع بالميكروفون. هنا تقدر تقيّم نفسك يدوي بدل كده.</p>
              </div>
            )}
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
                  <button onClick={resumeTest} disabled={recording && !!savedProgress.endSurah && savedProgress.endSurah !== savedProgress.surah}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl">
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
                <p className="text-sm text-accent-600 mt-2 leading-relaxed">
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
                <p className="text-sm text-accent-600 mt-2 leading-relaxed">
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
                <p className="text-sm text-accent-600 mt-2 leading-relaxed">
                  {reciteMode === 'ayah'
                    ? 'تسمّع كل آية لوحدها، وتتصحح قبل ما تنتقل للي بعدها.'
                    : 'سمّع النطاق كله على بعضه من غير توقف عند كل آية — من أول آية لآخر آية في النطاق، أو حتى نهاية السورة لو ده اختيارك. ولو غلطت في كلمة وانت ماشي، البرنامج يوقفك على طول وينطقها لك بصوت رجالي أو نسائي حسب حسابك، وتقولها وراه وتكمل؛ ولو وقفت ' + corrDelay.toLocaleString('ar-EG') + ' ثواني وعندك كلمة ناقصة، ينطقها لك برضه. التقرير يطلع في الآخر بالكلمات الناقصة في كل آية.'}
                </p>
                {!micSupported && (
                  <p className="text-sm text-amber-700 mt-1">{micAbsentSetupNote}</p>
                )}
              </div>
              <p className="text-xs text-accent-600 leading-relaxed">
                ملحوظة بأمانة: التدقيق كله على مستوى الكلمات — البرنامج بيسمع الكلمات مش الأصوات، فما بيقيس أحكام التجويد (اللحن الخفي).
              </p>
            </div>

            {/*
              RECORDER (Phase 0): recording-mode toggle + voice tags
              + planting plan. Setup only; when OFF it is just the
              toggle row. Recording requires a single-surah range
              (schema v1): the start buttons disable when the chosen
              range spans surahs.
            */}
            <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5 space-y-4">
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={recording} onChange={toggleRecording} className="w-5 h-5 accent-emerald-600" />
                <div>
                  <p className="font-bold text-accent-800">وضع التسجيل (لمدونة الاختبار)</p>
                  <p className="text-sm text-accent-600 leading-relaxed">عند التشغيل، يسجّل الاختبار أحداث التصحيح وخطة الأخطاء المزروعة لتصديرها كحالة اختبار — لا يغيّر التقييم ولا يرفع أي شيء تلقائيًا. مغلق افتراضيًا.</p>
                </div>
              </div>
              {recording && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-sm font-bold text-accent-700">لهجة الصوت</span>
                      <select value={recTags.dialect} onChange={(e) => setRecTags((t) => ({ ...t, dialect: e.target.value }))}
                        className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300">
                        <option value="">اختر…</option>
                        <option value="مصري">مصري</option>
                        <option value="شامي">شامي</option>
                        <option value="خليجي">خليجي</option>
                        <option value="مغربي">مغربي</option>
                        <option value="فصحى">فصحى</option>
                        <option value="أخرى">أخرى</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-bold text-accent-700">جنس الصوت</span>
                      <select value={recTags.gender} onChange={(e) => setRecTags((t) => ({ ...t, gender: e.target.value }))}
                        className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300">
                        <option value="">اختر…</option>
                        <option value="male">رجالي</option>
                        <option value="female">نسائي</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-bold text-accent-700">سرعة التلاوة</span>
                      <select value={recTags.pace} onChange={(e) => setRecTags((t) => ({ ...t, pace: e.target.value as VoiceTags['pace'] }))}
                        className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300">
                        <option value="slow">بطيئة</option>
                        <option value="normal">عادية</option>
                        <option value="fast">سريعة</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-bold text-accent-700">ضجيج المكان</span>
                      <select value={recTags.noise} onChange={(e) => setRecTags((t) => ({ ...t, noise: e.target.value as VoiceTags['noise'] }))}
                        className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300">
                        <option value="low">هادئ</option>
                        <option value="medium">متوسط</option>
                      </select>
                    </label>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-accent-700 mb-2">خطة الأخطاء المزروعة (قبل البدء)</p>
                    <p className="text-sm text-accent-600 leading-relaxed mb-2">سجّل هنا ما ستنطقه خطأً وأين — قبل أن ترى نتيجة التطبيق. عند النهاية ستؤكد ما نفذته فعلًا. الخطة والواقع حقلان منفصلان، وهذا يلتقط الأخطاء غير المقصودة أيضًا. بنود خارج النطاق المبدوء تُحذف عند التصدير.</p>
                    {recPlan.map((p, pi) => (
                      <div key={pi} className="flex items-center gap-2 mb-2 text-sm">
                        <span className="flex-1 text-accent-700" dir="rtl">سورة {SURAHS.find((s) => s.no === p.surah)?.name || p.surah} آية {p.ayah}: ستقول «{p.spoken}» بدل «{p.expectedWord}» ({TAXONOMY_LABELS[p.type]})</span>
                        <button onClick={() => setRecPlan((prev) => prev.filter((_, i) => i !== pi))} className="px-3 py-1.5 text-sm font-bold text-red-700 bg-red-50 rounded-lg">حذف</button>
                      </div>
                    ))}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-xs font-bold text-accent-700">السورة</span>
                        <select value={plDraft.surah} onChange={(e) => setPlDraft((d) => ({ ...d, surah: Number(e.target.value) }))}
                          className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-base bg-white">
                          {SURAHS.map((s) => (<option key={s.no} value={s.no}>{s.no} — سورة {s.name}</option>))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-bold text-accent-700">الآية</span>
                        <input type="number" min={1} max={SURAH_AYAH_COUNTS[plDraft.surah - 1] || 1} value={plDraft.ayah}
                          onChange={(e) => setPlDraft((d) => ({ ...d, ayah: Math.max(1, Math.min(SURAH_AYAH_COUNTS[d.surah - 1] || 1, Number(e.target.value) || 1)) }))}
                          className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-base" />
                      </label>
                      <label className="block">
                        <span className="text-xs font-bold text-accent-700">ستقول (خطأً)</span>
                        <input value={plDraft.spoken} onChange={(e) => setPlDraft((d) => ({ ...d, spoken: e.target.value }))}
                          className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-base" dir="rtl" />
                      </label>
                      <label className="block">
                        <span className="text-xs font-bold text-accent-700">بدل كلمة</span>
                        <input value={plDraft.expected} onChange={(e) => setPlDraft((d) => ({ ...d, expected: e.target.value }))}
                          className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-base" dir="rtl" />
                      </label>
                      <label className="block col-span-2">
                        <span className="text-xs font-bold text-accent-700">نوع الخطأ</span>
                        <select value={plDraft.type} onChange={(e) => setPlDraft((d) => ({ ...d, type: e.target.value as FixedTaxonomy }))}
                          className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-base bg-white">
                          {TAXONOMY_VALUES.map((t) => (<option key={t} value={t}>{TAXONOMY_LABELS[t]}</option>))}
                        </select>
                      </label>
                    </div>
                    <button onClick={() => {
                      if (!plDraft.spoken.trim() || !plDraft.expected.trim()) return;
                      setRecPlan((prev) => [...prev, { surah: plDraft.surah, ayah: plDraft.ayah, spoken: plDraft.spoken.trim(), expectedWord: plDraft.expected.trim(), type: plDraft.type }]);
                      setPlDraft((d) => ({ ...d, spoken: '', expected: '' }));
                    }} className="mt-2 px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-xl">إضافة إلى الخطة</button>
                  </div>
                  {(unitPreview.start.surah !== unitPreview.end.surah || (savedProgress?.endSurah && savedProgress.endSurah !== savedProgress.surah)) && (
                    <p className="text-sm text-red-600 font-semibold">تنبيه: التسجيل يدعم سورة واحدة فقط — النطاق المختار (بالوحدة/الاستكمال) يمتد لأكثر من سورة، فزر البدء معطل حتى تختار نطاقًا داخل سورة واحدة أو توقف التسجيل.</p>
                  )}
                </>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 space-y-4">
              <h2 className="font-bold text-accent-800">بالوحدة: من أول … إلى نهاية …</h2>
              <p className="text-sm text-accent-600 leading-relaxed">
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
              <p className="text-sm text-accent-600">
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
              <button onClick={() => void startTestGlobal(unitPreview.start.global, unitPreview.end.global)} disabled={loading || !unitPreviewValid || (recording && unitPreview.start.surah !== unitPreview.end.surah)}
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
              <p className="text-sm text-accent-600">
                سورة {surahName} فيها {surahCount.toLocaleString('ar-EG')} آية — النطاق المختار: {Math.max(1, Math.min(from, to, surahCount)).toLocaleString('ar-EG')} إلى {Math.min(Math.max(from, to), surahCount).toLocaleString('ar-EG')}
              </p>
              {error && <p className="text-sm text-red-600 font-semibold">{error}</p>}
              <button onClick={() => void startTest()} disabled={loading}
                className="w-full py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-lg font-bold rounded-xl shadow">
                {loading ? 'جارٍ تحميل الآيات…' : 'ابدأ التسميع'}
              </button>
              <p className="text-xs text-accent-600 leading-relaxed">
                {micSupported
                  ? 'الآية بتفضل مخفية. اضغط الميكروفون وسمّعها من حفظك: لو صحّت تنزل لك بالأخضر، ولو غلطت تاخد ' + corrDelay.toLocaleString('ar-EG') + ' ثواني تصلحها، وبعدها يظهر لك الجزء الغلط بالأحمر وينطقه لك البرنامج بصوت رجالي أو نسائي حسب حسابك. لو المتصفح مش بيدعم الميكروفون، هتقيّم نفسك يدوي زي قبل كده.'
                  : 'المتصفح ده مش بيدعم التسميع بالميكروفون — نص الآية لا يظهر إلا بعد أن تسمّعها وتضغط "أظهر الآية"، ثم تقيّم نفسك: صح أو خطأ.'}
              </p>
            </div>

            {/* Batch 2: lobby mic check — a real mic opens, samples,
            and closes BEFORE the session, so a dead mic or a denied
            permission is caught in the lobby instead of mid-test. */}
            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 space-y-3">
              <h2 className="font-bold text-accent-800">جرّب الميكروفون قبل ما تبدأ</h2>
              <p className="text-sm text-accent-600 leading-relaxed">
                اضغط الزر واتكلم بصوت عادي لمدة ثانيتين — الفحص بيفتح الميكروفون، يقيس صوتك، ويقفله تاني على طول، فمفيش ميكروفون بيفضل شغال، ومفيش أي تسجيل بيتحفظ أو بيترفع.
              </p>
              <button onClick={runMicCheck} disabled={micCheckState === 'checking'}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-lg font-bold rounded-xl shadow">
                {micCheckState === 'checking' ? 'جارٍ فحص الميكروفون…' : '🎤 جرّب الميكروفون'}
              </button>
              {micCheckState === 'checking' && (
                <div>
                  <p className="text-sm text-accent-600 mb-2">اتكلم بصوت عادي…</p>
                  <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, Math.round(micCheckLevel * 400))}%` }} />
                  </div>
                </div>
              )}
              {micCheckState === 'done' && micCheckResult && (
                micCheckResult.permission === 'granted' && micCheckResult.heardSomething ? (
                  <p className="text-sm font-bold text-emerald-700">تمام — الميكروفون شغال وسمعك (ده فحص الميكروفون بس، مش اختبار التعرف على الكلام). ابدأ التسميع وانت مطمن.</p>
                ) : micCheckResult.permission === 'granted' ? (
                  <p className="text-sm font-bold text-amber-700">الميكروفون مفتوح بس ما سمعش صوت — قرب من الجهاز أكتر أو علّي صوتك، واضغط تاني.</p>
                ) : micCheckResult.permission === 'denied' ? (
                  <p className="text-sm font-bold text-red-600">الميكروفون مقفول — اسمح بيه من إعدادات المتصفح أو إعدادات الجهاز، وبعدها اضغط تاني.</p>
                ) : (
                  <p className="text-sm font-bold text-red-600">ما قدرتش أفتح الميكروفون — جرّب من Safari على iPhone/iPad، أو قيّم نفسك يدوي.</p>
                )
              )}
            </div>

            {history.length > 0 && (
              <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5">
                <h2 className="font-bold text-accent-800 mb-3">نتائجك السابقة</h2>
                <ul className="space-y-2">
                  {history.slice(0, 5).map((h, i) => (
                    <li key={i} className="flex items-center justify-between text-sm gap-2">
                      <span className="text-accent-700">{h.endSurahName && h.endSurah !== h.surah ? <>من سورة {h.surahName} آية {formatAr(h.from)} إلى سورة {h.endSurahName} آية {formatAr(h.endAyah)}</> : <>سورة {h.surahName} — آيات {formatAr(h.from)} إلى {formatAr(h.to)}</>}</span>
                      <span className="font-bold text-emerald-700 whitespace-nowrap">{formatAr(h.correct)}/{formatAr(h.total)} ({h.total > 0 ? formatAr(Math.round((h.correct / h.total) * 100)) : formatAr(0)}٪)</span>
                      <span className="text-accent-400 whitespace-nowrap">{h.date}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {phase === 'testing' && textOfflineNotice && (
          <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">تعمل دون اتصال — نص الآيات من الذاكرة المحفوظة على جهازك</p>
        )}

        {phase === 'testing' && testMode === 'continuous' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm font-bold">
              <span className="text-accent-700">
                {rangeStart && rangeEnd ? (
                  rangeStart.surah === rangeEnd.surah
                    ? <>سورة {SURAHS.find((s) => s.no === rangeStart.surah)?.name || ''} — من آية {formatAr(rangeStart.ayah)} إلى آية {formatAr(rangeEnd.ayah)}</>
                    : <>من سورة {SURAHS.find((s) => s.no === rangeStart.surah)?.name || ''} آية {formatAr(rangeStart.ayah)} إلى سورة {SURAHS.find((s) => s.no === rangeEnd.surah)?.name || ''} آية {formatAr(rangeEnd.ayah)}</>
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
                  {contStalled && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                      <p className="text-base font-bold text-amber-800">
                        الاستماع وقف — لكن اللي سمعته محفوظ، كمّل من غير ما يضيع
                      </p>
                    </div>
                  )}
                  {contNoMatch && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                      <p className="text-base font-bold text-amber-800">
                        مش سامعك كويس — وقّفت التسميع مؤقتًا، واللي سمعته محفوظ. اضغط «كمّل التسميع المتصل» عشان تكمل من غير ما يضيع
                      </p>
                    </div>
                  )}
                  {/* Batch 1: after a watchdog pause the user could
                      not see what was heard (the raw line only
                      renders while listening). Show it here too. */}
                  {(transcript || interim) && (
                    <p className="text-sm text-accent-600 leading-relaxed mb-4" dir="rtl">
                      ما سمعه الجهاز حرفيًا (نص خام، مختصر للعرض): {heardCapped}
                    </p>
                  )}
                  <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Mic className="w-10 h-10 text-emerald-700" />
                  </div>
                  <p className="text-lg font-bold text-accent-700 leading-relaxed">
                    سمّع النطاق كله على بعضه من حفظك الآن
                  </p>
                  <p className="text-sm text-accent-600 mt-1">النص مخفي عمدًا — اضغط الميكروفون واقرأ من غير توقف، ولو خلصت اضغط "أنهيت التسميع"</p>
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
                  <p className="text-xs text-accent-500 mb-3">الاستماع المباشر محتاج إنترنت</p>
                  {ayahs[contProgress.ayahIdx] && (
                    <p className="text-sm font-bold text-emerald-700 mb-4">
                      الآن عند: سورة {SURAHS.find((s) => s.no === ayahs[contProgress.ayahIdx].surah_no)?.name || ''} — آية {ayahs[contProgress.ayahIdx].ayah_no}
                    </p>
                  )}
                  {contPrompting && (
                    <>
                      <p className="text-sm font-bold text-blue-700 mb-2">بصحح لك… اسمع الكلمة الصح، وبعدها كمّل — للتصحيح فقط</p>
                      {contLastPrompt.length > 0 && (
                        <p className="text-2xl font-bold text-blue-800 mb-4" dir="rtl">الصح: {contPromptHasContext && contLastPrompt.length > 0 ? (<><span className="opacity-50">{contLastPrompt[0]}</span>{' '}{contLastPrompt.slice(1).join(' ')}</>) : contLastPrompt.join(' ')}</p>
                      )}
                    </>
                  )}
                  {contAudioFailed && !contPrompting && contLastPrompt.length > 0 && (
                    <p className="text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-4">
                      التصحيح الصوتي ما كمّلش — الكلمة الصح قدامك: {contLastPrompt.join(' ')} — اضغط «أعد سماع التصحيح» عشان تحاول تاني
                    </p>
                  )}
                  {contLastPrompt.length > 0 && !contPrompting && (
                    <button onClick={() => speakContPrompt(contLastPrompt)}
                      className="mb-4 px-5 py-2.5 bg-white border border-blue-200 hover:bg-blue-50 text-blue-700 text-sm font-bold rounded-xl">
                      🔊 أعد سماع التصحيح: {contPromptHasContext && contLastPrompt.length > 0 ? (<><span className="opacity-50">{contLastPrompt[0]}</span>{' '}{contLastPrompt.slice(1).join(' ')}</>) : contLastPrompt.join(' ')}
                    </button>
                  )}
                  {(transcript || interim) && (
                    <p className="text-sm text-accent-600 leading-relaxed mb-4" dir="rtl">
                      ما سمعه الجهاز حرفيًا (نص خام، مختصر للعرض): {heardCapped}
                    </p>
                  )}
                  <div className="flex gap-3 justify-center">
                    <button onClick={finishContinuousPressed}
                      className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold rounded-xl shadow">
                      أنهيت التسميع
                    </button>
                    <button onClick={() => { diagPush('tap', { label: 'stop-cont' }); stopContinuousMic(); }}
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
            <p className="text-xs text-accent-500 text-center">{stampLine} • النص الخام أعلاه كما سمعه الجهاز حرفيًا</p>
            <button onClick={() => { diagPush('tap', { label: 'stop-to-setup' }); stopContinuousMic(); setPhase('setup'); }}
              className="block mx-auto text-sm font-bold text-accent-600 hover:text-accent-700 underline">
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
                      {micAbsentMessage(' — قيّم نفسك يدوي:')}
                    </p>
                  )}
                  {!revealed ? (
                    <>
                      <Eye className="w-10 h-10 text-emerald-300 mx-auto mb-3" />
                      <p className="text-lg font-bold text-accent-700 leading-relaxed">
                        سمّع الآية {ayahs[index].ayah_no} من حفظك الآن
                      </p>
                      <p className="text-sm text-accent-600 mt-1">النص مخفي عمدًا — عندما تنتهي اضغط الزر</p>
                      <button onClick={() => setRevealed(true)}
                        className="mt-5 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white text-lg font-bold rounded-xl shadow">
                        أظهر الآية
                      </button>
                      {micSupported && (
                        <button onClick={() => { manualPreferredRef.current = false; setManualMode(false); }}
                          className="mt-3 block mx-auto text-sm font-bold text-accent-600 hover:text-accent-700 underline">
                          أو سمّع بالميكروفون بدل كده
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-2xl leading-[2.2] font-bold text-accent-800" dir="rtl">{ayahs[index].ayah_text}</p>
                      <p className="text-sm text-accent-600 mt-4">طابق ما سمّعته بالنص — ثم قيّم نفسك بصدق:</p>
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
                  <p className="text-sm text-accent-600 mb-4">الآية كاملة، والكلمات اللي غلطت فيها أو نسيتها بالأحمر — وهتلاقي الآية في قائمة المراجعة آخر التسميع:</p>
                  <p className="text-2xl leading-[2.2] font-bold" dir="rtl">
                    {expectedWordList(ayahs[index].ayah_text).map((w, i) => (
                      <span key={i} className={wrongIndices.includes(i) ? 'text-red-600 tasmii-flash' : 'text-accent-800'}>{w.orig} </span>
                    ))}
                  </p>
                  {wrongExtras.length > 0 && (
                    <p className="text-sm text-amber-700 mt-3">كلمات زائدة سمعتها: {wrongExtras.join(' ')}</p>
                  )}
                  {(wrongByAyah[index]?.length ?? 0) > 0 && (
                    <button onClick={() => replayAyahCorrection()}
                      className="mt-3 px-5 py-2.5 bg-white border border-red-200 hover:bg-red-50 text-red-700 text-sm font-bold rounded-xl">
                      🔊 أعد سماع التصحيح
                    </button>
                  )}
                  {/* Reference unit (Surah 67 pilot + Juz-30 manifest_ok
                      ayahs, "(تجربة)" label kept): play the reference
                      3-word unit containing the first wrong word,
                      alongside — never instead of — the current
                      correction above. */}
                  {ayahs[index] && isRefUnitEnabled(ayahs[index].surah_no, ayahs[index].ayah_no) && wrongIndices.length > 0 && (
                    <button onClick={() => playRefUnit()}
                      className="mt-3 mr-2 px-5 py-2.5 bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-800 text-sm font-bold rounded-xl">
                      {refUnitPlaying ? 'جارٍ تشغيل الوحدة…' : '🔊 اسمع الوحدة المرجعية (تجربة)'}
                    </button>
                  )}
                  {refUnitFailedIdx === index && (
                    <p className="text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mt-3">
                      تعذر تشغيل الوحدة المرجعية — استخدم «أعد سماع التصحيح»
                    </p>
                  )}
                  {ayahAudioFailed && (wrongByAyah[index]?.length ?? 0) > 0 && (
                    <p className="text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mt-3">
                      التصحيح الصوتي ما اشتغلش — الكلمات الصح بالأحمر قدامك، واضغط «أعد سماع التصحيح» عشان تحاول تاني
                    </p>
                  )}
                  {/* Batch 1: re-recite the same ayah in place. goToAyah
                      resets the mic state; a fresh pass overwrites
                      the grade (and the wrong words) for this ayah. */}
                  <button onClick={() => { stopRefUnit(); goToAyah(index); }}
                    className="mt-5 ml-2 px-6 py-3 bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-700 text-lg font-bold rounded-xl shadow">
                    🔁 سمّع الآية دي تاني
                  </button>
                  <button onClick={nextAfterMic}
                    className="mt-5 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-bold rounded-xl shadow">
                    {index + 1 < ayahs.length ? 'الآية اللي بعدها' : 'إنهاء التسميع'}
                  </button>
                </>
              ) : (
                <>
                  {micState === 'idle' && (
                    <>
                      {micStalled && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                          <p className="text-base font-bold text-amber-800">
                            الاستماع وقف — لكن اللي سمعته محفوظ ومش هيضيع
                          </p>
                          {transcript && (
                            <p className="text-sm text-accent-500 leading-relaxed mt-1" dir="rtl">
                              ما سمعه الجهاز حرفيًا (نص خام، مختصر للعرض): {heardCapped}
                            </p>
                          )}
                          <div className="flex gap-2 justify-center mt-3">
                            <button onClick={resumeMic}
                              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold rounded-xl shadow">
                              كمّل
                            </button>
                            {spokenTokens(liveRef.current.finals).length > 0 && (
                              <button onClick={evaluateStalled}
                                className="px-5 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-accent-700 text-base font-bold rounded-xl">
                                قيّم اللي اتسمع
                              </button>
                            )}
                            <button onClick={() => startMic()}
                              className="px-5 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-accent-700 text-base font-bold rounded-xl">
                              ابدأ من جديد
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Mic className="w-10 h-10 text-emerald-700" />
                      </div>
                      <p className="text-lg font-bold text-accent-700 leading-relaxed">
                        سمّع الآية {ayahs[index].ayah_no} من حفظك الآن
                      </p>
                      <p className="text-sm text-accent-600 mt-1">النص مخفي عمدًا — اضغط الميكروفون واقرأ بصوتك</p>
                      <button onClick={() => startMic()}
                        className="mt-5 px-8 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-bold rounded-xl shadow flex items-center justify-center gap-2 mx-auto">
                        <Mic className="w-6 h-6" /> سمّع الآية بصوتك
                      </button>
                      <button onClick={() => { manualPreferredRef.current = true; setManualMode(true); }}
                        className="mt-3 text-sm font-bold text-accent-600 hover:text-accent-700 underline">
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
                      {/* Batch 1 live progress dots: one dot per word
                          of the current ayah — green when the live
                          alignment matched it, amber pulsing on the
                          first unmatched word, gray otherwise. Counts
                          only: no word is ever shown, so the hidden
                          text stays hidden. Indicative, not grading
                          (grading still uses finals at evaluation). */}
                      {ayahs[index] && (() => {
                        const exp = expectedWordList(ayahs[index].ayah_text);
                        const spokenLive = spokenTokens(`${transcript} ${interim}`.trim());
                        const al = alignWords(exp.map((w) => w.norm), spokenLive);
                        const firstOpen = al.matched.findIndex((v) => !v);
                        return (
                          <div className="flex gap-1.5 justify-center mb-4" dir="rtl" aria-hidden>
                            {exp.map((_, i) => (
                              <span key={i} className={`w-2.5 h-2.5 rounded-full ${al.matched[i] ? 'bg-emerald-500' : i === firstOpen ? 'bg-amber-400 animate-pulse' : 'bg-gray-300'}`} />
                            ))}
                          </div>
                        );
                      })()}
                      <p className="text-xs text-accent-500 mb-3">الاستماع المباشر محتاج إنترنت</p>
                      {micState === 'correcting' && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                          <p className="text-base font-bold text-amber-800">
                            في حاجة محتاجة تتصلح — كمّل أو صلّح، عندك {countdown.toLocaleString('ar-EG')} ثواني
                          </p>
                          <button onClick={() => showMistakeNow()}
                            className="mt-1 text-sm font-bold text-amber-700 underline">
                            خلاص، وريني الغلط
                          </button>
                        </div>
                      )}
                      {(transcript || interim) && (
                        <p className="text-sm text-accent-600 leading-relaxed mb-4" dir="rtl">
                          ما سمعه الجهاز حرفيًا (نص خام، مختصر للعرض): {heardCapped}
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
                    <button onClick={() => { diagPush('tap', { label: 'manual-mode' }); stopRec(); clearTimers(); manualPreferredRef.current = true; setManualMode(true); }}
                      className="mt-2 text-sm font-bold text-accent-600 underline">
                      قيّم يدوي بدل كده
                    </button>
                  )}
                </>
              )}
            </div>

            <p className="text-xs text-accent-500 text-center">{stampLine} • النص الخام أعلاه كما سمعه الجهاز حرفيًا</p>
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
            <p className="text-center text-sm text-accent-600">النتيجة حتى الآن: {correct} صح من {index + (currentDone ? 1 : 0)} آية</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-5">
            {contZeroMatch && testMode === 'continuous' && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                <p className="font-bold text-amber-800">لم يُطابق الجهاز أي كلمة — هذه ليست نتيجة ٠٪</p>
                <p className="text-sm text-accent-700 leading-relaxed mt-2">
                  سمعت {contHeardWords.toLocaleString('ar-EG')} كلمة، وطابقت {contMatchedWords.toLocaleString('ar-EG')} كلمة. عندما لا يطابق الجهاز أي كلمة، لا نعرض قائمة "آيات تحتاج مراجعة" ولا نسجل النتيجة في السجل، لأنها ستكون مضللة: المشكلة غالبًا في ما سمعه الجهاز أو في الميكروفون، وليست في حفظك. تأكد من الميكروفون، ثم أعد التسميع. النص الخام أدناه هو ما سمعه الجهاز حرفيًا — صوّره مع رقم النسخة إن تكرر الأمر.
                </p>
                <p className="text-sm text-accent-600 leading-relaxed mt-2" dir="rtl">
                  ما سمعه الجهاز حرفيًا (نص خام، مختصر للعرض): {heardCapped || '— لا يوجد نص مسموع —'}
                </p>
                {fullHeardToggle}
                {fullHeardContent}
                <p className="text-xs text-accent-500 mt-2">{stampLine}</p>
              </div>
            )}
            {!contZeroMatch && (
            <div className="bg-gradient-to-l from-emerald-600 to-teal-700 rounded-2xl p-6 shadow-lg text-white text-center">
              <Award className="w-12 h-12 mx-auto mb-2 text-amber-200" />
              <p className="text-2xl font-bold">نتيجتك: {correct} من {attempted} ({pct}٪)</p>
              <p className="text-emerald-50 mt-2 leading-relaxed">
                {pct >= 90 ? 'ما شاء الله — حفظ متقن، ثبّت الله ما حفظت' : pct >= 60 ? 'تقدّم طيب — راجع الآيات التي أخطأت فيها ثم أعد التسميع' : 'لا بأس — التعثر أول طريق الإتقان، راجع الآيات ثم أعد المحاولة'}
              </p>
              {skippedCount > 0 && (
                <p className="text-emerald-50/90 text-sm mt-1">تخطيت {skippedCount.toLocaleString('ar-EG')} آية — مش محسوبة في النتيجة</p>
              )}
            </div>)}
            {!contZeroMatch && testMode === 'continuous' && (
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                <p className="text-sm text-accent-600 leading-relaxed" dir="rtl">
                  سمعت {contHeardWords.toLocaleString('ar-EG')} كلمة، وطابقت {contMatchedWords.toLocaleString('ar-EG')} كلمة • النص الخام (مختصر للعرض): {heardCapped || '—'}
                </p>
                {fullHeardToggle}
                {fullHeardContent}
              </div>
            )}

            {!contZeroMatch && missed.length > 0 && (
              <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-5">
                <h2 className="font-bold text-accent-800 mb-3">آيات تحتاج مراجعة ({missed.length})</h2>
                <ul className="space-y-2">
                  {ayahs.map((a, i) => (!grades[i] && !skipped[i] ? (
                    <li key={a.id} className="text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-accent-700">سورة {SURAHS.find((s) => s.no === a.surah_no)?.name || ''} — آية {a.ayah_no}</span>
                        <div className="flex gap-2">
                          {/* Batch 1: fresh single-ayah session for
                              this ayah. It does NOT rewrite the
                              finished score above — it is practice
                              for the weak ayah. */}
                          <button onClick={() => { void startTest(a.surah_no, a.ayah_no, a.ayah_no, null, 'ayah'); }}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg">
                            🔁 سمّعها تاني
                          </button>
                          <button onClick={() => openInMushaf(a.surah_no, a.ayah_no)}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm font-bold text-emerald-700 bg-emerald-50 rounded-lg">
                            <BookOpen className="w-4 h-4" /> افتح في المصحف
                          </button>
                        </div>
                      </div>
                      {wrongByAyah[i]?.length ? <p className="text-red-600 text-lg mt-1 font-arabic leading-relaxed" dir="rtl">الكلمات الغلط: {wrongByAyah[i].map((w, wi) => (<span key={wi}>{w} </span>))}</p> : null}
                      {extraByAyah[i]?.length ? <p className="text-amber-700 text-xs mt-1" dir="rtl">كلمات زائدة: {extraByAyah[i].join(' ')}</p> : null}
                    </li>
                  ) : null))}
                </ul>
              </div>
            )}

            {!contZeroMatch && contExtras.length > 0 && testMode === 'continuous' && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 leading-relaxed" dir="rtl">
                كلمات زائدة سمعتها أثناء التسميع المتصل: {contExtras.join(' ')}
              </p>
            )}

            {!contZeroMatch && (
              <p className="text-xs text-accent-500 text-center">{stampLine}</p>
            )}
            {/* DIAG (Claude P0-5): collapsible event log + Copy JSON.
                Renders on every done screen (both modes, zero-match
                or scored) so a failed run always has an exportable
                record — screenshots are no longer the only evidence. */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold text-accent-800">سجل التشخيص</h2>
                <button type="button" onClick={() => { setDiagOpen((v) => !v); diagPermRefresh(); }} className="px-3 py-1.5 text-sm font-bold text-emerald-700 bg-emerald-50 rounded-lg">
                  {diagOpen ? 'إخفاء السجل' : `عرض السجل (${diagEventsRef.current.length})`}
                </button>
              </div>
              <p className="text-xs text-accent-600 mt-2 leading-relaxed" dir="rtl">
                يسجل كل أحداث الميكروفون والصوت بالأوقات — انسخه وأرسله مع أي بلاغ عن مشكلة، بدل لقطة الشاشة.
              </p>
              {diagOpen && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-accent-600" dir="rtl">{stampLine} • إذن الميكروفون: {micPerm}</p>
                  <div className="max-h-64 overflow-y-auto bg-stone-50 border border-gray-200 rounded-xl p-3 space-y-1" dir="ltr">
                    {diagEventsRef.current.slice(-DIAG_DISPLAY_CAP).map((ev, i) => (
                      <p key={i} className="text-xs text-accent-700 break-words">
                        <span className="text-accent-400">{ev.rel}ms</span> <span className="font-bold">{ev.k}</span>
                        {ev.label ? ` ${ev.label}` : ''}{ev.code ? ` (${ev.code})` : ''}{ev.final !== undefined ? (ev.final ? ' final' : ' interim') : ''}{ev.text ? `: ${ev.text}` : ''}
                      </p>
                    ))}
                    {diagEventsRef.current.length === 0 && <p className="text-xs text-accent-500">لا توجد أحداث مسجلة.</p>}
                  </div>
                  {diagTruncatedRef.current && <p className="text-xs text-amber-700" dir="rtl">السجل تجاوز 2000 حدث — الأقدم حُذف من الأحداث (قائمة النهائيات كاملة في JSON).</p>}
                  {diagEventsRef.current.length > DIAG_DISPLAY_CAP && <p className="text-xs text-accent-500" dir="rtl">معروض آخر 500 حدث فقط — باقي الأحداث في JSON.</p>}
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void diagCopyJson()} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl">نسخ JSON التشخيصي</button>
                    {diagCopied && <span className="text-xs text-emerald-700">{diagCopied}</span>}
                  </div>
                </div>
              )}
            </div>
            {recSessionRef.current?.recording && (
              <div className="bg-white border border-amber-200 rounded-2xl shadow-sm p-5 space-y-4">
                <h2 className="font-bold text-accent-800">تسجيل حالة اختبار</h2>
                <p className="text-sm text-accent-600 leading-relaxed">هذا الاختبار سُجّل لمدونة الاختبار. صنّف كل آية، ثم أكّد الموافقة وصدّر الحالة.</p>
                {(() => {
                  const preview = recBuildPreview();
                  const sess = recSessionRef.current!;
                  const plannedFor = (surah: number, ayah: number) => sess.plan.filter((p) => p.surah === surah && p.ayah === ayah);
                  const entriesOf = (key: string): ActualEntry[] => recActual[key]?.entries || [];
                  const derived = (key: string): string => {
                    const entries = entriesOf(key);
                    if (entries.length === 0) return 'correct';
                    const kinds = new Set(entries.map((e) => e.kind));
                    if (kinds.size > 1) return 'mixed';
                    return entries[0].kind;
                  };
                  const setStatus = (key: string, surah: number, ayah: number, st: string) => {
                    if (st === 'mixed') return;
                    setRecActual((prev) => {
                      const cur = prev[key];
                      const kinds = cur ? new Set(cur.entries.map((e) => e.kind)) : new Set<string>();
                      if (st === 'correct') return { ...prev, [key]: { entries: [] } };
                      if (st === 'planted') {
                        if (kinds.size > 0 && [...kinds].every((k) => k === 'planted')) return prev;
                        return { ...prev, [key]: { entries: plannedFor(surah, ayah).map((p) => ({ kind: 'planted' as const, spoken: p.spoken, expectedWord: p.expectedWord, type: p.type, executed: false })) } };
                      }
                      if (kinds.size > 0 && [...kinds].every((k) => k === st)) return prev;
                      return { ...prev, [key]: { entries: [] } };
                    });
                  };
                  const toggleExecuted = (key: string, idx: number) => {
                    setRecActual((prev) => {
                      const a = prev[key]; if (!a) return prev;
                      return { ...prev, [key]: { entries: a.entries.map((e, i) => (i === idx ? { ...e, executed: !e.executed } : e)) } };
                    });
                  };
                  const removeEntry = (key: string, idx: number) => {
                    setRecActual((prev) => {
                      const a = prev[key]; if (!a) return prev;
                      return { ...prev, [key]: { entries: a.entries.filter((_, i) => i !== idx) } };
                    });
                  };
                  const addUnintended = (key: string) => {
                    const d = unDraft[key] || { spoken: '', expected: '', type: 'substitution' as FixedTaxonomy, free: '' };
                    if (!d.spoken.trim() || !d.expected.trim()) return;
                    setRecActual((prev) => ({ ...prev, [key]: { entries: [...(prev[key]?.entries || []), { kind: 'unintended' as const, spoken: d.spoken.trim(), expectedWord: d.expected.trim(), type: d.type, free: d.free.trim() || undefined }] } }));
                    setUnDraft((prev) => ({ ...prev, [key]: { ...d, spoken: '', expected: '', free: '' } }));
                  };
                  const addSelfCorrected = (key: string) => {
                    const w = (scDraft[key] || '').trim();
                    if (!w) return;
                    setRecActual((prev) => ({ ...prev, [key]: { entries: [...(prev[key]?.entries || []), { kind: 'self-corrected' as const, spoken: w, expectedWord: w }] } }));
                    setScDraft((prev) => ({ ...prev, [key]: '' }));
                  };
                  const allCorrect = () => {
                    setRecActual((prev) => {
                      const next = { ...prev };
                      for (const a of ayahs) {
                        const key = `${a.surah_no}:${a.ayah_no}`;
                        if (plannedFor(a.surah_no, a.ayah_no).length === 0) next[key] = { entries: [] };
                      }
                      return next;
                    });
                  };
                  return (
                    <>
                      {ayahs.map((a) => {
                        const key = `${a.surah_no}:${a.ayah_no}`;
                        const planned = plannedFor(a.surah_no, a.ayah_no);
                        const st = derived(key);
                        return (
                          <div key={a.id} className="border border-gray-200 rounded-xl p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-bold text-accent-800">سورة {SURAHS.find((s) => s.no === a.surah_no)?.name || ''} — آية {a.ayah_no}</span>
                              <select value={st} onChange={(e) => setStatus(key, a.surah_no, a.ayah_no, e.target.value)}
                                className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
                                <option value="correct">صحيح</option>
                                <option value="planted">خطأ مزروع (مخطط)</option>
                                <option value="unintended">أخطأت دون قصد</option>
                                <option value="self-corrected">تعثر ثم صححت نفسي</option>
                                <option value="mixed">مختلط (مدخلات متعددة)</option>
                              </select>
                            </div>
                            {st === 'planted' && (planned.length === 0 ? (
                              <p className="text-sm text-amber-700">لا توجد خطة لهذه الآية — إن زرعت خطأً غير مخطط، اختر «أخطأت دون قصد».</p>
                            ) : (
                              <div className="space-y-1">
                                {planned.map((p, pi) => {
                                  const entry = entriesOf(key).find((e) => e.kind === 'planted' && e.spoken === p.spoken && e.expectedWord === p.expectedWord);
                                  const idx = entry ? entriesOf(key).indexOf(entry) : -1;
                                  return (
                                    <label key={pi} className="flex items-center gap-2 text-sm text-accent-700">
                                      <input type="checkbox" checked={!!entry?.executed} onChange={() => { if (idx >= 0) toggleExecuted(key, idx); }} className="w-4 h-4 accent-emerald-600" />
                                      <span dir="rtl">نفذتها: قلت «{p.spoken}» بدل «{p.expectedWord}» ({TAXONOMY_LABELS[p.type]})</span>
                                    </label>
                                  );
                                })}
                              </div>
                            ))}
                            {st === 'unintended' && (
                              <div className="space-y-2">
                                {entriesOf(key).filter((e) => e.kind === 'unintended').map((e) => {
                                  const idx = entriesOf(key).indexOf(e);
                                  return (
                                    <div key={idx} className="flex items-center gap-2 text-sm">
                                      <span className="flex-1 text-accent-700" dir="rtl">قلت «{e.spoken}» بدل «{e.expectedWord}» ({e.type ? TAXONOMY_LABELS[e.type] : ''}){e.free ? ` — ${e.free}` : ''}</span>
                                      <button onClick={() => removeEntry(key, idx)} className="px-3 py-1 text-sm font-bold text-red-700 bg-red-50 rounded-lg">حذف</button>
                                    </div>
                                  );
                                })}
                                <div className="grid grid-cols-2 gap-2">
                                  <input placeholder="قلت (خطأً)" value={(unDraft[key]?.spoken) || ''} onChange={(e) => setUnDraft((prev) => ({ ...prev, [key]: { ...(prev[key] || { spoken: '', expected: '', type: 'substitution' as FixedTaxonomy, free: '' }), spoken: e.target.value } }))} className="px-3 py-2 rounded-xl border border-gray-200 text-sm" dir="rtl" />
                                  <input placeholder="بدل كلمة" value={(unDraft[key]?.expected) || ''} onChange={(e) => setUnDraft((prev) => ({ ...prev, [key]: { ...(prev[key] || { spoken: '', expected: '', type: 'substitution' as FixedTaxonomy, free: '' }), expected: e.target.value } }))} className="px-3 py-2 rounded-xl border border-gray-200 text-sm" dir="rtl" />
                                  <select value={(unDraft[key]?.type) || 'substitution'} onChange={(e) => setUnDraft((prev) => ({ ...prev, [key]: { ...(prev[key] || { spoken: '', expected: '', type: 'substitution' as FixedTaxonomy, free: '' }), type: e.target.value as FixedTaxonomy } }))} className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
                                    {TAXONOMY_VALUES.map((t) => (<option key={t} value={t}>{TAXONOMY_LABELS[t]}</option>))}
                                  </select>
                                  <input placeholder="تفاصيل اختيارية" value={(unDraft[key]?.free) || ''} onChange={(e) => setUnDraft((prev) => ({ ...prev, [key]: { ...(prev[key] || { spoken: '', expected: '', type: 'substitution' as FixedTaxonomy, free: '' }), free: e.target.value } }))} className="px-3 py-2 rounded-xl border border-gray-200 text-sm" dir="rtl" />
                                </div>
                                <button onClick={() => addUnintended(key)} className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-xl">إضافة خطأ غير مقصود</button>
                              </div>
                            )}
                            {st === 'self-corrected' && (
                              <div className="space-y-2">
                                {entriesOf(key).filter((e) => e.kind === 'self-corrected').map((e) => {
                                  const idx = entriesOf(key).indexOf(e);
                                  return (
                                    <div key={idx} className="flex items-center gap-2 text-sm">
                                      <span className="flex-1 text-accent-700" dir="rtl">تعثرت في «{e.spoken}» ثم صححتها لنفسي</span>
                                      <button onClick={() => removeEntry(key, idx)} className="px-3 py-1 text-sm font-bold text-red-700 bg-red-50 rounded-lg">حذف</button>
                                    </div>
                                  );
                                })}
                                <div className="flex gap-2">
                                  <input placeholder="الكلمة التي تعثرت فيها" value={scDraft[key] || ''} onChange={(e) => setScDraft((prev) => ({ ...prev, [key]: e.target.value }))} className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm" dir="rtl" />
                                  <button onClick={() => addSelfCorrected(key)} className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-xl">إضافة</button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <button onClick={allCorrect} className="px-4 py-2 bg-white border border-gray-200 text-accent-700 text-sm font-bold rounded-xl">كلها صحيحة (ما عدا الآيات ذات الخطة)</button>
                      {preview.status === 'complete' ? (
                        <p className="text-sm font-bold text-emerald-700">الحالة مكتملة — جاهزة للمدونة.</p>
                      ) : (
                        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                          <p className="font-bold">الحالة جزئية (لن تُحسب في التقرير):</p>
                          <ul className="list-disc pr-5 mt-1 space-y-1">
                            {preview.reasons.map((r, i) => (<li key={i}>{r}</li>))}
                          </ul>
                        </div>
                      )}
                      <label className="flex items-start gap-2 text-sm text-accent-700">
                        <input type="checkbox" checked={recConsent} onChange={(e) => setRecConsent(e.target.checked)} className="w-5 h-5 accent-emerald-600 mt-0.5" />
                        <span>أوافق على حفظ نص هذا التسميع كحالة اختبار في المدونة.</span>
                      </label>
                      <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 leading-relaxed">تحذير خصوصية: نصوص التسميع بيانات صوتية. لا يُرفع أي شيء تلقائيًا — هذه الحالة لا تغادر جهازك إلا إذا نسختها ولصقتها بنفسك. إن كان الصوت لطفل أو لشخص آخر، لا تصدّره إلا بإذنه الصريح. وإن أُضيف الصوت الخام لاحقًا، فسيبقى على الجهاز ويُحذف مع الحالة ولا يُرفع أبدًا دون إذن صريح.</p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => void recCaseCopyJson()} disabled={!recConsent} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl">تصدير حالة الاختبار (JSON)</button>
                        {recCaseCopied && <span className="text-xs text-emerald-700">{recCaseCopied}</span>}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setContZeroMatch(false); setShowFullHeard(false); setRecPlan([]); setRecActual({}); setRecConsent(false); setRecCaseCopied(''); setPhase('setup'); }}
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
