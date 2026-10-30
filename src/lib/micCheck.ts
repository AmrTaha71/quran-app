// micCheck.ts — a small, dependency-free microphone check for the
// SelfTest lobby. Call it from a tap handler BEFORE a recitation
// session starts: it opens the mic, measures how loud the room is for
// a couple of seconds, then closes everything again.
//
// It never throws and never rejects: every failure path resolves to a
// MicCheckResult, so the lobby can always decide what to show next.
// It never leaks a live mic: every MediaStreamTrack is stopped and
// the AudioContext is closed on finish, timeout, denial, and error.

export type MicPermission = 'granted' | 'denied' | 'error';

export interface MicCheckResult {
  permission: MicPermission;
  /** Loudest RMS level seen during sampling, 0 (silence) to ~1. */
  maxLevel: number;
  /** True when the mic clearly heard something above background noise. */
  heardSomething: boolean;
}

export interface MicCheckOptions {
  /** How long to sample the mic, in ms. Default 2500. */
  sampleMs?: number;
  /** Overall deadline, in ms, including the permission prompt. Default 5000. */
  timeoutMs?: number;
  /** RMS level that counts as "heard something". Default 0.08 (see below). */
  threshold?: number;
  /** Called roughly every 100ms with the current RMS level (0-1), so the
   * lobby can draw a live volume bar while sampling. Never throws into
   * the check: a throwing callback is swallowed. */
  onLevel?: (level: number) => void;
}

// Threshold rationale: time-domain silence sits at byte value 128, so
// RMS is measured as deviation from 128. A quiet room's mic noise floor
// stays below ~0.03 RMS, while normal speech peaks well above 0.1. The
// 0.08 threshold therefore means "the mic is live AND somebody actually
// spoke", not just "the mic opened without error". maxLevel is still
// reported, so the lobby can apply its own judgement if it wants to.
const DEFAULT_THRESHOLD = 0.08;

const DEFAULT_SAMPLE_MS = 2500;
const DEFAULT_TIMEOUT_MS = 5000;

function clampMs(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function isDenial(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError';
}

function errorResult(): MicCheckResult {
  return { permission: 'error', maxLevel: 0, heardSomething: false };
}

/**
 * Open the mic, sample its volume for ~2.5s, then clean up.
 * Resolves (never rejects) with the permission outcome and the
 * loudest level heard. Safe to call in browsers without getUserMedia
 * or AudioContext: those resolve to permission 'error'.
 */
export async function checkMic(options: MicCheckOptions = {}): Promise<MicCheckResult> {
  const sampleMs = clampMs(options.sampleMs, DEFAULT_SAMPLE_MS, 500, 10000);
  // The deadline must leave room for sampling after the prompt, so a
  // too-small timeout is raised instead of self-defeating.
  const timeoutMs = Math.max(
    clampMs(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 30000),
    sampleMs + 1000,
  );
  const threshold =
    typeof options.threshold === 'number' && Number.isFinite(options.threshold) && options.threshold >= 0
      ? options.threshold
      : DEFAULT_THRESHOLD;
  const onLevel = options.onLevel;

  // No browser mic stack at all: report, don't throw.
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    return errorResult();
  }

  return new Promise<MicCheckResult>((resolve) => {
    let settled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let sampleTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = async (): Promise<void> => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      if (sampleTimer !== null) {
        clearTimeout(sampleTimer);
        sampleTimer = null;
      }
      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      try {
        source?.disconnect();
      } catch {
        // ignore: disconnect on a dead graph is harmless
      }
      source = null;
      // Stopping the tracks is what clears the live-mic indicator, so
      // it happens synchronously, before the context close below.
      try {
        stream?.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            // ignore: an already-stopped track is fine
          }
        });
      } catch {
        // ignore
      }
      stream = null;
      if (ctx) {
        const toClose = ctx;
        ctx = null;
        try {
          if (toClose.state !== 'closed') await toClose.close();
        } catch {
          // ignore: close is best-effort once tracks are stopped
        }
      }
    };

    const finish = (result: MicCheckResult): void => {
      if (settled) return;
      settled = true;
      void cleanup().finally(() => resolve(result));
    };

    // Deadline for the whole check, including a stuck permission
    // prompt: the caller must never hang forever.
    timeoutTimer = setTimeout(() => finish(errorResult()), timeoutMs);

    let gum: Promise<MediaStream>;
    try {
      gum = navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      finish(errorResult());
      return;
    }

    void gum.then(
      (acquired) => {
        // Arrived after the deadline already resolved us: stop it
        // immediately so no mic stays live behind the caller's back.
        if (settled) {
          try {
            acquired.getTracks().forEach((track) => {
              try {
                track.stop();
              } catch {
                // ignore
              }
            });
          } catch {
            // ignore
          }
          return;
        }
        stream = acquired;

        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) {
          finish(errorResult());
          return;
        }
        let analyser: AnalyserNode;
        try {
          ctx = new AC();
          source = ctx.createMediaStreamSource(stream);
          analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
        } catch {
          finish(errorResult());
          return;
        }
        // A context created outside a user gesture may start
        // suspended and report silence; the lobby calls checkMic from
        // a tap, so resume should succeed — failure is non-fatal.
        void ctx.resume().catch(() => {});

        const data = new Uint8Array(analyser.fftSize);
        let maxLevel = 0;
        interval = setInterval(() => {
          try {
            analyser.getByteTimeDomainData(data);
          } catch {
            return;
          }
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const d = (data[i] - 128) / 128;
            sum += d * d;
          }
          const rms = Math.sqrt(sum / data.length);
          if (rms > maxLevel) maxLevel = rms;
          if (onLevel) {
            try {
              onLevel(rms);
            } catch {
              // ignore: a caller callback must not break sampling
            }
          }
        }, 100);

        sampleTimer = setTimeout(() => {
          finish({
            permission: 'granted',
            maxLevel,
            heardSomething: maxLevel >= threshold,
          });
        }, sampleMs);
      },
      (err: unknown) => {
        if (settled) return;
        finish({
          permission: isDenial(err) ? 'denied' : 'error',
          maxLevel: 0,
          heardSomething: false,
        });
      },
    );
  });
}
