// Run: node --test src/lib/headEstimate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateByHead } from './headEstimate.ts';

const mkFetch = (sizes: Record<string, number | 'fail'>, track?: { live: number; max: number }) =>
  (async (url: string) => {
    if (track) { track.live++; track.max = Math.max(track.max, track.live); }
    await new Promise((r) => setTimeout(r, 2));
    if (track) track.live--;
    const v = sizes[url];
    if (v === 'fail') return { ok: false, headers: new Headers() } as Response;
    return { ok: true, headers: new Headers({ 'content-length': String(v) }) } as Response;
  }) as unknown as typeof fetch;

test('4.24: never more than 6 HEAD requests at once', async () => {
  const urls = Array.from({ length: 40 }, (_, i) => `u${i}`);
  const track = { live: 0, max: 0 };
  const r = await estimateByHead(urls, mkFetch(Object.fromEntries(urls.map((u) => [u, 10])), track));
  assert.equal(r.bytes, 400);
  assert.equal(r.approx, false);
  assert.ok(track.max <= 6, `max in flight ${track.max}`);
});

test('4.24: one failed HEAD gives an approximate size, not none', async () => {
  const r = await estimateByHead(['a', 'b', 'c'], mkFetch({ a: 100, b: 'fail', c: 200 }));
  assert.equal(r.bytes, 450);
  assert.equal(r.approx, true);
});

test('4.24: all failed → unknown', async () => {
  const r = await estimateByHead(['a'], mkFetch({ a: 'fail' }));
  assert.equal(r.bytes, null);
});
