// SRS storage (step 2, spec 2026-11-20 §3, §5): localStorage layer over the
// pure logic in srs.ts. Two NEW keys, both local-only:
//
//   quran-srs-v1         the review table: one record per word (stage + next
//                        review time), keyed surah:ayah:wordNo.
//   quran-srs-slips-v1   the separate pronunciation-slip store: the per-pair
//                        counters and the list of slips that were NOT promoted.
//
// The old log (quran-word-mistakes-v1, wordMistakes.ts) is only READ here
// (readLegacyMistakes). It is never written, deleted or migrated.
//
// Best-effort like wordMistakes.ts: a missing, empty, corrupt or full
// localStorage never throws. Broken records are skipped on read, and the
// next successful write replaces the broken value.
//
// This file does not judge tajwid; slips are text comparisons (see srs.ts).

import {
  newEntry, scheduleAfterSuccess, scheduleAfterFailure, isDue, recordSlip, classifySlip,
  SRS_SLIP_DECAY_DAYS,
} from './srs.ts';
import type { SrsEntry, SlipCounts } from './srs.ts';
import { listWeakWords } from './wordMistakes.ts';
import type { WeakWord } from './wordMistakes.ts';

// ---- Constants ----------------------------------------------------

export const SRS_STORE_KEY = 'quran-srs-v1';
export const SRS_SLIPS_KEY = 'quran-srs-slips-v1';
/** The slip list keeps the newest N un-promoted slips (counters are not
 *  affected: they only ever hold a handful of letter pairs). */
export const MAX_SLIP_LIST = 500;

// ---- Types --------------------------------------------------------

/** Stored shape (short keys, like the old log): s = stage, d = due (ms
 *  epoch), o = the word as written, for display. */
type ReviewRecord = { s: number; d: number; o: string };
type ReviewStore = Record<string, ReviewRecord>;

/** One slip that stayed in the separate list: k = word key, p = letter
 *  pair, w = written word, h = the text the app heard, t = when (ms). */
export type SlipRecord = { k: string; p: string; w: string; h: string; t: number };
/** t = when each pair last slipped (ms), for the 30-day decay (4.13). */
type SlipStore = { c: SlipCounts; l: SlipRecord[]; t: Record<string, number> };

export type DueWord = {
  key: string; surah: number; ayah: number; wordNo: number;
  word: string; stage: number; due: number;
};

export type WordSlipResult = {
  pair: string;
  /** this pair's count including the current slip */
  count: number;
  route: 'slip-list' | 'review';
  /** only for route 'review': false when the word was already in the table */
  added?: boolean;
};

// ---- Raw storage helpers ------------------------------------------

function isObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}
function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeJson(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; /* storage unavailable or full: best-effort */ }
}

const WORD_KEY_RE = /^\d+:\d+:\d+$/;

export function wordKey(surah: number, ayah: number, wordNo: number): string {
  return `${surah}:${ayah}:${wordNo}`;
}

function loadReview(): ReviewStore {
  const p = readJson(SRS_STORE_KEY);
  const out: ReviewStore = {};
  if (!isObj(p)) return out;
  for (const [k, v] of Object.entries(p)) {
    if (!WORD_KEY_RE.test(k) || !isObj(v) || !isNum(v.s) || !isNum(v.d) || v.s < 1) continue;
    out[k] = { s: Math.trunc(v.s), d: v.d, o: typeof v.o === 'string' ? v.o : '' };
  }
  return out;
}

function loadSlips(): SlipStore {
  const p = readJson(SRS_SLIPS_KEY);
  const out: SlipStore = { c: {}, l: [], t: {} };
  if (!isObj(p)) return out;
  if (isObj(p.t)) {
    for (const [pair, ts] of Object.entries(p.t)) if (isNum(ts)) out.t[pair] = ts;
  }
  if (isObj(p.c)) {
    for (const [pair, n] of Object.entries(p.c)) {
      if (isNum(n) && n >= 0) out.c[pair] = Math.trunc(n);
    }
  }
  if (Array.isArray(p.l)) {
    for (const r of p.l) {
      if (isObj(r) && typeof r.k === 'string' && typeof r.p === 'string' &&
          typeof r.w === 'string' && typeof r.h === 'string' && isNum(r.t)) {
        out.l.push({ k: r.k, p: r.p, w: r.w, h: r.h, t: r.t });
      }
    }
    if (out.l.length > MAX_SLIP_LIST) out.l = out.l.slice(out.l.length - MAX_SLIP_LIST);
  }
  return out;
}

// ---- Review table -------------------------------------------------

/** The stored entry for a word, or null. */
export function getReviewEntry(key: string): (SrsEntry & { word: string }) | null {
  const r = loadReview()[key];
  return r ? { stage: r.s, due: r.d, word: r.o } : null;
}

/** Put a word into the review table (stage 1, due after the first gap).
 *  If it is already there nothing changes (added: false): whether a new
 *  mistake on a tabled word counts as a failure is the caller's call
 *  (recordFailure). */
export function addWord(
  surah: number, ayah: number, wordNo: number, word: string,
  now: number = Date.now(), intervals?: readonly number[] | null,
): { added: boolean; entry: SrsEntry } {
  const store = loadReview();
  const key = wordKey(surah, ayah, wordNo);
  const existing = store[key];
  if (existing) return { added: false, entry: { stage: existing.s, due: existing.d } };
  const entry = newEntry(now, intervals);
  store[key] = { s: entry.stage, d: entry.due, o: word };
  writeJson(SRS_STORE_KEY, store);
  return { added: true, entry };
}

/** A review succeeded. Moves the word to its next stage, or removes it from
 *  the table when it graduates. Null when the word is not in the table. */
export function recordSuccess(
  key: string, now: number = Date.now(), intervals?: readonly number[] | null,
): { graduated: true } | { graduated: false; entry: SrsEntry } | null {
  const store = loadReview();
  const cur = store[key];
  if (!cur) return null;
  const out = scheduleAfterSuccess({ stage: cur.s, due: cur.d }, now, intervals);
  if (out.graduated) delete store[key];
  else store[key] = { s: out.entry.stage, d: out.entry.due, o: cur.o };
  writeJson(SRS_STORE_KEY, store);
  return out;
}

/** A review failed: the word keeps its stage, due again tomorrow (4.14). Null when the word is not in the table. */
export function recordFailure(
  key: string, now: number = Date.now(), intervals?: readonly number[] | null,
): SrsEntry | null {
  const store = loadReview();
  const cur = store[key];
  if (!cur) return null;
  const entry = scheduleAfterFailure(now, intervals, { stage: cur.s, due: cur.d });
  store[key] = { s: entry.stage, d: entry.due, o: cur.o };
  writeJson(SRS_STORE_KEY, store);
  return entry;
}

/** Words due now or earlier, oldest due first (ties: Mushaf order,
 *  numerically: 2:1:1 before 10:1:1, 4.27). `limit` caps the list (the
 *  day's review, SRS_DAILY_LIMIT); without it every due word is listed. */
export function getDueWords(now: number = Date.now(), limit?: number): DueWord[] {
  const out: DueWord[] = [];
  for (const [key, r] of Object.entries(loadReview())) {
    if (!isDue({ stage: r.s, due: r.d }, now)) continue;
    const [surah, ayah, wordNo] = key.split(':').map(Number);
    out.push({ key, surah, ayah, wordNo, word: r.o, stage: r.s, due: r.d });
  }
  out.sort((a, b) => (a.due - b.due) || (a.surah - b.surah) || (a.ayah - b.ayah) || (a.wordNo - b.wordNo));
  return limit !== undefined && limit >= 0 ? out.slice(0, limit) : out;
}

// ---- Pronunciation slips ------------------------------------------

/** Record what the app heard for a word whose final verdict was wrong.
 *  Null when `heard` is not a confusable-pair slip of `written` (nothing is
 *  written then; the caller treats it as an ordinary mistake).
 *  Slips 1 and 2 of a letter pair go to the separate list. Slip 3 and every
 *  later one of the same pair goes into the review table. Earlier slips are
 *  never moved or promoted after the fact.
 *  The counters are saved before the table, so if storage fills up between
 *  the two writes the slip is counted but the word is missing from the
 *  table; the next slip of that pair is promoted anyway. */
export function recordWordSlip(
  surah: number, ayah: number, wordNo: number, written: string, heard: string,
  now: number = Date.now(), intervals?: readonly number[] | null,
): WordSlipResult | null {
  const slips = loadSlips();
  // 4.13: a pair that has not slipped for SRS_SLIP_DECAY_DAYS starts over.
  const pair0 = classifySlip(written, heard);
  if (!pair0) return null;
  const lastT = slips.t[pair0];
  if (lastT !== undefined && now - lastT > SRS_SLIP_DECAY_DAYS * 86_400_000) slips.c = { ...slips.c, [pair0]: 0 };
  const r = recordSlip(slips.c, written, heard);
  if (!r) return null;
  slips.c = r.counts;
  slips.t = { ...slips.t, [r.pair]: now };
  if (r.route === 'slip-list') {
    slips.l.push({ k: wordKey(surah, ayah, wordNo), p: r.pair, w: written, h: heard, t: now });
    if (slips.l.length > MAX_SLIP_LIST) slips.l = slips.l.slice(slips.l.length - MAX_SLIP_LIST);
    writeJson(SRS_SLIPS_KEY, slips);
    return { pair: r.pair, count: r.count, route: 'slip-list' };
  }
  writeJson(SRS_SLIPS_KEY, slips);
  const { added } = addWord(surah, ayah, wordNo, written, now, intervals);
  return { pair: r.pair, count: r.count, route: 'review', added };
}

/** Slips that stayed in the separate list (oldest first). */
export function getSlipList(): SlipRecord[] {
  return loadSlips().l;
}

/** Per-pair slip counters. */
export function getSlipCounts(): SlipCounts {
  return loadSlips().c;
}

// ---- Doubtful single mistakes (4.5ب) -----------------------------

/** Phase 6 (4.5ب): one isolated wrong word in an ayah is often the engine
 *  mishearing, not the reciter. Such a word is only marked «مشكوك» here;
 *  it enters the review table when it is wrong again in a LATER session
 *  (at least SRS_SUSPECT_GAP_MS after the first time). Local only. */
export const SRS_SUSPECT_KEY = 'quran-srs-suspect-v1';
export const SRS_SUSPECT_GAP_MS = 30 * 60 * 1000;
/** A doubt older than this is forgotten (one slip a month apart is noise). */
export const SRS_SUSPECT_TTL_MS = 30 * 86_400_000;

function loadSuspects(now: number): Record<string, number> {
  const p = readJson(SRS_SUSPECT_KEY);
  const out: Record<string, number> = {};
  if (!isObj(p)) return out;
  for (const [k, t] of Object.entries(p)) {
    if (WORD_KEY_RE.test(k) && isNum(t) && now - t <= SRS_SUSPECT_TTL_MS) out[k] = t;
  }
  return out;
}

/** 'confirmed' = wrong again in a later session (the caller adds it to the
 *  table and the doubt is cleared); 'marked' = first time, or the same
 *  session again. */
export function markSuspect(key: string, now: number = Date.now()): 'marked' | 'confirmed' {
  const s = loadSuspects(now);
  const first = s[key];
  if (first !== undefined && now - first >= SRS_SUSPECT_GAP_MS) {
    delete s[key];
    writeJson(SRS_SUSPECT_KEY, s);
    return 'confirmed';
  }
  if (first === undefined) s[key] = now;
  writeJson(SRS_SUSPECT_KEY, s);
  return 'marked';
}

/** Said right later: the doubt goes away. */
export function clearSuspect(key: string, now: number = Date.now()): void {
  const s = loadSuspects(now);
  if (!(key in s)) return;
  delete s[key];
  writeJson(SRS_SUSPECT_KEY, s);
}

/** How many words are marked «مشكوك» now. */
export function suspectCount(now: number = Date.now()): number {
  return Object.keys(loadSuspects(now)).length;
}

// ---- Old log (read only) ------------------------------------------

/** The old word-mistake log, as wordMistakes.ts lists it. Read only: this
 *  module never writes, clears or migrates quran-word-mistakes-v1. */
export function readLegacyMistakes(): WeakWord[] {
  return listWeakWords();
}
