// Run: node --test src/lib/tajweedWords.test.ts
// The digital page paints word n of an ayah on box n of the page scan: both counts must agree.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { splitWords, TAJWEED_MISMATCH, BASMALA_WORDS, type TajweedAnn } from './tajweedWords.ts';

const root = new URL('../../', import.meta.url).pathname;
type Row = { surah: number; ayah: number; text: string; annotations: TajweedAnn[] };
const rows: Row[] = JSON.parse(fs.readFileSync(path.join(root, 'public/tajweed/tajweed-mushaf-image.json'), 'utf8'));

// word numbers each ayah has in the page boxes (all 604 pages; an ayah can span two)
const boxWords = new Map<string, Set<number>>();
for (let p = 1; p <= 604; p++) {
  const j = JSON.parse(fs.readFileSync(path.join(root, 'public/mushaf-boxes', `${String(p).padStart(3, '0')}.json`), 'utf8')) as { w: number[][] };
  for (const [s, a, w] of j.w) {
    const k = `${s}:${a}`;
    if (!boxWords.has(k)) boxWords.set(k, new Set());
    boxWords.get(k)!.add(w);
  }
}

describe('tajweed words vs page boxes', () => {
  it('every ayah with boxes has the same word count, except the listed ones', () => {
    const bad: string[] = [];
    let ok = 0;
    for (const r of rows) {
      const k = `${r.surah}:${r.ayah}`;
      const b = boxWords.get(k);
      if (!b) continue; // the 42 ayat the boxes do not cover keep the scan
      const n = splitWords(r.text, r.annotations, r.surah, r.ayah).length;
      const same = b.size === n && [...b].every((w) => w >= 1 && w <= n);
      if (same) ok++; else bad.push(k);
    }
    assert.deepEqual(bad.sort(), [...TAJWEED_MISMATCH].sort());
    assert.ok(ok > 6100, `ok=${ok}`);
  });

  it('the basmala header of ayah 1 is dropped (2:1) but not for 1:1 and 9:1', () => {
    const w = (s: number, a: number) => { const r = rows.find((x) => x.surah === s && x.ayah === a)!; return splitWords(r.text, r.annotations, s, a); };
    assert.equal(w(2, 1).length, 1);
    assert.equal(w(1, 1).length, BASMALA_WORDS);
    assert.ok(w(9, 1).length > 5);
    // every surah (not 1, 9) opens its ayah 1 with the same 4 words as 1:1
    const letters = (t: string[]) => t.map((x) => x.replace(/[^\u0621-\u064A\u0671-\u06D3]/g, ''));
    const first = letters(rows.find((x) => x.surah === 1 && x.ayah === 1)!.text.split(/\s+/));
    for (let s = 2; s <= 114; s++) {
      if (s === 9) continue;
      const t = rows.find((x) => x.surah === s && x.ayah === 1)!.text.split(/\s+/);
      assert.deepEqual(letters(t.slice(0, 4)), first, `surah ${s}`);
    }
  });

  it('waqf marks join the previous word, and the text of the words is the ayah text minus spaces', () => {
    const r = rows.find((x) => x.surah === 2 && x.ayah === 2)!;
    const words = splitWords(r.text, r.annotations, 2, 2);
    assert.equal(words.length, 7);
    assert.ok(words[3].segs.map((s) => s.text).join('').includes('ۛ'));
    assert.equal(words.map((x) => x.segs.map((s) => s.text).join('')).join(' '), r.text.replace(/ ۛ/g, ' ۛ'));
  });

  it('colour runs follow the annotations (1:1: hamzat wasl on the alef of «ٱللَّهِ»)', () => {
    const r = rows.find((x) => x.surah === 1 && x.ayah === 1)!;
    const words = splitWords(r.text, r.annotations, 1, 1);
    assert.deepEqual(words[1].segs[0], { text: 'ٱ', rule: 'hamzat_wasl' });
    assert.equal(words[1].segs.map((s) => s.text).join(''), r.text.split(' ')[1]);
    assert.ok(words[1].segs.some((s) => s.rule === 'lam_shamsiyyah') || words[2].segs.some((s) => s.rule === 'lam_shamsiyyah'));
  });
});

describe('digital pages', () => {
  it('all 604 pages have digital words (only the 4 mismatched ayat keep the scan)', () => {
    const have = new Set(rows.map((r) => `${r.surah}:${r.ayah}`));
    let pages = 0;
    for (let p = 1; p <= 604; p++) {
      const j = JSON.parse(fs.readFileSync(path.join(root, 'public/mushaf-boxes', `${String(p).padStart(3, '0')}.json`), 'utf8')) as { w: number[][] };
      if (j.w.some(([s, a]) => have.has(`${s}:${a}`) && !TAJWEED_MISMATCH.has(`${s}:${a}`))) pages++;
    }
    assert.equal(pages, 604);
  });
});
