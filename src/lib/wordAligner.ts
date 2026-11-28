// The tasmee' word aligner (10.6, 2026-11-26): moved out of SelfTestPage.tsx
// unchanged, so it can be unit-tested and shared (rounds, the written test).
// Pure functions, no React, no storage. alignWords is the lenient pass
// (extra spoken words ignored); alignWordsStrict is the same greedy in-order
// match that also collects extras. They are kept as two functions until a
// same-input/same-output comparison over the whole Mushaf proves one merged
// function equal (see wordAligner.test.ts and the phase 6 report).
import { IMLA_ALT, IMLA_PAIR_ALT } from './imlaAlt.ts';
import { applyLisp } from './lispLetters.ts';
import {
  normalizeWords, digitTokenToOpaque, muqattaatLetters, MUQATTAAT_NAME_TO_LETTER,
  MUQATTAAT_ALIF_LAM_MEEM_SECONDS, muqattaatWindowMatches, muqattaatIsLetterPiece,
  muqattaatAlifLamMeemBlocked,
} from './arabicNormalize.ts';
import { isOpaqueToken } from './overshoot.ts';
import { cleanToken } from './expectedWords.ts';

export function spokenTokens(text: string): string[] {
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
export function assimilatedPairForms(a: string, b: string): string[] {
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
export function splitMatches(parts: string[], expected: string): boolean {
  if (splitMatchesExact(parts, expected)) return true;
  const alts = IMLA_ALT[expected];
  if (alts) for (const a of alts) if (splitMatchesExact(parts, a)) return true;
  return false;
}
function splitMatchesExact(parts: string[], expected: string): boolean {
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

// Same-word equality across spellings (rewritten 2026-11-10).
// Measured on a word-perfect recitation of all 6236 ayahs typed in
// everyday spelling, the old rule (delete every ا/ى/ي, collapse any
// doubled letter, forgive a final ه) still failed 510 ayahs at the
// strict levels AND accepted different words as equal (الدنيا for
// الدين, الله for لله, فيها for فيه, على for عليه). Now:
//   1. exact match, or the word's own known spelling in the other
//      scripts (IMLA_ALT, generated from the three full texts);
//   2. else a narrow dictation tolerance against any of those
//      spellings: a dropped long alif INSIDE the word (يغشها for
//      يغشاها), a doubled ي or ل, and a dropped final «ها» after a long
//      alif (جلا for جلاها). A different consonant, a missing prefix or
//      a different ending is a different word.
// Same measurement after the change: 24 ayahs (all multi-word joins).
const softSkeleton = (w: string) => w.replace(/ة/g, 'ه').replace(/(?<=.)ا(?=.)/g, '').replace(/يي+/g, 'ي').replace(/لل+/g, 'ل');
export function softWordEq(spoken: string, expected: string): boolean {
  if (spoken === expected) return true;
  const alts = IMLA_ALT[expected];
  if (alts && alts.includes(spoken)) return true;
  // Owner rule: a madd length is never a mistake. A stretched madd is heard
  // as a repeated ا/و/ي (اعطينااك، الكووثر); fold the run to one letter and
  // compare again. Only repeats fold: a madd letter the word lacks stays a
  // difference. shortcut: an expected word with a real وو (ووري) stretched
  // further is not folded; fold to the expected run length if that shows up.
  const folded = spoken.replace(/([اوي])\1+/g, '$1');
  if (folded !== spoken) return softWordEq(folded, expected);
  const cands = alts ? [expected, ...alts] : [expected];
  // Owner rule (2026-11-28): a madd letter added or dropped is not a mistake,
  // and a dropped hamzat wasl after و/ف is the same sound. Consonants must match:
  //   * final ا dropped (إن for إنا), but not after ه: ها/ه is her/him (فيه≠فيها);
  //   * final ي added (فصلي for فصل: the end kasra heard long);
  //   * the ا of a leading وا/فا dropped (ونحر for وانحر).
  // shortcut: hamzat qat' is lost in norm (وأنتم = وانتم), so ونتم passes too;
  // a bare leading ا (اكبر/كبر, امر/مر) is not dropped for that reason.
  for (const c of cands) {
    if (spoken.length >= 2 && !spoken.endsWith('ه') && c === spoken + 'ا') return true;
    // Length >= 3: on 2-letter words an added ي makes a different word (من→مني, ان→اني).
    if (c.length >= 3 && spoken === c + 'ي') return true;
    if (/^[وف]ا./.test(c) && spoken === c[0] + c.slice(2)) return true;
  }
  if (spoken.length < 3) return false;
  const sp = softSkeleton(spoken);
  for (const c of cands) {
    if (sp === softSkeleton(c)) return true;
    if (c.length >= 5 && c.endsWith('اها') && spoken === c.slice(0, -2)) return true;
  }
  return false;
}

// A later occurrence of the word must not be credited to an earlier,
// skipped one (2026-11-10). Greedy first-match used to jump ahead: with
// the first «عليهم» of 1:7 skipped, it matched the second one, then
// marked «غير المغضوب عليهم» wrong although they were recited. When the
// very next spoken word is one of the next three expected words, the
// reciter has moved on: this expected word was skipped.
function skippedAhead(expected: string[], i: number, spoken: string[], j: number, found: number): boolean {
  if (found <= j) return false;
  for (let t = i + 1; t <= i + 3 && t < expected.length; t++) {
    if (softWordEq(spoken[j], expected[t]) && !softWordEq(spoken[j], expected[i])) return true;
  }
  return false;
}

// Two mushaf tokens that are one spoken word (the IndoPak in-word iqlab
// space, «اَنۭۡ بِيَآءَ» = أنبياء): index of that spoken word at or after
// j, or -1. Checked before the single-word match, because the first half
// alone («ان») is a common word that would otherwise match further on
// and leave the second half "missing".
function pairAltAt(expected: string[], i: number, spoken: string[], j: number): number {
  if (i + 1 >= expected.length) return -1;
  const alts = IMLA_PAIR_ALT[`${expected[i]} ${expected[i + 1]}`];
  if (!alts) return -1;
  for (let k = j; k < spoken.length; k++) if (alts.includes(spoken[k])) return k;
  return -1;
}


// Opening (2026-11-12, Dr. Amr): «أعوذ بالله من الشيطان الرجيم» and/or
// «بسم الله الرحمن الرحيم» said before the first word are a preface —
// never a mistake, never corrected, never an extra. A phrase counts when
// most of its words are heard in order (the ear may mishear one). The
// basmala is NOT skipped when the range itself starts with it (1:1).
const ISTIADHA = ['اعوذ', 'بالله', 'من', 'الشيطان', 'الرجيم'];
const BASMALA = ['بسم', 'الله', 'الرحمن', 'الرحيم'];
function phraseAt(spoken: string[], at: number, phrase: string[], need: number): number {
  let hit = 0;
  for (let t = 0; t < phrase.length && at + t < spoken.length; t++) if (softWordEq(spoken[at + t], phrase[t])) hit++;
  return hit >= need ? phrase.length : 0;
}
export function openingSkip(expected: string[], spoken: string[]): number {
  let at = 0;
  at += phraseAt(spoken, at, ISTIADHA, 4);
  const rangeStartsWithBasmala = expected.length > 0 && softWordEq(expected[0], 'بسم');
  if (!rangeStartsWithBasmala) at += phraseAt(spoken, at, BASMALA, 3);
  return Math.min(at, spoken.length);
}

export function alignWords(expected: string[], spoken: string[]): { matched: boolean[]; allMatched: boolean; positions: number[]; consumed: number[] } {
  // Item 17.1: a word that differs only at the user's lisp letters is the word
  // (one place for سمّع لي, continuous mode and both round tests via alignBridge).
  spoken = applyLisp(expected, spoken);
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
  const breathAll = breathRepeats(expected, spoken);
  let j = openingSkip(expected, spoken);
  let i = 0;
  let started = false;
  let gap = 0;
  while (i < expected.length) {
    if (i > 0 && matched[i - 1]) { started = true; gap = 0; }
    // Expected-side limit (2026-11-12 diag 57654b7): a leftover spoken word
    // («هدى» said twice in 2:2) must not be matched by the same word 25
    // expected words further on (2:5) — that jumped the pointer to ayah 5
    // and played a 17s correction of all of 2:4. Once under way, matching
    // stops after 10 expected words in a row with no match.
    if (started && gap++ > 10) break;
    let found = -1;
    {
      // Reach limit (2026-11-12 diag): once he is under way, a word may
      // only match near where he is. Unlimited reach let a short common
      // word («هم» of 2:4, misheard locally) match far ahead inside 2:5,
      // which then marked all of 2:5 wrong. Breath repeats do not count
      // toward the distance. Before the first match (isti'adha, basmala)
      // the reach stays unlimited.
      const limit = !started ? Infinity : (expected[i].length <= 3 ? 6 : 14);
      let dist = 0;
      for (let k = j; k < spoken.length; k++) {
        if (softWordEq(spoken[k], expected[i])) { found = k; break; }
        if (!breathAll.has(k) && ++dist > limit) break;
      }
    }
    if (found >= 0 && skippedAhead(expected, i, spoken, j, found)) found = -1;
    {
      const kp = pairAltAt(expected, i, spoken, j);
      if (kp >= 0 && (found < 0 || kp <= found)) { matched[i] = true; matched[i + 1] = true; positions[i] = kp; positions[i + 1] = kp; j = kp + 1; i += 2; continue; }
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
      const pairAlts = IMLA_PAIR_ALT[`${expected[i]} ${expected[i + 1]}`];
      let foundPair = -1;
      for (let k = j; k < spoken.length; k++) {
        if (spoken[k] === pair || forms.includes(spoken[k]) || softWordEq(spoken[k], pair) || (pairAlts && pairAlts.includes(spoken[k]))) { foundPair = k; break; }
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
// Breath restarts (2026-11-12, agreed: normal, never a mistake). After a
// breath a reciter often goes back one to a few words and continues:
// «لا ريب فيه | فيه هدى», «ذلك الكتاب لا ريب | الكتاب لا ريب فيه».
// A run of 1–8 spoken words that repeats the run just before it is a
// restart, unless the mushaf text itself repeats that run at this point
// («كلا سوف تعلمون ثم كلا سوف تعلمون», «فإن مع العسر يسرا إن مع العسر يسرا»).
// Returns the spoken indices of the repeated copy; they are never extras.
export function breathRepeats(expected: string[], spoken: string[]): Set<number> {
  const out = new Set<number>();
  const expJoined = ` ${expected.join(' ')} `;
  for (let k = 1; k < spoken.length; k++) {
    if (out.has(k)) continue;
    for (let n = Math.min(8, k); n >= 1; n--) {
      if (k + n > spoken.length) continue;
      let same = true;
      for (let t = 0; t < n; t++) if (!softWordEq(spoken[k + t], spoken[k - n + t])) { same = false; break; }
      if (!same) continue;
      const run = spoken.slice(k - n, k).join(' ');
      if (expJoined.includes(` ${run} ${run} `)) continue;
      for (let t = 0; t < n; t++) out.add(k + t);
      break;
    }
  }
  return out;
}

export function alignWordsStrict(expected: string[], spoken: string[]): { matched: boolean[]; allMatched: boolean; extras: string[]; positions: number[]; consumed: number[] } {
  const matched = new Array(expected.length).fill(false);
  const positions = new Array(expected.length).fill(-1);
  // F1: consumed counts, same sites as alignWords (see above).
  const consumed = new Array(expected.length).fill(1);
  const extras: string[] = [];
  const breath = breathRepeats(expected, spoken);
  const breathAll = breath;
  let j = openingSkip(expected, spoken);
  let i = 0;
  let started = false;
  let gap = 0;
  const consumeThrough = (k: number, count: number) => {
    for (let t = j; t < k; t++) if (!breath.has(t)) extras.push(spoken[t]);
    j = k + count;
  };
  while (i < expected.length) {
    if (i > 0 && matched[i - 1]) { started = true; gap = 0; }
    // Expected-side limit (2026-11-12 diag 57654b7): a leftover spoken word
    // («هدى» said twice in 2:2) must not be matched by the same word 25
    // expected words further on (2:5) — that jumped the pointer to ayah 5
    // and played a 17s correction of all of 2:4. Once under way, matching
    // stops after 10 expected words in a row with no match.
    if (started && gap++ > 10) break;
    let found = -1;
    {
      // Reach limit (2026-11-12 diag): once he is under way, a word may
      // only match near where he is. Unlimited reach let a short common
      // word («هم» of 2:4, misheard locally) match far ahead inside 2:5,
      // which then marked all of 2:5 wrong. Breath repeats do not count
      // toward the distance. Before the first match (isti'adha, basmala)
      // the reach stays unlimited.
      const limit = !started ? Infinity : (expected[i].length <= 3 ? 6 : 14);
      let dist = 0;
      for (let k = j; k < spoken.length; k++) {
        if (softWordEq(spoken[k], expected[i])) { found = k; break; }
        if (!breathAll.has(k) && ++dist > limit) break;
      }
    }
    if (found >= 0 && skippedAhead(expected, i, spoken, j, found)) found = -1;
    {
      const kp = pairAltAt(expected, i, spoken, j);
      if (kp >= 0 && (found < 0 || kp <= found)) { consumeThrough(kp, 1); matched[i] = true; matched[i + 1] = true; positions[i] = kp; positions[i + 1] = kp; i += 2; continue; }
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
      const pairAlts = IMLA_PAIR_ALT[`${expected[i]} ${expected[i + 1]}`];
      let foundPair = -1;
      for (let k = j; k < spoken.length; k++) {
        if (spoken[k] === pair || forms.includes(spoken[k]) || softWordEq(spoken[k], pair) || (pairAlts && pairAlts.includes(spoken[k]))) { foundPair = k; break; }
      }
      if (foundPair >= 0) { consumeThrough(foundPair, 1); matched[i] = true; matched[i + 1] = true; positions[i] = foundPair; positions[i + 1] = foundPair; i += 2; continue; }
    }
    i++;
  }
  // Trailing spoken words after the last match are extras too.
  for (let t = j; t < spoken.length; t++) if (!breath.has(t)) extras.push(spoken[t]);
  // P1: opaque numeral tokens are never extras — they are ASR
  // artifacts (Safari wrote "2", the user did not say it), so
  // counting one as an extra would penalize the engine's rendering,
  // not the recitation. They stay visible in heard counts/display.
  return { matched, allMatched: matched.every(Boolean), extras: extras.filter((t) => !isOpaqueToken(t)), positions, consumed };
}

