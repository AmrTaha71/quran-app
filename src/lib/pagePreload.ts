// Warm + decode Mushaf page images so a page turn never waits on the
// network or on image decoding. Keeps the most recent decoded images alive
// (a held reference stops the browser dropping the decoded bitmap).
const MAX_KEPT = 14;
const kept = new Map<string, HTMLImageElement>(); // insertion order = recency
const pending = new Map<string, Promise<boolean>>();

export function isPageReady(url: string): boolean {
  const im = kept.get(url);
  return !!im && im.complete && im.naturalWidth > 0;
}

export function warmPage(url: string): Promise<boolean> {
  const hit = kept.get(url);
  if (hit && hit.complete && hit.naturalWidth > 0) {
    kept.delete(url); kept.set(url, hit);
    return Promise.resolve(true);
  }
  const inflight = pending.get(url);
  if (inflight) return inflight;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  const loaded: Promise<void> = typeof img.decode === 'function'
    ? img.decode()
    : new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('load')); });
  const p = loaded.then(() => {
    kept.set(url, img);
    while (kept.size > MAX_KEPT) {
      const oldest = kept.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      kept.delete(oldest);
    }
    return true;
  }).catch(() => false).finally(() => { pending.delete(url); });
  pending.set(url, p);
  return p;
}
