// Smart Fajr alarm (2026-11-13). 'off' | 'simple' (stop button) | 'smart'
// (rings again every minute until 3 challenges are solved).
export type FajrAlarmMode = 'off' | 'simple' | 'smart';
export const FAJR_ALARM_KEY = 'quran-fajr-alarm';
export function loadFajrAlarm(): FajrAlarmMode {
  try { const v = localStorage.getItem(FAJR_ALARM_KEY); return v === 'simple' || v === 'smart' ? v : 'off'; } catch { return 'off'; }
}
export function saveFajrAlarm(m: FajrAlarmMode): void { try { localStorage.setItem(FAJR_ALARM_KEY, m); } catch { /* ignore */ } }

/** Looping alarm tone (not an adhan). Returns a stop function. */
export function startAlarmTone(): () => void {
  let ctx: AudioContext | null = null;
  let timer = 0;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return () => {};
    ctx = new Ctx();
    void ctx.resume();
    const c = ctx;
    const beepBurst = () => {
      const now = c.currentTime;
      [0, 0.25, 0.5, 0.75].forEach((o) => {
        const osc = c.createOscillator(); const g = c.createGain();
        osc.type = 'square'; osc.frequency.value = 988;
        g.gain.setValueAtTime(0.0001, now + o);
        g.gain.exponentialRampToValueAtTime(0.3, now + o + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + o + 0.18);
        osc.connect(g).connect(c.destination); osc.start(now + o); osc.stop(now + o + 0.2);
      });
    };
    beepBurst();
    timer = window.setInterval(beepBurst, 1200);
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
