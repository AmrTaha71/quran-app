// Smart Fajr alarm (2026-11-13). 'off' | 'simple' (stop button) | 'smart'
// (rings again every minute until 3 challenges are solved).
export type FajrAlarmMode = 'off' | 'simple' | 'smart';
export const FAJR_ALARM_KEY = 'quran-fajr-alarm';
export function loadFajrAlarm(): FajrAlarmMode {
  try { const v = localStorage.getItem(FAJR_ALARM_KEY); return v === 'simple' || v === 'smart' ? v : 'off'; } catch { return 'off'; }
}
export function saveFajrAlarm(m: FajrAlarmMode): void { try { localStorage.setItem(FAJR_ALARM_KEY, m); } catch { /* ignore */ } }

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
export const FAJR_TONE_KEY = 'quran-fajr-tone';
export function loadFajrTone(): string {
  try { const v = localStorage.getItem(FAJR_TONE_KEY); return ALARM_TONES.some((t) => t.id === v) ? (v as string) : 'classic'; } catch { return 'classic'; }
}
export function saveFajrTone(id: string): void { try { localStorage.setItem(FAJR_TONE_KEY, id); } catch { /* ignore */ } }

/** Looping alarm tone (not an adhan). Returns a stop function. */
export function startAlarmTone(toneId: string = loadFajrTone()): () => void {
  let ctx: AudioContext | null = null;
  let timer = 0;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return () => {};
    ctx = new Ctx();
    void ctx.resume();
    const c = ctx;
    const tone = ALARM_TONES.find((t) => t.id === toneId) ?? ALARM_TONES[0];
    const burst = () => {
      const now = c.currentTime;
      for (const [t, f, d, type, gain, glide] of tone.notes) {
        const osc = c.createOscillator(); const g = c.createGain();
        osc.type = type; osc.frequency.setValueAtTime(f, now + t);
        if (glide) osc.frequency.linearRampToValueAtTime(glide, now + t + d);
        g.gain.setValueAtTime(0.0001, now + t);
        g.gain.exponentialRampToValueAtTime(gain, now + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + d);
        osc.connect(g).connect(c.destination); osc.start(now + t); osc.stop(now + t + d + 0.05);
      }
    };
    burst();
    timer = window.setInterval(burst, tone.period * 1000);
  } catch { /* best effort */ }
  return () => { window.clearInterval(timer); try { void ctx?.close(); } catch { /* ignore */ } };
}

export type Challenge =
  | { kind: 'math'; q: string; answer: string }
  | { kind: 'code'; code: string }
  | { kind: 'odd'; items: string[]; odd: number };

const ri = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const GROUPS: string[][] = [
  ['🍎', '🍌', '🍇', '🍓', '🍊', '🍉'], ['🐶', '🐱', '🐭', '🐰', '🦊', '🐻'],
  ['🚗', '🚕', '🚌', '🚓', '🚑', '🚒'], ['⚽', '🏀', '🏈', '🎾', '🏐', '🏉'],
];
export function makeChallenges(): Challenge[] {
  const a = ri(3, 12), b = ri(3, 12);
  const op = ri(0, 1);
  const math: Challenge = op ? { kind: 'math', q: `${a} × ${b}`, answer: String(a * b) } : { kind: 'math', q: `${a * 7} + ${b * 3}`, answer: String(a * 7 + b * 3) };
  const code: Challenge = { kind: 'code', code: String(ri(1000, 9999)) };
  const gi = ri(0, GROUPS.length - 1);
  const main = GROUPS[gi]; const other = GROUPS[(gi + 1 + ri(0, GROUPS.length - 2)) % GROUPS.length];
  const pick = [...main].sort(() => Math.random() - 0.5).slice(0, 3);
  const odd = ri(0, 3);
  const items = [...pick]; items.splice(odd, 0, other[ri(0, other.length - 1)]);
  return [math, code, { kind: 'odd', items, odd }];
}
