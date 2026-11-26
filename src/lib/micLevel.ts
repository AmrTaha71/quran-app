// Item 2.4: a tiny live mic-level bus. The on-device ears (quranEar,
// quranLabEar) already read every audio block; they publish its RMS
// here so the tasmee' screen can show a level bar while listening.
// The browser speech API exposes no audio, so with that ear no level
// ever arrives and the bar stays hidden (the early "I hear nothing"
// hint still works from result timing).
type Listener = (rms: number) => void;
const listeners = new Set<Listener>();

export function publishMicLevel(rms: number): void {
  for (const l of listeners) {
    try { l(rms); } catch { /* a listener must never break the audio thread */ }
  }
}

export function subscribeMicLevel(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
