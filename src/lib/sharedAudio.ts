// Shared audio unit: ONE <audio> element + one Media Session shared
// across the app's long-form audio sources (listen / adhkar).
// Starting any source STOPS the others: acquireAudio()
// pauses the element and notifies the previous owner via its
// onPreempted callback before handing ownership to the new owner.
//
// ANYWHERE-RESUME (2026-10-30): when a source that was PLAYING is
// preempted by a DIFFERENT owner (listen <-> adhkar), the preempted
// owner is pushed onto a resume stack. When the current holder
// releases the element (its page closes, it stops, it finishes),
// the stack top resumes automatically — even while its page is
// hidden on another route, and even with the screen locked (the
// element keeps playing in the background; if the browser blocks
// the resume play, the owner's own fallback applies and nothing
// crashes). Same-owner preemption (a listen mode switch: one
// engine replacing another under 'listen') never pushes: the user
// chose the new mode, so nothing older may come back.
// An owner that acquires while it has stack entries drops them:
// it is playing again, not waiting. OS interruptions (calls,
// another app) never touch this stack: they pause without
// releasing, so they stay tap-to-resume, never auto-resume.
//
// SCOPE: listen + adhkar only. The Mushaf's one-shot ayah
// playback uses its own short-lived elements, and self-test
// corrections use their own paths; both are OUT of scope.
//
// Node-testability: the element is created LAZILY on the first
// getSharedAudio()/acquireAudio() call, never at import time, so a
// node runner can install a fake Audio first. No Supabase, no React.

export type AudioOwner = 'listen' | 'radio' | 'adhkar';

export type ResumeFn = () => void;

let shared: HTMLAudioElement | null = null;

// The current holder, as an (owner, callback) pair. Pair identity
// matters: the same owner re-acquiring with the SAME callback (e.g.
// one engine's play() after pause()) is a no-op resume, not a
// preemption; a different owner, or a different engine instance
// (different callback object) holding the same role, preempts.
let holderOwner: AudioOwner | null = null;
let holderCallback: (() => void) | null = null;

// Resume dispatchers, one per owner, registered by the owning page
// (stable dispatcher closures that read the page's refs). Only
// consulted at preemption time; a page that never registers simply
// never auto-resumes.
const resumeByOwner = new Map<AudioOwner, ResumeFn>();

// Preempted owners waiting for the current holder to release.
// Entries are one-shot: popped before invocation, never replayed.
let resumeStack: Array<{ owner: AudioOwner; resume: ResumeFn }> = [];

export function getSharedAudio(): HTMLAudioElement {
  if (!shared) {
    shared = new Audio();
  }
  return shared;
}

export function registerResume(owner: AudioOwner, fn: ResumeFn): void {
  resumeByOwner.set(owner, fn);
}

export function unregisterResume(owner: AudioOwner): void {
  resumeByOwner.delete(owner);
  resumeStack = resumeStack.filter((e) => e.owner !== owner);
}

export function clearResumeStack(): void {
  resumeStack = [];
}

// True when a preempted owner waits for the current holder to
// release. Hide paths consult this: leaving a page releases only
// when someone waits, so the solo leave-and-return fast path
// (element untouched) is preserved.
export function hasWaitingResumes(): boolean {
  return resumeStack.length > 0;
}

function popAndResume(): void {
  const entry = resumeStack.pop();
  if (!entry) return;
  try {
    entry.resume();
  } catch {
    // Swallow: a failing resume must not break the releaser.
  }
}

export function acquireAudio(owner: AudioOwner, onPreempted?: () => void): HTMLAudioElement {
  const el = getSharedAudio();
  const cb = onPreempted ?? null;
  const isSameHolder = holderOwner === owner && holderCallback === cb;
  if (holderOwner !== null && !isSameHolder) {
    // Cross-owner preemption only: the previous owner waits on the
    // stack (if it registered a resume dispatcher). Same-owner
    // preemption (a mode/engine switch) never waits.
    const prevOwner = holderOwner;
    const prevResume = prevOwner !== owner ? resumeByOwner.get(prevOwner) : undefined;
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
    if (prevResume) {
      resumeStack.push({ owner: prevOwner, resume: prevResume });
    }
  }
  // Acquiring means playing again: any entries where this owner
  // was waiting are stale (its position moved on) — drop them.
  if (resumeStack.some((e) => e.owner === owner)) {
    resumeStack = resumeStack.filter((e) => e.owner !== owner);
  }
  holderOwner = owner;
  holderCallback = cb;
  return el;
}

export function releaseAudio(owner: AudioOwner): void {
  // Clears ONLY a matching holder: a preempted source's late
  // release must never steal the current holder's ownership, and
  // must never trigger a resume. A matching release means the
  // holder closed/stopped — the waiting top resumes.
  if (holderOwner === owner) {
    holderOwner = null;
    holderCallback = null;
    popAndResume();
  }
}

export function currentAudioOwner(): AudioOwner | null {
  return holderOwner;
}

export function stopSharedAudio(): void {
  // Pause + clear owner + resume the waiting top (same as a
  // release: stopping is closing). Deliberately does NOT create
  // the element just to stop it: if nothing ever played, there
  // is nothing to pause and no holder to clear beyond the nulls
  // below.
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
  popAndResume();
}
