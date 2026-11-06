// Shared "now playing ayah" store — the follow-along seam between
// Listen playback and the Mushaf page (feature #4, 2026-11-06).
//
// MODEL: a tiny module-singleton pub/sub, no React, no storage.
// ListenPage publishes the ayah currently playing (or a tafsir
// item, or null when nothing ayah-tracked is playing); any page
// can subscribe and highlight it. The Mushaf page does NOT read
// this yet — wiring its highlight is a later step that must not
// touch the Mushaf page image or slide; this store is the seam it
// will read, so no Listen change is needed then.
//
// VALUE: null = nothing ayah-tracked is playing right now (stopped,
// paused-and-cleared, riwaya/hadr surah-file playback which has no
// ayah steps, or a Juhani surah file inside a journey). Otherwise
// { surah, ayah, kind }: kind 'ayah' is a recited ayah, kind
// 'tafsir' is a tafsir clip for that ayah (no ayah text matches it,
// so a reader highlights the ayah the tafsir is ABOUT, or shows a
// tafsir badge instead — the reader's choice, not this store's).
//
// API:
//   setNowPlaying(value)        — publish (same value twice = no-op,
//                                 no duplicate notifications).
//   clearNowPlaying()           — publish null.
//   getNowPlaying()             — current value (null if none).
//   subscribeNowPlaying(cb)     — subscribe; returns unsubscribe.
// Hook-free, React-free, Supabase-free, same as the other engines.

export type NowPlayingAyah =
  | { surah: number; ayah: number; kind: 'ayah' | 'tafsir' }
  | null;

let current: NowPlayingAyah = null;
const subscribers = new Set<() => void>();

function same(a: NowPlayingAyah, b: NowPlayingAyah): boolean {
  if (a === null || b === null) return a === b;
  return a.surah === b.surah && a.ayah === b.ayah && a.kind === b.kind;
}

/** Publish the currently playing ayah (or null). No-op if unchanged. */
export function setNowPlaying(value: NowPlayingAyah): void {
  if (same(current, value)) return;
  current = value;
  for (const cb of [...subscribers]) {
    try {
      cb();
    } catch {
      // A throwing subscriber must never break playback.
    }
  }
}

/** Publish null — nothing ayah-tracked is playing. */
export function clearNowPlaying(): void {
  setNowPlaying(null);
}

/** Current value, or null if nothing ayah-tracked is playing. */
export function getNowPlaying(): NowPlayingAyah {
  return current;
}

/**
 * Subscribe to now-playing changes. Returns an unsubscribe
 * function. Callers read the current value with getNowPlaying()
 * inside the callback.
 */
export function subscribeNowPlaying(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
