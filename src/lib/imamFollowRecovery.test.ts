// A loss (junk letters in the middle of an ayah) must not stall the follower for the rest of the ayah.
// Regression for 2:256 (2026-11-21): after junk near the end it stayed "searching" until the ayah ended.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFollowIndex, ImamFollower, istiadhaVerse } from './imamFollow';

const d = JSON.parse(readFileSync(new URL('../../public/models/quranlab/follow-skel.json', import.meta.url), 'utf8'));
const verses = d.verses.map((v: [number, number, string]) => ({ surah: v[0], ayah: v[1], words: v[2].split(' ').map((s) => ({ norm: s, skel: s })) }));
const ist = istiadhaVerse(verses);
const idx = buildFollowIndex(ist ? [ist, ...verses] : verses);

function resumesAfterJunk(afterWord: number, junkLetters: number): boolean {
  const fl = new ImamFollower(idx);
  const a = verses.find((x: { surah: number; ayah: number }) => x.surah === 2 && x.ayah === 255);
  const b = verses.find((x: { surah: number; ayah: number }) => x.surah === 2 && x.ayah === 256);
  const words = [...a.words.slice(40), ...b.words];
  let t = 0;
  const push = (s: string) => { t += 0.1; return fl.pushPhonemes([{ s, t }]); };
  let injected = false;
  for (const w of words) {
    for (let i = 0; i < w.skel.length; i += 2) push(w.skel.slice(i, i + 2));
    const p = fl.state().pos;
    const cur = p ? idx.words[p.g] : null;
    if (!injected && cur && cur.surah === 2 && cur.ayah === 256 && cur.word + 1 === afterWord) {
      injected = true;
      const junk = 'ضظغخجشصثزذ'.repeat(Math.ceil(junkLetters / 10));
      for (let i = 0; i < junkLetters; i += 2) push(junk.slice(i, i + 2));
    }
  }
  const end = fl.state().pos;
  return fl.state().status === 'following' && !!end && idx.words[end.g].surah === 2 && idx.words[end.g].ayah === 256 && idx.words[end.g].word + 1 >= 22;
}

test('follower re-locks after junk near the end of 2:256', () => { assert.ok(resumesAfterJunk(16, 24)); assert.ok(resumesAfterJunk(16, 40)); });
test('follower re-locks after junk early in 2:256', () => { assert.ok(resumesAfterJunk(8, 30)); });
