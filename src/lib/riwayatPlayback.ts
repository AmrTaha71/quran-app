// Riwaya surah-file playback engine — the listening-only companion
// to ListenEngine (listenPlayback.ts), kept deliberately SEPARATE
// so the Hafs ayah-chaining engine is untouched.
//
// HADR (see hadr.ts) reuses this engine with the edition / label /
// persist options: Juhani's surah files are the same shape as a
// riwaya's (one file per surah, no ayah steps, no read-along), so
// a second engine would only duplicate the Media Session +
// interruption behaviour. The riwaya picker still renders only
// the five RIWAYAT entries; hadr is selected from the pace area.
//
// MODEL: one surah file per playback (the riwaya editions are
// surahbysurah). The engine plays that single file to its end and
// then stops — it NEVER auto-advances to the next surah, chains
// ayahs, or highlights text. Position is (riwaya, surah,
// time-in-surah in seconds), persisted on pause / stop /
// interruption / destroy, exactly like the Hafs wird path.
//
// SHARED AUDIO: the playing element is the SAME shared singleton
// from sharedAudio.ts, acquired with owner 'listen'. Starting a
// riwaya file therefore preempts Hafs listen (and radio), and
// starting Hafs listen (or radio) preempts this engine — via the
// same onPreempted callback contract. INTERRUPTION: this engine
// NEVER auto-resumes. Tab-hide and external 'pause' events persist
// and fire onInterrupted; resume is a UI button only.
//
// Hook-free, React-free, Supabase-free, same as ListenEngine.

import { RIWAYAT, writeRiwayaResume } from './riwayat';
import type { RiwayaPosition } from './riwayat';
import { SURAHS } from './surahs';
import { getSharedAudio, acquireAudio, releaseAudio } from './sharedAudio';

const ERROR_MESSAGE = 'تعذرت التلاوة — تحقق من الاتصال وحاول تاني';

export interface RiwayaEngineOptions {
  riwayaId: string;
  surah: number;
  /** Seconds into the surah file to resume from. Clamped to duration. */
  startTime?: number;
  // ELECTRONIC speed (audio.playbackRate), applied on every play
  // site like ListenEngine. Defaults to 1. This is NOT hadr.
  playbackRate?: number;
  // HADR GENERALISATION (see hadr.ts): when an edition override
  // is given, the engine plays that edition's surah files instead
  // of a RIWAYAT entry, riwayaId is accepted as-is (it is then a
  // caller-supplied mode id, e.g. 'hadr', not a RIWAYAT id), and
  // `label` replaces the RIWAYAT name in Media Session metadata.
  // The riwaya picker itself never sees these options — it still
  // renders only the five RIWAYAT entries.
  edition?: string;
  label?: string;
  // Persist override: when given, positions go here instead of
  // writeRiwayaResume (which would silently drop a non-RIWAYAT
  // id). Hadr passes writeHadrResume.
  onPersistPosition?: (pos: RiwayaPosition) => void;
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

export class RiwayaEngine {
  private readonly riwayaId: string;
  private readonly playbackRate: number;
  private readonly editionOverride: string | null;
  private readonly labelOverride: string | null;
  private readonly onPersistPosition?: (pos: RiwayaPosition) => void;
  private readonly onEnded?: () => void;
  private readonly onError?: (message: string) => void;
  private readonly onInterrupted?: () => void;

  private surah: number;
  private playingFlag = false;
  private destroyed = false;
  private holdsAudio = false;
  private pendingStartTime: number | null;
  private internalPauseTokens = 0;
  private internalPauseAt = 0;
  private lastPositionStateAt = 0;
  // Periodic persist (2026-10-29): without this, a position
  // exists only after a pause/hide/destroy event — closing or
  // killing the tab mid-playback saved NOTHING, so hadr/riwaya
  // resume silently vanished. Throttled to 10s: localStorage
  // writes stay cheap, and any listening longer than 10s
  // leaves a recoverable position.
  private lastPersistAt = 0;

  private readonly audio: HTMLAudioElement;
  private currentSrc = '';
  private loadedSurah: number | null = null;

  // Handlers are field arrow functions declared BEFORE the
  // constructor body runs (same pattern as ListenEngine).

  private readonly handleEnded = (): void => {
    if (this.destroyed || !this.holdsAudio) return;
    // End of the surah file: stop here, never auto-advance.
    this.playingFlag = false;
    this.callEnded();
  };

  private readonly handleAudioError = (): void => {
    if (this.destroyed || !this.holdsAudio) return;
    this.playingFlag = false;
    // Do NOT skip anywhere on error.
    this.callError(ERROR_MESSAGE);
  };

  private readonly handlePreempted = (): void => {
    if (this.destroyed) return;
    this.playingFlag = false;
    this.holdsAudio = false;
    // The acquire-pause event for this preemption may arrive after
    // this handler; token it so it is not later mistaken for an
    // external pause if this engine re-acquires within the window.
    this.markInternalPause();
    this.currentSrc = '';
    this.loadedSurah = null;
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
      // Stale event: the element is playing again. It still
      // consumes its token, or the token would swallow the next
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
    // Periodic persist (see lastPersistAt): only while actually
    // playing, so a seek that has not applied yet can never
    // overwrite a resumed position with 0.
    if (this.playingFlag && now - this.lastPersistAt >= 10000) {
      this.lastPersistAt = now;
      this.persistPosition();
    }
  };

  private readonly handleLoadedMetadata = (): void => {
    if (this.destroyed || !this.holdsAudio) return;
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
    // pause here, only persist + notify (same as ListenEngine).
    this.persistPosition();
    this.callInterrupted();
  };

  constructor(opts: RiwayaEngineOptions) {
    const surah =
      Number.isInteger(opts.surah) && opts.surah >= 1 && opts.surah <= 114 ? opts.surah : 1;
    // With an edition override (hadr), the id is a mode id, not a
    // RIWAYAT id, so it is accepted as-is; without one, the
    // original validation stands (unknown id -> first riwaya).
    this.riwayaId =
      typeof opts.edition === 'string' && opts.edition.length > 0
        ? opts.riwayaId
        : RIWAYAT.some((r) => r.id === opts.riwayaId)
          ? opts.riwayaId
          : RIWAYAT[0].id;
    this.playbackRate =
      typeof opts.playbackRate === 'number' &&
      Number.isFinite(opts.playbackRate) &&
      opts.playbackRate > 0
        ? opts.playbackRate
        : 1;
    this.editionOverride =
      typeof opts.edition === 'string' && opts.edition.length > 0 ? opts.edition : null;
    this.labelOverride =
      typeof opts.label === 'string' && opts.label.length > 0 ? opts.label : null;
    this.onPersistPosition = opts.onPersistPosition;
    this.onEnded = opts.onEnded;
    this.onError = opts.onError;
    this.onInterrupted = opts.onInterrupted;
    this.pendingStartTime =
      typeof opts.startTime === 'number' && Number.isFinite(opts.startTime) && opts.startTime >= 0
        ? opts.startTime
        : null;
    this.surah = surah;

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
    // NOTE: no Media Session setup here on purpose — same reason
    // as ListenEngine: only touch it after acquiring ownership.
  }

  get current(): { riwaya: string; surah: number } {
    return { riwaya: this.riwayaId, surah: this.surah };
  }

  get playing(): boolean {
    return this.playingFlag;
  }

  getPosition(): RiwayaPosition {
    let time = 0;
    try {
      const t = this.audio.currentTime;
      if (Number.isFinite(t) && t >= 0) time = t;
    } catch {
      time = 0;
    }
    return { riwaya: this.riwayaId, surah: this.surah, time };
  }

  async play(): Promise<void> {
    if (this.destroyed) return;
    if (this.playingFlag) return;
    acquireAudio('listen', this.handlePreempted);
    this.holdsAudio = true;
    this.setupMediaSession();
    // Resume on the already-loaded surah file when possible.
    if (this.loadedSurah === this.surah && this.currentSrc) {
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
    await this.startCurrentPlayback();
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
        // Swallow: pause is best-effort on a stopped element.
      }
    }
    // Pause persists the LIVE position (with time), not time 0.
    this.persistPosition();
  }

  async restart(): Promise<void> {
    if (this.destroyed) return;
    // Restart means the surah file's start: a pending resume
    // offset no longer applies.
    this.pendingStartTime = null;
    acquireAudio('listen', this.handlePreempted);
    this.holdsAudio = true;
    this.markInternalPause();
    const wasPlaying = this.playingFlag;
    if (this.loadedSurah !== this.surah || !this.currentSrc) {
      await this.startCurrentPlayback();
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
    this.updatePositionState();
  }

  destroy(): void {
    if (this.destroyed) return;
    // Persist first: destroy() is a stop path for riwaya mode,
    // and the resume position is the feature.
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
    this.loadedSurah = null;
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
  // Internals
  // ----------------------------------------------------------------

  private persistPosition(): void {
    // Riwaya resume is unconditional (unlike Hafs free mode):
    // remembering the position IS the feature. With a persist
    // override (hadr), positions go to the override instead —
    // writeRiwayaResume would silently drop a non-RIWAYAT id.
    try {
      if (this.onPersistPosition) this.onPersistPosition(this.getPosition());
      else writeRiwayaResume(this.getPosition());
    } catch {
      // Swallow: persistence must never break playback.
    }
  }

  // Same contract as ListenEngine.applyRate: re-applied at every
  // play site so no rate leaks across modes (hadr passes 1, so a
  // leftover 1.5x from Hafs listening can never speed up Juhani).
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

  private async startCurrentPlayback(): Promise<void> {
    // Edition override (hadr) uses the same verified surah-file
    // pattern with its own edition id; otherwise the RIWAYAT
    // entry's audioUrl (the original behaviour, unchanged).
    const url =
      this.editionOverride !== null
        ? `https://cdn.islamic.network/quran/audio-surah/128/${this.editionOverride}/${this.surah}.mp3`
        : (RIWAYAT.find((r) => r.id === this.riwayaId) ?? RIWAYAT[0]).audioUrl(this.surah);
    this.currentSrc = url;
    this.loadedSurah = this.surah;
    try {
      this.audio.src = url;
    } catch {
      // Swallow: a later 'error' event surfaces real media failures.
    }
    this.applyPendingStartTime();
    this.applyRate();
    await this.audio.play();
    this.playingFlag = true;
    this.updateMediaSession();
    this.updatePositionState();
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
      // Swallow: Media Session is entirely best-effort.
    }
  }

  private setupMediaSession(): void {
    try {
      const ms = getMediaSession();
      if (!ms) return;
      ms.setActionHandler('play', () => {
        void this.play().catch(() => {
          // Swallow: gesture-less Media Session play rejections
          // are surfaced by the next user gesture.
        });
      });
      ms.setActionHandler('pause', () => {
        this.pause();
      });
      // No ayah/surah navigation in riwaya mode: a surah file
      // has no next/previous track inside this engine.
      ms.setActionHandler('previoustrack', null);
      ms.setActionHandler('nexttrack', null);
    } catch {
      // Media Session is entirely best-effort.
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
      const surahName = SURAHS[this.surah - 1]?.name ?? String(this.surah);
      const riwayaName =
        this.labelOverride ??
        RIWAYAT.find((r) => r.id === this.riwayaId)?.name ??
        this.riwayaId;
      ms.metadata = new MediaMetadataCtor({
        title: `سورة ${surahName}`,
        artist: riwayaName,
        album: 'روابط الذكر الحكيم',
      });
    } catch {
      // Media Session is entirely best-effort.
    }
  }
}
