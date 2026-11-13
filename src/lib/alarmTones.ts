// Alarm tone catalogue + pure synthesiser (no DOM): used by the web alarm and by
// scripts/gen-alarm-sounds.mjs to bake native notification sounds.
// 12 synthesized tones (no audio files, no licensing). Each pattern is a
// list of notes [startSec, freqHz, durSec, waveform, gain, glideToHz?]
// repeated every `period` seconds.
type Note = [number, number, number, OscillatorType, number, number?];
export const ALARM_TONES: { id: string; name: string; period: number; notes: Note[] }[] = [
  { id: 'classic', name: 'كلاسيكي', period: 1.2, notes: [0, .25, .5, .75].map((t) => [t, 988, .18, 'square', .3] as Note) },
  { id: 'digital', name: 'ساعة رقمية', period: 1, notes: [[0, 880, .12, 'sine', .4], [.2, 880, .12, 'sine', .4], [.6, 880, .12, 'sine', .4]] },
  { id: 'bell', name: 'جرس', period: 2, notes: [[0, 1319, 1.6, 'triangle', .5], [0.02, 2638, 1.2, 'sine', .15]] },
  { id: 'rise', name: 'سُلّم صاعد', period: 1.6, notes: [[0, 523, .25, 'sine', .4], [.25, 659, .25, 'sine', .4], [.5, 784, .25, 'sine', .4], [.75, 1047, .5, 'sine', .45]] },
  { id: 'fall', name: 'سُلّم هابط', period: 1.6, notes: [[0, 1047, .25, 'sine', .4], [.25, 784, .25, 'sine', .4], [.5, 659, .25, 'sine', .4], [.75, 523, .5, 'sine', .45]] },
  { id: 'siren', name: 'صفّارة إنذار', period: 1.6, notes: [[0, 600, .7, 'sawtooth', .25, 1200], [.8, 1200, .7, 'sawtooth', .25, 600]] },
  { id: 'heart', name: 'نبضات', period: 1, notes: [[0, 150, .2, 'sine', .8], [.28, 130, .25, 'sine', .8]] },
  { id: 'phone', name: 'رنين هاتف', period: 1.6, notes: [0, .08, .16, .24, .32, .4].map((t, i) => [t, i % 2 ? 1400 : 1000, .07, 'square', .25] as Note) },
  { id: 'calm', name: 'هادئ متصاعد', period: 3, notes: [[0, 440, 1, 'sine', .35], [.8, 554, 1, 'sine', .35], [1.6, 659, 1.3, 'sine', .4]] },
  { id: 'whistle', name: 'صافرة', period: 1.2, notes: [[0, 500, .5, 'sawtooth', .2, 1800], [.6, 1800, .3, 'square', .15]] },
  { id: 'trio', name: 'ثلاثية مرحة', period: 1.4, notes: [[0, 523, .15, 'square', .25], [.2, 659, .15, 'square', .25], [.4, 784, .3, 'square', .25], [.9, 784, .15, 'square', .2]] },
  { id: 'drums', name: 'طبول', period: .9, notes: [[0, 90, .18, 'sine', 1], [.15, 90, .18, 'sine', 1], [.45, 110, .25, 'sine', 1], [.6, 70, .25, 'sine', 1]] },
];

/** Render one period (or `seconds` of repeated periods when > 0) to mono float samples. */
export function renderTone(id: string, seconds: number, sr: number): Float32Array {
  const tone = ALARM_TONES.find((t) => t.id === id) ?? ALARM_TONES[0];
  const per = Math.round(tone.period * sr);
  const one = new Float32Array(per);
  for (const [t, f, d, type, gain, glide] of tone.notes) {
    const n0 = Math.round(t * sr), n = Math.round(d * sr);
    let phase = 0;
    for (let i = 0; i < n && n0 + i < per; i++) {
      const fr = glide ? f + (glide - f) * (i / n) : f;
      phase += fr / sr; const ph = phase % 1;
      const x = type === 'square' ? (ph < 0.5 ? 1 : -1) : type === 'sawtooth' ? 2 * ph - 1 : type === 'triangle' ? 4 * Math.abs(ph - 0.5) - 1 : Math.sin(2 * Math.PI * ph);
      const env = Math.min(1, i / (0.02 * sr)) * Math.pow(1 - i / n, 1.5);
      one[n0 + i] += x * env * gain * 0.8;
    }
  }
  if (seconds <= 0) return one;
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = one[i % per];
  return out;
}
