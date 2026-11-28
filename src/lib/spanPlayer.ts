import { prepareClip, setClipSrc, wireClip, unwireClip, sameOriginClip, FADE_START, FADE_MS } from './clipLevel';

// Fallback when the Web Audio fade is not possible (no CORS check, or the audio context is
// suspended, e.g. after the mic): ramp element.volume. Safari ignores it (shortcut: iPhone stays loud), upgrade: a fade that works there.
function softStart(a: HTMLAudioElement): void {
  try { a.volume = FADE_START; } catch { return; }
  const t0 = Date.now();
  const iv = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / FADE_MS);
    try { a.volume = FADE_START + (1 - FADE_START) * k; } catch { /* ignore */ }
    if (k >= 1) clearInterval(iv);
  }, 30);
}

// Plays ONE span (from..to seconds) of a remote audio file and stops exactly
// at its end. Used by the recitation tests: «5 words from the reciter» and the
// one-word correction. Safari ignores currentTime until metadata is loaded, so
// the seek waits for it; the stop is a 30 ms poll (timeupdate is only ~4 Hz).
export type SpanHandle = { promise: Promise<void>; cancel: () => void };

export function playSpan(url: string, from: number, to: number, rate = 1): SpanHandle {
  const a = new Audio();
  a.preload = 'auto';
  let done = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let metaTimer: ReturnType<typeof setTimeout> | null = null;
  let finish: () => void = () => {};
  let fail: (e: Error) => void = () => {};
  const promise = new Promise<void>((res, rej) => { finish = res; fail = rej; });
  const end = (err?: Error) => {
    if (done) return;
    done = true;
    if (timer) clearInterval(timer);
    if (metaTimer) clearTimeout(metaTimer);
    try { a.pause(); a.removeAttribute('src'); a.load(); } catch { /* ignore */ }
    unwireClip(a);
    if (err) fail(err); else finish();
  };
  let cors = false;
  let src = url;
  a.onerror = () => {
    // CORS-mode load failed: retry once as a plain element, as before.
    if (cors && !done) { cors = false; a.removeAttribute('crossorigin'); a.addEventListener('loadedmetadata', onMeta, { once: true }); a.src = url; return; }
    end(new Error('audio-error'));
  };
  a.onended = () => end();
  const onMeta = () => { if (metaTimer) clearTimeout(metaTimer); metaTimer = null; go(); };
  const go = () => {
    try { a.currentTime = Math.max(0, from); } catch { /* ignore */ }
    try { a.playbackRate = rate; } catch { /* ignore */ }
    if (!wireClip(a, src)) softStart(a);
    a.play().then(() => {
      timer = setInterval(() => { if (a.currentTime >= to) end(); }, 30);
    }).catch(() => end(new Error('play-blocked')));
  };
  // 4.27: never wait forever for metadata (a stalled network left the
  // test hanging): give up after 8 s like any other audio error.
  metaTimer = setTimeout(() => end(new Error('metadata-timeout')), 8000);
  a.addEventListener('loadedmetadata', onMeta, { once: true });
  // Wait briefly for the CORS check (same-origin copy first) so the fade-in can be used; never longer.
  const proxied = sameOriginClip(url);
  const pick = (async () => (proxied && await prepareClip(proxied)) ? proxied : (await prepareClip(url), url))();
  Promise.race([pick, new Promise<string>((r) => setTimeout(() => r(url), 700))]).then((s) => {
    if (done) return;
    cors = true;
    src = s;
    setClipSrc(a, s);
    if (a.crossOrigin !== 'anonymous') cors = false;
  });
  return { promise, cancel: () => end() };
}
