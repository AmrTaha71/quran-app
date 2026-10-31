// Three-mode listening — planner, interstitial selector, resume storage.
//
// MODES (owner-confirmed 19:46 EEST 2026-10-29; names are working
// titles until Amr picks/adjusts them):
//   (1) ختمة بقارئ واحد — one voice: the chosen reciter for every surah.
//   (2) ختمة منوّعة — varied khatma: the full Quran from the start
//       point, each QUARTER by a different one of the existing 8
//       reciters, in the fixed rotation below (owner rule 22:01
//       EEST 2026-10-29: quarters, not surahs).
//   (3) ختمة وتفسير — varied khatma + one الميسر interstitial PER
//       QUARTER. Placement follows the user's tafsir-order toggle
//       (TadabburTafsirOrder): 'after' (default) plays the
//       interstitial after each completed quarter except the last
//       — owner decision 22:13 EEST 2026-10-29: the khatma completes
//       clearly at 114:6; the final quarter's tafsir is not played
//       in-journey. 'before' plays a PREVIEW before each quarter
//       instead, including the first and the last (the last
//       quarter's preview plays before its ayahs, so the journey
//       still completes clearly at 114:6 with no trailing tafsir).
//
// Every mode is FREE-CHOICE (start surah + starting reciter are the
// user's choice) + RESUME in all three modes (tap-only, never
// auto-resume — the same interruption rule as listenPlayback and
// riwayatPlayback). A journey starts at the chosen surah, ayah 1,
// and runs continuously to the end of surah 114. The existing
// single-surah free/wird player is UNTOUCHED: these modes are a
// separate, additive section on the Listen page, not a replacement
// for it. "Start anywhere" means any surah (the page's existing
// start granularity); ayah-level precision comes back through
// resume, exactly like the existing wird path.
//
// ROTATION RULE (deterministic, documented — no hidden state):
// the fixed reciter order is RECITERS order (المنشاوي first). For
// a journey starting at (startSurah, startReciterIndex r0), quarter
// Q is voiced by RECITERS[(r0 + (Q - startQuarter)) % 8], where
// startQuarter is the quarter containing the journey's first ayah
// (journeys always start at ayah 1 of the start surah, and resume
// re-plans from that same origin, so the mapping never shifts on
// resume). So a journey starting at surah 1 with المنشاوي voices
// quarter n with RECITERS[(n - 1) % 8] — 240 quarters / 8 reciters
// = exactly 30 quarters each. A journey starting mid-Quran gives
// its (possibly partial) first quarter to r0, the next quarter to
// r0+1, and so on. Mode (1) ignores the rotation: every quarter
// uses RECITERS[r0]. Mode (3) shares mode (2)'s rotation and adds
// the interstitials. Playback is hands-free throughout: the engine
// chains ayah items across quarter and surah boundaries on 'ended'
// events — a reciter change is just the next ayah's reciterId, and
// never asks the user for a tap.
//
// INTERSTITIAL SIZING (adaptive, never a fixed ayah count): the
// interstitial after a quarter targets 1/4–1/3 of that quarter's
// PLAYED duration (Quran:interstitial ratio 3–4:1). The quarter's
// played duration is measured at runtime (sum of the ayah clips'
// audio durations as they actually played), never estimated from
// a table. Tafsir clip durations are probed from the clips'
// metadata at runtime (see threeModePlayback). The selector below
// is pure: given candidate clips with known durations, it picks
// the FIRST N in order. Candidates are the ayahs actually PLAYED
// in that quarter, in order (for a full quarter that is the whole
// quarter; for a journey that started mid-quarter it is the played
// portion — tafsir of unheard ayahs would be the wrong تدبّر).
// Which ayahs: the quarter's opening ayahs are NOT assumed — the
// played portion is, by construction, the quarter's ayahs the
// user just heard, in order.
//
// TAFSIR AUDIO: the Complex's own human recording of التفسير
// الميسر, served from the app's own storage (the app cannot
// hot-link the Complex's single ZIP). The base URL comes from
// VITE_TAFSIR_AUDIO_BASE (same env pattern as VITE_SUPABASE_URL):
// empty means the clips are not uploaded yet, and mode (3) must
// say so honestly instead of playing silence. Clip layout in
// storage is flat: 10-{surah:03d}{ayah:03d}-104.mp3 (the ZIP's own
// filenames, directory stripped). Attribution is shown in-app
// wherever mode (3) appears (see TAFSIR_ATTRIBUTION).
//
// Hook-free, React-free, Supabase-free, same as listenPlayback:
// localStorage is read at call time, every failure swallowed.

import { RECITERS } from './reciters';
import { SURAH_AYAH_COUNTS } from './surahs';
import { quarterContaining } from './quarters';
import type { Quarter } from './quarters';

export type ThreeMode = 'single' | 'varied' | 'tadabbur';

// Tadabbur tafsir order (user toggle, 2026-10-31): whether each
// quarter's الميسر tafsir plays BEFORE the quarter (a preview:
// understand, then recite) or AFTER it (a review: recite, then
// reflect). Default 'after' = the original behavior. A saved
// position records the order it started with, so resuming never
// silently re-orders a journey in progress (see ThreeModePosition).
export type TadabburTafsirOrder = 'before' | 'after';

export const TADABBUR_TAFSIR_ORDER_KEY = 'quran-tadabbur-tafsir-order';

export function readTadabburTafsirOrder(): TadabburTafsirOrder {
  try {
    const raw = localStorage.getItem(TADABBUR_TAFSIR_ORDER_KEY);
    if (raw === 'before' || raw === 'after') return raw;
  } catch {
    // Swallow: fall through to the default.
  }
  return 'after';
}

export function writeTadabburTafsirOrder(order: TadabburTafsirOrder): void {
  try {
    localStorage.setItem(TADABBUR_TAFSIR_ORDER_KEY, order === 'before' ? 'before' : 'after');
  } catch {
    // Swallow: persistence must never break playback.
  }
}

export const THREE_MODES: { id: ThreeMode; name: string; description: string }[] = [
  {
    id: 'single',
    name: 'ختمة بقارئ واحد',
    description: 'ختمة كاملة بصوت القارئ الذي تختاره، من السورة التي تبدأ منها.',
  },
  {
    id: 'varied',
    name: 'ختمة منوّعة',
    description: 'ختمة كاملة، كل ربع بقارئ مختلف من القراء الثمانية، بالتناوب الثابت.',
  },
  {
    id: 'tadabbur',
    name: 'ختمة وتفسير',
    description: 'ختمة منوّعة، مع وقفة تفسير من التفسير الميسر بحجم يتناسب مع الربع، قبل الربع أو بعده حسب اختيارك.',
  },
];

export function threeModeName(mode: ThreeMode): string {
  return THREE_MODES.find((m) => m.id === mode)?.name ?? mode;
}

// ------------------------------------------------------------------
// Rotation
// ------------------------------------------------------------------

export function reciterIndexForQuarter(
  mode: ThreeMode,
  startQuarter: number,
  startReciterIndex: number,
  quarter: number,
): number {
  const r0 = ((startReciterIndex % RECITERS.length) + RECITERS.length) % RECITERS.length;
  if (mode === 'single') return r0;
  const steps = quarter - startQuarter;
  return ((r0 + steps) % RECITERS.length + RECITERS.length) % RECITERS.length;
}

export function reciterIdForQuarter(
  mode: ThreeMode,
  startQuarter: number,
  startReciterId: string,
  quarter: number,
): string {
  const idx = RECITERS.findIndex((r) => r.id === startReciterId);
  const r0 = idx >= 0 ? idx : 0;
  return RECITERS[reciterIndexForQuarter(mode, startQuarter, r0, quarter)].id;
}

// ------------------------------------------------------------------
// Tafsir audio base + clip URLs + attribution
// ------------------------------------------------------------------

const RAW_BASE: unknown = (() => {
  try {
    return (import.meta as unknown as { env?: Record<string, unknown> }).env
      ?.VITE_TAFSIR_AUDIO_BASE;
  } catch {
    return undefined;
  }
})();

export const TAFSIR_AUDIO_BASE: string =
  typeof RAW_BASE === 'string' ? RAW_BASE.trim().replace(/\/+$/, '') : '';

export function tafsirConfigured(): boolean {
  return TAFSIR_AUDIO_BASE.length > 0;
}

const pad3 = (n: number): string => String(n).padStart(3, '0');

export function tafsirClipUrl(surah: number, ayah: number): string | null {
  if (!tafsirConfigured()) return null;
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) return null;
  const count = SURAH_AYAH_COUNTS[surah - 1];
  if (!Number.isInteger(ayah) || ayah < 1 || ayah > count) return null;
  return `${TAFSIR_AUDIO_BASE}/10-${pad3(surah)}${pad3(ayah)}-104.mp3`;
}

// Grant wording: King Fahd Complex grants free public use of its
// audio books' digital copies in computer applications, websites
// and radio/internet, inside and outside KSA — WITH attribution.
// This line is shown wherever mode (3) appears.
export const TAFSIR_ATTRIBUTION =
  'التفسير الميسر — تسجيل مجمع الملك فهد لطباعة المصحف الشريف، يُستخدم مجانًا داخل التطبيق مع ذكر المصدر';

// ------------------------------------------------------------------
// Journey planner (pure generator — no audio, no DOM).
//
// Yields ayah items in order, plus a quarterEnd marker AFTER the
// last ayah of each quarter the journey completes (including the
// final quarter, Q240). The engine turns a marker into the
// interstitial: it is NOT a playable item, so the planner never
// needs a tafsir duration — selection happens at runtime with
// measured durations (see selectInterstitial + threeModePlayback).
// ------------------------------------------------------------------

export type JourneyItem =
  | { kind: 'ayah'; surah: number; ayah: number; reciterId: string }
  | { kind: 'quarterEnd'; quarter: number };

export function* planJourney(
  mode: ThreeMode,
  startSurah: number,
  startReciterId: string,
  startAyah = 1,
): Generator<JourneyItem> {
  const s0 =
    Number.isInteger(startSurah) && startSurah >= 1 && startSurah <= 114 ? startSurah : 1;
  const firstCount = SURAH_AYAH_COUNTS[s0 - 1];
  const a0 =
    Number.isInteger(startAyah) && startAyah >= 1 && startAyah <= firstCount ? startAyah : 1;
  // Rotation origin: the quarter of the journey's first ayah.
  // Journeys start at ayah 1 and resume re-plans from this same
  // origin, so this value — and therefore every quarter's reciter
  // — is identical on first play and on every resume.
  const startQuarter = quarterContaining(s0, a0)?.q ?? 1;
  let prevQuarter: Quarter | null = null;
  for (let surah = s0; surah <= 114; surah += 1) {
    const count = SURAH_AYAH_COUNTS[surah - 1];
    const fromAyah = surah === s0 ? a0 : 1;
    for (let ayah = fromAyah; ayah <= count; ayah += 1) {
      const qu = quarterContaining(surah, ayah);
      if (prevQuarter !== null && qu !== null && qu.q !== prevQuarter.q) {
        // Crossed into a new quarter: the previous one just completed.
        yield { kind: 'quarterEnd', quarter: prevQuarter.q };
      }
      yield {
        kind: 'ayah',
        surah,
        ayah,
        reciterId: reciterIdForQuarter(mode, startQuarter, startReciterId, qu?.q ?? startQuarter),
      };
      if (qu !== null) prevQuarter = qu;
    }
  }
  // The journey's last quarter completes at the end of surah 114 —
  // and gets NO interstitial: owner decision 22:13 EEST 2026-10-29
  // (clear completion at 114:6 first; the final quarter's tafsir
  // is not played in-journey). Earlier quarters still emit theirs
  // on the crossing above.
  if (prevQuarter !== null && prevQuarter.q !== 240) {
    yield { kind: 'quarterEnd', quarter: prevQuarter.q };
  }
}

// ------------------------------------------------------------------
// Interstitial selection (pure, testable).
//
// Candidates: played ayahs of the completed quarter, in order,
// each with a measured tafsir duration in seconds (null = unknown
// — the engine probes unknowns on demand before calling this with
// resolved values; a candidate that still has no duration is
// skipped by the caller, never guessed).
//
// Rule: L = quarterDuration / 4, H = quarterDuration / 3. Walk in
// order, accumulating. Add a clip while the sum is still below L;
// stop as soon as the sum reaches or passes L. If a clip takes the
// sum past H while the sum is still below L, it is still added —
// reaching L takes precedence, and the overshoot is bounded by one
// clip. If candidates run out first, return all of them (an honest
// shortfall: the quarter's tafsir is shorter than the window).
// A non-positive quarter duration, or no candidates, yields [].
// ------------------------------------------------------------------

export interface TafsirCandidate {
  surah: number;
  ayah: number;
  /** Measured tafsir clip duration in seconds (never estimated). */
  duration: number;
}

export function selectInterstitial(
  candidates: TafsirCandidate[],
  quarterDuration: number,
): { surah: number; ayah: number }[] {
  if (!(quarterDuration > 0) || candidates.length === 0) return [];
  const low = quarterDuration / 4;
  const picked: { surah: number; ayah: number }[] = [];
  let sum = 0;
  for (const c of candidates) {
    if (!(c.duration > 0)) continue;
    if (sum >= low) break;
    picked.push({ surah: c.surah, ayah: c.ayah });
    sum += c.duration;
  }
  return picked;
}

// ------------------------------------------------------------------
// Per-mode resume: one saved position per mode (like the per-riwaya
// resume), so stopping a varied khatma never clobbers a
// single-voice position. A position is (journey start + current
// item + time-in-item). For a tafsir item, `interstitial` carries
// the exact interstitial list the engine selected, so resuming
// into an interstitial replays the SAME list instead of
// re-selecting without the quarter's played duration (which is
// gone on a fresh load). Positions with a bad shape are ignored,
// never trusted blindly; a bad time normalises to 0.
// ------------------------------------------------------------------

export interface ThreeModePosition {
  mode: ThreeMode;
  startSurah: number;
  startReciterId: string;
  kind: 'ayah' | 'tafsir';
  surah: number;
  ayah: number;
  time: number;
  interstitial?: { surah: number; ayah: number }[];
  // Tadabbur only: the tafsir order this journey started with.
  // Absent on positions saved before the toggle existed, which
  // consumers read as 'after' (the original behavior) — so old
  // resumes are unaffected. The engine writes it for tadabbur
  // journeys; single/varied positions never carry it.
  tafsirOrder?: TadabburTafsirOrder;
}

export const THREE_MODE_RESUME_KEY = 'quran-three-mode-resume';

function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

function cleanPosition(mode: ThreeMode, raw: unknown): ThreeModePosition | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { startSurah, startReciterId, kind, surah, ayah, time, interstitial, tafsirOrder } = raw as {
    startSurah?: unknown;
    startReciterId?: unknown;
    kind?: unknown;
    surah?: unknown;
    ayah?: unknown;
    time?: unknown;
    interstitial?: unknown;
    tafsirOrder?: unknown;
  };
  if (!Number.isInteger(startSurah) || (startSurah as number) < 1 || (startSurah as number) > 114)
    return null;
  if (typeof startReciterId !== 'string' || !RECITERS.some((r) => r.id === startReciterId))
    return null;
  if (kind !== 'ayah' && kind !== 'tafsir') return null;
  if (!Number.isInteger(surah) || (surah as number) < 1 || (surah as number) > 114) return null;
  const count = SURAH_AYAH_COUNTS[(surah as number) - 1];
  if (!Number.isInteger(ayah) || (ayah as number) < 1 || (ayah as number) > count) return null;
  const cleanTime =
    typeof time === 'number' && Number.isFinite(time) && time >= 0 ? time : 0;
  let cleanInterstitial: { surah: number; ayah: number }[] | undefined;
  if (Array.isArray(interstitial)) {
    const list: { surah: number; ayah: number }[] = [];
    for (const it of interstitial) {
      if (typeof it !== 'object' || it === null) continue;
      const { surah: s, ayah: a } = it as { surah?: unknown; ayah?: unknown };
      if (!Number.isInteger(s) || (s as number) < 1 || (s as number) > 114) continue;
      const c = SURAH_AYAH_COUNTS[(s as number) - 1];
      if (!Number.isInteger(a) || (a as number) < 1 || (a as number) > c) continue;
      list.push({ surah: s as number, ayah: a as number });
    }
    if (list.length > 0) cleanInterstitial = list;
  }
  // Only the two valid order values survive; anything else
  // (including absence on pre-toggle positions) reads as 'after'
  // at the consumer, so the field stays optional here.
  const cleanOrder: TadabburTafsirOrder | undefined =
    tafsirOrder === 'before' || tafsirOrder === 'after' ? tafsirOrder : undefined;
  return {
    mode,
    startSurah: startSurah as number,
    startReciterId,
    kind,
    surah: surah as number,
    ayah: ayah as number,
    time: cleanTime,
    ...(cleanInterstitial ? { interstitial: cleanInterstitial } : {}),
    ...(cleanOrder ? { tafsirOrder: cleanOrder } : {}),
  };
}

export function readThreeModeResume(mode: ThreeMode): ThreeModePosition | null {
  try {
    if (!THREE_MODES.some((m) => m.id === mode)) return null;
    const ls = storage();
    if (!ls) return null;
    const parsed: unknown = JSON.parse(ls.getItem(THREE_MODE_RESUME_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return null;
    return cleanPosition(mode, (parsed as Record<string, unknown>)[mode]);
  } catch {
    return null;
  }
}

export function readAllThreeModeResumes(): Partial<Record<ThreeMode, ThreeModePosition>> {
  const out: Partial<Record<ThreeMode, ThreeModePosition>> = {};
  for (const m of THREE_MODES) {
    const pos = readThreeModeResume(m.id);
    if (pos) out[m.id] = pos;
  }
  return out;
}

export function writeThreeModeResume(pos: ThreeModePosition): void {
  try {
    if (!THREE_MODES.some((m) => m.id === pos.mode)) return;
    const ls = storage();
    if (!ls) return;
    let all: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(ls.getItem(THREE_MODE_RESUME_KEY) ?? 'null');
      if (typeof parsed === 'object' && parsed !== null)
        all = parsed as Record<string, unknown>;
    } catch {
      all = {};
    }
    all[pos.mode] = pos;
    ls.setItem(THREE_MODE_RESUME_KEY, JSON.stringify(all));
  } catch {
    // Swallow: persistence must never break playback.
  }
}

export function clearThreeModeResume(mode: ThreeMode): void {
  try {
    const ls = storage();
    if (!ls) return;
    let all: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(ls.getItem(THREE_MODE_RESUME_KEY) ?? 'null');
      if (typeof parsed === 'object' && parsed !== null)
        all = parsed as Record<string, unknown>;
    } catch {
      all = {};
    }
    delete all[mode];
    ls.setItem(THREE_MODE_RESUME_KEY, JSON.stringify(all));
  } catch {
    // Swallow, as above.
  }
}
