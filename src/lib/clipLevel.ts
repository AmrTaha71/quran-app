// Reciter / correction clip fade-in via Web Audio (Safari on iPhone ignores
// audio.volume): gain starts at FADE_START and ramps to 1 over FADE_MS.
// SAFETY: createMediaElementSource is SILENT for a cross-origin clip without
// CORS, so a clip is only routed through the graph after a fetch(mode:'cors')
// of the same URL succeeded. Any failure => the caller plays the element
// normally at volume 1 (today's behaviour). No loudness levelling.

export const FADE_START = 0.35;
export const FADE_MS = 350;

/** Gain ramp for a fade-in beginning at time t (seconds). Pure. */
export function fadePlan(t: number): { startAt: number; startValue: number; endAt: number; endValue: number } {
  return { startAt: t, startValue: FADE_START, endAt: t + FADE_MS / 1000, endValue: 1 };
}

let ctx: AudioContext | null = null;
const getCtx = (): AudioContext | null => {
  try {
    if (!ctx) {
      const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const K = w.AudioContext || w.webkitAudioContext;
      if (!K) return null;
      ctx = new K();
    }
    return ctx;
  } catch { return null; }
};

// First user gesture: create/resume the one shared context.
if (typeof document !== 'undefined') {
  const unlock = () => { try { void getCtx()?.resume(); } catch { /* ignore */ } };
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) {
    document.addEventListener(ev, unlock, { capture: true, passive: true });
  }
}

const corsOk = new Map<string, boolean>();
const pending = new Map<string, Promise<boolean>>();

/** Resolves true once a CORS fetch of the clip succeeded (cached per URL). */
export function prepareClip(url: string): Promise<boolean> {
  const known = corsOk.get(url);
  if (known !== undefined) return Promise.resolve(known);
  let p = pending.get(url);
  if (!p) {
    p = fetch(url, { mode: 'cors' })
      .then((r) => { try { void r.body?.cancel(); } catch { /* ignore */ } return r.ok; })
      .catch(() => false)
      .then((ok) => { corsOk.set(url, ok); pending.delete(url); return ok; });
    pending.set(url, p);
  }
  return p;
}

export const clipReady = (url: string): boolean => corsOk.get(url) === true;

/** Use instead of el.src = url: CORS mode only for clips already verified. */
export function setClipSrc(el: HTMLAudioElement, url: string): void {
  if (clipReady(url)) el.crossOrigin = 'anonymous'; else el.removeAttribute('crossorigin');
  el.src = url;
}

type Wire = { src: MediaElementAudioSourceNode; gain: GainNode };
const wired = new WeakMap<HTMLAudioElement, Wire>();
export const isWired = (el: HTMLAudioElement): boolean => wired.has(el);

/** Route el through the fade-in gain. false => nothing changed: play normally.
 *  The element must have been loaded via setClipSrc. */
export function wireClip(el: HTMLAudioElement, url: string): boolean {
  try {
    const c = getCtx();
    if (!c || !clipReady(url) || el.crossOrigin !== 'anonymous') return false;
    if (c.state !== 'running') { void c.resume().catch(() => {}); if (!wired.has(el)) return false; }
    let w = wired.get(el);
    if (!w) {
      const src = c.createMediaElementSource(el);
      const gain = c.createGain();
      src.connect(gain); gain.connect(c.destination);
      w = { src, gain };
      wired.set(el, w);
    }
    const f = fadePlan(c.currentTime);
    w.gain.gain.cancelScheduledValues(f.startAt);
    w.gain.gain.setValueAtTime(f.startValue, f.startAt);
    w.gain.gain.linearRampToValueAtTime(f.endValue, f.endAt);
    return true;
  } catch { return false; }
}

/** Disconnect the graph. The element is silent afterwards: drop it. */
export function unwireClip(el: HTMLAudioElement): void {
  const w = wired.get(el);
  if (!w) return;
  wired.delete(el);
  try { w.src.disconnect(); w.gain.disconnect(); } catch { /* ignore */ }
}

// The reciter site may not allow Web Audio (CORS), and Safari ignores volume, so on the website the
// clip goes through our own domain (vercel.json rewrite /ea/*): same origin, the fade always works.
// Not on localhost or inside the native app (no rewrite there): the original URL as before.
export function sameOriginClip(url: string): string | null {
  const m = /^https:\/\/everyayah\.com\/data\/(.+)$/.exec(url);
  if (!m || typeof location === 'undefined' || location.protocol !== 'https:' || /localhost/.test(location.hostname)) return null;
  return `/ea/${m[1]}`;
}
