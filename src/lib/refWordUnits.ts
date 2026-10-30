// Reference-word units for the SelfTest segmentation pilot (v0).
//
// IDEA (user brief, 2026-10-30): on a confirmed recitation error,
// play a REAL reciter's 3-word unit containing the mistaken word
// alongside the synthetic correction voice.
//
// AUDIO SOURCE — VERIFIED LIVE 2026-10-30 (browser check, not a
// guess): quran.com word-by-word files, 1-based indices:
//   https://audio.qurancdn.com/wbw/067_001_001.mp3  -> LOADED (1s clip,
//   first word of Al-Mulk 1:1, تَبَارَكَ — no Basmalah counted).
// The 0-based variant 067_001_000 404s, and the quranwbw mirror path
// (audio-words-new) 404s entirely — so the app word index i maps to
// file i+1. If that mapping ever drifts for an ayah, playback fails
// loudly (onerror) and the caller falls back — never a silent wrong
// word.
//
// SCOPE v1 (2026-10-30), GATED batch 3 on reviewer verdicts:
// URL pattern verified by HEAD requests 2026-10-30 for surahs 1,
// 2, 18, 36, 67, 112, 114 incl. mid/deep ayah words — every probe
// 200. The reference voice is quran.com's single word-by-word
// voice, NOT the user's chosen reciter: official docs name NO
// reciter for it (one fixed resource, no catalog) — never name
// one. CAVEAT (both reviewers, blocking): a 200 proves a file
// exists at that index, NOT that its word matches the app's
// space-split word at the same index (segmentation/Basmalah can
// drift per surah) — and a MISALIGNED file plays cleanly, so
// neither the "(تجربة)" label nor the onerror fallback catches
// it. Until the offline manifest check lands (app words vs
// Quran.com word list per ayah, wbw_ok[ayah]), ONLY Surah 67 —
// the ear-checked pilot — is verified and may serve units.
// All-surah URL support stays in wbwWordUrl; the gate below is
// what restricts presentation. Unverified surahs fall back to
// the synthetic correction voice, never to a possibly-wrong clip.
// Units are computed from the app's OWN expectedWordList split, so
// the unit always aligns with what SelfTest graded.
//
// UNITS: overlapping 3-word windows with starts at 0, 2, 4, ...
// (brief's 1-3, 3-5, 5-7 scheme). For a wrong word w, prefer the unit
// where w sits in the middle, else last, else first — i.e. preceding
// context first, matching the app's correction philosophy
// (withPrecedingContextWord). The final window truncates at the ayah
// end (shorter final unit allowed).

// Verified reference-unit surahs (see SCOPE note above).
// Extend ONLY from the wbw_ok manifest, never from HEAD 200s.
export const REF_VERIFIED_SURAHS = new Set([67]);

// Juz-30 extension (2026-10-30): manifest v1 (strict per-index
// normalized match) + Amr's human ear QA of the 15-clip
// stratified Juz-30 sample (all good) authorize the 548
// manifest_ok Juz-30 ayahs, with the "(تجربة)" label kept and
// monitored rollout. The 16 Juz-30 ayahs outside the set stay
// synthetic-only. Imported lazily through the helper below so
// this module keeps its single-gate shape for callers.
import { isWbwManifestJuz30Ok } from './wbwManifestJuz30';

/** True when a ref unit may be offered for this ayah: the Surah 67
 *  pilot, or a Juz-30 ayah in the manifest_ok set. Everything else
 *  stays synthetic-only. */
export function isRefUnitEnabled(surah: number, ayah: number): boolean {
  return REF_VERIFIED_SURAHS.has(surah) || isWbwManifestJuz30Ok(surah, ayah);
}

const WBW_BASE = 'https://audio.qurancdn.com/wbw';

const pad3 = (n: number): string => String(n).padStart(3, '0');

/** Word-by-word audio URL for app word index `wordIdx0` (0-based). */
export function wbwWordUrl(surah: number, ayah: number, wordIdx0: number): string {
  return `${WBW_BASE}/${pad3(surah)}_${pad3(ayah)}_${pad3(wordIdx0 + 1)}.mp3`;
}

/** Overlapping 3-word unit (0-based, inclusive) containing `wrongIdx`. */
export function refUnitForWord(wordCount: number, wrongIdx: number): { start: number; end: number } {
  if (wordCount <= 0) return { start: 0, end: -1 };
  const w = Math.min(Math.max(wrongIdx, 0), wordCount - 1);
  // Even starts s with s <= w <= s+2; prefer middle (w-s==1),
  // then last (w-s==2), then first (w-s==0).
  const candidates: number[] = [];
  for (let s = 0; s <= w; s += 2) {
    if (w <= s + 2) candidates.push(s);
  }
  let start = candidates[0] ?? 0;
  for (const s of candidates) {
    if (w - s === 1) { start = s; break; }
    if (w - s === 2) start = s;
  }
  const end = Math.min(start + 2, wordCount - 1);
  return { start, end };
}
