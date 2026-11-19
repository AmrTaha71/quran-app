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
  let finish: () => void = () => {};
  let fail: (e: Error) => void = () => {};
  const promise = new Promise<void>((res, rej) => { finish = res; fail = rej; });
  const end = (err?: Error) => {
    if (done) return;
    done = true;
    if (timer) clearInterval(timer);
    try { a.pause(); a.removeAttribute('src'); a.load(); } catch { /* ignore */ }
    if (err) fail(err); else finish();
  };
  a.onerror = () => end(new Error('audio-error'));
  a.onended = () => end();
  const go = () => {
    try { a.currentTime = Math.max(0, from); } catch { /* ignore */ }
    try { a.playbackRate = rate; } catch { /* ignore */ }
    a.play().then(() => {
      timer = setInterval(() => { if (a.currentTime >= to) end(); }, 30);
    }).catch(() => end(new Error('play-blocked')));
  };
  a.addEventListener('loadedmetadata', go, { once: true });
  a.src = url;
  return { promise, cancel: () => end() };
}
