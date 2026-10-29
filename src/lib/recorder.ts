// recorder.ts — Phase 0 test-case recorder: pure case assembly + report math.
//
// Dependency-free and DOM-free (no imports, no clock reads): the
// component supplies every input (build stamp, UA-derived iOS
// version, session wall-clock reference, word counts, orig word
// lists, diag events). Node can transpile + test this file directly,
// and the corpus runner loads it the same way — one source of truth
// for case assembly and report aggregation, never a mirror.
//
// DESIGN (recorder-design.md + binding Revision 1):
// - Plan BEFORE the test (what will be planted, and where); the
//   done screen confirms what was actually executed. plan and
//   actual are separate fields — this catches unintended errors.
// - Fixed error taxonomy is MANDATORY; free-form is OPTIONAL.
// - Self-correction (`تعثر ثم تصحيح ذاتي`) is a first-class
//   actual kind: the word ended correct, so it is never an FN,
//   and an interrupt on it counts as a false interrupt.
// - Consent is explicit: export is blocked until the tester checks
//   it, and a case without consent is partial, never complete.
// - Default behavior DROPS anything outside the test range.
// - Audio stays null in v1 WITH the reason recorded (see schema.md):
//   the scorer consumes transcripts; audio is a parallel Phase 3
//   experiment, not a v1 condition. Audio, if ever added, stays
//   on-device, is deleted with its case, and is never uploaded
//   without explicit consent. Transcripts today follow the same
//   rule: no auto-upload anywhere; the user pastes the export.

export type FixedTaxonomy =
  | 'substitution'
  | 'deletion'
  | 'addition'
  | 'order-swap'
  | 'repetition'
  | 'stop-and-restart';

export const TAXONOMY_LABELS: Record<FixedTaxonomy, string> = {
  substitution: 'استبدال',
  deletion: 'حذف',
  addition: 'زيادة',
  'order-swap': 'تبديل ترتيب',
  repetition: 'تكرار',
  'stop-and-restart': 'وقف وبدء',
};

export const TAXONOMY_VALUES: FixedTaxonomy[] = [
  'substitution',
  'deletion',
  'addition',
  'order-swap',
  'repetition',
  'stop-and-restart',
];

export function isFixedTaxonomy(v: unknown): v is FixedTaxonomy {
  return typeof v === 'string' && (TAXONOMY_VALUES as string[]).includes(v);
}

export interface PlanEntry {
  surah: number;
  ayah: number;
  spoken: string;
  expectedWord: string;
  type: FixedTaxonomy;
}

export type ActualKind = 'planted' | 'unintended' | 'self-corrected';

export interface ActualEntry {
  kind: ActualKind;
  spoken: string;
  expectedWord: string;
  /** Fixed type for planted/unintended; absent for self-corrected. */
  type?: FixedTaxonomy;
  /** Free-form detail (optional, never a substitute for type). */
  free?: string;
  /** Planted only: did the tester actually execute this plan entry? */
  executed?: boolean;
}

export interface ActualAyah {
  entries: ActualEntry[];
}

/** Derived status of one ayah's actual record. */
export function actualStatus(a: ActualAyah | undefined): 'correct' | 'planted' | 'unintended' | 'self-corrected' | 'mixed' | 'unclassified' {
  if (!a) return 'unclassified';
  if (a.entries.length === 0) return 'correct';
  const kinds = new Set(a.entries.map((e) => e.kind));
  if (kinds.size > 1) return 'mixed';
  return kinds.has('planted') ? 'planted' : kinds.has('unintended') ? 'unintended' : 'self-corrected';
}

export interface VoiceTags {
  dialect: string;
  gender: string;
  pace: 'slow' | 'normal' | 'fast' | '';
  noise: 'low' | 'medium' | '';
}

export function tagsComplete(t: VoiceTags | null | undefined): boolean {
  if (!t) return false;
  return (
    typeof t.dialect === 'string' && t.dialect.length > 0 &&
    typeof t.gender === 'string' && t.gender.length > 0 &&
    (t.pace === 'slow' || t.pace === 'normal' || t.pace === 'fast') &&
    (t.noise === 'low' || t.noise === 'medium')
  );
}

export type PromptTrigger = 'confirmed-miss' | 'overshoot' | 'stall' | 'ayah-mode';

export interface RecorderEvent {
  k: 'prompt' | 'interrupt';
  words: string[];
  /** Continuous: GLOBAL indices into the range's expected list.
      Ayah-mode: LOCAL indices within the ayah. */
  indices: number[];
  trigger: PromptTrigger;
  /** Performance.now() ms offset from test start. */
  rel: number;
  /** Ayah-mode only: position index into the range's ayah list. */
  ayah?: number;
}

export interface CaseAyahInput {
  surah: number;
  ayah: number;
  text: string;
  /** Orig word forms from expectedWordList, in order. */
  orig: string[];
}

export interface CaseInput {
  build: string;
  shell: string;
  ua: string;
  iosVersion: string | null;
  /** ONE wall-clock reference per session (Date.now() at test start). */
  sessionWall: number;
  settings: { level: string; mode: string; corrDelay: number; corrRate: string };
  range: { surah: number; from: number; to: number; startGlobal: number; endGlobal: number; endSurah?: number };
  ayahs: CaseAyahInput[];
  grades: boolean[];
  wrongByAyah: Record<number, string[]>;
  skipped: boolean[];
  /** Ayah mode: transcript per "surah:ayah". Continuous: null. */
  finalsByAyah: Record<string, string> | null;
  /** Continuous mode: joined finals string. Ayah mode: null. */
  finalsJoined: string | null;
  events: RecorderEvent[];
  plan: PlanEntry[];
  actual: Record<string, ActualAyah>;
  consent: boolean;
  voiceTags: VoiceTags;
  zeroMatch: boolean;
  /** True when the diag event log hit its cap (early events lost). */
  eventsTruncated: boolean;
}

export interface BuiltCase {
  cases: Record<string, unknown>[];
  status: 'complete' | 'partial';
  reasons: string[];
  droppedOutOfRange: number;
}

const ayahKey = (surah: number, ayah: number): string => `${surah}:${ayah}`;

/** Map a GLOBAL index into the range's expected list to (ayah position, local index). */
export function globalToAyah(globalIdx: number, offsets: number[], counts: number[]): { ayahPos: number; local: number } | null {
  for (let i = 0; i < counts.length; i++) {
    const start = offsets[i];
    const end = start + counts[i];
    if (globalIdx >= start && globalIdx < end) return { ayahPos: i, local: globalIdx - start };
  }
  return null;
}

/** Parse an iOS version from a UA string ("OS 17_4" etc). Null when not iOS / unparseable. */
export function parseIosVersion(ua: string): string | null {
  if (typeof ua !== 'string') return null;
  const m = ua.match(/OS (\d+_\d+(?:_\d+)?)/);
  if (!m) return null;
  return m[1].replace(/_/g, '.');
}

/** Muqatta'at opening test on a normalized, space-free string. */
export function isMuqattaatText(noSpaces: string): boolean {
  if (typeof noSpaces !== 'string' || noSpaces.length === 0 || noSpaces.length > 14) return false;
  return /^[المصركهيعطحسقن]+$/.test(noSpaces);
}

export function ayahLengthBucket(wordCount: number): 'short' | 'medium' | 'long' {
  if (wordCount < 10) return 'short';
  if (wordCount <= 30) return 'medium';
  return 'long';
}

/** Case id: recorder date+time + range. Unique per session in practice;
    the corpus runner rejects duplicates loudly if two collide. */
export function caseIdFor(sessionWall: number, surah: number, from: number, to: number): string {
  const d = new Date(sessionWall);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `rec-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${surah}-${from}-${to}`;
}

interface SplitPrompt {
  ayahPos: number;
  words: string[];
  indices: number[];
}

/**
 * Split one recorded prompt event into per-ayah prompt entries.
 * Continuous indices are global; a prompt may span an ayah boundary,
 * so indices are grouped by ayah. When words outnumber indices by
 * exactly one, words[0] is the context word: it attaches to the first
 * fix word's ayah (withPrecedingContextWord never emits a context
 * word for an ayah-initial fix, so the context word is always in the
 * same ayah as indices[0]).
 */
export function splitPromptEvent(ev: RecorderEvent, offsets: number[], counts: number[], mode: string): SplitPrompt[] {
  if (mode === 'ayah') {
    const ayahPos = typeof ev.ayah === 'number' ? ev.ayah : 0;
    return [{ ayahPos, words: ev.words, indices: ev.indices }];
  }
  const hasContext = ev.words.length === ev.indices.length + 1;
  const fixWords = hasContext ? ev.words.slice(1) : ev.words;
  const groups = new Map<number, { words: string[]; indices: number[] }>();
  ev.indices.forEach((g, k) => {
    const m = globalToAyah(g, offsets, counts);
    if (!m) return;
    let grp = groups.get(m.ayahPos);
    if (!grp) { grp = { words: [], indices: [] }; groups.set(m.ayahPos, grp); }
    grp.words.push(fixWords[k] ?? '');
    grp.indices.push(m.local);
  });
  const out: SplitPrompt[] = [];
  groups.forEach((grp, ayahPos) => {
    const words = [...grp.words];
    if (hasContext && ayahPos === (globalToAyah(ev.indices[0], offsets, counts)?.ayahPos ?? -1)) words.unshift(ev.words[0]);
    out.push({ ayahPos, words, indices: grp.indices });
  });
  out.sort((a, b) => a.ayahPos - b.ayahPos);
  return out;
}

function coverageForAyah(
  prompts: { words: string[]; indices: number[] }[],
  interrupts: { indices: number[] }[],
  orig: string[],
): (word: string) => boolean {
  return (word: string) => {
    if (prompts.some((p) => p.words.includes(word))) return true;
    return interrupts.some((x) => x.indices.some((l) => orig[l] === word));
  };
}

/**
 * Assemble a schema-v1 case (+ recorder block) from a recorded test.
 * Never throws: every anomaly becomes a partial reason instead.
 */
export function buildCase(input: CaseInput): BuiltCase {
  const reasons: string[] = [];
  const r = input.range;
  if (r.endSurah !== undefined && r.endSurah !== r.surah) {
    return { cases: [], status: 'partial', reasons: ['multi-surah range: schema v1 is single-surah; record one surah at a time'], droppedOutOfRange: 0 };
  }
  const n = input.ayahs.length;
  if (n === 0) return { cases: [], status: 'partial', reasons: ['no ayahs in range'], droppedOutOfRange: 0 };

  // Offsets into the concatenated expected list (continuous mapping).
  const offsets: number[] = [];
  const counts: number[] = [];
  let acc = 0;
  input.ayahs.forEach((a) => { offsets.push(acc); counts.push(a.orig.length); acc += a.orig.length; });

  // Per-ayah prompts / interrupts from first-class events.
  const promptsByAyah: { words: string[]; indices: number[] }[][] = input.ayahs.map(() => []);
  const interruptsByAyah: { indices: number[]; via: 'overshoot' | 'confirmed-miss' }[][] = input.ayahs.map(() => []);
  const mode = input.settings.mode;
  for (const ev of input.events) {
    if (ev.k !== 'prompt' && ev.k !== 'interrupt') continue;
    const parts = splitPromptEvent(ev, offsets, counts, mode);
    for (const part of parts) {
      if (part.ayahPos < 0 || part.ayahPos >= n) continue;
      if (ev.k === 'prompt') promptsByAyah[part.ayahPos].push({ words: part.words, indices: part.indices });
      else if (ev.trigger === 'overshoot' || ev.trigger === 'confirmed-miss') {
        interruptsByAyah[part.ayahPos].push({ indices: part.indices, via: ev.trigger });
      }
    }
  }

  // Plan / actual, dropping anything outside the range (default rule).
  let dropped = 0;
  const inRange = (surah: number, ayah: number): boolean =>
    surah === r.surah && ayah >= r.from && ayah <= r.to;
  const planInRange: PlanEntry[] = [];
  for (const p of input.plan) {
    if (inRange(p.surah, p.ayah)) planInRange.push(p);
    else dropped++;
  }
  const actualInRange: Record<string, ActualAyah> = {};
  for (const [key, a] of Object.entries(input.actual)) {
    const [s, y] = key.split(':').map(Number);
    if (inRange(s, y)) actualInRange[key] = a;
    else dropped++;
  }
  // Plan entries whose ayah is in range but whose execution was never
  // confirmed stay in the plan; confirmation is a completeness rule.
  const plannedByAyah = new Map<string, PlanEntry[]>();
  for (const p of planInRange) {
    const key = ayahKey(p.surah, p.ayah);
    const arr = plannedByAyah.get(key) || [];
    arr.push(p);
    plannedByAyah.set(key, arr);
  }

  // Completeness rules (every failure -> partial, never silent).
  if (input.zeroMatch) reasons.push('zero-match session: device matched nothing, no grading to record');
  if (input.eventsTruncated) reasons.push('event log truncated: early prompt/interrupt events may be lost');
  if (!input.consent) reasons.push('consent not confirmed');
  if (!tagsComplete(input.voiceTags)) reasons.push('voice tags incomplete (dialect, gender, pace, noise all required)');
  input.ayahs.forEach((a, i) => {
    if (input.skipped[i]) reasons.push(`ayah ${a.surah}:${a.ayah} was skipped (no verdict)`);
    const key = ayahKey(a.surah, a.ayah);
    if (!(key in actualInRange)) reasons.push(`ayah ${key} has no classification`);
  });
  for (const [key, entries] of plannedByAyah) {
    const actual = actualInRange[key];
    for (const p of entries) {
      const confirmed = (actual?.entries || []).some(
        (e) => e.kind === 'planted' && e.spoken === p.spoken && e.expectedWord === p.expectedWord && typeof e.executed === 'boolean',
      );
      if (!confirmed) reasons.push(`planned error at ${key} (${p.spoken} for ${p.expectedWord}) was never confirmed executed or not`);
    }
  }
  // Fixed taxonomy is MANDATORY for planted/unintended entries and
  // ABSENT for self-corrected entries (a self-correction is not an
  // error type). A violation exports as partial, never complete.
  for (const [key, ayah] of Object.entries(actualInRange)) {
    for (const e of ayah.entries) {
      if ((e.kind === 'planted' || e.kind === 'unintended') && !isFixedTaxonomy(e.type)) {
        reasons.push(`ayah ${key} entry (${e.spoken} for ${e.expectedWord}) has no fixed error type`);
      }
      if (e.kind === 'self-corrected' && e.type !== undefined) {
        reasons.push(`ayah ${key} self-corrected entry must not carry an error type`);
      }
    }
  }

  // Transcript.
  let transcript: unknown = null;
  if (mode === 'continuous') {
    if (typeof input.finalsJoined === 'string' && input.finalsJoined.trim().length > 0) transcript = input.finalsJoined;
    else reasons.push('empty continuous transcript');
  } else {
    const obj: Record<string, string> = {};
    let ok = true;
    for (const a of input.ayahs) {
      const key = ayahKey(a.surah, a.ayah);
      const t = input.finalsByAyah ? input.finalsByAyah[key] : undefined;
      if (typeof t === 'string' && t.trim().length > 0) obj[key] = t;
      else { ok = false; reasons.push(`ayah ${key} has no recorded finals`); }
    }
    if (ok) transcript = obj;
  }

  // Per-ayah records + schema plantedErrors (backward compatible).
  // Rule: an entry that is covered by a prompt/interrupt but whose
  // word ended MATCHED (prompted, then self-corrected) is recorded
  // ONLY in the recorder block's actual — putting it in
  // plantedErrors would fail the schema consistency check either
  // way (interrupted requires missed; not-interrupted requires
  // uncovered). All other entries map to plantedErrors directly.
  const ayahRecords: Record<string, unknown>[] = [];
  input.ayahs.forEach((a, i) => {
    const missed: string[] = input.wrongByAyah[i] ?? [];
    const missedSet = new Set(missed);
    const matched = a.orig.filter((w) => !missedSet.has(w));
    const prompts = promptsByAyah[i];
    const interrupts = interruptsByAyah[i];
    const covers = coverageForAyah(prompts, interrupts, a.orig);
    const key = ayahKey(a.surah, a.ayah);
    const actual = actualInRange[key];
    const plantedErrors: { spoken: string; expectedWord: string; interrupted: boolean }[] = [];
    if (actual) {
      for (const e of actual.entries) {
        if (e.kind === 'self-corrected') continue; // never an error: word ended correct
        if (e.kind === 'planted' && e.executed === false) continue; // did not happen
        const isMissed = missedSet.has(e.expectedWord);
        const isCovered = covers(e.expectedWord);
        if (isCovered && !isMissed) continue; // prompted-then-corrected: actual block only
        plantedErrors.push({ spoken: e.spoken, expectedWord: e.expectedWord, interrupted: isCovered && isMissed });
      }
    }
    ayahRecords.push({
      surah: a.surah,
      ayah: a.ayah,
      text: a.text,
      matchedWords: matched,
      missedWords: missed,
      prompts,
      interrupts,
      plantedErrors,
    });
  });

  const status: 'complete' | 'partial' = reasons.length === 0 ? 'complete' : 'partial';
  const date = new Date(input.sessionWall);
  const isoDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const level = input.settings.level === 'beginner' ? 'beginner' : 'strict';
  const c: Record<string, unknown> = {
    id: caseIdFor(input.sessionWall, r.surah, r.from, r.to),
    status,
    date: isoDate,
    device: input.shell,
    build: input.build,
    range: { surah: r.surah, from: r.from, to: r.to },
    level,
    mode,
    ayahs: ayahRecords,
    transcript,
    settings: { corrDelay: input.settings.corrDelay, corrRate: input.settings.corrRate },
    notes: `Recorder export (${status}).${status === 'partial' ? ` Partial reasons: ${reasons.join('; ')}.` : ''} Plan entries: ${planInRange.length}, dropped out-of-range entries: ${dropped}.`,
    audio: null,
    audioReason: 'v1 is transcript-only by design: the scorer consumes transcripts, and audio is a parallel Phase 3 experiment (Safari-vs-Whisper comparison needs the same audio, which means re-collection). Audio, if ever added, stays on-device, is deleted with its case, and is never uploaded without explicit consent.',
    recorder: {
      recorderVersion: 'recorder/v1',
      sessionWall: input.sessionWall,
      alignerFingerprint: input.build,
      iosVersion: input.iosVersion,
      plan: planInRange,
      actual: actualInRange,
      voiceTags: input.voiceTags,
      consent: input.consent,
      zeroMatch: input.zeroMatch,
      eventsTruncated: input.eventsTruncated,
      droppedOutOfRange: dropped,
      events: input.events.map((e) => ({ k: e.k, words: e.words, indices: e.indices, trigger: e.trigger, rel: e.rel, ayah: e.ayah ?? null })),
    },
  };
  return { cases: [c], status, reasons, droppedOutOfRange: dropped };
}

// ---------------------------------------------------------------------------
// Report math (pure; the corpus runner loads this module for --report).
// ---------------------------------------------------------------------------

export interface WilsonResult { p: number; lower: number; upper: number }

/** Wilson score interval (z = 1.96). 0/25 gives [0, ~0.133], never "zero". */
export function wilson(k: number, n: number): WilsonResult {
  if (n <= 0) return { p: 0, lower: 0, upper: 0 };
  const z = 1.96;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const delta = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / den;
  return { p, lower: Math.max(0, centre - delta), upper: Math.min(1, centre + delta) };
}

export interface AyahRecord {
  caseId: string;
  level: string;
  mode: string;
  lengthBucket: 'short' | 'medium' | 'long';
  muqattaat: boolean;
  dialect: string;
  gender: string;
  pace: string;
  noise: string;
  deviceWrong: boolean;
  replayWrong: boolean;
  interruptFired: boolean;
  stallPrompted: boolean;
  /** Fixed types of planted/unintended entries on this ayah (for FN split). */
  errorTypes: string[];
  /** True when this ayah has a planted/unintended error the app never
      surfaced: no covering prompt AND no covering interrupt. A
      prompted ayah-mode error is surfaced (post-ayah correction), and
      a stall-prompt-covered continuous error is surfaced — neither is
      an FN. Only fully-uncovered errors are FNs. */
  fnEntry: boolean;
  selfCorrected: boolean;
}

export interface SessionRecord {
  caseId: string;
  mode: string;
  /** Every ayah device-correct AND no planted/unintended errors. */
  fullyCorrect: boolean;
  interruptFired: boolean;
}

export interface RateStat { k: number; n: number; rate: number; wilson: WilsonResult }

export interface SegmentBucket {
  cases: number;
  ayahs: number;
  accuracy: RateStat | null;
  /** Null accuracy serializes as `عيّنة غير كافية` in the report. */
}

export interface Report {
  totalCases: number;
  totalAyahs: number;
  confusion: { tp: number; fp: number; fn: number; tn: number };
  accuracy: RateStat;
  interruptFP: RateStat;
  stallFP: RateStat;
  sessionFP: RateStat;
  fnByType: Record<string, number>;
  segments: Record<string, Record<string, SegmentBucket>>;
}

const rate = (k: number, n: number): RateStat => ({ k, n, rate: n > 0 ? k / n : 0, wilson: wilson(k, n) });

/**
 * Aggregate a baseline report over complete cases.
 * Segment rule (binding): a bucket's rates print ONLY when the
 * bucket holds >=2 cases AND the report covers >=5 complete cases;
 * otherwise the bucket is `عيّنة غير كافية`. "Cases" for a bucket
 * means distinct case ids contributing ayahs to it.
 */
export function aggregateReport(ayahs: AyahRecord[], sessions: SessionRecord[]): Report {
  const totalCases = new Set([...ayahs.map((a) => a.caseId), ...sessions.map((s) => s.caseId)]).size;
  const totalAyahs = ayahs.length;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const a of ayahs) {
    if (a.deviceWrong && a.replayWrong) tp++;
    else if (!a.deviceWrong && a.replayWrong) fp++;
    else if (a.deviceWrong && !a.replayWrong) fn++;
    else tn++;
  }
  // False-interrupt vs false-stall-alert: denominators are
  // fully-correct ayahs (device-correct AND no planted/unintended
  // error AND no self-correction confusion — self-corrected words
  // ended correct, so an interrupt on them is a false interrupt).
  const correctAyahs = ayahs.filter((a) => !a.deviceWrong && a.errorTypes.length === 0);
  const intFP = correctAyahs.filter((a) => a.interruptFired).length;
  const stallFP = correctAyahs.filter((a) => a.stallPrompted).length;
  const correctSessions = sessions.filter((s) => s.mode === 'continuous' && s.fullyCorrect);
  const sessFP = correctSessions.filter((s) => s.interruptFired).length;

  const fnByType: Record<string, number> = {};
  for (const a of ayahs) {
    if (a.fnEntry) {
      for (const t of a.errorTypes) fnByType[t] = (fnByType[t] || 0) + 1;
      if (a.errorTypes.length === 0) fnByType.unknown = (fnByType.unknown || 0) + 1;
    }
  }

  const dimensions: Record<string, (a: AyahRecord) => string> = {
    level: (a) => a.level,
    mode: (a) => a.mode,
    'ayah-length': (a) => a.lengthBucket,
    muqattaat: (a) => (a.muqattaat ? 'yes' : 'no'),
    dialect: (a) => a.dialect || 'unknown',
    gender: (a) => a.gender || 'unknown',
    pace: (a) => a.pace || 'unknown',
    noise: (a) => a.noise || 'unknown',
  };
  const segments: Report['segments'] = {};
  for (const [dim, keyFn] of Object.entries(dimensions)) {
    const buckets = new Map<string, { caseIds: Set<string>; ayahs: AyahRecord[] }>();
    for (const a of ayahs) {
      const key = keyFn(a);
      let b = buckets.get(key);
      if (!b) { b = { caseIds: new Set(), ayahs: [] }; buckets.set(key, b); }
      b.caseIds.add(a.caseId);
      b.ayahs.push(a);
    }
    const out: Record<string, SegmentBucket> = {};
    buckets.forEach((b, key) => {
      const ok = totalCases >= 5 && b.caseIds.size >= 2;
      const correct = b.ayahs.filter((a) => a.deviceWrong === a.replayWrong).length;
      out[key] = {
        cases: b.caseIds.size,
        ayahs: b.ayahs.length,
        accuracy: ok ? rate(correct, b.ayahs.length) : null,
      };
    });
    segments[dim] = out;
  }

  return {
    totalCases,
    totalAyahs,
    confusion: { tp, fp, fn, tn },
    accuracy: rate(tp + tn, totalAyahs),
    interruptFP: rate(intFP, correctAyahs.length),
    stallFP: rate(stallFP, correctAyahs.length),
    sessionFP: rate(sessFP, correctSessions.length),
    fnByType,
    segments,
  };
}
