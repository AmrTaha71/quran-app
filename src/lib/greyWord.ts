// R2 (owner, 2026-11-28): a wrong word that differs from the expected one by ONE letter that
// sounds close to it (غ/خ, ز/ذ, ...) is probably the ear/noise, not the reciter: it is grey.
// Returns the pair the app heard («سمعت غين مكان الخاء») or null when it is a real mistake.
const CONFUSABLE: [string, string][] = [
  ['غ', 'خ'], ['ز', 'ذ'], ['ض', 'ظ'], ['ث', 'س'], ['ص', 'س'], ['ق', 'ك'], ['ط', 'ت'], ['ح', 'ه'],
];

export type NearMiss = { expected: string; heard: string };

export function nearMissLetter(expected: string, heard: string): NearMiss | null {
  if (expected === heard || expected.length !== heard.length) return null;
  let diff = -1;
  for (let k = 0; k < expected.length; k++) {
    if (expected[k] === heard[k]) continue;
    if (diff >= 0) return null; // two letters differ: a real mistake
    diff = k;
  }
  if (diff < 0) return null;
  const a = expected[diff], b = heard[diff];
  const pair = CONFUSABLE.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
  return pair ? { expected: a, heard: b } : null;
}
