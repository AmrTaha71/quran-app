import { earMicConstraints } from './earMic.ts';
import { MIC_CHECK_RMS_THRESHOLD } from './earTuning.ts';
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

/** Why the check did not end in "heard you" (undefined when it did). */
export type MicReason =
  | 'denied'       // permission refused (browser / device settings)
  | 'no-device'    // no microphone found
  | 'busy'         // mic held by another app / tab, or unreadable
  | 'unsupported'  // browser has no getUserMedia / AudioContext
  | 'no-answer'    // the permission prompt was never answered in time
  | 'suspended'    // permission fine but the audio engine never started (iOS gesture rule)
  | 'muted'        // the mic track is muted by the system
  | 'quiet'        // mic is live but the level stayed below the threshold
  | 'error';       // anything else

export interface MicCheckResult {
  permission: MicPermission;
  /** Set whenever heardSomething is false. */
  reason?: MicReason;
  /** Loudest RMS level seen during sampling, 0 (silence) to ~1. */
  maxLevel: number;
  /** True when the mic clearly heard something above background noise. */
  heardSomething: boolean;
}

export interface MicCheckOptions {
  /** How long to sample the mic, in ms. Default 2500. */
  sampleMs?: number;
  /** How long to wait for the permission prompt to be answered, in ms. Default 20000.
   * Only the wait for the stream counts: once the mic is granted, sampling runs its
   * own course (before 2026-11-20 this deadline also covered sampling, so a prompt
   * answered after ~2.5s turned a granted mic into an "error"). */
  timeoutMs?: number;
  /** RMS level that counts as "heard something". Default 0.015 (see below). */
  threshold?: number;
  /** Called roughly every 100ms with the current RMS level (0-1), so the
   * lobby can draw a live volume bar while sampling. Never throws into
   * the check: a throwing callback is swallowed. */
  onLevel?: (level: number) => void;
}

// Threshold rationale: time-domain silence sits at byte value 128, so
// RMS is measured as deviation from 128. Phone browsers (iOS Safari
// especially) apply noise suppression + auto gain, so a quiet room reads
// ~0.001-0.01 RMS while ordinary speech over a 46 ms window reads about
// 0.02-0.15 (the old 0.08 was a PEAK-ish figure and rejected normal
// speech). 0.015 still means "somebody actually spoke", not just "the mic
// opened". maxLevel is still reported. Estimate from signal reasoning,
// not measured on a device.
const DEFAULT_THRESHOLD = MIC_CHECK_RMS_THRESHOLD; // earTuning.ts (not yet device-measured)

const DEFAULT_SAMPLE_MS = 2500;
const DEFAULT_TIMEOUT_MS = 20000;

function clampMs(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function errName(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : '';
}

function isDenial(err: unknown): boolean {
  const name = errName(err);
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError';
}

/** Maps a getUserMedia failure to a reason the lobby can show. */
export function reasonOfError(err: unknown): MicReason {
  const name = errName(err);
  if (isDenial(err)) return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'no-device';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'error';
}

function errorResult(reason: MicReason = 'error'): MicCheckResult {
  return { permission: 'error', reason, maxLevel: 0, heardSomething: false };
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
    clampMs(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 60000),
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
    return errorResult('unsupported');
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

    // Deadline for a stuck permission prompt: the caller must never hang
    // forever. It is cleared the moment the stream arrives (see below).
    timeoutTimer = setTimeout(() => finish(errorResult('no-answer')), timeoutMs);

    // iOS Safari only lets an AudioContext run if it is created/resumed in
    // the tap's own call stack. After `await getUserMedia` that stack is
    // gone, so a context created there can stay "suspended" and read pure
    // silence. Create + resume it NOW, synchronously, inside the tap.
    const AC =
      typeof window !== 'undefined'
        ? window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!AC) {
      finish(errorResult('unsupported'));
      return;
    }
    try {
      ctx = new AC();
      void ctx.resume().catch(() => {});
    } catch {
      finish(errorResult('unsupported'));
      return;
    }

    let gum: Promise<MediaStream>;
    try {
      // 3.24: the same mic settings the ears use, so the check tests them.
      gum = navigator.mediaDevices.getUserMedia(earMicConstraints());
    } catch (err) {
      finish(errorResult(reasonOfError(err)));
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
        // Permission is granted: the prompt deadline has done its job.
        if (timeoutTimer !== null) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }

        let analyser: AnalyserNode;
        try {
          if (!ctx) throw new Error('no context');
          source = ctx.createMediaStreamSource(stream);
          analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
        } catch {
          finish(errorResult());
          return;
        }
        // Resume again now that the stream exists (harmless if running).
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
          const heard = maxLevel >= threshold;
          let reason: MicReason | undefined;
          if (!heard) {
            const track = stream?.getAudioTracks?.()[0];
            if (ctx && ctx.state !== 'running') reason = 'suspended';
            else if (track && track.muted) reason = 'muted';
            else reason = 'quiet';
          }
          finish({ permission: 'granted', reason, maxLevel, heardSomething: heard });
        }, sampleMs);
      },
      (err: unknown) => {
        if (settled) return;
        finish({
          permission: isDenial(err) ? 'denied' : 'error',
          reason: reasonOfError(err),
          maxLevel: 0,
          heardSomething: false,
        });
      },
    );
  });
}

/** Arabic (Egyptian) one-line explanation of a mic check that did not hear the user. */
export function micCheckReasonText(r: MicCheckResult): string {
  const pct = Math.round(r.maxLevel * 100);
  switch (r.reason) {
    case 'denied':
      return 'الإذن مقفول — اسمح بالميكروفون للموقع من إعدادات المتصفح أو إعدادات الجهاز، وبعدها اضغط تاني.';
    case 'no-device':
      return 'مش لاقي ميكروفون على الجهاز — شوف إن في ميكروفون شغال، أو قيّم نفسك يدوي.';
    case 'busy':
      return 'الميكروفون مشغول بتطبيق أو تبويب تاني — اقفله وجرّب تاني.';
    case 'unsupported':
      return 'المتصفح ده مش بيدعم الميكروفون — جرّب من Safari على iPhone/iPad، أو قيّم نفسك يدوي.';
    case 'no-answer':
      return 'طلب الإذن ما اتردّش عليه — اضغط تاني ووافق على استخدام الميكروفون.';
    case 'suspended':
      return 'الصوت ما اشتغلش على الجهاز (المتصفح وقّف معالج الصوت) — اضغط الزر تاني، ولو فضل كده أعد فتح الصفحة.';
    case 'muted':
      return 'الميكروفون مكتّم من النظام (مكالمة أو تطبيق تاني شغّال عليه) — فكّه وجرّب تاني.';
    case 'quiet':
      return `الإذن تمام والميكروفون شغال، بس الصوت ضعيف (مستوى ${pct}٪) — قرّب من الجهاز أو علّي صوتك، واضغط تاني.`;
    default:
      return 'ما قدرتش أفتح الميكروفون — جرّب من Safari على iPhone/iPad، أو قيّم نفسك يدوي.';
  }
}
