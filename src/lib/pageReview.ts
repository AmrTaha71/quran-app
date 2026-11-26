// 17.3 (phase 6): the PAGE review queue, separate from the word SRS. The
// unit is a Madinah page inside «محفوظي». Order: pages with open mistakes
// first, then the pages longest without a recital. After a CLEAN recital
// of a whole page its gap grows (stages = the SRS gaps 1/3/7/14/30 days as
// a first guess; final numbers are a grading-phase decision); a recital
// with a mistake keeps the page open and due tomorrow. Local only.
import { SRS_DEFAULT_INTERVALS_DAYS, startOfLocalDay } from './srs.ts';
import { pageStartGlobal, pageEndGlobal, pageOfGlobal } from './reviewPages.ts';

export const PAGE_REVIEW_KEY = 'quran-page-review-v1';
const DAY = 86_400_000;

/** l = last recital (ms), s = stage (0 = never clean), d = due (ms), o = open mistakes */
export type PageRec = { l: number; s: number; d: number; o: boolean };
export type PageStore = Record<string, PageRec>;
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const ls = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export function loadPageReview(store: Store | null = ls()): PageStore {
  if (!store) return {};
  try {
    const v = JSON.parse(store.getItem(PAGE_REVIEW_KEY) ?? '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: PageStore = {};
    for (const [k, r] of Object.entries(v as Record<string, PageRec>)) {
      if (/^\d+$/.test(k) && r && typeof r.l === 'number' && typeof r.s === 'number' && typeof r.d === 'number') out[k] = { l: r.l, s: r.s, d: r.d, o: !!r.o };
    }
    return out;
  } catch { return {}; }
}

/** Record a finished test. `ayat`: the tested ayat as global numbers with
 *  their verdicts (skipped ones left out). A page is "recited" when every
 *  ayah of it was in the test; any wrong ayah opens its page's mistakes
 *  even if the page was only partly tested. */
export function recordTestPages(ayat: readonly { g: number; ok: boolean }[], now = Date.now(), store: Store | null = ls()): PageStore {
  const s = loadPageReview(store);
  const byPage = new Map<number, { ok: boolean; gs: Set<number> }>();
  for (const a of ayat) {
    const p = pageOfGlobal(a.g);
    const e = byPage.get(p) ?? { ok: true, gs: new Set<number>() };
    e.gs.add(a.g); if (!a.ok) e.ok = false;
    byPage.set(p, e);
  }
  const iv = SRS_DEFAULT_INTERVALS_DAYS;
  for (const [p, e] of byPage) {
    const full = pageEndGlobal(p) - pageStartGlobal(p) + 1 <= e.gs.size;
    const cur = s[p] ?? { l: 0, s: 0, d: 0, o: false };
    if (!e.ok) { s[p] = { l: full ? now : cur.l, s: cur.s, d: startOfLocalDay(now + DAY), o: true }; continue; }
    if (!full) continue;
    const stage = Math.min(cur.s + 1, iv.length);
    s[p] = { l: now, s: stage, d: startOfLocalDay(now + iv[stage - 1] * DAY), o: false };
  }
  if (store) { try { store.setItem(PAGE_REVIEW_KEY, JSON.stringify(s)); } catch { /* full */ } }
  return s;
}

export type QueuedPage = { page: number; open: boolean; last: number };

/** The queue over the memorized pages: open mistakes first (oldest recital
 *  first), then due pages, never-recited ones counted as oldest. */
export function pageQueue(memorizedPages: Iterable<number>, store: PageStore, now = Date.now()): QueuedPage[] {
  const out: QueuedPage[] = [];
  for (const p of memorizedPages) {
    const r = store[p];
    if (r && !r.o && r.d > now) continue;
    out.push({ page: p, open: !!r?.o, last: r?.l ?? 0 });
  }
  return out.sort((a, b) => (Number(b.open) - Number(a.open)) || (a.last - b.last) || (a.page - b.page));
}

/** Pages that hold at least one ayah of the corpus. */
export function pagesOfCorpus(corpus: Iterable<number>): number[] {
  const set = new Set<number>();
  for (const g of corpus) set.add(pageOfGlobal(g));
  return [...set].sort((a, b) => a - b);
}
