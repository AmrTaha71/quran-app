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
  // Allah ligature (one codepoint, some keyboards): the name itself.
  // After ل the alef of الله is elided in writing (لله, not لالله),
  // so the ل-prefixed form is expanded first.
  s = s.replace(/ل\uFDF2/g, 'لله');
  s = s.replace(/\uFDF2/g, 'الله');
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
    .replace(/ء/g, '')
    // Non-standard keyboards: Farsi yeh/kaf and heh-doachashmee.
    // Without these, cleanToken deletes the letters entirely.
    .replace(/ی/g, 'ي')
    .replace(/[کڪ]/g, 'ك')
    .replace(/ھ/g, 'ه');
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
    .replace(/لاكن/g, 'لكن')
    // Name spellings where the mushaf drops a letter the recitation
    // keeps: Baqarah ابراهم = إبراهيم, and داود = داوود. Substring
    // replaces are safe here: these occur only as the name, with any
    // prefix. (ميكال is deliberately NOT mapped to ميكائيل: that is
    // a different reading's pronunciation, not a rasm variant.)
    .replace(/ابراهيم/g, 'ابراهم')
    .replace(/داوود/g, 'داود');
  // Uthmani open taa: in a closed list of words the mushaf writes a
  // final ت where imla'i writes ة (رحمت/رحمة، نعمت/نعمة، ...). Map
  // that ت to ه (the ة form after the step above) so both spellings
  // meet. Only a bare stem, with an optional و/ف/ال prefix, and no
  // suffix: رحمتك/رحمته keep their ت on both sides and are untouched.
  // Stems are in normalized form (امرات, not امرأت). This is NOT a
  // general ت->ه rule: that would merge e.g. مرة/مرت. Residual cost:
  // bare verb رحمه/لعنه/كلمه would also map here, but no such bare
  // token is believed to occur in the Quran (the suffixed forms keep
  // their ت: رحمته، لعنهم، كلمته).
  const openTaa = (tok: string): string => {
    const m = tok.match(/^([^\u0621-\u064A]*)([وف]?)(ال)?(رحمت|نعمت|لعنت|معصيت|شجرت|قرت|ابنت|امرات|سنت|بقيت|فطرت|جنت|كلمت|غيابت)([^\u0621-\u064A]*)$/);
    if (!m) return tok;
    return m[1] + m[2] + (m[3] || '') + m[4].slice(0, -1) + 'ه' + m[5];
  };
  s = s.split(/\s+/).map(openTaa).join(' ');
  return s.replace(/\s+/g, ' ').trim();
}

// ---- Muqatta'at (الحروف المقطعة) — 2026-10-28 --------------------
// Surah openings are pronounced letter by letter (ألف لام ميم) but
// written as one token (الم). The aligner compares normalized
// tokens, so spoken letter names never matched the written token —
// a correct recitation of 2:1 graded wrong. These helpers give the
// aligner, the follow-mode matcher, and the spoken correction ONE
// shared canonical form: the letter sequence itself.
//
// Why canonicalization, not a lookup of written forms: the seeded
// IndoPak text does not write every opening the same way. Verified
// against the seed file (ara-quranindopak): 2:1 "الٓمّٓۚ" (maddah)
// normalizes to الم, 2:1 in dagger spelling "الٰمٰ" to الاما,
// 19:1 "كٓهٰيٰعٓصٓ" to كهياعص (a dagger-before-yeh rule artifact —
// the هٰيٰ collapses), 40:1 "حٰمٓۚ" to حام (dagger becomes ا, maddah
// is stripped), 20:1 "طٰهٰ" (dagger, IB-8) to طاها, 36:1 "يٰسٓ"
// (dagger, IB-8) to ياس. All of these reduce to their letter
// sequence by one rule: drop every ا that directly follows a
// muqatta'at letter. The rule is only ever consulted when the
// result lands in the closed 14-token set below, and the spoken
// side must independently be letter names (or a canonical-equal
// token) — so a real word can only collide if it both reduces into
// the set AND is recited as letter names. The one real collision in
// the Quran is ألم (e.g. 105:1 ألم تر): it normalizes to الم, so the
// الم letter path additionally requires the next expected word to
// be one of the five genuine opening second words (ذلك، غلبت،
// أحسب، تنزيل، تلك). ألم is always followed by a verb in the Quran,
// never by one of those five.

export const MUQATTAAT_TOKENS = ['الم', 'المص', 'الر', 'المر', 'كهيعص', 'طه', 'طسم', 'طس', 'يس', 'ص', 'حم', 'عسق', 'ق', 'ن'];
// The 14 letters above, as a set string.
const MUQATTAAT_LETTERS = 'المصركهيعطسحقن';
// Spoken letter names in NORMALIZED form (ألف -> الف, راء -> را,
// طاء -> طا, حاء -> حا, هاء -> ها, ياء -> يا — the normalizer
// deletes ء, so ASR variants collapse here for free).
export const MUQATTAAT_NAME_TO_LETTER: Record<string, string> = {
  'الف': 'ا', 'لام': 'ل', 'ميم': 'م', 'صاد': 'ص', 'را': 'ر',
  'كاف': 'ك', 'ها': 'ه', 'يا': 'ي', 'عين': 'ع', 'طا': 'ط',
  'سين': 'س', 'حا': 'ح', 'قاف': 'ق', 'نون': 'ن',
};
// Full spoken names (for correction speech — written with ء so the
// voice pronounces them as letter names).
const MUQATTAAT_LETTER_TO_NAME: Record<string, string> = {
  'ا': 'ألف', 'ل': 'لام', 'م': 'ميم', 'ص': 'صاد', 'ر': 'راء',
  'ك': 'كاف', 'ه': 'هاء', 'ي': 'ياء', 'ع': 'عين', 'ط': 'طاء',
  'س': 'سين', 'ح': 'حاء', 'ق': 'قاف', 'ن': 'نون',
};
// Second words of the five الم openings (2:1 ذلك، 29:1 أحسب،
// 30:1 غلبت، 31:1 تلك، 32:1 تنزيل), in normalized form.
export const MUQATTAAT_ALIF_LAM_MEEM_SECONDS = ['ذلك', 'غلبت', 'احسب', 'تنزيل', 'تلك'];

// Canonical letter sequence of a normalized token, or null when the
// token is not a muqatta'at opening in any of its seeded spellings.
export function muqattaatLetters(token: string): string | null {
  if (MUQATTAAT_TOKENS.includes(token)) return token;
  let out = '';
  for (const ch of token) {
    if (ch === 'ا' && out.length > 0 && MUQATTAAT_LETTERS.includes(out[out.length - 1])) continue;
    out += ch;
  }
  return MUQATTAAT_TOKENS.includes(out) ? out : null;
}

// Quranic annotation marks: pause signs, ayah-end ornaments, sajdah
// marks. They carry no sound, so stripping them from correction
// speech is safe for EVERY word (letters and diacritics are kept —
// diacritics help the voice pronounce correctly). This fixes the
// general case of B3: the last word of an ayah used to reach
// generate-voice/TTS with its pause mark attached (e.g. ...ۚ).
const SPEECH_MARKS = /[\u06D6-\u06ED\u08D3-\u08FF]/g;
export function stripSpeechMarks(text: string): string {
  return text.replace(SPEECH_MARKS, '');
}

// Spoken correction text for a list of original (diacritized)
// expected words: muqatta'at tokens expand to their letter names
// (a missed الم is spoken as "ألف لام ميم", never as the written
// token), everything else passes through with only annotation marks
// stripped. The الم expansion is gated on the original token
// carrying a maddah (U+0653) or dagger alef (U+0670): the genuine
// openings are written with those marks, while the word ألم
// (e.g. 105:1) is written plain — so a missed ألم is still spoken
// as "ألم", never as letter names. Other tokens have no such
// collision, so they expand unconditionally.
export function correctionSpeechWords(words: string[]): string[] {
  const out: string[] = [];
  for (const w of words) {
    const norm = w ? normalizeArabic(w).replace(/[^\u0621-\u064A]/g, '') : '';
    const letters = norm ? muqattaatLetters(norm) : null;
    if (letters && (letters !== 'الم' || /[\u0653\u0670]/.test(w))) {
      for (const l of letters) out.push(MUQATTAAT_LETTER_TO_NAME[l]);
    } else {
      out.push(stripSpeechMarks(w));
    }
  }
  return out;
}
export function correctionSpeechText(words: string[]): string {
  return correctionSpeechWords(words).join(' ');
}

export function normalizeWords(text: string): string[] {
  return normalizeArabic(text)
    .split(/\s+/)
    .filter((w) => w.length > 0);
}
