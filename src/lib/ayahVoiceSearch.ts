// 15.7 (2026-11-26): find an ayah from a short recitation. The device ear's
// phonemes become consonant letters (followSkel); 4-letter grams vote for
// places in the whole Mushaf (the follow-the-imam index); the best places are
// aligned against what was heard and the top few DIFFERENT ayat come back,
// best first, with how well each matched. Pure: no React, no DOM.
import { alignWindow, gramHits, GRAM, type FollowIndex } from './imamFollow.ts';

export type AyahHit = { surah: number; ayah: number; /** errors per heard letter, 0 = exact */ rate: number };

/** Fewer heard letters than this cannot name a place (≈ two short words). */
export const VOICE_SEARCH_MIN_LETTERS = 10;
/** Worse than this is not shown at all. */
export const VOICE_SEARCH_MAX_RATE = 0.45;

export function findAyahCandidates(idx: FollowIndex, heard: string, max = 3): AyahHit[] {
  const H = heard.length > 80 ? heard.slice(0, 80) : heard; // the start names the place
  if (H.length < VOICE_SEARCH_MIN_LETTERS) return [];
  const votes = new Map<number, number>();
  for (let i = 0; i + GRAM <= H.length; i++) {
    const { from, to } = gramHits(idx, H, i);
    if (to <= from || to - from > 4000) continue;
    for (let k = from; k < to; k++) {
      const b = Math.floor((idx.gramPos[k] - i) / 8);
      votes.set(b, (votes.get(b) ?? 0) + 1);
    }
  }
  const buckets = [...votes.entries()].filter((e) => e[1] >= 2).sort((a, b) => b[1] - a[1]).slice(0, 24);
  const byAyah = new Map<string, AyahHit>();
  for (const [b] of buckets) {
    const d = b * 8;
    const r = alignWindow(H, idx.letters, d - 16, d + H.length + 24);
    if (!r) continue;
    const rate = r.cost / H.length;
    if (rate > VOICE_SEARCH_MAX_RATE) continue;
    const w = idx.words[idx.owner[Math.max(0, Math.min(idx.owner.length - 1, r.start))]];
    if (!w || w.surah === 0) continue; // the isti'adha is not an ayah
    const key = `${w.surah}:${w.ayah}`;
    const prev = byAyah.get(key);
    if (!prev || rate < prev.rate) byAyah.set(key, { surah: w.surah, ayah: w.ayah, rate });
  }
  const hits = [...byAyah.values()].sort((a, b) => a.rate - b.rate);
  // The basmala alone names no place: drop 1:1 when anything else matched.
  const filtered = hits.length > 1 ? hits.filter((h) => !(h.surah === 1 && h.ayah === 1)) : hits;
  return filtered.slice(0, max);
}
