// Listen-to-Quran playback engine — "استمع للقرآن".
//
// Hook-free, React-free, Supabase-free. The playing element is the
// SHARED audio unit's singleton (see sharedAudio.ts), reused for
// every ayah (only its src changes), so playback started from a user
// gesture on that single element is the background-safe path on iOS
// Safari + Android Chrome (survives lock + app-switch). Starting
// another source (radio) preempts this engine via acquireAudio():
// the engine is treated as interrupted (persist + onInterrupted,
// never auto-resume) and ignores further element events until it
// re-acquires on play(). A second DETACHED Audio element
// (preload='auto', never played) only warms the following clip's
// URL; it is never the playing element.
//
// Background-safe chaining: while the current ayah plays, the NEXT
// ayah's URL is pre-resolved (via the injected resolver, default =
// the reciter's audioUrl) and kept in hand. The 'ended' handler then
// SYNCHRONOUSLY sets src to the already-resolved URL and calls
// play() — no setTimeout, no await on the hot path, because a gap
// risks iOS suspending the page while locked. If the pre-resolved
// URL is somehow not ready at 'ended', the handler falls back to
// awaiting the resolver and then playing (degraded, noted in NOTES).
//
// POSITION MODEL (surah-level timeline): a position is
// (surah, ayah, time-in-ayah in seconds). ListenPosition carries
// time; getPosition() reports live audio.currentTime; wird writes
// time 0 on ayah advance and the live time on pause / destroy /
// external pause / tab-hide. This is the seam for a future
// stitched full-surah source: it would replace the chaining loop
// with timeupdate-driven ayah detection from a timing table while
// ListenPosition, onAyahChange, and the UI stay untouched (see
// NOTES — full-surah timing sources are UNVERIFIED today, which is
// why per-ayah chaining stays the first implementation).
//
// INTERRUPTION: the engine NEVER auto-resumes. Tab-hide
// (visibilitychange) and external 'pause' events persist (wird)
// and fire onInterrupted; resume is a UI button the UI team shows
// on onInterrupted.

import { RECITERS, DEFAULT_RECITER_ID } from './reciters';
import { SURAHS, SURAH_AYAH_COUNTS } from './surahs';
import { getSharedAudio, acquireAudio, releaseAudio } from './sharedAudio';

export type ListenMode = 'free' | 'wird';

export interface ListenPosition {
  surah: number;
  ayah: number;
  reciter: string;
  // Seconds into the current ayah. Optional for callers; the engine
  // always reports it from getPosition() / readListeningWird().
  time?: number;
}

export const LISTENING_WIRD_KEY = 'quran-listening-wird';

const ERROR_MESSAGE = 'تعذرت التلاوة — تحقق من الاتصال وحاول تاني';

// ------------------------------------------------------------------
// localStorage helpers. localStorage is read from globalThis AT CALL
// TIME (never at import time) so a node runner can install fakes.
// Every failure is swallowed and yields null / no-op, matching the
// repo's localStorage discipline (e.g. 'quran-reciter').
// ------------------------------------------------------------------

function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export function readListeningWird(): ListenPosition | null {
  try {
    const ls = storage();
    if (!ls) return null;
    const raw = ls.getItem(LISTENING_WIRD_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { surah, ayah, reciter, time } = parsed as {
      surah?: unknown;
      ayah?: unknown;
      reciter?: unknown;
      time?: unknown;
    };
    if (!Number.isInteger(surah) || (surah as number) < 1 || (surah as number) > 114) return null;
    const count = SURAH_AYAH_COUNTS[(surah as number) - 1];
    if (!Number.isInteger(ayah) || (ayah as number) < 1 || (ayah as number) > count) return null;
    if (typeof reciter !== 'string' || !RECITERS.some((r) => r.id === reciter)) return null;
    // time is lenient: a finite number >= 0 is kept, anything else
    // (missing, NaN, negative, non-number) normalises to 0 — a bad
    // time must never invalidate an otherwise good position.
    const cleanTime =
      typeof time === 'number' && Number.isFinite(time) && time >= 0 ? time : 0;
    return { surah: surah as number, ayah: ayah as number, reciter, time: cleanTime };
  } catch {
    return null;
  }
}

export function writeListeningWird(pos: ListenPosition): void {
  try {
    const ls = storage();
    if (!ls) return;
    ls.setItem(LISTENING_WIRD_KEY, JSON.stringify(pos));
  } catch {
    // Swallow: persistence must never break playback.
  }
}

export function clearListeningWird(): void {
  try {
    const ls = storage();
    if (!ls) return;
    ls.removeItem(LISTENING_WIRD_KEY);
  } catch {
    // Swallow, as above.
  }
}

// ------------------------------------------------------------------
// Ayah navigation. Never auto-advances across a surah boundary:
// nextAyah returns null at the surah's last ayah, prevAyah null at
// ayah 1. Out-of-range inputs also yield null.
// ------------------------------------------------------------------

export function nextAyah(surah: number, ayah: number): { surah: number; ayah: number } | null {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) return null;
  const count = SURAH_AYAH_COUNTS[surah - 1];
  if (!Number.isInteger(ayah) || ayah < 1 || ayah > count) return null;
  if (ayah >= count) return null;
  return { surah, ayah: ayah + 1 };
}

export function prevAyah(surah: number, ayah: number): { surah: number; ayah: number } | null {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) return null;
  const count = SURAH_AYAH_COUNTS[surah - 1];
  if (!Number.isInteger(ayah) || ayah < 1 || ayah > count) return null;
  if (ayah <= 1) return null;
  return { surah, ayah: ayah - 1 };
}

export type UrlResolver = (reciterId: string, surah: number, ayah: number) => Promise<string>;

export interface ListenEngineOptions {
  reciterId: string;
  surah: number;
  startAyah: number;
  mode: ListenMode;
  // Seconds into startAyah to resume from (wird resume). Applied on
  // play() after the first clip's metadata loads, clamped to the
  // clip duration. Ignored when missing, non-finite, or negative.
  startTime?: number;
  // ELECTRONIC speed (audio.playbackRate): 1, 1.25, or 1.5 from
  // the Listen page's speed picker. This is NOT hadr — hadr is a
  // naturally fast recording (see hadr.ts), never a playbackRate.
  // Applied to the shared element on every play site (applyRate),
  // so each engine re-applies its own rate and no rate leaks
  // across modes. Defaults to 1 when missing or invalid.
  playbackRate?: number;
  resolveUrl?: UrlResolver;
  onAyahChange?: (surah: number, ayah: number) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
  // Fired on tab-hide (visibilitychange) and on external 'pause'
  // events (not engine-initiated pauses). The engine NEVER
  // auto-resumes: the UI shows a resume button on this callback.
  onInterrupted?: () => void;
}

// Internal marker: the URL resolver failed (offline layer miss, network
// error, ...). Callers report it via onError and swallow it; audio
// .play() rejections are a different failure and propagate to the
// caller (e.g. a gesture retry) instead.
class ResolverError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'ResolverError';
  }
}

function defaultResolveUrl(reciterId: string, surah: number, ayah: number): Promise<string> {
  const reciter =
    RECITERS.find((r) => r.id === reciterId) ??
    RECITERS.find((r) => r.id === DEFAULT_RECITER_ID) ??
    RECITERS[0];
  return Promise.resolve(reciter.audioUrl(surah, ayah));
}

function positionKey(surah: number, ayah: number): string {
  return `${surah}:${ayah}`;
}

type MediaSessionLike = {
  metadata: unknown;
  setActionHandler: (action: string, handler: (() => void) | null) => void;
  setPositionState?: (state: { duration: number; playbackRate: number; position: number }) => void;
};

function getMediaSession(): MediaSessionLike | null {
  try {
    if (typeof navigator === 'undefined') return null;
    const ms = (navigator as unknown as { mediaSession?: MediaSessionLike }).mediaSession;
    return ms ?? null;
  } catch {
    return null;
  }
}

function revokeBlob(url: string | null): void {
  if (!url || !url.startsWith('blob:')) return;
  try {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  } catch {
    // Swallow: revocation is hygiene, never playback-critical.
  }
}

export class ListenEngine {
  private readonly reciterId: string;
  private readonly mode: ListenMode;
  private readonly playbackRate: number;
  private readonly resolveUrl: UrlResolver;
  private readonly onAyahChange?: (surah: number, ayah: number) => void;
  private readonly onEnded?: () => void;
  private readonly onError?: (message: string) => void;
  private readonly onInterrupted?: () => void;

  private surah: number;
  private ayah: number;
  private playingFlag = false;
  private destroyed = false;

  // True while THIS engine is the shared unit's current holder
  // (acquired on play(), cleared on preemption / destroy). Element
  // event handlers ignore everything while false: after preemption
  // the shared element belongs to another source, and its ended /
  // pause / error / timeupdate events are that source's business,
  // not this engine's. This is what stops a preempted engine from
  // hijacking the element when the new source's clip ends.
  private holdsAudio = false;

  // Pending resume offset into the STARTING ayah only (constructor
  // startTime). Cleared on first application and on any move, so a
  // stale offset can never jump a later clip.
  private pendingStartTime: number | null;
  // Counted suppression for engine-initiated 'pause' events.
  // Each engine-initiated audio mutation that may queue a 'pause'
  // event (pause(), move, restart, preemption) adds ONE token;
  // each 'pause' event consumes one token if any token is still
  // within its 1s window. Counting (not a boolean/timestamp) is
  // what makes this correct: a pause event delivered LATE (after
  // a resume, when audio.paused is already false) still consumes
  // its token instead of leaving it to swallow a later genuine
  // external pause, and two rapid engine pauses produce two
  // tokens for their two events. Tokens expire after 1s, so a
  // mutation that fires no event can never suppress a genuine
  // later external pause beyond that window. Residual ambiguity
  // (a genuine external pause landing within 1s of an engine
  // mutation, while a token is outstanding) resolves as internal
  // — a narrow, documented window.
  private internalPauseTokens = 0;
  private internalPauseAt = 0;
  // Last timeupdate-driven setPositionState call (ms), for ~1/s
  // throttling.
  private lastPositionStateAt = 0;

  // THE one playing element, created once and reused for every ayah.
  private readonly audio: HTMLAudioElement;
  // Detached preloader: preload='auto', never played, never swapped
  // in as the playing element. Null only if construction failed.
  private readonly preloadAudio: HTMLAudioElement | null;

  // URL currently assigned to the playing element, and the position
  // it belongs to. Tracked separately from audio.src because the
  // .src property normalises to an absolute URL, which would break
  // blob: comparisons.
  private currentSrc = '';
  private loadedKey: string | null = null;
  // Pre-resolved URL for the CURRENT ayah, available when a paused
  // move (next/prev/seek) consumed the old next-URL. play() uses it
  // without calling the resolver again.
  private readyUrl: string | null = null;
  private readyKey: string | null = null;
  // Pre-resolved URL for nextAyah(current), kept in hand for the
  // synchronous 'ended' hot path.
  private nextUrl: string | null = null;
  private nextKey: string | null = null;
  private resolvingNext = false;
  private preloadSrc: string | null = null;

  // Event handlers are field arrow functions declared BEFORE the
  // constructor body runs (class fields initialise first), so the
  // constructor can safely attach them. No hook deps arrays exist
  // in this module at all (hook-free by design).
  private readonly handleEnded = (): void => {
    if (this.destroyed || !this.holdsAudio) return;
    const nxt = nextAyah(this.surah, this.ayah);
    if (!nxt) {
      // End of surah: stop here, never auto-advance to next surah.
      this.playingFlag = false;
      this.callEnded();
      return;
    }
    // HOT PATH — synchronous, no await, no setTimeout.
    const url = this.consumeNextUrlFor(nxt);
    this.moveTo(nxt);
    if (url !== null) {
      this.setSrc(url);
      this.playingFlag = true;
      // Synchronous rate application: safe on the hot path.
      this.applyRate();
      try {
        const p = this.audio.play() as unknown as Promise<void> | undefined;
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            // Locked-page play rejection: stay silent here; the
            // next user gesture resumes via play().
            this.playingFlag = false;
          });
        }
      } catch {
        this.playingFlag = false;
      }
      this.preResolveNext();
      return;
    }
    // DEGRADED FALLBACK: pre-resolved URL was not ready (resolver
    // slow, failed, or raced with a manual move). Await the resolver
    // and play. This is the only 'ended' path that awaits, and it
    // exists so playback never silently dies.
    this.playingFlag = true;
    void this.startCurrentPlayback().catch((e) => {
      this.playingFlag = false;
      // Resolver failure on the fallback path still deserves the
      // error message (otherwise playback dies silently); a play()
      // rejection here (e.g. locked page) stays silent and the
      // next user gesture resumes via play().
      if (e instanceof ResolverError) this.callError(ERROR_MESSAGE);
    });
  };

  private readonly handleAudioError = (): void => {
    if (this.destroyed || !this.holdsAudio) return;
    this.playingFlag = false;
    // Do NOT skip to the next ayah on error (contract rule 6).
    this.callError(ERROR_MESSAGE);
  };

  // Shared-unit preemption (another source acquired the element):
  // treated EXACTLY like an interruption — stop flagging playback,
  // drop ownership, invalidate the now-stale loaded state (the
  // element's src is about to become the new source's clip, so the
  // engine's tracked src / ready / next URLs no longer describe
  // it), persist the position (wird), and notify for a UI resume
  // button. NEVER auto-resume. Note the ordering inside
  // acquireAudio(): the element is paused, then this runs, then
  // the new owner is set — so getPosition() here still reads this
  // engine's clip position, which is the correct resume point.
  // Blob hygiene: the current / preload blobs are revoked here
  // because the element is paused and the new source is about to
  // replace src; nothing still needs them.
  // Position captured at preemption time, when the element is
  // paused but still on this clip (currentTime is the exact
  // preempt point). Only when actually playing: a paused or
  // completed engine must never auto-resume. Read by the
  // page's anywhere-resume dispatcher; cleared after use.
  preemptedPosition: { surah: number; ayah: number; time: number; reciter: string; mode: ListenMode } | null = null;

  private readonly handlePreempted = (): void => {
    if (this.destroyed) return;
    if (this.playingFlag) {
      let time = 0;
      try {
        const t = this.audio.currentTime;
        if (Number.isFinite(t) && t >= 0) time = t;
      } catch {
        // ignore: time stays 0
      }
      this.preemptedPosition = { surah: this.surah, ayah: this.ayah, time, reciter: this.reciterId, mode: this.mode };
    } else {
      this.preemptedPosition = null;
    }
    this.playingFlag = false;
    this.holdsAudio = false;
    // The acquire-pause event for this preemption may arrive after
    // this handler (async dispatch); token it so it is not later
    // mistaken for an external pause if this engine re-acquires
    // and plays within the window.
    this.markInternalPause();
    this.invalidateLoadedState();
    this.persistPosition();
    this.callInterrupted();
  };

  // External-pause detection. Persist on EVERY pause event (wird);
  // fire onInterrupted only when the pause was NOT engine-initiated.
  // A stale event (element playing again by the time the queued
  // event runs, e.g. right after an ayah transition) is ignored
  // entirely — audio.paused is the ground truth, not the flag.
  private readonly handleAudioPause = (): void => {
    if (this.destroyed || !this.holdsAudio) return;
    let paused = true;
    try {
      paused = this.audio.paused;
    } catch {
      paused = true;
    }
    if (!paused) {
      // Stale event: the element is playing again (e.g. an engine
      // pause's event delivered after a resume). It still consumes
      // its token — otherwise that token would swallow the next
      // genuine external pause.
      this.consumeInternalPause();
      return;
    }
    this.playingFlag = false;
    this.persistPosition();
    if (this.consumeInternalPause()) return;
    this.callInterrupted();
  };

  private readonly handleTimeUpdate = (): void => {
    if (this.destroyed || !this.holdsAudio) return;
    const now = Date.now();
    if (now - this.lastPositionStateAt < 1000) return;
    this.lastPositionStateAt = now;
    this.updatePositionState();
  };

  private readonly handleLoadedMetadata = (): void => {
    if (this.destroyed || !this.holdsAudio) return;
    // New clip's real duration is known now: correct any stale
    // position state left by the ayah-change call, which ran
    // before this clip's metadata existed.
    this.updatePositionState();
  };

  // Tab-hide interruption: persist immediately (wird) and notify.
  // The engine does NOT pause here — background playback while
  // locked is the feature — and NEVER auto-resumes.
  private readonly handleVisibilityChange = (): void => {
    if (this.destroyed || !this.holdsAudio) return;
    let hidden = false;
    try {
      const doc = (globalThis as {
        document?: { hidden?: boolean; visibilityState?: string };
      }).document;
      hidden = doc?.hidden === true || doc?.visibilityState === 'hidden';
    } catch {
      hidden = false;
    }
    if (!hidden) return;
    this.persistPosition();
    this.callInterrupted();
  };

  constructor(opts: ListenEngineOptions) {
    const surah =
      Number.isInteger(opts.surah) && opts.surah >= 1 && opts.surah <= 114 ? opts.surah : 1;
    const count = SURAH_AYAH_COUNTS[surah - 1];
    const startAyah =
      Number.isInteger(opts.startAyah) && opts.startAyah >= 1 && opts.startAyah <= count
        ? opts.startAyah
        : 1;
    this.reciterId = RECITERS.some((r) => r.id === opts.reciterId)
      ? opts.reciterId
      : DEFAULT_RECITER_ID;
    this.mode = opts.mode;
    // Electronic speed, validated: a non-finite or non-positive
    // rate would silence or break playback, so it falls back to 1.
    this.playbackRate =
      typeof opts.playbackRate === 'number' &&
      Number.isFinite(opts.playbackRate) &&
      opts.playbackRate > 0
        ? opts.playbackRate
        : 1;
    this.resolveUrl = opts.resolveUrl ?? defaultResolveUrl;
    this.onAyahChange = opts.onAyahChange;
    this.onEnded = opts.onEnded;
    this.onError = opts.onError;
    this.onInterrupted = opts.onInterrupted;
    this.pendingStartTime =
      typeof opts.startTime === 'number' && Number.isFinite(opts.startTime) && opts.startTime >= 0
        ? opts.startTime
        : null;
    this.surah = surah;
    this.ayah = startAyah;

    // The SHARED element (singleton, created lazily here on first
    // engine construction — never at import time). Listeners are
    // attached now but guarded by holdsAudio, so construction alone
    // never hijacks another source's playback or Media Session.
    this.audio = getSharedAudio();
    try {
      this.audio.preload = 'auto';
    } catch {
      // Non-fatal.
    }
    this.audio.addEventListener('ended', this.handleEnded);
    this.audio.addEventListener('error', this.handleAudioError);
    this.audio.addEventListener('pause', this.handleAudioPause);
    this.audio.addEventListener('timeupdate', this.handleTimeUpdate);
    this.audio.addEventListener('loadedmetadata', this.handleLoadedMetadata);
    try {
      if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
      }
    } catch {
      // Guarded: no document (node) or listener failure is fine.
    }

    let preload: HTMLAudioElement | null = null;
    try {
      preload = new Audio();
      preload.preload = 'auto';
    } catch {
      preload = null;
    }
    this.preloadAudio = preload;

    // NOTE: no Media Session setup here on purpose. The Media
    // Session is shared with radio, so this engine touches it only
    // after acquiring ownership in play() — constructing an engine
    // must never overwrite another source's metadata/handlers.
  }

  get current(): { surah: number; ayah: number } {
    return { surah: this.surah, ayah: this.ayah };
  }

  get playing(): boolean {
    return this.playingFlag;
  }

  // Live position: (surah, ayah, seconds into the ayah). time is 0
  // when currentTime is unavailable, NaN, or negative.
  getPosition(): ListenPosition {
    let time = 0;
    try {
      const t = this.audio.currentTime;
      if (Number.isFinite(t) && t >= 0) time = t;
    } catch {
      time = 0;
    }
    return { surah: this.surah, ayah: this.ayah, reciter: this.reciterId, time };
  }

  async play(): Promise<void> {
    if (this.destroyed) return;
    if (this.playingFlag) return;
    // Acquire the shared element FIRST: this preempts any other
    // source (radio) — pausing it and notifying its owner — before
    // this engine plays anything. Re-acquiring with the same
    // (owner, callback) pair is a no-op, so resume-after-pause
    // does not disturb anything. Media Session handlers/metadata
    // are (re)wired here, only once ownership is held.
    acquireAudio('listen', this.handlePreempted);
    this.holdsAudio = true;
    this.setupMediaSession();
    // Resume mid-ayah on the already-loaded src when possible.
    if (this.loadedKey === positionKey(this.surah, this.ayah) && this.currentSrc) {
      this.applyPendingStartTime();
      this.applyRate();
      try {
        await this.audio.play();
        this.playingFlag = true;
        this.updateMediaSession();
        this.updatePositionState();
        this.preResolveNext();
      } catch {
        this.playingFlag = false;
        throw new Error(ERROR_MESSAGE);
      }
      return;
    }
    try {
      await this.startCurrentPlayback();
    } catch (e) {
      this.playingFlag = false;
      if (e instanceof ResolverError) {
        this.callError(ERROR_MESSAGE);
        return;
      }
      throw new Error(ERROR_MESSAGE);
    }
  }

  pause(): void {
    if (this.destroyed) return;
    const wasPlaying = this.playingFlag;
    this.playingFlag = false;
    if (wasPlaying) {
      // Engine-initiated: the queued 'pause' event must not fire
      // onInterrupted (see handleAudioPause).
      this.markInternalPause();
      try {
        this.audio.pause();
      } catch {
        // Swallow: pause is best-effort on a stopped element.
      }
    }
    // Pause persists the LIVE position (with time), not time 0.
    this.persistPosition();
  }

  async next(): Promise<void> {
    if (this.destroyed) return;
    const nxt = nextAyah(this.surah, this.ayah);
    if (!nxt) {
      // End of surah via manual next: stop and report end.
      const wasPlaying = this.playingFlag;
      this.playingFlag = false;
      if (wasPlaying) {
        this.markInternalPause();
        try {
          this.audio.pause();
        } catch {
          // Swallow.
        }
      }
      this.callEnded();
      return;
    }
    await this.advanceTo(nxt);
  }

  async prev(): Promise<void> {
    if (this.destroyed) return;
    const prv = prevAyah(this.surah, this.ayah);
    if (!prv) return;
    await this.advanceTo(prv);
  }

  async restart(): Promise<void> {
    if (this.destroyed) return;
    // Restart means the ayah's start: a pending resume offset for
    // this ayah no longer applies.
    this.pendingStartTime = null;
    // Restart touches the shared element (currentTime / load), so
    // it acquires ownership even when paused: a restart press on
    // listen controls makes listen the current source again. (A
    // paused move — next/prev/seek — does NOT acquire: it only
    // changes logical position and must not stop another source.)
    acquireAudio('listen', this.handlePreempted);
    this.holdsAudio = true;
    this.markInternalPause();
    const wasPlaying = this.playingFlag;
    if (this.loadedKey !== positionKey(this.surah, this.ayah) || !this.currentSrc) {
      try {
        await this.startCurrentPlayback();
      } catch (e) {
        this.playingFlag = false;
        if (e instanceof ResolverError) {
          this.callError(ERROR_MESSAGE);
          return;
        }
        throw new Error(ERROR_MESSAGE);
      }
      // startCurrentPlayback left us playing; if we were paused,
      // restart should leave us paused at the start instead.
      if (!wasPlaying) {
        this.pause();
        return;
      }
    }
    try {
      this.audio.currentTime = 0;
    } catch {
      // Swallow: some elements reject currentTime before metadata.
    }
    if (wasPlaying) {
      this.applyRate();
      try {
        await this.audio.play();
        this.playingFlag = true;
      } catch {
        this.playingFlag = false;
        throw new Error(ERROR_MESSAGE);
      }
    }
    // Seek-equivalent: report the reset position to Media Session.
    this.updatePositionState();
  }

  async seekTo(ayah: number): Promise<void> {
    if (this.destroyed) return;
    const count = SURAH_AYAH_COUNTS[this.surah - 1];
    if (!Number.isInteger(ayah) || ayah < 1 || ayah > count) return;
    if (ayah === this.ayah) {
      await this.restart();
      return;
    }
    await this.advanceTo({ surah: this.surah, ayah });
  }

  destroy(): void {
    if (this.destroyed) return;
    // Persist first: destroy() is the stop path for wird mode, and
    // it persists the LIVE position (with time).
    this.persistPosition();
    // Capture ownership BEFORE tearing down: the shared element
    // must only be paused / detached / released when THIS engine
    // still holds it. A preempted engine's destroy must not touch
    // the new source's playback or Media Session handlers.
    const holdsBefore = this.holdsAudio;
    const wasPlaying = this.playingFlag;
    this.destroyed = true;
    this.playingFlag = false;
    this.holdsAudio = false;
    try {
      this.audio.removeEventListener('ended', this.handleEnded);
      this.audio.removeEventListener('error', this.handleAudioError);
      this.audio.removeEventListener('pause', this.handleAudioPause);
      this.audio.removeEventListener('timeupdate', this.handleTimeUpdate);
      this.audio.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
    } catch {
      // Swallow.
    }
    try {
      if (typeof document !== 'undefined' && document && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      }
    } catch {
      // Swallow.
    }
    if (holdsBefore && wasPlaying) {
      try {
        this.audio.pause();
      } catch {
        // Swallow.
      }
    }
    const oldSrc = this.currentSrc;
    const oldPreload = this.preloadSrc;
    // Detach the shared element's src ONLY while holding it; a
    // preempted engine must leave the new source's src alone.
    if (holdsBefore) {
      try {
        if (typeof this.audio.removeAttribute === 'function') {
          this.audio.removeAttribute('src');
        }
        if (typeof this.audio.load === 'function') {
          this.audio.load();
        }
      } catch {
        // Swallow.
      }
    }
    try {
      if (this.preloadAudio && typeof this.preloadAudio.removeAttribute === 'function') {
        this.preloadAudio.removeAttribute('src');
      }
    } catch {
      // Swallow.
    }
    // Old blobs are no longer referenced by any element: safe to
    // revoke now (never before detaching).
    revokeBlob(oldSrc);
    if (oldPreload !== oldSrc) revokeBlob(oldPreload);
    this.currentSrc = '';
    this.loadedKey = null;
    this.readyUrl = null;
    this.readyKey = null;
    this.nextUrl = null;
    this.nextKey = null;
    this.preloadSrc = null;
    this.pendingStartTime = null;
    // Release + clear Media Session handlers ONLY while holding;
    // a preempted engine's releaseAudio('listen') would be a
    // no-op anyway (owner already changed), but clearing handlers
    // here would wipe the NEW source's handlers — hence the guard.
    if (holdsBefore) {
      releaseAudio('listen');
      try {
        const ms = getMediaSession();
        if (ms) {
          ms.setActionHandler('play', null);
          ms.setActionHandler('pause', null);
          ms.setActionHandler('previoustrack', null);
          ms.setActionHandler('nexttrack', null);
        }
      } catch {
        // Swallow.
      }
    }
  }

  // ----------------------------------------------------------------
  // Internals
  // ----------------------------------------------------------------

  // Ayah-advance persistence: the NEW ayah, time 0. Free mode
  // writes nothing, in both persist paths.
  private persistAdvance(): void {
    if (this.mode !== 'wird') return;
    writeListeningWird({ surah: this.surah, ayah: this.ayah, reciter: this.reciterId, time: 0 });
  }

  // Stop / interruption persistence: the LIVE position, with time.
  private persistPosition(): void {
    if (this.mode !== 'wird') return;
    writeListeningWird(this.getPosition());
  }

  // Drop all tracked loaded state after preemption: the shared
  // element's src no longer belongs to this engine, so loadedKey /
  // currentSrc / ready / next caches would lie on the next play()
  // (e.g. restart() would seek radio's clip). Blobs are revoked:
  // the element is paused and the new source is about to replace
  // src, so nothing still needs them. The next play() re-resolves
  // everything from scratch.
  private invalidateLoadedState(): void {
    const oldSrc = this.currentSrc;
    const oldPre = this.preloadSrc;
    this.currentSrc = '';
    this.loadedKey = null;
    this.readyUrl = null;
    this.readyKey = null;
    this.nextUrl = null;
    this.nextKey = null;
    this.preloadSrc = null;
    try {
      if (this.preloadAudio && typeof this.preloadAudio.removeAttribute === 'function') {
        this.preloadAudio.removeAttribute('src');
      }
    } catch {
      // Swallow.
    }
    revokeBlob(oldSrc);
    if (oldPre !== oldSrc) revokeBlob(oldPre);
  }

  private markInternalPause(): void {
    try {
      this.internalPauseTokens += 1;
      this.internalPauseAt = Date.now();
    } catch {
      this.internalPauseTokens = 0;
      this.internalPauseAt = 0;
    }
  }

  // Consume one suppression token if any is live (count > 0 and
  // within 1s of the latest token). Expired tokens are dropped.
  private consumeInternalPause(): boolean {
    try {
      if (this.internalPauseTokens <= 0) return false;
      if (Date.now() - this.internalPauseAt > 1000) {
        this.internalPauseTokens = 0;
        this.internalPauseAt = 0;
        return false;
      }
      this.internalPauseTokens -= 1;
      if (this.internalPauseTokens === 0) this.internalPauseAt = 0;
      return true;
    } catch {
      return false;
    }
  }

  // Apply this engine's electronic speed to the shared element.
  // playbackRate persists across src changes on the same element,
  // but it is re-applied at EVERY play site anyway, so the
  // invariant never depends on that persistence — and so a rate
  // left by another engine (or by radio, which never sets one)
  // cannot leak into this engine's playback. Synchronous, so it
  // is safe on the 'ended' hot path too. Best-effort: a failure
  // here must never break playback (the clip then plays at 1x).
  private applyRate(): void {
    try {
      this.audio.playbackRate = this.playbackRate;
      // Pitch preservation, EXPLICIT (Claude 2026-10-29): the default
      // is true, but a speed change must never rely on it — a shifted
      // pitch would distort tajwid at 1.25x/1.5x. webkit prefix for
      // older Safari. Set on every play path, like the rate itself.
      const el = this.audio as HTMLAudioElement & {
        preservesPitch?: boolean;
        webkitPreservesPitch?: boolean;
      };
      el.preservesPitch = true;
      el.webkitPreservesPitch = true;
    } catch {
      // Swallow.
    }
  }

  // Apply the constructor startTime once, on the first clip only:
  // immediately when metadata is already known (readyState >= 1),
  // else on 'loadedmetadata' once. Clamped to the clip duration.
  // The pending value is cleared on application and on any move,
  // and the once-listener re-checks it, so a stale offset can
  // never jump a later clip.
  private applyPendingStartTime(): void {
    const pending = this.pendingStartTime;
    if (pending === null) return;
    const apply = (): void => {
      if (this.pendingStartTime !== pending) return;
      this.pendingStartTime = null;
      try {
        const d = this.audio.duration;
        const clamped = Number.isFinite(d) && d > 0 ? Math.min(pending, d) : pending;
        this.audio.currentTime = clamped;
      } catch {
        // Swallow: seeking before metadata is best-effort.
      }
    };
    try {
      if (this.audio.readyState >= 1) {
        apply();
      } else {
        this.audio.addEventListener('loadedmetadata', apply, { once: true });
      }
    } catch {
      this.pendingStartTime = null;
    }
  }

  private callAyahChange(): void {
    if (!this.onAyahChange) return;
    try {
      this.onAyahChange(this.surah, this.ayah);
    } catch {
      // A throwing UI callback must never break the engine.
    }
  }

  private callEnded(): void {
    if (!this.onEnded) return;
    try {
      this.onEnded();
    } catch {
      // Swallow, as above.
    }
  }

  private callError(message: string): void {
    if (!this.onError) return;
    try {
      this.onError(message);
    } catch {
      // Swallow, as above.
    }
  }

  private callInterrupted(): void {
    if (!this.onInterrupted) return;
    try {
      this.onInterrupted();
    } catch {
      // Swallow, as above.
    }
  }

  // Synchronous state move: position, callbacks, Media Session
  // metadata + position state, wird persistence (new ayah, time 0).
  // Does NOT touch audio src — the caller owns src/play decisions
  // so the 'ended' hot path stays synchronous. Invalidates
  // ready/next caches and the pending startTime (which belonged to
  // the previous ayah); the caller must have consumed nextUrl
  // BEFORE calling this. Marks an internal pause: the src change
  // that follows may queue a 'pause' event, which must not fire
  // onInterrupted.
  private moveTo(target: { surah: number; ayah: number }): void {
    this.surah = target.surah;
    this.ayah = target.ayah;
    this.readyUrl = null;
    this.readyKey = null;
    this.nextUrl = null;
    this.nextKey = null;
    this.pendingStartTime = null;
    this.markInternalPause();
    this.callAyahChange();
    this.updateMediaSession();
    this.updatePositionState();
    this.persistAdvance();
  }

  // Take the pre-resolved next URL if it belongs to `target`.
  private consumeNextUrlFor(target: { surah: number; ayah: number }): string | null {
    if (this.nextKey === positionKey(target.surah, target.ayah) && this.nextUrl !== null) {
      const url = this.nextUrl;
      this.nextUrl = null;
      this.nextKey = null;
      return url;
    }
    return null;
  }

  // Assign a new src to the ONE playing element. If the previous src
  // was a blob: URL, revoke it AFTER the new assignment (the element
  // no longer references it). Same-URL re-assignment is a no-op so
  // a blob in use is never revoked out from under itself.
  private setSrc(url: string): void {
    const old = this.currentSrc;
    // Same URL (e.g. a resolver returning one clip per surah):
    // just re-key it. Never revoke a URL that is still assigned.
    if (old === url) {
      this.loadedKey = positionKey(this.surah, this.ayah);
      return;
    }
    this.currentSrc = url;
    this.loadedKey = positionKey(this.surah, this.ayah);
    try {
      this.audio.src = url;
    } catch {
      // Swallow: a later 'error' event surfaces real media failures.
    }
    revokeBlob(old);
  }

  private setPreload(url: string): void {
    if (!this.preloadAudio) return;
    const old = this.preloadSrc;
    this.preloadSrc = url;
    try {
      this.preloadAudio.src = url;
    } catch {
      // Swallow: preloading is best-effort.
    }
    // Never revoke a blob that the playing element (or the pending
    // next URL) still references — revoking would kill playback.
    if (old !== null && old !== url && old !== this.currentSrc && old !== this.nextUrl) {
      revokeBlob(old);
    }
  }

  private clearPreload(): void {
    if (!this.preloadAudio) {
      this.preloadSrc = null;
      return;
    }
    const old = this.preloadSrc;
    this.preloadSrc = null;
    try {
      this.preloadAudio.removeAttribute('src');
    } catch {
      // Swallow.
    }
    if (old !== null && old !== this.currentSrc) revokeBlob(old);
  }

  // Pre-resolve the FOLLOWING ayah's URL while the current ayah
  // plays, and warm it on the detached preloader. Duplicate and
  // stale-flight safe: a result is only kept if its key still
  // matches the current next target.
  private preResolveNext(): void {
    const nxt = nextAyah(this.surah, this.ayah);
    if (!nxt) {
      this.nextUrl = null;
      this.nextKey = null;
      this.clearPreload();
      return;
    }
    const key = positionKey(nxt.surah, nxt.ayah);
    if (this.nextKey === key && this.nextUrl !== null) {
      this.setPreload(this.nextUrl);
      return;
    }
    if (this.nextKey === key && this.resolvingNext) return;
    this.nextKey = key;
    this.nextUrl = null;
    this.resolvingNext = true;
    const resolver = this.resolveUrl;
    Promise.resolve()
      .then(() => resolver(this.reciterId, nxt.surah, nxt.ayah))
      .then((url) => {
        if (this.nextKey !== key) return;
        this.resolvingNext = false;
        if (this.destroyed) return;
        this.nextUrl = url;
        this.setPreload(url);
      })
      .catch(() => {
        // Resolver failure here is non-fatal: the 'ended' handler's
        // degraded fallback retries the resolver at that point.
        if (this.nextKey === key) this.resolvingNext = false;
      });
  }

  // Resolve the current ayah's URL (ready cache first, else the
  // resolver) and return it. Throws only on resolver failure; the
  // caller decides how to report it.
  private async loadUrlForCurrent(): Promise<string> {
    const key = positionKey(this.surah, this.ayah);
    if (this.readyKey === key && this.readyUrl !== null) {
      const url = this.readyUrl;
      this.readyUrl = null;
      this.readyKey = null;
      return url;
    }
    return this.resolveUrl(this.reciterId, this.surah, this.ayah);
  }

  // Full async load + play of the current ayah (used by play(),
  // manual next/prev/seek, and the degraded 'ended' fallback).
  // Resolver failures throw ResolverError (callers report via
  // onError and stop); audio.play() rejections propagate raw so a
  // gesture caller can retry.
  private async startCurrentPlayback(): Promise<void> {
    let url: string;
    try {
      url = await this.loadUrlForCurrent();
    } catch {
      this.playingFlag = false;
      throw new ResolverError();
    }
    this.setSrc(url);
    // First-clip resume offset: applied here (after src, before
    // play) so playback starts at startTime, not at 0.
    this.applyPendingStartTime();
    this.applyRate();
    await this.audio.play();
    this.playingFlag = true;
    this.updateMediaSession();
    this.updatePositionState();
    this.preResolveNext();
  }

  // Shared manual-move path (next/prev/seekTo). If the move target
  // was pre-resolved (manual next into the warmed ayah), its URL is
  // consumed synchronously; otherwise the resolver is awaited. When
  // paused, a consumed URL is kept as the ready cache for play()
  // instead of loading immediately.
  private async advanceTo(target: { surah: number; ayah: number }): Promise<void> {
    const wasPlaying = this.playingFlag;
    // Note: no markInternalPause() here — moveTo() below marks
    // exactly one token per move; marking in both places would
    // double-count and let a leftover token swallow a later
    // genuine external pause.
    const preResolved = this.consumeNextUrlFor(target);
    this.moveTo(target);
    if (wasPlaying) {
      // About to play on the shared element: (re)acquire first.
      // Normally a no-op (already holding); after a preemption
      // this path is unreachable (preemption clears playingFlag),
      // but acquiring here closes the hole regardless.
      acquireAudio('listen', this.handlePreempted);
      this.holdsAudio = true;
      if (preResolved !== null) {
        this.setSrc(preResolved);
        this.applyRate();
        try {
          await this.audio.play();
          this.playingFlag = true;
        } catch {
          this.playingFlag = false;
          throw new Error(ERROR_MESSAGE);
        }
        this.preResolveNext();
        return;
      }
      try {
        await this.startCurrentPlayback();
      } catch (e) {
        this.playingFlag = false;
        if (e instanceof ResolverError) {
          this.callError(ERROR_MESSAGE);
          return;
        }
        throw new Error(ERROR_MESSAGE);
      }
      return;
    }
    // Paused move: do not load or play; keep a consumed URL ready
    // for the next play(), and warm the following ayah.
    if (preResolved !== null) {
      this.readyUrl = preResolved;
      this.readyKey = positionKey(target.surah, target.ayah);
    }
    this.preResolveNext();
  }

  // Media Session position state: OS lock-screen / headset
  // seek bar. Only when duration is finite and positive; position
  // clamped into [0, duration] (setPositionState throws otherwise
  // in some browsers). All guarded — Media Session is best-effort.
  // Called on ayah change (moveTo), on seek (restart tail /
  // timeupdate), and on timeupdate throttled to ~1/s. Note the
  // ayah-change call runs before the new clip's metadata loads,
  // so it may briefly report the previous clip's duration; the
  // loadedmetadata handler corrects it as soon as the new clip's
  // real duration is known.
  private updatePositionState(): void {
    // Shared Media Session: only the current holder may write it.
    if (!this.holdsAudio) return;
    try {
      const ms = getMediaSession();
      if (!ms || typeof ms.setPositionState !== 'function') return;
      const d = this.audio.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      let pos = 0;
      try {
        pos = this.audio.currentTime;
      } catch {
        pos = 0;
      }
      if (!Number.isFinite(pos)) pos = 0;
      pos = Math.min(Math.max(0, pos), d);
      ms.setPositionState({ duration: d, playbackRate: this.playbackRate, position: pos });
    } catch {
      // Swallow: Media Session is entirely best-effort.
    }
  }

  private setupMediaSession(): void {
    try {
      const ms = getMediaSession();
      if (!ms) return;
      // Wired exactly once, here in the constructor.
      ms.setActionHandler('play', () => {
        void this.play().catch(() => {
          // Swallow: gesture-less Media Session play rejections
          // are surfaced by the next user gesture.
        });
      });
      ms.setActionHandler('pause', () => {
        this.pause();
      });
      ms.setActionHandler('previoustrack', () => {
        void this.prev().catch(() => {
          // Swallow.
        });
      });
      ms.setActionHandler('nexttrack', () => {
        void this.next().catch(() => {
          // Swallow.
        });
      });
    } catch {
      // Media Session is entirely best-effort.
    }
  }

  private updateMediaSession(): void {
    // Shared Media Session: only the current holder may write it.
    if (!this.holdsAudio) return;
    try {
      const ms = getMediaSession();
      if (!ms) return;
      const MediaMetadataCtor = (globalThis as { MediaMetadata?: new (init: {
        title: string;
        artist: string;
        album: string;
      }) => unknown }).MediaMetadata;
      if (typeof MediaMetadataCtor === 'undefined') return;
      const surahName = SURAHS[this.surah - 1]?.name ?? String(this.surah);
      const reciterName =
        RECITERS.find((r) => r.id === this.reciterId)?.name ?? this.reciterId;
      ms.metadata = new MediaMetadataCtor({
        title: `سورة ${surahName} — آية ${this.ayah}`,
        artist: reciterName,
        album: 'روابط الذكر الحكيم',
      });
    } catch {
      // Media Session is entirely best-effort.
    }
  }
}
