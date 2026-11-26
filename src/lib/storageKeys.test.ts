import test from 'node:test';
import assert from 'node:assert/strict';
import { SK, readJSON } from './storageKeys.ts';

const isNums = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number');

test('keys are unique', () => {
  const vals = Object.values(SK);
  assert.equal(new Set(vals).size, vals.length);
});

test('readJSON: ok, missing, corrupt, wrong shape', () => {
  const m: Record<string, string> = { a: '[1,2]', b: '{bad', c: '"x"' };
  const store = { getItem: (k: string) => m[k] ?? null };
  const bad: string[] = [];
  const on = (k: string) => { bad.push(k); };
  assert.deepEqual(readJSON(store, 'a', [], isNums, on), [1, 2]);
  assert.deepEqual(readJSON(store, 'z', [9], isNums, on), [9]);
  assert.deepEqual(readJSON(store, 'b', [], isNums, on), []);
  assert.deepEqual(readJSON(store, 'c', [], isNums, on), []);
  assert.deepEqual(bad, ['b', 'c']);
});
