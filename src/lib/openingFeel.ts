// App-opening feel (2026-11-14): a soft two-note chime and a short buzz when
// the app opens or a login completes. Browsers refuse sound before the first
// touch, so if the audio context is still locked the chime plays on the very
// first tap instead. iPhone/iPad Safari has no vibration API: sound only there.
import { isTapSoundEnabled } from './pressFeedback';

let played = false;

function chime(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const c = new Ctor();
    const go = () => {
      const t = c.currentTime + 0.02;
      [[659.25, 0], [987.77, 0.16]].forEach(([f, d]) => {
        const o = c.createOscillator(); const g = c.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.7);
        o.connect(g); g.connect(c.destination); o.start(t + d); o.stop(t + d + 0.75);
      });
      window.setTimeout(() => { void c.close(); }, 1400);
    };
    void c.resume().then(go).catch(() => {});
    if (c.state !== 'running') {
      const once = () => { window.removeEventListener('pointerdown', once); void c.resume().then(go).catch(() => {}); };
      window.addEventListener('pointerdown', once, { once: true });
    }
  } catch { /* no audio */ }
}

export function playOpening(): void {
  if (played) return;
  played = true;
  try { navigator.vibrate?.([25, 45, 25]); } catch { /* ignore */ }
  if (isTapSoundEnabled()) chime();
}
