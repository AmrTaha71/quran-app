// Three-mode journey engine — the continuous-playback companion to
// ListenEngine (single surah) and RiwayaEngine (single surah file),
// kept deliberately SEPARATE so both existing engines are untouched.
//
// MODEL: a journey is the planner's item stream (threeModeListen):
// ayah items in order across surah boundaries (the reciter rotates
// per surah in varied/tadabbur modes, stays fixed in single mode),
// plus a quarterEnd marker after each completed quarter. In
// tadabbur mode a marker becomes an interstitial: consecutive
// تفسیر clips for the quarter's PLAYED ayahs, sized adaptively
// (see selectInterstitial). The journey ends after surah 114's
// last ayah and its quarter's interstitial.
//
// TAFSIR ORDER (user toggle, 2026-10-31; tadabbur only):
// - 'after' (default): exactly the model above — the interstitial
//   reviews the quarter just heard, sized from MEASURED played
//   time. Nothing in this path changed for the toggle.
// - 'before': each quarter's tafsir plays as a PREVIEW before the
//   quarter's ayahs. The marker that ends quarter Q is the
//   injection point for quarter Q+1's preview: when the marker is
//   reached, the engine looks ahead through the generator,
//   buffers Q+1's ayahs, resolves the preview from them, and
//   queues it; the buffered ayahs then play in order. The first
//   quarter has no preceding marker, so its preview is generated
//   when its first ayah is reached instead. The last quarter's
//   preview is generated at the previous quarter's marker, so
//   every quarter — first and last included — gets a preview, and
//   the journey still ends at 114:6 with no trailing tafsir.
//   A preview is sized from PLANNED time (see resolvePreview),
//   never from heard time: nothing has been heard yet. The
//   after-mode sizing path (resolveInterstitial) is untouched.
//
// RUNTIME MEASUREMENT (no estimated durations anywhere):
// - A quarter's played duration is the sum of its ayah clips'
//   actual played time (audio.duration when known, else the time
//   actually played before 'ended'). A skipped ayah counts only
//   what was heard — the interstitial scales with what the user
//   actually heard, which is the honest reading of "3–4:1".
// - Tafsir clip durations are probed from the clips' own metadata
//   (a detached Audio element, preload='metadata', never the
//   playing element). Probing starts when an ayah starts playing
//   — its tafsir clip usually has the whole ayah to load metadata
//   — so by the quarter boundary the durations are normally
//   already known. Any duration still unknown at the boundary is
//   probed on demand (bounded timeout); a clip whose metadata
//   will not load is skipped (it could not play anyway).
// - The one gap this design accepts: if metadata is still loading
//   at a quarter boundary on a slow network, the boundary waits
//   briefly for the probe (the 'ended' degraded path). Mid-ayah
//   chaining stays synchronous: ayah URLs are pure string
//   building (reciter.audioUrl / tafsirClipUrl), pre-resolved
//   while the current item plays, exactly like ListenEngine's hot
//   path. A quarter boundary is a section break, not a mid-ayah
//   gap, so the brief wait there is the honest trade.
//
// SHARED AUDIO + INTERRUPTION: the playing element is the SAME
// shared singleton (owner 'listen'), so starting a journey
// preempts Hafs listen / radio / riwaya and vice versa. This
// engine NEVER auto-resumes: tab-hide and external 'pause' events
// persist and fire onInterrupted; resume is a UI button only.
// Preemption is also an interruption (persist + notify).
//
// RESUME SEEK: a saved tafsir position carries the exact
// interstitial list (see threeModeListen), so resuming into an
// interstitial replays the SAME list. A saved position whose item
// no longer matches the rebuilt journey falls back to the
// journey's start (never a crash, never a guessed item).
//
// Hook-free, React-free, Supabase-free, same as the other engines.

import { RECITERS, DEFAULT_RECITER_ID } from './reciters';
import { SURAHS } from './surahs';
import { quarterContaining } from './quarters';
import {
  planJourney,
  selectInterstitial,
  tafsirClipUrl,
  writeThreeModeResume,
} from './threeModeListen';
import type {
  JourneyItem,
  TadabburTafsirOrder,
  ThreeMode,
  ThreeModePosition,
} from './threeModeListen';
import { getSharedAudio, acquireAudio, releaseAudio } from './sharedAudio';

const ERROR_MESSAGE = 'تعذرت التلاوة — تحقق من الاتصال وحاول تاني';

export type JourneyPlayable =
  | { kind: 'ayah'; surah: number; ayah: number; reciterId: string }
  | { kind: 'tafsir'; surah: number; ayah: number };

export interface JourneyEngineOptions {
  mode: ThreeMode;
  startSurah: number;
  startReciterId: string;
  startAyah?: number;
  /**
   * Tadabbur only: 'before' plays each quarter's tafsir as a
   * preview before the quarter; 'after' (default) reviews the
   * quarter after it. Ignored for single/varied modes, and a
   * resumed journey's saved order (startItem's position) wins
   * over this value at the page layer — see ListenPage.
   */
  tafsirOrder?: TadabburTafsirOrder;
  /** Resume seek: jump to this item without playing earlier items. */
  startItem?: { kind: 'ayah' | 'tafsir'; surah: number; ayah: number };
  /** Saved interstitial list, for resuming into a tafsir item. */
  startInterstitial?: { surah: number; ayah: number }[];
  /** Seconds into the start item to resume from. Clamped to duration. */
  startTime?: number;
  // ELECTRONIC speed (audio.playbackRate), same contract as the
  // other engines: applied on every play site, defaults to 1.
  // Journeys take the Listen page's current speed pick; the saved
  // position never stores a speed (speed is a current preference,
  // not part of the position — resuming applies the current pick).
  playbackRate?: number;
  resolveAyahUrl?: (reciterId: string, surah: number, ayah: number) => Promise<string>;
  /** Injected in tests; default probes clip metadata in the browser. */
  probeTafsirDuration?: (surah: number, ayah: number) => Promise<number | null>;
  /**
   * Injected in tests; default resolves the ayah URL (via
   * resolveAyahUrl, injected or default) and probes its metadata.
   * Used ONLY by before-mode preview sizing (planned durations).
   */
  probeAyahDuration?: (reciterId: string, surah: number, ayah: number) => Promise<number | null>;
  onItemChange?: (item: JourneyPlayable) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
  /** Fired on tab-hide and on external 'pause' events. Never auto-resumes. */
  onInterrupted?: () => void;
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

function defaultResolveAyahUrl(
  reciterId: string,
  surah: number,
  ayah: number,
): Promise<string> {
  const reciter =
    RECITERS.find((r) => r.id === reciterId) ??
    RECITERS.find((r) => r.id === DEFAULT_RECITER_ID) ??
    RECITERS[0];
  return Promise.resolve(reciter.audioUrl(surah, ayah));
}

// Shared metadata prober: detached Audio element, preload =
// 'metadata', never the playing element. 10s timeout; null on any
// failure (a clip whose metadata will not load is skipped, never
// guessed). Used by the tafsir prober and by before-mode planned
// recitation probing alike.
function probeAudioMetadata(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: number | null): void => {
      if (done) return;
      done = true;
      try {
        el.removeEventListener('loadedmetadata', onLoaded);
        el.removeEventListener('error', onErr);
      } catch {
        // Swallow.
      }
      resolve(value);
    };
    const onLoaded = (): void => {
      let d: number | null = null;
      try {
        const v = el.duration;
        if (Number.isFinite(v) && v > 0) d = v;
      } catch {
        d = null;
      }
      finish(d);
    };
    const onErr = (): void => finish(null);
    let el: HTMLAudioElement;
    try {
      el = new Audio();
      el.preload = 'metadata';
      el.addEventListener('loadedmetadata', onLoaded);
      el.addEventListener('error', onErr);
      el.src = url;
    } catch {
      resolve(null);
      return;
    }
    setTimeout(() => finish(null), 10000);
  });
}

function defaultProbeTafsirDuration(surah: number, ayah: number): Promise<number | null> {
  const url = tafsirClipUrl(surah, ayah);
  if (!url) return Promise.resolve(null);
  return probeAudioMetadata(url);
}

export class JourneyEngine {
  private readonly mode: ThreeMode;
  private readonly startSurah: number;
  private readonly startReciterId: string;
  private readonly startAyah: number;
  private readonly playbackRate: number;
  private readonly resolveAyahUrl: (
    reciterId: string,
    surah: number,
    ayah: number,
  ) => Promise<string>;
  private readonly probeTafsirDuration: (
    surah: number,
    ayah: number,
  ) => Promise<number | null>;
  private readonly probeAyahDurationOpt?: (
    reciterId: string,
    surah: number,
    ayah: number,
  ) => Promise<number | null>;
  private readonly tafsirOrder: TadabburTafsirOrder;
  private readonly onItemChange?: (item: JourneyPlayable) => void;
  private readonly onEnded?: () => void;
  private readonly onError?: (message: string) => void;
  private readonly onInterrupted?: () => void;

  private generator: Generator<JourneyItem>;
  private playingFlag = false;
  private destroyed = false;
  private holdsAudio = false;
  private pendingStartTime: number | null;
  private internalPauseTokens = 0;
  private internalPauseAt = 0;
  private lastPositionStateAt = 0;

  private readonly audio: HTMLAudioElement;
  private current: JourneyPlayable | null = null;
  private currentSrc = '';
  // The next playable item + its URL, pre-resolved while the
  // current item plays (the synchronous 'ended' hot path).
  private nextItem: JourneyPlayable | null = null;
  private nextUrl: string | null = null;
  private preparingNext = false;
  private preparePromise: Promise<void> | null = null;
  // Interstitial queue for the marker being played through.
  private pendingTafsir: { surah: number; ayah: number }[] = [];
  private currentInterstitial: { surah: number; ayah: number }[] | null = null;
  // BEFORE-mode only: ayah items collected by lookahead for the
  // quarter whose preview is queued/playing. They are returned in
  // order after the preview drains, before the generator is pulled
  // again — so a preview never skips the quarter it previews.
  // Always empty in after-mode (and in single/varied modes).
  // INVARIANT: the buffer is non-empty only while seekTarget is
  // null (seek paths never buffer; the Q1-preview seek path
  // buffers only after clearing the seek).
  private bufferedAyahs: Extract<JourneyItem, { kind: 'ayah' }>[] = [];
  // Quarter of the last ayah RETURNED (buffered, sought, or
  // direct). The before-mode "new quarter" check fires only when
  // a generator ayah's quarter differs from this — i.e. at
  // journey start / restart, the only points where a generator
  // ayah can begin a quarter without a preceding marker having
  // already queued that quarter's preview.
  private lastAyahQuarter: number | null = null;
  // A quarterEnd marker seen during BACKGROUND preparation (while
  // an ayah plays). It is deliberately NOT resolved there: the
  // quarter's played duration is incomplete until its last ayah
  // ends, and resolving early would size the interstitial from a
  // short quarter. The boundary path (after recordPlayedAyah)
  // consumes it with complete data.
  private pendingMarker: number | null = null;
  // Resume seek: matched once, then cleared. While seeking, items
  // are discarded without recording durations or played ayahs.
  private seekTarget: { kind: 'ayah' | 'tafsir'; surah: number; ayah: number } | null;
  private seekInterstitial: { surah: number; ayah: number }[] | null;
  // Quarter tracking for the quarter currently being PLAYED
  // (not sought): its number, the ayahs actually played in order,
  // and their summed played seconds.
  // DEFINITION (pinned per Claude 2026-10-29): D = trackedSeconds is
  // CONTENT time — each ayah clip's audio.duration when known, else
  // its currentTime at end — never wall-clock time, so pauses never
  // inflate it. The 3–4:1 ratio is defined on these content durations,
  // and it holds in experienced (wall) time too, because the tafsir
  // clips play through this same engine at the SAME electronic rate
  // (applyRate on every item start): both sides scale together.
  private trackedQuarter: number | null = null;
  private trackedAyahs: { surah: number; ayah: number }[] = [];
  private trackedSeconds = 0;
  // Probed tafsir durations for the tracked quarter's ayahs
  // (key "surah:ayah"), filled in the background while playing.
  private probedDurations = new Map<string, number>();
  private probing = new Set<string>();
  // Duration of the current ayah clip when metadata is known.
  private currentAyahDuration: number | null = null;

  // Handlers are field arrow functions declared BEFORE the
  // constructor body runs (same pattern as the other engines).

  private readonly handleEnded = (): void => {
    if (this.destroyed || !this.holdsAudio) return;
    this.recordPlayedAyah();
    if (this.nextItem !== null && this.nextUrl !== null) {
      // HOT PATH — synchronous, no await.
      const item = this.nextItem;
      const url = this.nextUrl;
      this.nextItem = null;
      this.nextUrl = null;
      this.playItem(item, url);
      void this.prepareNext();
      return;
    }
    // DEGRADED FALLBACK: the next item was not ready (a marker
    // needed probing, or the resolver was slow). Await preparation
    // and play — playback never silently dies at a boundary.
    this.playingFlag = true;
    void this.advanceAfterPreparation().catch(() => {
      this.playingFlag = false;
    });
  };

  private readonly handleAudioError = (): void => {
    if (this.destroyed || !this.holdsAudio) return;
    this.playingFlag = false;
    this.callError(ERROR_MESSAGE);
  };

  // Position captured at preemption time, when the element is
  // paused but still on this clip (getPosition reads the exact
  // preempt point). Only when actually playing: a paused or
  // completed engine must never auto-resume. Read by the
  // page's anywhere-resume dispatcher; cleared after use.
  preemptedPosition: ThreeModePosition | null = null;

  private readonly handlePreempted = (): void => {
    if (this.destroyed) return;
    this.preemptedPosition = this.playingFlag ? this.getPosition() : null;
    this.playingFlag = false;
    this.holdsAudio = false;
    this.markInternalPause();
    this.currentSrc = '';
    this.nextItem = null;
    this.nextUrl = null;
    this.persistPosition();
    this.callInterrupted();
  };

  private readonly handleAudioPause = (): void => {
    if (this.destroyed || !this.holdsAudio) return;
    let paused = true;
    try {
      paused = this.audio.paused;
    } catch {
      paused = true;
    }
    if (!paused) {
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
    if (this.current !== null && this.current.kind === 'ayah') {
      try {
        const d = this.audio.duration;
        this.currentAyahDuration = Number.isFinite(d) && d > 0 ? d : null;
      } catch {
        this.currentAyahDuration = null;
      }
    }
    this.updatePositionState();
  };

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
    // Background playback while locked is the feature: do NOT
    // pause here, only persist + notify (same as the other engines).
    this.persistPosition();
    this.callInterrupted();
  };

  constructor(opts: JourneyEngineOptions) {
    this.mode = opts.mode;
    this.startSurah =
      Number.isInteger(opts.startSurah) && opts.startSurah >= 1 && opts.startSurah <= 114
        ? opts.startSurah
        : 1;
    this.startReciterId = RECITERS.some((r) => r.id === opts.startReciterId)
      ? opts.startReciterId
      : DEFAULT_RECITER_ID;
    this.startAyah = opts.startAyah ?? 1;
    this.tafsirOrder = opts.tafsirOrder === 'before' ? 'before' : 'after';
    this.resolveAyahUrl = opts.resolveAyahUrl ?? defaultResolveAyahUrl;
    this.probeTafsirDuration = opts.probeTafsirDuration ?? defaultProbeTafsirDuration;
    this.probeAyahDurationOpt = opts.probeAyahDuration;
    this.onItemChange = opts.onItemChange;
    this.onEnded = opts.onEnded;
    this.onError = opts.onError;
    this.onInterrupted = opts.onInterrupted;
    this.pendingStartTime =
      typeof opts.startTime === 'number' && Number.isFinite(opts.startTime) && opts.startTime >= 0
        ? opts.startTime
        : null;
    this.playbackRate =
      typeof opts.playbackRate === 'number' &&
      Number.isFinite(opts.playbackRate) &&
      opts.playbackRate > 0
        ? opts.playbackRate
        : 1;
    this.seekTarget = opts.startItem ?? null;
    this.seekInterstitial = opts.startInterstitial ?? null;
    this.generator = planJourney(this.mode, this.startSurah, this.startReciterId, this.startAyah);

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
  }

  get currentItem(): JourneyPlayable | null {
    return this.current;
  }

  get playing(): boolean {
    return this.playingFlag;
  }

  getPosition(): ThreeModePosition {
    let time = 0;
    try {
      const t = this.audio.currentTime;
      if (Number.isFinite(t) && t >= 0) time = t;
    } catch {
      time = 0;
    }
    const cur = this.current ?? { kind: 'ayah' as const, surah: this.startSurah, ayah: this.startAyah };
    return {
      mode: this.mode,
      startSurah: this.startSurah,
      startReciterId: this.startReciterId,
      kind: cur.kind,
      surah: cur.surah,
      ayah: cur.ayah,
      time,
      ...(this.currentInterstitial ? { interstitial: this.currentInterstitial } : {}),
      // Tadabbur only: the order this journey runs in, so a resume
      // rebuilds the same item stream (previews included) instead
      // of silently re-ordering. Single/varied positions never
      // carry it, and pre-toggle tadabbur positions (absent) read
      // as 'after' at the page layer.
      ...(this.mode === 'tadabbur' ? { tafsirOrder: this.tafsirOrder } : {}),
    };
  }

  async play(): Promise<void> {
    if (this.destroyed) return;
    if (this.playingFlag) return;
    acquireAudio('listen', this.handlePreempted);
    this.holdsAudio = true;
    this.setupMediaSession();
    if (this.current !== null && this.currentSrc) {
      // Resume on the already-loaded item.
      this.applyPendingStartTime();
      this.applyRate();
      try {
        await this.audio.play();
        this.playingFlag = true;
        this.updateMediaSession();
        this.updatePositionState();
      } catch {
        this.playingFlag = false;
        throw new Error(ERROR_MESSAGE);
      }
      return;
    }
    await this.startFirstItem();
  }

  pause(): void {
    if (this.destroyed) return;
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
    this.persistPosition();
  }

  async restart(): Promise<void> {
    if (this.destroyed) return;
    const wasPlaying = this.playingFlag;
    this.pendingStartTime = null;
    this.seekTarget = null;
    this.seekInterstitial = null;
    this.generator = planJourney(this.mode, this.startSurah, this.startReciterId, this.startAyah);
    this.current = null;
    this.currentSrc = '';
    this.nextItem = null;
    this.nextUrl = null;
    this.pendingTafsir = [];
    this.currentInterstitial = null;
    this.pendingMarker = null;
    this.bufferedAyahs = [];
    this.lastAyahQuarter = null;
    this.resetQuarterTracking();
    acquireAudio('listen', this.handlePreempted);
    this.holdsAudio = true;
    this.markInternalPause();
    await this.startFirstItem();
    if (!wasPlaying) {
      // Restart while paused stays paused (same as RiwayaEngine).
      this.pause();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.persistPosition();
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
    this.currentSrc = '';
    this.nextItem = null;
    this.nextUrl = null;
    this.pendingTafsir = [];
    this.currentInterstitial = null;
    this.pendingMarker = null;
    this.bufferedAyahs = [];
    this.pendingStartTime = null;
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
  // Item source: generator + interstitial queue + resume seek.
  // pullNext() returns the next PLAYABLE item (or null at the
  // journey's end), resolving markers into interstitial queues on
  // the way. It is async only when a marker needs probing; the
  // caller (prepareNext) runs it in the background while the
  // current item plays.
  // ----------------------------------------------------------------

  private resetQuarterTracking(): void {
    this.trackedQuarter = null;
    this.trackedAyahs = [];
    this.trackedSeconds = 0;
    this.probedDurations = new Map();
    this.probing = new Set();
  }

  private recordPlayedAyah(): void {
    const cur = this.current;
    if (cur === null || cur.kind !== 'ayah') return;
    if (this.seekTarget !== null) return; // Sought items are not "played".
    const qu = quarterContaining(cur.surah, cur.ayah);
    if (qu === null) return;
    if (this.trackedQuarter !== null && this.trackedQuarter !== qu.q) {
      // Defensive: a marker should have reset tracking already;
      // never let one quarter's seconds leak into the next.
      this.resetQuarterTracking();
    }
    if (this.trackedQuarter === null) {
      this.trackedQuarter = qu.q;
      this.trackedAyahs = [];
      this.trackedSeconds = 0;
    }
    let played = this.currentAyahDuration;
    if (played === null) {
      try {
        const t = this.audio.currentTime;
        played = Number.isFinite(t) && t >= 0 ? t : 0;
      } catch {
        played = 0;
      }
    }
    this.trackedAyahs.push({ surah: cur.surah, ayah: cur.ayah });
    this.trackedSeconds += played ?? 0;
    this.currentAyahDuration = null;
  }

  private kickProbe(surah: number, ayah: number): void {
    const key = `${surah}:${ayah}`;
    if (this.probedDurations.has(key) || this.probing.has(key)) return;
    this.probing.add(key);
    void this.probeTafsirDuration(surah, ayah)
      .then((d) => {
        if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
          this.probedDurations.set(key, d);
        }
        this.probing.delete(key);
      })
      .catch(() => {
        this.probing.delete(key);
      });
  }

  // ----------------------------------------------------------------
  // BEFORE-mode preview machinery (tadabbur only; after-mode never
  // calls any of this — its path below is untouched).
  // ----------------------------------------------------------------

  private isBeforeMode(): boolean {
    return this.mode === 'tadabbur' && this.tafsirOrder === 'before';
  }

  // Planned recitation duration for one ayah: injected override in
  // tests, else resolve the ayah URL and probe its metadata. Null
  // on any failure (skipped, never guessed).
  private async probeRecitationDuration(
    reciterId: string,
    surah: number,
    ayah: number,
  ): Promise<number | null> {
    try {
      if (this.probeAyahDurationOpt) {
        return await this.probeAyahDurationOpt(reciterId, surah, ayah);
      }
      const url = await this.resolveAyahUrl(reciterId, surah, ayah);
      return await probeAudioMetadata(url);
    } catch {
      return null;
    }
  }

  // Lookahead: pull generator items until the next quarterEnd
  // marker or the journey's end. Ayah items are collected in
  // order; a marker is STASHED in pendingMarker (it is the next
  // boundary, to be processed once the collected quarter has
  // played). Callers own the collected ayahs (buffering).
  private collectUpcomingQuarter(): { surah: number; ayah: number; reciterId: string }[] {
    const collected: { surah: number; ayah: number; reciterId: string }[] = [];
    for (;;) {
      const step = this.generator.next();
      if (step.done) return collected;
      const item = step.value;
      if (item.kind === 'quarterEnd') {
        this.pendingMarker = item.quarter;
        return collected;
      }
      collected.push({ surah: item.surah, ayah: item.ayah, reciterId: item.reciterId });
    }
  }

  // Preview selection for one quarter's UPCOMING ayahs (in order).
  // Sizing basis is PLANNED time, not heard time: the sum of the
  // quarter's recitation-clip metadata durations that resolve,
  // probed in parallel (each probe carries the prober's own
  // timeout; failures are skipped). The sum is an HONEST LOWER
  // BOUND when probes fail — it is never scaled or extrapolated,
  // so a partial sum only shortens the preview, exactly like
  // after-mode's shortfall when candidates run out. The selector
  // is the same selectInterstitial (first clips in order until
  // the sum reaches planned/4), with tafsir durations probed
  // sequentially and early-exited like resolveInterstitial.
  // If no planned duration resolves at all, the fallback is the
  // first up to 3 upcoming ayahs with resolvable tafsir clips —
  // a preview, never silence, never a hang. An empty return means
  // the quarter plays without a preview (e.g. tafsir base
  // unconfigured — the page disables tadabbur then, so in-app
  // this is only a defensive path).
  private async resolvePreview(
    quarterAyahs: { surah: number; ayah: number; reciterId: string }[],
  ): Promise<{ surah: number; ayah: number }[]> {
    if (quarterAyahs.length === 0) return [];
    const plannedResults = await Promise.all(
      quarterAyahs.map(async (a) => {
        try {
          return await this.probeRecitationDuration(a.reciterId, a.surah, a.ayah);
        } catch {
          return null;
        }
      }),
    );
    let planned = 0;
    for (const d of plannedResults) {
      if (typeof d === 'number' && Number.isFinite(d) && d > 0) planned += d;
    }
    const candidates: { surah: number; ayah: number; duration: number }[] = [];
    const target = planned > 0 ? planned / 4 : null;
    for (const a of quarterAyahs) {
      if (target !== null) {
        const picked = selectInterstitial(candidates, planned);
        let sum = 0;
        for (const p of picked) {
          const c = candidates.find((x) => x.surah === p.surah && x.ayah === p.ayah);
          sum += c ? c.duration : 0;
        }
        if (sum >= target) break;
      } else if (candidates.length >= 3) {
        break;
      }
      const key = `${a.surah}:${a.ayah}`;
      let d = this.probedDurations.get(key);
      if (d === undefined) {
        try {
          const probed = await this.probeTafsirDuration(a.surah, a.ayah);
          if (typeof probed === 'number' && Number.isFinite(probed) && probed > 0) {
            d = probed;
            this.probedDurations.set(key, probed);
          }
        } catch {
          d = undefined;
        }
      }
      if (d !== undefined) candidates.push({ surah: a.surah, ayah: a.ayah, duration: d });
    }
    if (planned > 0) return selectInterstitial(candidates, planned);
    return candidates.slice(0, 3).map(({ surah, ayah }) => ({ surah, ayah }));
  }

  // Process one quarterEnd marker in before-mode. Returns a
  // playable item, or null meaning "no preview to play here —
  // caller falls through to the buffered ayahs / generator".
  // Seek handling comes first (no lookahead while seeking):
  // - seeking a tafsir item whose quarter FOLLOWS this marker
  //   (marker quarter + 1): the saved preview list belongs HERE
  //   (previews attach to the marker BEFORE their quarter, the
  //   mirror of after-mode attaching to the marker AFTER it).
  //   Replay the saved list from the target index.
  // - any other seek: discard the marker (nothing was played, so
  //   there is nothing to preview from — same rule as after-mode).
  // Normal path: collect the upcoming quarter, buffer it, queue
  // its preview, and return the preview's first clip.
  private async resolveBeforeMarker(
    markerQuarter: number,
  ): Promise<JourneyPlayable | null> {
    if (this.seekTarget !== null) {
      if (this.seekTarget.kind === 'tafsir') {
        const targetQuarter = quarterContaining(this.seekTarget.surah, this.seekTarget.ayah);
        if (targetQuarter !== null && targetQuarter.q === markerQuarter + 1) {
          const saved = this.seekInterstitial ?? [];
          const startIdx = saved.findIndex(
            (x) => x.surah === this.seekTarget?.surah && x.ayah === this.seekTarget?.ayah,
          );
          this.pendingTafsir = startIdx >= 0 ? saved.slice(startIdx) : saved.slice();
          this.currentInterstitial = saved.slice();
          this.seekTarget = null;
          this.seekInterstitial = null;
          this.lastAyahQuarter = targetQuarter.q;
          this.resetQuarterTracking();
          if (this.pendingTafsir.length > 0) {
            const t = this.pendingTafsir.shift() as { surah: number; ayah: number };
            return { kind: 'tafsir', surah: t.surah, ayah: t.ayah };
          }
          // Saved list empty: skip the preview entirely (mirror
          // of after-mode's empty-list marker handling).
          return null;
        }
        this.resetQuarterTracking();
        return null;
      }
      // Seeking an ayah: discard the marker.
      this.resetQuarterTracking();
      return null;
    }
    const upcoming = this.collectUpcomingQuarter();
    if (upcoming.length === 0) return null;
    this.bufferedAyahs = upcoming.map((a) => ({
      kind: 'ayah' as const,
      surah: a.surah,
      ayah: a.ayah,
      reciterId: a.reciterId,
    }));
    const firstQuarter = quarterContaining(upcoming[0].surah, upcoming[0].ayah);
    if (firstQuarter !== null) this.lastAyahQuarter = firstQuarter.q;
    const picked = await this.resolvePreview(upcoming);
    this.pendingTafsir = picked.slice();
    this.currentInterstitial = picked.length > 0 ? picked.slice() : null;
    if (this.pendingTafsir.length > 0) {
      const t = this.pendingTafsir.shift() as { surah: number; ayah: number };
      return { kind: 'tafsir', surah: t.surah, ayah: t.ayah };
    }
    return null;
  }

  private async resolveInterstitial(): Promise<{ surah: number; ayah: number }[]> {
    // Mode (1)/(2) have no interstitials at all.
    if (this.mode !== 'tadabbur') return [];
    const played = this.trackedAyahs;
    const duration = this.trackedSeconds;
    if (played.length === 0 || !(duration > 0)) return [];
    // Candidates in order, with durations: known ones first, then
    // on-demand probes for the unknowns that block reaching the
    // window (bounded: at most the played list, each with timeout
    // inside the prober). A clip that still will not resolve is
    // skipped — it could not play anyway.
    const candidates: { surah: number; ayah: number; duration: number }[] = [];
    for (const a of played) {
      const key = `${a.surah}:${a.ayah}`;
      let d = this.probedDurations.get(key);
      if (d === undefined) {
        try {
          const probed = await this.probeTafsirDuration(a.surah, a.ayah);
          if (typeof probed === 'number' && Number.isFinite(probed) && probed > 0) {
            d = probed;
            this.probedDurations.set(key, probed);
          }
        } catch {
          d = undefined;
        }
      }
      if (d !== undefined) candidates.push({ surah: a.surah, ayah: a.ayah, duration: d });
      // Early exit: once the selector's window is reachable with
      // the candidates so far, later probes are unnecessary.
      const picked = selectInterstitial(candidates, duration);
      const sum = picked.reduce((acc, p) => {
        const c = candidates.find((x) => x.surah === p.surah && x.ayah === p.ayah);
        return acc + (c ? c.duration : 0);
      }, 0);
      if (sum >= duration / 4) break;
    }
    const picked = selectInterstitial(candidates, duration);
    // The completed quarter's tracking resets AFTER selection:
    // the interstitial itself belongs to the quarter, but its
    // clips must never count toward the NEXT quarter's duration.
    this.resetQuarterTracking();
    return picked;
  }

  private async pullNext(resolveMarkers: boolean): Promise<JourneyPlayable | null> {
    // Drain a queued interstitial first.
    if (this.pendingTafsir.length > 0) {
      const t = this.pendingTafsir.shift() as { surah: number; ayah: number };
      return { kind: 'tafsir', surah: t.surah, ayah: t.ayah };
    }
    // BEFORE-mode: buffered quarter ayahs play before any stashed
    // marker is processed — the stash is the NEXT boundary, and
    // processing it early would overwrite this buffer with the
    // following quarter. (No-op in after-mode: the buffer is
    // always empty there, so the existing order below is kept.)
    if (this.bufferedAyahs.length > 0) {
      const b = this.bufferedAyahs.shift() as Extract<JourneyItem, { kind: 'ayah' }>;
      const qu = quarterContaining(b.surah, b.ayah);
      if (qu !== null) this.lastAyahQuarter = qu.q;
      return b;
    }
    // BEFORE-mode: a stashed marker is the next quarter's preview
    // trigger. Preview sizing needs no played data, so unlike
    // after-mode it never waits for the boundary path. The marker
    // is captured and cleared BEFORE resolving, so the lookahead's
    // stash of the FOLLOWING marker survives.
    if (this.pendingMarker !== null && this.isBeforeMode()) {
      const quarterNo = this.pendingMarker;
      this.pendingMarker = null;
      const item = await this.resolveBeforeMarker(quarterNo);
      if (item) return item;
      if (this.bufferedAyahs.length > 0) {
        const b = this.bufferedAyahs.shift() as Extract<JourneyItem, { kind: 'ayah' }>;
        const qu = quarterContaining(b.surah, b.ayah);
        if (qu !== null) this.lastAyahQuarter = qu.q;
        return b;
      }
      // No preview and no buffered ayahs (seek-discard or an
      // empty quarter): fall through to the generator loop, which
      // continues discarding while seeking, or ends the journey.
    }
    // A marker deferred during background preparation is consumed
    // only by the boundary path (resolveMarkers true), when the
    // quarter's played duration is complete.
    if (this.pendingMarker !== null) {
      if (!resolveMarkers) return null;
      const quarterNo = this.pendingMarker;
      this.pendingMarker = null;
      if (this.mode === 'tadabbur') {
        const picked = await this.resolveInterstitial();
        this.pendingTafsir = picked.slice();
        this.currentInterstitial = picked.length > 0 ? picked.slice() : null;
        if (this.pendingTafsir.length > 0) {
          const t = this.pendingTafsir.shift() as { surah: number; ayah: number };
          return { kind: 'tafsir', surah: t.surah, ayah: t.ayah };
        }
      } else {
        this.resetQuarterTracking();
      }
    }
    for (;;) {
      const step = this.generator.next();
      if (step.done) return null;
      const item = step.value;
      if (item.kind === 'quarterEnd') {
        if (this.isBeforeMode()) {
          // This marker ends a quarter; the NEXT quarter's
          // preview belongs here (before its ayahs).
          const bItem = await this.resolveBeforeMarker(item.quarter);
          if (bItem) return bItem;
          if (this.bufferedAyahs.length > 0) {
            const b = this.bufferedAyahs.shift() as Extract<JourneyItem, { kind: 'ayah' }>;
            const qu = quarterContaining(b.surah, b.ayah);
            if (qu !== null) this.lastAyahQuarter = qu.q;
            return b;
          }
          // Seek-discard or an empty quarter: keep looping.
          continue;
        }
        if (this.mode !== 'tadabbur') {
          this.resetQuarterTracking();
          continue;
        }
        // Resume into a tafsir item: the saved list replaces
        // selection (the quarter's played duration is gone).
        if (this.seekTarget !== null && this.seekTarget.kind === 'tafsir') {
          const targetQuarter = quarterContaining(
            this.seekTarget.surah,
            this.seekTarget.ayah,
          );
          if (targetQuarter !== null && targetQuarter.q === item.quarter) {
            const saved = this.seekInterstitial ?? [];
            const startIdx = saved.findIndex(
              (x) => x.surah === this.seekTarget?.surah && x.ayah === this.seekTarget?.ayah,
            );
            this.pendingTafsir = startIdx >= 0 ? saved.slice(startIdx) : saved.slice();
            this.currentInterstitial = saved.slice();
            this.seekTarget = null;
            this.seekInterstitial = null;
            this.resetQuarterTracking();
            if (this.pendingTafsir.length > 0) {
              const t = this.pendingTafsir.shift() as { surah: number; ayah: number };
              return { kind: 'tafsir', surah: t.surah, ayah: t.ayah };
            }
            // Saved list empty: skip the interstitial entirely.
            continue;
          }
          // Seeking a tafsir item of another quarter, or seeking
          // an ayah: discard the marker (nothing was played, so
          // there is nothing to size an interstitial from).
          this.resetQuarterTracking();
          continue;
        }
        if (this.seekTarget !== null) {
          // Seeking an ayah: discard the marker.
          this.resetQuarterTracking();
          continue;
        }
        if (!resolveMarkers) {
          // Background preparation: defer the marker until the
          // boundary, when the quarter's duration is complete.
          this.pendingMarker = item.quarter;
          return null;
        }
        const picked = await this.resolveInterstitial();
        this.pendingTafsir = picked.slice();
        this.currentInterstitial = picked.length > 0 ? picked.slice() : null;
        if (this.pendingTafsir.length > 0) {
          const t = this.pendingTafsir.shift() as { surah: number; ayah: number };
          return { kind: 'tafsir', surah: t.surah, ayah: t.ayah };
        }
        continue;
      }
      // Ayah item: resume-seek discards non-matching items.
      if (this.isBeforeMode() && this.seekTarget !== null && this.seekTarget.kind === 'tafsir') {
        // BEFORE-mode seek into a preview of the journey's FIRST
        // quarter: no marker precedes it (that preview is
        // generated at journey start), so the marker branch can
        // never catch it. The first ayah of that quarter triggers
        // the saved list instead. Any other quarter's preview is
        // caught by its preceding marker; other ayahs pass by.
        const targetQuarter = quarterContaining(this.seekTarget.surah, this.seekTarget.ayah);
        const ayahQuarter = quarterContaining(item.surah, item.ayah);
        const firstQuarter = quarterContaining(this.startSurah, this.startAyah);
        if (
          targetQuarter !== null &&
          ayahQuarter !== null &&
          firstQuarter !== null &&
          targetQuarter.q === ayahQuarter.q &&
          targetQuarter.q === firstQuarter.q
        ) {
          const saved = this.seekInterstitial ?? [];
          const startIdx = saved.findIndex(
            (x) => x.surah === this.seekTarget?.surah && x.ayah === this.seekTarget?.ayah,
          );
          this.pendingTafsir = startIdx >= 0 ? saved.slice(startIdx) : saved.slice();
          this.currentInterstitial = saved.slice();
          this.seekTarget = null;
          this.seekInterstitial = null;
          this.lastAyahQuarter = targetQuarter.q;
          this.resetQuarterTracking();
          if (this.pendingTafsir.length > 0) {
            // Buffer the triggering ayah (seek already cleared,
            // so the invariant holds): it plays after the preview.
            this.bufferedAyahs = [item];
            const t = this.pendingTafsir.shift() as { surah: number; ayah: number };
            return { kind: 'tafsir', surah: t.surah, ayah: t.ayah };
          }
          // Saved list empty: play the quarter's first ayah.
          return item;
        }
        continue;
      }
      if (this.seekTarget !== null) {
        if (this.seekTarget.kind === 'ayah') {
          if (item.surah === this.seekTarget.surah && item.ayah === this.seekTarget.ayah) {
            this.seekTarget = null;
            this.lastAyahQuarter = quarterContaining(item.surah, item.ayah)?.q ?? null;
            return item;
          }
          continue;
        }
        // Seeking a tafsir item: ayah items pass by until the
        // marker of its quarter (handled above). If the journey
        // ends first, the seek has failed — startFirstItem falls
        // back to the journey's start.
        continue;
      }
      // BEFORE-mode quarter start. A generator ayah can begin a
      // quarter without a preceding marker only at journey start
      // (or restart) — every later quarter is preceded by its
      // marker, which already queued its preview. So this fires
      // once per journey: buffer this ayah plus the rest of its
      // quarter, preview first.
      if (this.isBeforeMode()) {
        const qu = quarterContaining(item.surah, item.ayah);
        if (qu !== null && qu.q !== this.lastAyahQuarter) {
          this.bufferedAyahs = [item];
          const rest = this.collectUpcomingQuarter();
          for (const a of rest) {
            this.bufferedAyahs.push({
              kind: 'ayah' as const,
              surah: a.surah,
              ayah: a.ayah,
              reciterId: a.reciterId,
            });
          }
          this.lastAyahQuarter = qu.q;
          const previewAyahs = this.bufferedAyahs.map((b) => ({
            surah: b.surah,
            ayah: b.ayah,
            reciterId: b.reciterId,
          }));
          const picked = await this.resolvePreview(previewAyahs);
          this.pendingTafsir = picked.slice();
          this.currentInterstitial = picked.length > 0 ? picked.slice() : null;
          if (this.pendingTafsir.length > 0) {
            const t = this.pendingTafsir.shift() as { surah: number; ayah: number };
            return { kind: 'tafsir', surah: t.surah, ayah: t.ayah };
          }
          const first = this.bufferedAyahs.shift() as Extract<JourneyItem, { kind: 'ayah' }>;
          return first;
        }
      }
      return item;
    }
  }

  private async prepareNext(resolveMarkers = false): Promise<void> {
    if (this.preparingNext) return this.preparePromise ?? Promise.resolve();
    this.preparingNext = true;
    this.preparePromise = (async () => {
      try {
        if (this.nextItem !== null) return;
        // Loop: an unplayable tafsir item (unconfigured base)
        // is skipped, never fatal, and the loop always consumes
        // generator items or the interstitial queue, so it ends.
        for (;;) {
          const item = await this.pullNext(resolveMarkers);
          if (item === null) {
            this.nextItem = null;
            this.nextUrl = null;
            return;
          }
          const url =
            item.kind === 'ayah'
              ? await this.resolveAyahUrl(item.reciterId, item.surah, item.ayah)
              : tafsirClipUrl(item.surah, item.ayah);
          if (url === null) continue;
          this.nextItem = item;
          this.nextUrl = url;
          return;
        }
      } catch {
        this.nextItem = null;
        this.nextUrl = null;
      } finally {
        this.preparingNext = false;
        this.preparePromise = null;
      }
    })();
    return this.preparePromise;
  }

  private async startFirstItem(): Promise<void> {
    // Resume seek that never matches must not hang: if pullNext
    // exhausts the journey while seeking, restart from the top
    // without a seek target (documented fallback).
    let item = await this.pullNext(true);
    if (item === null && this.seekTarget !== null) {
      this.seekTarget = null;
      this.seekInterstitial = null;
      this.generator = planJourney(this.mode, this.startSurah, this.startReciterId, this.startAyah);
      item = await this.pullNext(true);
    }
    if (item === null) {
      this.playingFlag = false;
      this.callEnded();
      return;
    }
    const url =
      item.kind === 'ayah'
        ? await this.resolveAyahUrl(item.reciterId, item.surah, item.ayah)
        : tafsirClipUrl(item.surah, item.ayah);
    if (url === null) {
      this.playingFlag = false;
      this.callError(ERROR_MESSAGE);
      return;
    }
    this.playItem(item, url);
    void this.prepareNext();
  }

  private async advanceAfterPreparation(): Promise<void> {
    // Boundary path: markers resolve here, with the completed
    // quarter's played duration already recorded.
    await this.prepareNext(true);
    if (this.destroyed || !this.holdsAudio) return;
    if (this.nextItem !== null && this.nextUrl !== null) {
      const item = this.nextItem;
      const url = this.nextUrl;
      this.nextItem = null;
      this.nextUrl = null;
      this.playItem(item, url);
      void this.prepareNext();
      return;
    }
    // Journey complete.
    this.playingFlag = false;
    this.callEnded();
  }

  private playItem(item: JourneyPlayable, url: string): void {
    this.current = item;
    this.currentSrc = url;
    this.currentAyahDuration = null;
    if (item.kind === 'ayah') {
      // An ayah position never carries an interstitial list: the
      // previous interstitial is over.
      this.currentInterstitial = null;
      // Start background probing for this ayah's tafsir clip, so
      // the quarter boundary usually finds durations already known.
      if (this.mode === 'tadabbur') this.kickProbe(item.surah, item.ayah);
    }
    try {
      this.audio.src = url;
    } catch {
      // Swallow: a later 'error' event surfaces real media failures.
    }
    this.applyPendingStartTime();
    this.applyRate();
    try {
      const p = this.audio.play() as unknown as Promise<void> | undefined;
      this.playingFlag = true;
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          this.playingFlag = false;
        });
      }
    } catch {
      this.playingFlag = false;
    }
    this.updateMediaSession();
    this.updatePositionState();
    this.callItemChange(item);
  }

  // ----------------------------------------------------------------
  // Internals
  // ----------------------------------------------------------------

  // Same contract as the other engines: re-applied at every play
  // site (playItem + the play() resume path) so no rate leaks
  // across modes on the shared element.
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

  private persistPosition(): void {
    try {
      writeThreeModeResume(this.getPosition());
    } catch {
      // Swallow: persistence must never break playback.
    }
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
        // Swallow.
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

  private callItemChange(item: JourneyPlayable): void {
    if (!this.onItemChange) return;
    try {
      this.onItemChange(item);
    } catch {
      // Swallow.
    }
  }

  private callEnded(): void {
    if (!this.onEnded) return;
    try {
      this.onEnded();
    } catch {
      // Swallow.
    }
  }

  private callError(message: string): void {
    if (!this.onError) return;
    try {
      this.onError(message);
    } catch {
      // Swallow.
    }
  }

  private callInterrupted(): void {
    if (!this.onInterrupted) return;
    try {
      this.onInterrupted();
    } catch {
      // Swallow.
    }
  }

  private updatePositionState(): void {
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
      // Swallow.
    }
  }

  private setupMediaSession(): void {
    try {
      const ms = getMediaSession();
      if (!ms) return;
      ms.setActionHandler('play', () => {
        void this.play().catch(() => {
          // Swallow: gesture-less play rejections surface on the
          // next user gesture.
        });
      });
      ms.setActionHandler('pause', () => {
        this.pause();
      });
      ms.setActionHandler('previoustrack', null);
      ms.setActionHandler('nexttrack', null);
    } catch {
      // Swallow.
    }
  }

  private updateMediaSession(): void {
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
      const cur = this.current;
      if (cur === null) return;
      const surahName = SURAHS[cur.surah - 1]?.name ?? String(cur.surah);
      if (cur.kind === 'ayah') {
        const reciterName =
          RECITERS.find((r) => r.id === cur.reciterId)?.name ?? cur.reciterId;
        ms.metadata = new MediaMetadataCtor({
          title: `سورة ${surahName} — آية ${cur.ayah}`,
          artist: reciterName,
          album: 'روابط الذكر الحكيم',
        });
      } else {
        ms.metadata = new MediaMetadataCtor({
          title: `تفسير سورة ${surahName} آية ${cur.ayah}`,
          artist: 'التفسير الميسر',
          album: 'روابط الذكر الحكيم',
        });
      }
    } catch {
      // Swallow.
    }
  }
}
