// node --test src/lib/memQuestions.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeQuestion, type PoolAyah, type ChoiceQ, type OrderQ } from './memQuestions.ts';

const pool: PoolAyah[] = Array.from({ length: 8 }, (_, i) => ({ g: 100 + i, s: 2, a: 10 + i, text: `كلمة${i} ثانية${i} ثالثة${i} رابعة${i} خامسة${i}` }));
const ctx = { pageStarts: [1, 100, 104, 200], juzStarts: [1, 104, 300], textOf: (g: number) => `نص${g} اخر${g} ثالث${g}` };
let seed = 1;
const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

describe('memQuestions (15.9)', () => {
  it('next: the right option is the following ayah', () => {
    const q = makeQuestion('next', pool, ctx, rng) as ChoiceQ;
    const shownIdx = pool.findIndex((p) => p.text === q.shown);
    assert.ok(q.options[q.answer].startsWith(pool[shownIdx + 1].text.split(' ')[0]));
    assert.ok(q.options.length >= 2 && q.options.length <= 4);
  });
  it('prev: the right option is the ayah before', () => {
    const q = makeQuestion('prev', pool, ctx, rng) as ChoiceQ;
    const shownIdx = pool.findIndex((p) => p.text === q.shown);
    assert.ok(q.options[q.answer].startsWith(pool[shownIdx - 1].text.split(' ')[0]));
  });
  it('missing: the gap word is the answer', () => {
    const q = makeQuestion('missing', pool, ctx, rng) as ChoiceQ;
    const full = pool.find((p) => p.s === q.ref.s && p.a === q.ref.a)!.text;
    assert.equal(q.shown!.replace('……', q.options[q.answer]), full);
  });
  it('order: items in `order` give the ayat in Mushaf order', () => {
    const q = makeQuestion('order', pool, ctx, rng) as OrderQ;
    const start = pool.findIndex((p) => p.s === q.ref.s && p.a === q.ref.a);
    q.order.forEach((itemIdx, k) => assert.ok(q.items[itemIdx].startsWith(pool[start + k].text.split(' ')[0])));
  });
  it('page and juz starts come only from starts inside the range', () => {
    const p = makeQuestion('page', pool, ctx, rng) as ChoiceQ;
    assert.ok(p.prompt.includes('2') || p.prompt.includes('3'));
    const j = makeQuestion('juz', pool, ctx, rng) as ChoiceQ;
    assert.ok(j.prompt.includes('2'));
  });
  it('an empty or too small range gives null, never a broken question', () => {
    assert.equal(makeQuestion('next', [], ctx, rng), null);
    assert.equal(makeQuestion('order', pool.slice(0, 2), ctx, rng), null);
  });
});
