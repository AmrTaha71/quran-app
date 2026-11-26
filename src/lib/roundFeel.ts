// Item 17.6 (c): optional touch feedback in the round tests — a 40 ms
// buzz on a confident mistake and a short soft chime when a position
// ends clean. Both OFF by default (and so off for elderly mode too).
// navigator.vibrate does not exist in iOS Safari (Android only); the
// chime is silent when the phone is on silent.
export const ROUND_BUZZ_KEY = 'quran-round-buzz';
export const ROUND_CHIME_KEY = 'quran-round-chime';
const read = (k: string) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const write = (k: string, on: boolean) => { try { localStorage.setItem(k, on ? '1' : '0'); } catch { /* ignore */ } };
export const roundBuzzOn = () => read(ROUND_BUZZ_KEY);
export const roundChimeOn = () => read(ROUND_CHIME_KEY);
export const setRoundBuzz = (on: boolean) => write(ROUND_BUZZ_KEY, on);
export const setRoundChime = (on: boolean) => write(ROUND_CHIME_KEY, on);

export function mistakeBuzz(): void {
  if (!roundBuzzOn()) return;
  try { if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(40); } catch { /* ignore */ }
}

let ctx: AudioContext | null = null;
export function acceptChime(): void {
  if (!roundChimeOn()) return;
  try {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.27);
  } catch { /* decorative */ }
}
