import type { PointerEvent as ReactPointerEvent } from 'react';
import { getSharedAudio } from './sharedAudio';
import { isLite } from './liteMode';

// Visual design batch (2026-11-04) + water pass (2026-11-04) +
// alive ripple (2026-11-06): one press-feedback entry point for nav
// + Home buttons — water ripple + tap sound + vibration (where
// supported). The ripple's keyframes live in src/alive-ripple.css
// (imported after index.css); this module only spawns the nodes at
// the touch point and removes them when they fade. Visuals only: this never
// changes navigation, playback, grading, or any other behavior. The
// tap sound is deliberately silenced whenever audio could be playing
// or recording, so it can never talk over a recitation, a correction,
// or the microphone.
//
// Suppression rules (all cheap, all synchronous):
//  - tap sounds OFF in Settings (localStorage 'quran-tap-sound' = '0');
//  - on the test / listen / adhkar / follow routes, tap sounds are
//    always off (SelfTest records; the listening pages play audio);
//  - anywhere else, tap sounds are off while any <audio> element, the
//    shared audio element, or browser speech synthesis is playing.
// Vibration never interrupts audio, so it is NOT suppressed — it is
// simply a no-op on iPad Safari, which does not support the API.

export const TAP_SOUND_KEY = 'quran-tap-sound';

export function isTapSoundEnabled(): boolean {
  if (isLite()) return false;
  try {
    return localStorage.getItem(TAP_SOUND_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setTapSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(TAP_SOUND_KEY, on ? '1' : '0');
  } catch {
    // storage unavailable: the in-memory default (on) stands
  }
}

function hashRoute(): string {
  try {
    return window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0];
  } catch {
    return '';
  }
}

export function anyAudioPlaying(): boolean {
  try {
    const audios = document.querySelectorAll('audio');
    for (const a of Array.from(audios)) {
      if (!a.paused && !a.ended) return true;
    }
    const shared = getSharedAudio();
    if (shared && !shared.paused && !shared.ended) return true;
  } catch {
    // fall through to the speech check
  }
  try {
    if (window.speechSynthesis && window.speechSynthesis.speaking) return true;
  } catch {
    // ignore
  }
  return false;
}

function tapSoundSuppressed(): boolean {
  const route = hashRoute();
  if (route === 'test' || route === 'listen' || route === 'adhkar' || route === 'follow') return true;
  return anyAudioPlaying();
}

// --- Tap sound: one soft WebAudio click, created on the first gesture
// (iOS Safari only allows audio inside a user gesture, and a pointerdown
// handler IS a gesture, so the context unlocks on the first tap). ---
let tapCtx: AudioContext | null = null;

let lastTapAt = 0;

function playTapSound(): void {
  try {
    const nowMs = Date.now();
    if (nowMs - lastTapAt < 60) return;
    lastTapAt = nowMs;
    if (!tapCtx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      tapCtx = new AC();
    }
    if (tapCtx.state !== 'running') void tapCtx.resume().catch(() => {});
    const t = tapCtx.currentTime;
    const osc = tapCtx.createOscillator();
    const gain = tapCtx.createGain();
    const jitter = 0.97 + Math.random() * 0.06; // ±3% pitch so repeated taps don't machine-gun
    // Soft, flat-pitched tick: a sine with no pitch sweep (sweeps sound like
    // arcade blips on Windows) and a short gentle decay.
    osc.type = 'sine';
    osc.frequency.setValueAtTime(820 * jitter, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.035, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(gain);
    gain.connect(tapCtx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  } catch {
    // sound is decorative: never let it break a press
  }
}

/** Soft two-note rising chime. Same suppression + setting as the tap
 *  sound; never plays an error sound. Call from a successful action. */
export function playSuccessCue(): void {
  try {
    if (!isTapSoundEnabled()) return;
    if (tapSoundSuppressed()) return;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!tapCtx) tapCtx = new AC();
    if (tapCtx.state !== 'running') void tapCtx.resume().catch(() => {});
    const t0 = tapCtx.currentTime;
    [[523.25, 0], [783.99, 0.11]].forEach(([freq, delay]) => {
      const osc = tapCtx!.createOscillator();
      const gain = tapCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0 + delay);
      gain.gain.setValueAtTime(0.0001, t0 + delay);
      gain.gain.exponentialRampToValueAtTime(0.06, t0 + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.45);
      osc.connect(gain);
      gain.connect(tapCtx!.destination);
      osc.start(t0 + delay);
      osc.stop(t0 + delay + 0.5);
    });
  } catch {
    // decorative: never break the action
  }
}

// --- Error buzz (Juhani correction flow) ---------------------------
// Plays at the moment a mistake is detected. Deliberately NOT subject
// to tapSoundSuppressed() (SelfTest is a suppressed route and the buzz
// must be audible mid-recitation) nor to the tap-sound setting. It is
// suppressed ONLY while a correction window is playing. Short and low
// so the open microphone is unlikely to hear it as speech.
let corrWindowPlaying = false;

/** SelfTestPage sets this true while a Juhani window plays. */
export function setCorrWindowPlaying(on: boolean): void {
  corrWindowPlaying = on;
}

/** Call inside a user gesture (the mic-start tap) so the context is
 *  allowed to make sound later from a timer (iOS autoplay policy). */
export function warmErrorBuzz(): void {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!tapCtx) tapCtx = new AC();
    if (tapCtx.state !== 'running') void tapCtx.resume().catch(() => {});
  } catch {
    // decorative: never break the action
  }
}

let lastBuzzAt = 0;

/** Two quick beeps, ~150ms total; distinct from the tap click (triangle
 *  1500->900Hz) and from playSuccessCue (sine 523/784Hz). */
export function playErrorBuzz(): void {
  try {
    if (corrWindowPlaying) return;
    const nowMs = Date.now();
    if (nowMs - lastBuzzAt < 300) return; // a burst of detections must not machine-gun
    lastBuzzAt = nowMs;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!tapCtx) tapCtx = new AC();
    if (tapCtx.state !== 'running') void tapCtx.resume().catch(() => {});
    const ctx = tapCtx;
    const t0 = ctx.currentTime;
    [0, 0.09].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(330, t0 + delay);
      gain.gain.setValueAtTime(0.0001, t0 + delay);
      gain.gain.exponentialRampToValueAtTime(0.06, t0 + delay + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + delay);
      osc.stop(t0 + delay + 0.07);
    });
    try {
      // Android only: iPad Safari has no Vibration API (established fact).
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(100);
    } catch {
      // ignore
    }
  } catch {
    // decorative: never break detection
  }
}

// --- Water: pressing on water. A drop hits at the exact touch
// point: a small bright drop core blooms first (~320ms), a soft wash
// spreads under it, and three thin rings chase each other outward
// (staggered 0/120/240ms, ~700-1000ms), so the press reads as a drop
// in water, not a glow. Nodes are <span>s in the dedicated
// .ripple-layer overlay (never on Arabic text, never a text element's
// own overflow), animated by CSS keyframes in src/alive-ripple.css
// (transform/opacity only, GPU-friendly, no blur) and removed on
// animationend with a timer fallback, so no node ever lingers and no
// button can get stuck pressed. Colors adapt to the host: white on
// dark buttons, deep emerald on light surfaces. Reduced-motion users
// get no water. The ripple is purely visual and fire-and-forget: the
// tap itself is never delayed or intercepted. ---
function hostIsDark(host: HTMLElement): boolean {
  try {
    const bg = window.getComputedStyle(host).backgroundColor;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    if (!m) return false;
    const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
    const [r, g, b, a = 1] = parts;
    if (Number.isNaN(r) || a < 0.5) return false;
    const srgb = [r / 255, g / 255, b / 255].map((c) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
    );
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2] < 0.3;
  } catch {
    return false;
  }
}

/** One ripple node: a disc centred on (x, y) inside the layer,
 *  animated by a keyframe in src/alive-ripple.css. Removed on
 *  animationend; the timer is a fallback so a node can never linger
 *  if the animation event is lost (tab hidden, host detached). */
function spawnRippleNode(
  layer: HTMLElement,
  className: string,
  size: number,
  x: number,
  y: number,
  colorProp: 'background' | 'borderColor',
  color: string,
  durationMs: number,
  delayMs: number,
): void {
  const node = document.createElement('span');
  node.className = className;
  node.style.width = `${size}px`;
  node.style.height = `${size}px`;
  node.style.left = `${x - size / 2}px`;
  node.style.top = `${y - size / 2}px`;
  node.style[colorProp] = color;
  node.style.animationDuration = `${durationMs}ms`;
  node.style.animationDelay = `${delayMs}ms`;
  layer.appendChild(node);
  let gone = false;
  const remove = () => {
    if (gone) return;
    gone = true;
    try {
      node.remove();
    } catch {
      // already gone
    }
  };
  node.addEventListener('animationend', () => {
    window.clearTimeout(timer);
    remove();
  });
  // Fallback: duration + delay + 150ms of slack.
  const timer = window.setTimeout(remove, durationMs + delayMs + 150);
}

function spawnWater(host: HTMLElement, clientX: number, clientY: number): void {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // Touch/pointer coordinates, relative to the host. A (0, 0)
    // coordinate means "no pointer position" (e.g. keyboard
    // activation) — fall back to the centre so the wave still reads.
    const x = clientX === 0 && clientY === 0 ? rect.width / 2 : clientX - rect.left;
    const y = clientX === 0 && clientY === 0 ? rect.height / 2 : clientY - rect.top;
    // The layer positions against the host, so a statically-positioned
    // host gets a harmless relative context (no offsets: no visual shift).
    try {
      if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative';
    } catch {
      // ignore
    }
    let layer = host.querySelector(':scope > .ripple-layer') as HTMLElement | null;
    if (!layer) {
      layer = document.createElement('span');
      layer.className = 'ripple-layer';
      host.appendChild(layer);
    }
    // Cap: 5 nodes per press (wash + drop + 3 rings) x 3 presses in
    // flight. A rapid tapper never accumulates lingering DOM nodes.
    if (layer.childElementCount > 14) return;
    const dark = hostIsDark(host);
    const washColor = dark ? 'rgba(255, 255, 255, 0.30)' : 'rgba(5, 59, 39, 0.18)';
    const dropColor = dark ? 'rgba(255, 255, 255, 0.90)' : 'rgba(5, 59, 39, 0.55)';
    const ringColor = dark ? 'rgba(255, 255, 255, 0.80)' : 'rgba(5, 59, 39, 0.50)';
    const maxDim = Math.max(rect.width, rect.height);
    // The wash is the widest element (2.6x) so the wave visibly
    // reaches — and dissolves past — the button's edges.
    spawnRippleNode(layer, 'alive-ripple-wash', maxDim * 2.6, x, y, 'background', washColor, 750, 0);
    // The drop core: small, bright, fast — the impact itself.
    spawnRippleNode(
      layer,
      'alive-ripple-drop',
      Math.max(30, maxDim * 0.22),
      x,
      y,
      'background',
      dropColor,
      320,
      0,
    );
    // Three rings, each chasing the previous one by 120ms.
    const ringSize = maxDim * 2.2;
    [
      { durationMs: 700, delayMs: 0 },
      { durationMs: 850, delayMs: 120 },
      { durationMs: 1000, delayMs: 240 },
    ].forEach(({ durationMs, delayMs }) => {
      spawnRippleNode(
        layer,
        'alive-ripple-ring',
        ringSize,
        x,
        y,
        'borderColor',
        ringColor,
        durationMs,
        delayMs,
      );
    });
  } catch {
    // water is decorative: never let it break a press
  }
}

/** Wire to onPointerDown of nav + Home buttons. Visuals + sound only. */
export function pressFeedback(e: ReactPointerEvent<HTMLElement>): void {
  try {
    const host = e.currentTarget as HTMLElement;
    // Stamp for the global delegate's dedup (see installGlobalWater).
    host.dataset.waterAt = String(Date.now());
    spawnWater(host, e.clientX, e.clientY);
  } catch {
    // ignore
  }
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      // iPad Safari has no Vibration API: this is a no-op there
      // (water + sound are the feedback); Android gets a 10ms buzz.
      navigator.vibrate(10);
    }
  } catch {
    // ignore
  }
  try {
    if (!isTapSoundEnabled()) return;
    if (tapSoundSuppressed()) return;
    playTapSound();
  } catch {
    // ignore
  }
}

// --- Global water delegate: every interactive element gets the water
// effect, not just the ones wired with pressFeedback (chips, list
// rows, header buttons, popup buttons...). Visuals ONLY — it never
// plays the tap sound (sound comes only from pressFeedback, under
// its suppression rules). Skips text inputs entirely. Dedup: a direct
// pressFeedback handler stamps the host with the press time, and the
// delegate (document bubble phase, which runs after React's root
// handlers) skips hosts stamped within the last 100ms. ---
let delegateInstalled = false;

export function installGlobalWater(): void {
  if (delegateInstalled) return;
  delegateInstalled = true;
  try {
    document.addEventListener('pointerdown', (e) => {
      try {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const t = e.target as HTMLElement | null;
        if (!t || !(t as HTMLElement).closest) return;
        if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
        const el = t.closest('button, a, [role="button"]') as HTMLElement | null;
        if (!el) return;
        const stamped = (el as HTMLElement).dataset?.waterAt;
        if (stamped && Date.now() - Number(stamped) < 100) return;
        spawnWater(el, e.clientX, e.clientY);
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}

// Installed on import (BottomNav imports this module, so every tab
// page gets the delegate; pages that import it directly get it too).
// Idempotent: repeated imports/installs are no-ops.
if (typeof document !== 'undefined') installGlobalWater();
