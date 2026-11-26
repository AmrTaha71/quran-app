// Item 4.24: download-size estimate by HEAD requests, at most 6 in
// flight (al-Baqarah used to fire 286 at once), and an approximate
// total when some fail: each failed clip counts as the average of the
// ones that answered. Only when NONE answer is the size unknown.
export const HEAD_CONCURRENCY = 6;

export async function estimateByHead(
  urls: string[],
  fetchFn: typeof fetch,
  concurrency = HEAD_CONCURRENCY,
): Promise<{ bytes: number | null; approx: boolean }> {
  const sizes: (number | null)[] = new Array(urls.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      try {
        const res = await fetchFn(urls[i], { method: 'HEAD' });
        if (!res.ok) continue;
        const len = res.headers.get('content-length');
        if (len === null) continue;
        const n = Number(len);
        if (Number.isFinite(n) && n >= 0) sizes[i] = n;
      } catch { /* counts as unknown */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  const known = sizes.filter((s): s is number => s !== null);
  if (known.length === 0) return { bytes: null, approx: false };
  const sum = known.reduce((a, b) => a + b, 0);
  const missing = urls.length - known.length;
  return { bytes: Math.round(sum + missing * (sum / known.length)), approx: missing > 0 };
}
