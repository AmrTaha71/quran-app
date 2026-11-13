// Smart Fajr alarm (2026-11-13). 'off' | 'simple' (stop button) | 'smart'
// (rings again every minute until 3 challenges are solved).
import { ALARM_TONES, renderTone } from './alarmTones';
export { ALARM_TONES };
import { isRecTone, recUrl } from './alarmRecordings';
export type FajrAlarmMode = 'off' | 'simple' | 'smart';
export const FAJR_ALARM_KEY = 'quran-fajr-alarm';
export function loadFajrAlarm(): FajrAlarmMode {
  try { const v = localStorage.getItem(FAJR_ALARM_KEY); return v === 'simple' || v === 'smart' ? v : 'off'; } catch { return 'off'; }
}
export function saveFajrAlarm(m: FajrAlarmMode): void { try { localStorage.setItem(FAJR_ALARM_KEY, m); } catch { /* ignore */ } }

// Voice clips taken from an adhan recording by playback window (file is not cut).
// Fill with the muezzin file + seconds of «الصلاة خير من النوم» once measured.
export const ALARM_CLIPS: { id: string; name: string; url: string; start: number; end: number; credit?: string }[] = [
  {
    id: 'hamed-khayr', name: '🕌 الصلاة خير من النوم — الشيخ حامد',
    url: 'https://www.repository.cam.ac.uk/bitstreams/89e27493-5010-4d23-a754-d60b4584b016/download',
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
  const u = wavBlobUrl(renderTone(id, 0, SR)); urlCache.set(id, u); return u;
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
