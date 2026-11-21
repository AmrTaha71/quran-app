// W5-N1 (2026-11-19): loads the prebuilt Mushaf skeletons
// (public/models/quranlab/follow-skel.json, made by
// tools/imam-eval/build_skel.ts) and builds the imamFollow index once per
// tab. Failures are not cached: the next call retries.
import { buildFollowIndex, istiadhaVerse, type FollowIndex, type FollowVerse } from './imamFollow';

export const FOLLOW_SKEL_URL = '/models/quranlab/follow-skel.json';

let pending: Promise<FollowIndex> | null = null;

export function parseFollowSkel(raw: { v: number; verses: [number, number, string][] }): FollowVerse[] {
  return raw.verses.map(([surah, ayah, sk]) => ({
    surah, ayah,
    words: (sk ? sk.split(' ') : []).map((skel) => ({ norm: '', skel })),
  }));
}

export function loadFollowIndex(): Promise<FollowIndex> {
  if (!pending) {
    pending = fetch(FOLLOW_SKEL_URL)
      .then((r) => { if (!r.ok) throw new Error(`follow-skel ${r.status}`); return r.json(); })
      .then((raw) => {
        const verses = parseFollowSkel(raw);
        const ist = istiadhaVerse(verses);
        return buildFollowIndex(ist ? [ist, ...verses] : verses);
      });
    pending.catch(() => { pending = null; });
  }
  return pending;
}
