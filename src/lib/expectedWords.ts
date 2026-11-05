// Extracted VERBATIM from SelfTestPage.tsx (no behaviour change) so
// the Juhani Phase-0 tooling (tools/juhani-align/export_words.ts) and
// the app use ONE tokenizer. Word numbering in the Juhani timing
// manifest is this function's output order, nothing else.
import { normalizeArabic } from './arabicNormalize';

// Spoken tokens for comparison: the normalizer strips diacritics but
// NOT punctuation, so a transcript "والله،" never equaled "والله".
// Strip every non-Arabic letter from both sides before aligning.
export function cleanToken(t: string): string {
  return t.replace(/[^\u0621-\u064A]/g, '');
}

// Expected ayah words, keeping the original (diacritized) form for
// display and the normalized form for comparison. Tokens with no
// Arabic letter in them (ayah-end markers, digits) are dropped
// defensively so they can never count as "missed" words.
export function expectedWordList(ayahText: string): { orig: string; norm: string }[] {
  return ayahText
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ orig: w, norm: cleanToken(normalizeArabic(w)) }))
    .filter((x) => x.norm.length > 0 && /[\u0621-\u064A]/.test(x.norm));
}
