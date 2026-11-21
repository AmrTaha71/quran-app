// Run: node --test src/lib/tajweedColors.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TAJWEED_RULES } from './tajweedColors.ts';

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('tajweed colours', () => {
  it('there are 18 rules', () => assert.equal(Object.keys(TAJWEED_RULES).length, 18));
  for (const [k, v] of Object.entries(TAJWEED_RULES)) {
    it(`${k} is readable (>= 3:1) on white and on the page paper`, () => {
      assert.ok(contrast(v.color, '#ffffff') >= 3, `white ${contrast(v.color, '#ffffff').toFixed(2)}`);
      assert.ok(contrast(v.color, '#f8f1de') >= 3, `paper ${contrast(v.color, '#f8f1de').toFixed(2)}`);
    });
  }
});
