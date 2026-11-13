// Smart Fajr alarm (2026-11-13). 'off' | 'simple' (stop button) | 'smart'
// (rings again every minute until 3 challenges are solved).
import { isRecTone, recUrl } from './alarmRecordings';
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
// Voice clips taken from an adhan recording by playback window (file is not cut).
// Fill with the muezzin file + seconds of «الصلاة خير من النوم» once measured.
export const ALARM_CLIPS: { id: string; name: string; url: string; start: number; end: number; credit?: string }[] = [
  {
    id: 'hamed-khayr', name: '🕌 الصلاة خير من النوم — الشيخ حامد',
    url: '/audio/hamed-fajr-mahmoudeya.mp3',
    start: 145, end: 165, // 2:25 → 2:45 (measured by the owner); file itself is not edited (CC BY-NC-ND)
    credit: 'أذان الفجر — الشيخ حامد، مسجد المحمودية، القاهرة. تسجيل: Anna Kipervaser / On Look Films — World Oral Literature Project، جامعة كامبريدج (CC BY-NC-ND 3.0)',
  },
];
export const FAJR_TONE_KEY = 'quran-fajr-tone';
export function loadFajrTone(): string {
  try { const v = localStorage.getItem(FAJR_TONE_KEY); return (ALARM_TONES.some((t) => t.id === v) || ALARM_CLIPS.some((c) => c.id === v) || isRecTone(v ?? '')) ? (v as string) : 'classic'; } catch { return 'classic'; }
}
export function saveFajrTone(id: string): void { try { localStorage.setItem(FAJR_TONE_KEY, id); } catch { /* ignore */ } }

// ---- Audio engine (2026-11-13) ------------------------------------------
// The alarm is an <audio> element playing a generated WAV loop (not WebAudio),
// because iOS keeps a playing <audio> alive with the screen locked. "Night
// mode": a silent loop plays all night on ONE element (unlocked by the user's
// tap); at Fajr the same element swaps to the tone, no gesture needed.
const SR = 22050;
const urlCache = new Map<string, string>();
function wavBlobUrl(samples: Float32Array): string {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
function toneUrl(id: string): string {
  const hit = urlCache.get(id); if (hit) return hit;
  const tone = ALARM_TONES.find((t) => t.id === id) ?? ALARM_TONES[0];
  const out = new Float32Array(Math.round(tone.period * SR));
  for (const [t, f, d, type, gain, glide] of tone.notes) {
    const n0 = Math.round(t * SR), n = Math.round(d * SR);
    let phase = 0;
    for (let i = 0; i < n && n0 + i < out.length; i++) {
      const fr = glide ? f + (glide - f) * (i / n) : f;
      phase += fr / SR; const ph = phase % 1;
      const x = type === 'square' ? (ph < 0.5 ? 1 : -1) : type === 'sawtooth' ? 2 * ph - 1 : type === 'triangle' ? 4 * Math.abs(ph - 0.5) - 1 : Math.sin(2 * Math.PI * ph);
      const env = Math.min(1, i / (0.02 * SR)) * Math.pow(1 - i / n, 1.5);
      out[n0 + i] += x * env * gain * 0.8;
    }
  }
  const u = wavBlobUrl(out); urlCache.set(id, u); return u;
}
function silentUrl(): string {
  const hit = urlCache.get('silent'); if (hit) return hit;
  const u = wavBlobUrl(new Float32Array(SR)); urlCache.set('silent', u); return u;
}

let shared: HTMLAudioElement | null = null;
export const isNightMode = (): boolean => shared !== null;
/** Call from a tap. Keeps the page alive with the screen locked (best effort). */
export function startNightMode(): boolean {
  try {
    shared?.pause();
    const a = new Audio(silentUrl()); a.loop = true; a.volume = 1;
    void a.play();
    shared = a;
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'منبه الفجر شغّال', artist: 'تربيطات آيات القرآن' });
    }
    return true;
  } catch { shared = null; return false; }
}
export function stopNightMode(): void {
  try { shared?.pause(); } catch { /* ignore */ }
  shared = null;
}

/** Looping alarm tone (not an adhan). Returns a stop function. */
export function startAlarmTone(toneId: string = loadFajrTone()): () => void {
  const night = shared;
  let el: HTMLAudioElement;
  let onTime: (() => void) | null = null;
  try {
    el = night ?? new Audio();
    const clip = ALARM_CLIPS.find((c) => c.id === toneId);
    if (clip) {
      el.src = clip.url; el.loop = false; el.volume = 1;
      const seek = () => { try { el.currentTime = clip.start; } catch { /* retry */ } };
      el.addEventListener('loadedmetadata', seek, { once: true });
      onTime = () => { if (el.currentTime >= clip.end) seek(); };
      el.addEventListener('timeupdate', onTime);
      el.addEventListener('ended', seek);
    } else if (isRecTone(toneId) && recUrl(toneId.slice(4))) { el.src = recUrl(toneId.slice(4)) as string; el.loop = true; el.volume = 1; }
    else { el.src = toneUrl(isRecTone(toneId) ? 'classic' : toneId); el.loop = true; el.volume = 1; }
    void el.play().catch(() => {});
  } catch { return () => {}; }
  return () => {
    try {
      if (onTime) el.removeEventListener('timeupdate', onTime);
      if (night && shared === night) { el.src = silentUrl(); el.loop = true; void el.play().catch(() => {}); }
      else el.pause();
    } catch { /* ignore */ }
  };
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
