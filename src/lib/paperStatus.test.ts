// Run: node --test src/lib/paperStatus.test.ts
// Real data: public/mushaf-boxes (604 pages) + per-ayah word counts of the seeded text.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { paperStatusOf, type PaperStatus } from './paperStatus.ts';
import { madinahPageOfAyah } from './madinahPageStarts.ts';
import { SURAH_AYAH_COUNTS } from './surahs.ts';

const root = new URL('../../', import.meta.url);
const counts: number[] = JSON.parse(fs.readFileSync(new URL('src/lib/__fixtures__/indopakWordCounts.json', root), 'utf8')).counts;
const pages: number[][][] = [];
for (let p = 1; p <= 604; p++) pages[p] = JSON.parse(fs.readFileSync(new URL(`public/mushaf-boxes/${String(p).padStart(3, '0')}.json`, root), 'utf8')).w;

const index = new Map<string, number>();
{ let i = 0; SURAH_AYAH_COUNTS.forEach((n, s) => { for (let a = 1; a <= n; a++) index.set(`${s + 1}:${a}`, i++); }); }
const boxesOf = (s: number, a: number) => pages[madinahPageOfAyah(s, a)].filter(([bs, ba]) => bs === s && ba === a).length;
const statusOf = (s: number, a: number): PaperStatus => paperStatusOf(boxesOf(s, a), counts[index.get(`${s}:${a}`)!]);

// 2026-11-21: page-break repair gave every ayah boxes (was 43 without).
const NO_BOXES: string[] = [];
const MISMATCH = ('2:31 2:33 2:61 2:91 2:181 2:261 3:37 3:44 3:112 3:165 3:181 4:36 4:78 4:83 4:91 4:155 5:20 6:5 6:111 7:101 7:160 8:6 8:41 8:58 9:46 ' +
  '10:12 10:32 10:53 11:6 11:49 11:100 11:120 12:29 12:43 12:46 12:47 12:102 13:37 15:7 15:19 16:11 17:90 19:92 20:99 22:5 23:20 23:44 25:18 ' +
  '26:6 26:7 26:14 26:92 26:211 27:60 28:66 29:40 31:10 33:20 36:36 36:40 36:69 37:17 37:130 37:146 38:35 39:56 40:3 40:55 41:47 41:51 47:19 ' +
  '48:2 50:7 50:9 54:4 55:39 56:6 56:48 58:1 59:2 66:3 67:11 71:17 72:16 79:33 80:27 81:9 91:12 91:14 104:4').split(' ');
const at = (k: string) => k.split(':').map(Number) as [number, number];

describe('paperStatusOf (rules)', () => {
  it('text but no boxes -> no-boxes', () => assert.equal(paperStatusOf(0, 12), 'no-boxes'));
  it('equal counts -> ok', () => assert.equal(paperStatusOf(28, 28), 'ok'));
  it('text has one more or one fewer word than boxes -> count-mismatch', () => {
    assert.equal(paperStatusOf(15, 16), 'count-mismatch');
    assert.equal(paperStatusOf(13, 14), 'count-mismatch');
    assert.equal(paperStatusOf(14, 13), 'count-mismatch');
  });
  it('boxes but empty text -> count-mismatch (never ok)', () => assert.equal(paperStatusOf(4, 0), 'count-mismatch'));
});

describe('real data: the 6236 ayat', () => {
  it('fixture and box files are complete', () => { assert.equal(counts.length, 6236); assert.equal(pages.length, 605); });

  it('totals: 6146 ok, 0 no-boxes, 90 count-mismatch', () => {
    const t: Record<PaperStatus, number> = { ok: 0, 'no-boxes': 0, 'count-mismatch': 0 };
    for (const k of index.keys()) { const [s, a] = at(k); t[statusOf(s, a)]++; }
    assert.deepEqual(t, { ok: 6146, 'no-boxes': 0, 'count-mismatch': 90 });
  });

  it('no ayah is left without boxes', () => {
    assert.equal(NO_BOXES.length, 0);
    for (let s = 1; s <= 114; s++) for (let a = 1; counts[index.get(`${s}:${a}`) ?? -1] > 0; a++) assert.ok(boxesOf(s, a) > 0, `${s}:${a} has boxes`);
    for (const k of NO_BOXES) { const [s, a] = at(k); assert.ok(counts[index.get(k)!] > 0, `${k} has text`); assert.equal(boxesOf(s, a), 0, k); assert.equal(statusOf(s, a), 'no-boxes', k); }
  });

  it('each of the 90 ayat with different word and box counts -> count-mismatch (boxes exist)', () => {
    assert.equal(MISMATCH.length, 90);
    for (const k of MISMATCH) { const [s, a] = at(k); assert.ok(boxesOf(s, a) > 0, `${k} has boxes`); assert.notEqual(boxesOf(s, a), counts[index.get(k)!], k); assert.equal(statusOf(s, a), 'count-mismatch', k); }
  });

  it('every other ayah -> ok', () => {
    const bad = new Set([...NO_BOXES, ...MISMATCH]);
    for (const k of index.keys()) if (!bad.has(k)) { const [s, a] = at(k); assert.equal(statusOf(s, a), 'ok', k); }
  });

  it('edges: first ayah of a surah, last ayah on a page, and the double-labelled 4:1-4 / 64:1-7', () => {
    for (const k of ['1:1', '2:1', '114:1', '114:6', '1:7']) { const [s, a] = at(k); assert.equal(statusOf(s, a), 'ok', k); }
    for (const k of ['4:1', '4:2', '4:3', '4:4', '64:1', '64:7']) { const [s, a] = at(k); assert.equal(statusOf(s, a), 'ok', `${k} (extra labels sit on the previous page, not on the start page)`); }
    // last ayah on page p = the ayah just before the first ayah printed on page p+1
    let checked = 0;
    for (let p = 2; p <= 604; p++) {
      const first = pages[p][0]; if (!first) continue;
      const [s, a] = [first[0], first[1]];
      const prev = a > 1 ? `${s}:${a - 1}` : `${s - 1}:${SURAH_AYAH_COUNTS[s - 2]}`;
      if (!index.has(prev)) continue;
      const [ps, pa] = at(prev);
      const st = statusOf(ps, pa);
      assert.ok(st === 'ok' || NO_BOXES.includes(prev) || MISMATCH.includes(prev), `${prev} -> ${st}`);
      checked++;
    }
    assert.ok(checked > 500);
  });
});
