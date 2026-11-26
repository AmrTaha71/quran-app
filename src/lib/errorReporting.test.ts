import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(), key: () => null, length: 0,
} as Storage;
(globalThis as unknown as { __BUILD_SHA__: string }).__BUILD_SHA__ = 'abc1234';

const { logError, readErrorLog, errorText } = await import('./errorReporting.ts');

test('logError keeps a capped, content-free ring', () => {
  for (let i = 0; i < 35; i++) logError('t', new Error(`boom ${i}`));
  const log = readErrorLog();
  assert.equal(log.length, 30);
  assert.equal(log[29].msg, 'Error: boom 34');
  assert.equal(log[0].msg, 'Error: boom 5');
  assert.equal(log[0].build, 'abc1234');
});

test('errorText cuts long messages and handles non-errors', () => {
  assert.equal(errorText('x'.repeat(500)).length, 200);
  assert.equal(errorText({ a: 1 }), '{"a":1}');
});
