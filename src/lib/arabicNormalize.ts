// Cross-rasm Arabic normalization for search.
//
// The stored text is the IndoPak edition (the seed source), the
// printed Mushaf images are Madinah Uthmani, and users type imla'i
// (or speak it — voice transcripts are imla'i by nature). The same
// word is spelled three different ways across those, so a plain
// (even diacritic-stripped) substring search misses most matches.
// This function maps all three spellings to ONE canonical form, and
// the SAME function normalizes both the stored text and the query.
//
// Examples (verified against the real seeded text, all 6,236 verses):
//   IndoPak الصَّلٰوةَ / Uthmani الصَّلَوٰةَ / imla'i الصَّلَاةَ
//     -> الصلاه
//   IndoPak ٱلرِّبٰوا / imla'i الرِّبَا -> الربا
//   IndoPak عَلٰي / imla'i عَلَى -> علي
//   IndoPak اُولٰٓئِكَ / imla'i أُولَئِكَ -> اوليك
//   IndoPak مٰلِكِ / imla'i مَالِكِ -> مالك
//   IndoPak ٱلْعٰلَمِينَ / imla'i الْعَالَمِينَ -> العالمين
//   IndoPak ٱلْقِيٰمَةِ / imla'i الْقِيَامَةِ -> القيامه
//   Uthmani/imla'i رَءُوفٌ / رَؤُوفٌ -> روف
//     (a hamza immediately before waw collapses into the waw)
//   Voice-style imla'i فمن تبع هداي -> matches 2:38.
//
// Order matters: multi-character rasm sequences are resolved FIRST
// (while the dagger alef U+0670 is still present), then marks are
// stripped, then remaining standalone daggers become alif, then
// single-letter variants are merged. The sequence rules are ordered
// most-specific-first so one rule's output cannot feed another
// (e.g. alef+dagger is resolved before dagger+waw, so آوَى stays
// اوى instead of collapsing).
//
// A few dagger-alef words are exceptions: in الله and الرحمن (and
// إله، هذه، هؤلاء) the dagger marks a length imla'i leaves unwritten,
// so after everything else they are mapped back to their imla'i forms.
//
// Known limit (documented, not fixable by normalization): true
// letter differences between riwayat, e.g. Hafs مَـٰلِكِ (مالك) vs
// Warsh مَلِكِ (ملك) in 1:4 — different letters, not different
// spellings of the same letters. Those need a variant map, which is
// out of scope here.

// Diacritics and Quranic marks. NOTE: dagger alef U+0670 is
// deliberately NOT in this set — it is a letter, not a mark, and is
// resolved by the sequence rules and the standalone rule below.
const DIACRITICS_AND_MARKS =
  /[\u0610-\u061A\u064B-\u065F\u06D6-\u06DC\u06DD\u06DE\u06DF-\u06E8\u06E9\u06EA-\u06ED\u08D3-\u08FF\u0640\u200C-\u200F\u061C\u061F]/g;

export function normalizeArabic(text: string): string {
  if (!text) return '';
  let s = text;
  // Marks that may sit between a dagger and its letter in IndoPak
  // (e.g. مُوسٰ٘ي, where a small mark follows the dagger).
  const MARKS =
    '[\u0610-\u061A\u064B-\u065F\u06D6-\u06DC\u06DD\u06DE\u06DF-\u06E8\u06E9\u06EA-\u06ED\u08D3-\u08FF\u0640\u200C-\u200F\u061C\u061F]';
  // IndoPak final long-a: consonant + dagger + waw + alef -> alef.
  // Guarded: not after an alef, where the dagger is a madda
  // (آوَى must stay اوى, not collapse).
  s = s.replace(/([^ا])\u0670\u0648\u0627/g, '$1ا');
  // Possessive after a maksura: maksura + dagger + yeh -> alif + yeh
  // (هُدَىٰيَ -> هداي, as imla'i writes it).
  s = s.replace(/ى\u0670ي/g, 'اي');
  // Dagger on a maksura is redundant: the maksura IS the length
  // (مُوسَىٰ -> موسى، هُدَىٰ -> هدى).
  s = s.replace(/ى\u0670/g, 'ى');
  // Alef + dagger is a single alef, not two (القراٰن -> القرآن،
  // اٰمنوا -> امنوا).
  s = s.replace(/ا\u0670/g, 'ا');
  // IndoPak medial long-a: dagger + waw -> alef (الصَّلٰوةَ -> الصلاة).
  // Guarded: not when the waw is a real consonant between two
  // daggers (السَّمٰوٰتِ -> السماوات, with the waw kept).
  s = s.replace(/\u0670\u0648(?!\u0670)/g, 'ا');
  // Uthmani alif written as waw + dagger. The waw is the length's
  // seat (and vanishes) only before ة, ا, or a word end
  // (الصَّلَوٰةَ -> الصلاة، الرِّبَوٰا -> الربا); elsewhere the waw
  // is a real consonant and the dagger is the length after it
  // (وٰعَدْنَا -> واعدنا، الصَّلَوٰتِ -> الصلوات).
  s = s.replace(/\u0648\u0670(?=[ةا ]|$)/g, 'ا');
  s = s.replace(/\u0648\u0670/g, 'وا');
  // Dagger (+ marks) before a hamza seat is redundant: the seat
  // already carries the length (اُولٰٓئِكَ -> اولئك، مُوسٰ٘ي -> موسى).
  // Covers both the precomposed seat (ئ) and yeh + high hamza (ئ).
  s = s.replace(new RegExp(`\u0670${MARKS}*[يىئ]${MARKS}*`, 'g'), 'ئ');
  // Hamza immediately before waw collapses into the waw, merging
  // رَءُوفٌ and رَؤُوفٌ (both -> روف).
  s = s.replace(/[ؤءئ]\u0648/g, 'و');
  // Strip all remaining diacritics and Quranic marks.
  s = s.replace(DIACRITICS_AND_MARKS, '');
  // Remaining standalone dagger alefs are plain long-a.
  s = s.replace(/\u0670/g, 'ا');
  // Single-letter variants -> one canonical form.
  s = s
    .replace(/[أإآٱٲٵ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ء/g, '');
  // Dagger-alef exceptions: words whose imla'i form has no alef at
  // all. The للاه rule also covers اللاه and its prefixed forms, since
  // اللاه contains للاه after its first letter. ذالك/لاكن cover
  // their prefixed forms the same way (كذلك، ذلكم، ولكن).
  s = s
    .replace(/للاه/g, 'لله')
    .replace(/الرحمان/g, 'الرحمن')
    .replace(/الاه/g, 'اله')
    .replace(/هاذه/g, 'هذه')
    // Post-drop form: the ء is already gone by this stage, so the
    // pattern is هاولا (from هٰولاء with any intervening marks).
    .replace(/هاولا/g, 'هولا')
    .replace(/ذالك/g, 'ذلك')
    .replace(/لاكن/g, 'لكن');
  return s.replace(/\s+/g, ' ').trim();
}

export function normalizeWords(text: string): string[] {
  return normalizeArabic(text)
    .split(/\s+/)
    .filter((w) => w.length > 0);
}
