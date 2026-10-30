// corrVerify.ts — SERVER-SIDE port of the client's correction-text logic.
// VERBATIM PORT WARNING: the functions below are copied byte-for-byte from
// src/lib/arabicNormalize.ts (DIACRITICS_AND_MARKS, normalizeArabic,
// muqatta'at helpers, stripSpeechMarks, correctionSpeechWords) so the
// server rebuilds EXACTLY the spoken text the client builds. If the
// client copy ever changes, port it again and re-run the equivalence
// test (scripts/corr-verify-test) before deploying — a divergence
// fails CLOSED (400) but degrades corrections to browser voice.


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
// Second words of the six الم openings (2:1 ذلك، 3:1 الله، 29:1 أحسب،
// 30:1 غلبت، 31:1 تلك، 32:1 تنزيل), in normalized form.
export const MUQATTAAT_ALIF_LAM_MEEM_SECONDS = ['ذلك', 'غلبت', 'احسب', 'تنزيل', 'تلك', 'الله'];

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
    // Round 2: a dagger-form norm (الاما) can only be an opening — the
    // word ألم always normalizes to plain الم — so it expands even
    // when the original lost its marks upstream. Plain الم still
    // needs its marks, exactly as before.
    if (letters && (letters !== 'الم' || norm !== 'الم' || /[\u0653\u0670]/.test(w))) {
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

// ---- Server-side verification helpers (NOT a port — written for the
// function, mirroring the client's expectedWordList/cleanToken in
// SelfTestPage.tsx and withPrecedingContextWord in corrPrompt.ts).
// The equivalence test (scripts/corr-verify-test) proves these match
// the client on real seeded ayahs, including muqatta'at openings,
// pause marks, and multi-ayah spans.

export function cleanToken(t: string): string {
  return t.replace(/[^\u0621-\u064A]/g, '');
}

export function expectedWordList(ayahText: string): { orig: string; norm: string }[] {
  return ayahText
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ orig: w, norm: cleanToken(normalizeArabic(w)) }))
    .filter((x) => x.norm.length > 0 && /[\u0621-\u064A]/.test(x.norm));
}

export interface CorrPosition {
  id: number;
  w: number;
}

// Rebuild the spoken correction text from seeded ayah texts.
// positions: one per MISSED expected word, in order (the context
// predecessor is derived, never sent). shape 'context' prepends the
// same-ayah predecessor of the first missed word (exactly the
// client's withPrecedingContextWord rule); shape 'bare' does not.
// Returns null on ANY invalid input (unknown ayah, out-of-range
// word, context shape on an ayah-initial word, empty positions) —
// the caller fails closed with 400 and never generates from
// unverified input.
export function buildCorrSpokenText(
  ayahTexts: Map<number, string>,
  positions: CorrPosition[],
  shape: 'context' | 'bare',
): string | null {
  if (positions.length === 0) return null;
  const wordLists = new Map<number, string[]>();
  const wordsAt = (id: number): string[] | null => {
    if (!wordLists.has(id)) {
      const text = ayahTexts.get(id);
      if (text === undefined) return null;
      wordLists.set(id, expectedWordList(text).map((x) => x.orig));
    }
    return wordLists.get(id)!;
  };
  const missed: string[] = [];
  for (const p of positions) {
    const list = wordsAt(p.id);
    if (!list || p.w < 0 || p.w >= list.length) return null;
    missed.push(list[p.w]);
  }
  let base = missed;
  if (shape === 'context') {
    const first = positions[0];
    if (first.w <= 0) return null;
    const list = wordsAt(first.id)!;
    base = [list[first.w - 1], ...missed];
  }
  return correctionSpeechWords(base).join(' ');
}
