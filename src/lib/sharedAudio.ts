// Shared audio unit: ONE <audio> element + one Media Session shared
// across the app's long-form audio sources (listen / radio / future
// adhkar). Starting any source STOPS the others: acquireAudio()
// pauses the element and notifies the previous owner via its
// onPreempted callback before handing ownership to the new owner.
//
// SCOPE: this unit covers listen + radio (+ future adhkar). The
// Mushaf's one-shot ayah playback uses its own short-lived elements
// and is OUT of scope for this patch (covering it would require
// touching QuranMushafPage) — a possible future adoption, not this
// work.
//
// ADHKAR: the 'adhkar' owner value is RESERVED ONLY. No adhkar
// audio is implemented here, no audio files are referenced, and no
// third-party files are hotlinked. It exists so a future adhkar
// source can plug into acquireAudio() without rework.
//
// Node-testability: the element is created LAZILY on the first
// getSharedAudio()/acquireAudio() call, never at import time, so a
// node runner can install a fake Audio first. No Supabase, no React.

export type AudioOwner = 'listen' | 'radio' | 'adhkar';

let shared: HTMLAudioElement | null = null;

// The current holder, as an (owner, callback) pair. Pair identity
// matters: the same owner re-acquiring with the SAME callback (e.g.
// one engine's play() after pause()) is a no-op resume, not a
// preemption; a different owner, or a different engine instance
// (different callback object) holding the same role, preempts.
let holderOwner: AudioOwner | null = null;
let holderCallback: (() => void) | null = null;

export function getSharedAudio(): HTMLAudioElement {
  if (!shared) {
    shared = new Audio();
  }
  return shared;
}

export function acquireAudio(owner: AudioOwner, onPreempted?: () => void): HTMLAudioElement {
  const el = getSharedAudio();
  const cb = onPreempted ?? null;
  const isSameHolder = holderOwner === owner && holderCallback === cb;
  if (holderOwner !== null && !isSameHolder) {
    // Preemption, in contract order: pause the element first, then
    // notify the previous owner, then set the new owner. The
    // previous callback is cleared BEFORE it runs, so a callback
    // that releases or re-acquires cannot corrupt the handover,
    // and a throwing callback cannot block the new owner.
    const prevCallback = holderCallback;
    holderOwner = null;
    holderCallback = null;
    try {
      el.pause();
    } catch {
      // Swallow: pausing is best-effort; the handover continues.
    }
    if (prevCallback) {
      try {
        prevCallback();
      } catch {
        // Swallow: a throwing previous owner must not block the
        // new owner.
      }
    }
  }
  holderOwner = owner;
  holderCallback = cb;
  return el;
}

export function releaseAudio(owner: AudioOwner): void {
  // Clears ONLY a matching holder: a preempted source's late
  // release must never steal the current holder's ownership.
  if (holderOwner === owner) {
    holderOwner = null;
    holderCallback = null;
  }
}

export function currentAudioOwner(): AudioOwner | null {
  return holderOwner;
}

export function stopSharedAudio(): void {
  // Pause + clear owner. Deliberately does NOT create the element
  // just to stop it: if nothing ever played, there is nothing to
  // pause and no holder to clear beyond the nulls below.
  // The previous holder's callback IS notified (same as
  // preemption): without it, a holder engine would keep believing
  // it is playing, and its next play() would early-return without
  // playing anything. The callback is cleared before it runs, as
  // in acquireAudio().
  const prevCallback = holderCallback;
  holderOwner = null;
  holderCallback = null;
  if (shared) {
    try {
      shared.pause();
    } catch {
      // Swallow.
    }
  }
  if (prevCallback) {
    try {
      prevCallback();
    } catch {
      // Swallow.
    }
  }
}
