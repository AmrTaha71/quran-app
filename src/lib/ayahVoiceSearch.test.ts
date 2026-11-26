// 15.7: a recited piece of an ayah finds that ayah in the whole Mushaf.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFollowIndex, istiadhaVerse } from './imamFollow.ts';
import { findAyahCandidates } from './ayahVoiceSearch.ts';

const d = JSON.parse(readFileSync(new URL('../../public/models/quranlab/follow-skel.json', import.meta.url), 'utf8'));
const verses = d.verses.map((v: [number, number, string]) => ({ surah: v[0], ayah: v[1], words: (v[2] ? v[2].split(' ') : []).map((s: string) => ({ norm: s, skel: s })) }));
const ist = istiadhaVerse(verses);
const idx = buildFollowIndex(ist ? [ist, ...verses] : verses);
const verse = (s: number, a: number) => verses.find((x: { surah: number; ayah: number }) => x.surah === s && x.ayah === a);
const heardOf = (s: number, a: number, from: number, n: number) => verse(s, a).words.slice(from, from + n).map((w: { skel: string }) => w.skel).join('');

test('the start of a distinctive ayah is found first', () => {
  for (const [s, a] of [[2, 255], [36, 12], [112, 1], [18, 10], [67, 2]] as [number, number][]) {
    const v = verse(s, a);
    const n = Math.min(v.words.length, 8);
    const hits = findAyahCandidates(idx, heardOf(s, a, 0, n));
    if (heardOf(s, a, 0, n).length < 10) continue;
    assert.ok(hits.length > 0, `${s}:${a} no hits`);
    assert.deepEqual([hits[0].surah, hits[0].ayah], [s, a], `${s}:${a} got ${JSON.stringify(hits)}`);
  }
});

test('a shared opening lists every ayah it could be', () => {
  // «الله لا إله إلا هو» opens 2:255, 3:2, 4:87, 20:8 ...: all near-equal.
  const hits = findAyahCandidates(idx, heardOf(2, 255, 0, 5));
  assert.ok(hits.length >= 2 && hits.some((x) => x.surah === 2 && x.ayah === 255), JSON.stringify(hits));
});

test('a middle piece with a few ear errors still finds the ayah', () => {
  const h = heardOf(2, 255, 6, 6);
  const noisy = h.slice(0, 5) + 'ض' + h.slice(6, 14) + h.slice(15);
  const hits = findAyahCandidates(idx, noisy);
  assert.ok(hits.some((x) => x.surah === 2 && x.ayah === 255), JSON.stringify(hits));
});

test('too short or nonsense gives nothing', () => {
  assert.deepEqual(findAyahCandidates(idx, 'قل'), []);
  assert.deepEqual(findAyahCandidates(idx, 'ضظغخجشصثزذضظغخجشص'), []);
});
