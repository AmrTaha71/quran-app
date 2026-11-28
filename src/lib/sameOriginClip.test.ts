// Run: node --test src/lib/sameOriginClip.test.ts
// sameOriginClip: reciter clips go through /ea/ on the website only (iPhone fade needs same origin).
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sameOriginClip } from './clipLevel.ts';

const g = globalThis as unknown as { location?: { protocol: string; hostname: string } };
afterEach(() => { delete g.location; });

describe('sameOriginClip', () => {
  const url = 'https://everyayah.com/data/Husary_128kbps/001001.mp3';
  it('website: everyayah clip -> /ea/ path', () => {
    g.location = { protocol: 'https:', hostname: 'rawabit.vercel.app' };
    assert.equal(sameOriginClip(url), '/ea/Husary_128kbps/001001.mp3');
  });
  it('localhost, native app (https://localhost) and no location: original URL', () => {
    g.location = { protocol: 'https:', hostname: 'localhost' };
    assert.equal(sameOriginClip(url), null);
    g.location = { protocol: 'capacitor:', hostname: 'localhost' };
    assert.equal(sameOriginClip(url), null);
    delete g.location;
    assert.equal(sameOriginClip(url), null);
  });
  it('other hosts are left alone', () => {
    g.location = { protocol: 'https:', hostname: 'rawabit.vercel.app' };
    assert.equal(sameOriginClip('https://cdn.islamic.network/x.mp3'), null);
  });
});
