// ---- Overshoot confirmation (PURE) ---------------------------------
// R1 (Claude-2, structural): this module is the SINGLE source of
// truth for the overshoot decision. The SelfTestPage component AND
// every test runner import THIS function — no runner may re-implement
// the counting logic. (The old E2 runner mirrored the component and
// therefore inherited its anchor bug invisibly; that structural flaw
// is what this extraction ends.)
//
// CONTRACT — overshootOwed(input) -> target | null:
//   Inputs (all plain data, no refs, no side effects):
//     expected:    the test range's words in order, each with its
//                  normalized form (norm), display form (orig), and
//                  test-local ayah index (ayahIdx, 0-based per ayah
//                  in the range, in range order).
//     spoken:      normalized spoken tokens (raw alignment's spoken).
//     rawMatched:  the aligner's raw matched[] (before fix-credit).
//     rawPositions: the aligner's raw positions[] (span STARTS).
//     rawConsumed: the aligner's raw consumed[] (span lengths; a
//                  missing/short entry falls back to span 1, exactly
//                  as the component did for stale caches).
//     credited:    indices credited by fix-credit so far (the
//                  component's contCreditedRef). Effective matched =
//                  rawMatched[i] || credited.has(i). A credited-only
//                  word has no raw position and therefore can never
//                  be the anchor; it only joins matchedNorms.
//     prompting:   true while a correction prompt is playing. The
//                  check NEVER fires mid-prompt (the component also
//                  early-returns then; this is a second guard so no
//                  future caller can fire one mid-prompt either).
//   Output: the owed next word as { words, indices, norms } when the
//   speaker has demonstrably moved past it, else null. It NEVER
//   credits, un-credits, or grades a word — it only selects a prompt
//   target (the component speaks it and checkContFix credits later).
//
// THE RULE (pigeonhole, not a guess):
//   Let next = the expected word after the last effectively matched
//   word, and remaining = words left in next's ayah from next onward.
//   Anchor at the END of the last raw match's consumed span (F1 —
//   the old start-anchor counted a match's own fragments as new
//   words and fired false interrupts). Skip a LEADING run of
//   liturgical phrases after the anchor (F2 — basmalah and/or
//   isti'adha, each in order, each possibly a prefix; the scan stops
//   permanently at the first non-phrase token, so out-of-order phrase
//   words still count). Count DISTINCT post-anchor tokens that are
//   not repeats of a matched word, not opaque numeral artifacts, and
//   not near-miss variants (>= 0.7 normalized Levenshtein similarity)
//   of an owed-ayah word. Fire when:
//     remaining >= 2: distinct > remaining AND distinct >= 4
//       (the shipped rule, unchanged), or
//     remaining == 1: (distinct >= 2 AND positive evidence) OR
//       distinct >= 4 — see DEVIATION note below.
//   Finals-only holds by construction in the component (the check
//   runs only from the final-result handler and the onend
//   orphan-rescue path, never on a timer and never on interim
//   tokens); this function itself takes already-final token arrays.
//   Silence can never confirm: with no new tokens the count is 0.
//
// DEVIATION FROM CLAUDE'S LETTER (R2) — READ THIS BEFORE CHANGING
// THE REMAINING==1 BRANCH:
//   Claude specified: fire for remaining==1 ONLY with positive
//   evidence (a distinct token matching one of the first 2 words of
//   the NEXT ayah); junk-only never fires. His stated reason the
//   device replay still fires — "ذلك الكتاب are 2:3's first words" —
//   is factually wrong: ذلك الكتاب are 2:2's first two words, and in
//   the replay they already MATCHED (so they are excluded from the
//   distinct set, not evidence in it). The replay's distinct tokens
//   after هدى are the planted error plus the 2:255 tail — no 2:3 word
//   (الذين/يؤمنون) appears at all. Under STRICT R2 the replay, P10,
//   P12a (6 junk) and P12b (7 junk) would ALL go silent — i.e. the
//   exact planted-error test the user runs next would stop
//   interrupting, reintroducing the original complaint. The shipped
//   >= 4 floor is therefore kept for remaining==1 as well: it changes
//   ONLY the distinct∈{2,3}-without-positive-evidence behavior (the
//   F3 join-anchor +2-junk case and the pausal-form +1-junk case
//   become NO-fire, which is exactly the fragility Claude targeted),
//   while every shipped fire case keeps firing. If a future reviewer
//   wants strict R2, the cost must be accepted explicitly: P1/P2/P10/
//   P12a/P12b expectations flip to no-fire and the planted-error
//   test goes silent mid-flow (the stall prompt would still surface
//   it at the pause, but not as an interrupt).
//   Positive evidence itself is checked on the post-exclusion
//   distinct set: a next-ayah word that is also a matched norm, or
//   near-miss-excluded against the owed ayah, cannot serve as
//   evidence (it is ambiguous, not forward movement).

export interface OvershootExpectedWord {
  norm: string;
  orig: string;
  ayahIdx: number;
}

export interface OvershootInput {
  expected: OvershootExpectedWord[];
  spoken: string[];
  rawMatched: boolean[];
  rawPositions: number[];
  rawConsumed: number[];
  credited: ReadonlySet<number>;
  prompting: boolean;
}

export interface OvershootTarget {
  words: string[];
  indices: number[];
  norms: string[];
}

// Liturgical phrases skipped (leading only) by the overshoot count
// (F2). Normalized forms — spoken tokens are already normalized,
// verified against the real normalizer (بسم الله الرحمن الرحيم,
// أعوذ بالله من الشيطان الرجيم).
export const OVERSHOOT_BASMALAH = ['بسم', 'الله', 'الرحمن', 'الرحيم'];
export const OVERSHOOT_ISTIADHA = ['اعوذ', 'بالله', 'من', 'الشيطان', 'الرجيم'];

// P1: an opaque numeral token (see digitTokenToOpaque) — digits
// with no Arabic letters. Spoken tokens are either cleanToken output
// (Arabic letters only) or opaque tokens, so this test is exact on
// spoken-token arrays. It must NOT be applied to expected norms
// (which never contain digits) or raw text.
export function isOpaqueToken(t: string): boolean {
  return /\d/.test(t) && !/[\u0621-\u064A]/.test(t);
}

// Normalized Levenshtein similarity for the overshoot exclusion
// (P0-1): 1 - distance / max length. Inputs are short normalized
// words, so the quadratic DP is trivial per call.
export function normLevSim(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

export function overshootOwed(input: OvershootInput): OvershootTarget | null {
  const { expected, spoken, rawMatched, rawPositions, rawConsumed, credited, prompting } = input;
  if (expected.length === 0) return null;
  // The overshoot check never runs while a prompt is playing.
  if (prompting) return null;
  // Effective matched = raw match OR fix-credit. lastMatchedIdx is
  // the last effectively matched word; the anchor below scans RAW
  // matches only (a credited-only word has no raw position).
  const matched: boolean[] = rawMatched.map((m, i) => m || credited.has(i));
  let lastMatchedIdx = -1;
  matched.forEach((m, i) => { if (m) lastMatchedIdx = i; });
  if (lastMatchedIdx < 0) return null;
  const nextIdx = lastMatchedIdx + 1;
  if (nextIdx >= expected.length) return null;
  const next = expected[nextIdx];
  // Words left in the next word's ayah, from the next word onward.
  let remaining = 0;
  for (let i = nextIdx; i < expected.length && expected[i].ayahIdx === next.ayahIdx; i++) remaining++;
  // F1: anchor at the END of the last raw match's consumed span.
  // Defensive fallback: a missing/short consumed array (stale cache)
  // anchors at the start rather than producing a NaN anchor.
  let anchor = -1;
  for (let i = lastMatchedIdx; i >= 0; i--) {
    if (rawMatched[i] && rawPositions[i] >= 0) {
      const span = rawConsumed && rawConsumed[i] ? rawConsumed[i] : 1;
      anchor = rawPositions[i] + span - 1;
      break;
    }
  }
  if (anchor < 0) return null;
  // F2: skip a LEADING run of liturgical phrases after the anchor —
  // a basmalah and/or isti'adha, each in order, each possibly a
  // prefix (the user may pause mid-phrase). Only exact in-order
  // contiguous phrases are skipped; the scan stops permanently at
  // the first non-phrase token, so out-of-order phrase words still
  // count. Counting only — grading is untouched.
  let scan = anchor + 1;
  for (;;) {
    let took = 0;
    for (const phrase of [OVERSHOOT_BASMALAH, OVERSHOOT_ISTIADHA]) {
      let k = 0;
      while (k < phrase.length && spoken[scan + k] === phrase[k]) k++;
      if (k > 0) { took = k; break; }
    }
    if (took === 0) break;
    scan += took;
  }
  const matchedNorms = new Set<string>();
  matched.forEach((m, i) => { if (m) matchedNorms.add(expected[i].norm); });
  // The owed ayah's own words, for the near-miss exclusion below
  // (a token similar to something owed is a variant of it, not
  // forward movement).
  const owedAyahNorms: string[] = [];
  expected.forEach((w) => { if (w.ayahIdx === next.ayahIdx) owedAyahNorms.push(w.norm); });
  const distinctNew = new Set<string>();
  for (let t = scan; t < spoken.length; t++) {
    const tok = spoken[t];
    if (matchedNorms.has(tok)) continue;
    // P1: opaque numeral artifacts carry no lexical evidence of
    // movement (they are engine renderings, not spoken words).
    if (isOpaqueToken(tok)) continue;
    // P0-1(b): near-miss variants of owed words are not movement.
    // Verified against the planted device replay: للمؤمنين vs
    // للمتقين scores 0.625 (< 0.7), so the replay still fires.
    let nearMiss = false;
    for (const w of owedAyahNorms) {
      if (normLevSim(tok, w) >= 0.7) { nearMiss = true; break; }
    }
    if (nearMiss) continue;
    distinctNew.add(tok);
  }
  // R2 (Claude-2, with the DEVIATION documented above): the first 2
  // words of the NEXT ayah (the smallest ayahIdx greater than the
  // owed word's ayah) are the positive evidence of moving on. If
  // there is no next ayah in the range, positive evidence is
  // impossible and only the >= 4 floor can fire.
  const nextAyahFirstNorms: string[] = [];
  for (let i = 0; i < expected.length && nextAyahFirstNorms.length < 2; i++) {
    if (expected[i].ayahIdx > next.ayahIdx) nextAyahFirstNorms.push(expected[i].norm);
  }
  let hasPositiveEvidence = false;
  for (const t of distinctNew) {
    if (nextAyahFirstNorms.includes(t)) { hasPositiveEvidence = true; break; }
  }
  if (remaining === 1) {
    // Tightest pigeonhole (any 2 distinct new words already exceed 1
    // slot) gated by positive evidence, plus the >= 4 noise floor
    // that keeps every shipped large-distinct fire case firing. A
    // single slip (distinct 1) never fires under either branch.
    if ((distinctNew.size >= 2 && hasPositiveEvidence) || distinctNew.size >= 4) {
      return { words: [next.orig], indices: [nextIdx], norms: [next.norm] };
    }
    return null;
  }
  // Roomier cases: the shipped rule, unchanged.
  if (distinctNew.size > remaining && distinctNew.size >= 4) {
    return { words: [next.orig], indices: [nextIdx], norms: [next.norm] };
  }
  return null;
}
