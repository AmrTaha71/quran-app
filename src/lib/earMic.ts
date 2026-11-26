// 3.24 (2026-11-26): ONE set of microphone settings for every ear, so the
// lobby mic check tests what the test will use and the two ears compare
// fairly. Why each value:
// - echoCancellation: true — the app plays corrections/reciters from the
//   same device; without it the ear hears the reciter as the user.
// - noiseSuppression: false — the browser's suppressor eats soft endings
//   and the soft letters (ه، ح، ث) the Quran-Lab ear must hear; the
//   model was tuned on unsuppressed audio (2026-11-13 device logs). The
//   Whisper ear used true; it now uses the same audio as the Lab ear.
// - autoGainControl: true — keeps quiet reciters above the VAD floor.
// - sampleRate: ideal 16000 (3.16) — a hint only (never an
//   OverconstrainedError); the ears resample with a low-pass anyway.
// The Lab ear's LAST dead-mic rebuild drops echoCancellation on purpose:
// on some iPads the echo canceller is what returns silence after a call.
export const EAR_MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: true,
  sampleRate: { ideal: 16000 },
};

export function earMicConstraints(over?: Partial<MediaTrackConstraints>): MediaStreamConstraints {
  return { audio: { ...EAR_MIC_CONSTRAINTS, ...(over ?? {}) } };
}
