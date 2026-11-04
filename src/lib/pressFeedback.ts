import type { PointerEvent as ReactPointerEvent } from 'react';
import { getSharedAudio } from './sharedAudio';

// Visual design batch (2026-11-04): one press-feedback entry point for
// nav + Home buttons — ripple + tap sound + vibration (where supported).
// Visuals only: this never changes navigation, playback, grading, or
// any other behavior. The tap sound is deliberately silenced whenever
// audio could be playing or recording, so it can never talk over a
// recitation, a correction, or the microphone.
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

function anyAudioPlaying(): boolean {
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

function playTapSound(): void {
  try {
    if (!tapCtx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      tapCtx = new AC();
    }
    if (tapCtx.state === 'suspended') void tapCtx.resume();
    const t = tapCtx.currentTime;
    const osc = tapCtx.createOscillator();
    const gain = tapCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1500, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.06);
    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain);
    gain.connect(tapCtx.destination);
    osc.start(t);
    osc.stop(t + 0.09);
  } catch {
    // sound is decorative: never let it break a press
  }
}

// --- Ripple: an expanding circle from the touch point, ~450ms, on
// icons/buttons ONLY (never on Arabic text — the ink lives inside a
// dedicated .ripple-layer overlay, and the host button's own text is
// untouched). Reduced-motion users get no ripple at all. ---
function spawnRipple(host: HTMLElement, clientX: number, clientY: number): void {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    let layer = host.querySelector(':scope > .ripple-layer') as HTMLElement | null;
    if (!layer) {
      layer = document.createElement('span');
      layer.className = 'ripple-layer';
      host.appendChild(layer);
    }
    const size = Math.max(rect.width, rect.height) * 2.2;
    const ink = document.createElement('span');
    ink.className = 'ripple-ink';
    ink.style.width = `${size}px`;
    ink.style.height = `${size}px`;
    ink.style.left = `${clientX - rect.left - size / 2}px`;
    ink.style.top = `${clientY - rect.top - size / 2}px`;
    layer.appendChild(ink);
    const anim = ink.animate(
      [
        { transform: 'scale(0)', opacity: 0.32 },
        { transform: 'scale(1)', opacity: 0 },
      ],
      { duration: 450, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    anim.onfinish = () => {
      try {
        ink.remove();
      } catch {
        // already gone
      }
    };
  } catch {
    // ripple is decorative: never let it break a press
  }
}

/** Wire to onPointerDown of nav + Home buttons. Visuals + sound only. */
export function pressFeedback(e: ReactPointerEvent<HTMLElement>): void {
  try {
    spawnRipple(e.currentTarget as HTMLElement, e.clientX, e.clientY);
  } catch {
    // ignore
  }
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      // iPad Safari has no Vibration API: this is a no-op there
      // (ripple + sound are the feedback); Android gets a 10ms buzz.
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
