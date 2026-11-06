// Synthesised game sounds (2026-11-07). No audio files: every sound is
// generated with Web Audio, so there is no licence to track.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noiseBurst(c: AudioContext, start: number, dur: number, gain: number): void {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = c.createBufferSource();
  src.buffer = buf;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1800;
  band.Q.value = 0.8;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(band).connect(g).connect(c.destination);
  src.start(c.currentTime + start);
}

/** Short clap: a few quick noise bursts. */
export function playClap(): void {
  const c = getCtx();
  if (!c) return;
  [0, 0.045, 0.09].forEach((t, i) => noiseBurst(c, t, 0.09, 0.7 - i * 0.12));
}

/** Bigger celebration: a rising arpeggio plus a clap. */
export function playCelebrate(): void {
  const c = getCtx();
  if (!c) return;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    const t = c.currentTime + i * 0.12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.55);
  });
  playClap();
}

/** Soft low buzz for a wrong answer. */
export function playBuzz(): void {
  const c = getCtx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sawtooth';
  o.frequency.value = 160;
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.12, c.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.35);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.4);
}
