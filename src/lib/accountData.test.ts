import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAccountData, isAccountKey } from './accountData.ts';

function mem(keys: string[]) {
  const m = new Map(keys.map((k) => [k, '1']));
  return { m, store: { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, removeItem: (k: string) => { m.delete(k); } } };
}

test('account data goes, device setup stays', () => {
  const { m, store } = mem(['quran-uid', 'quran-srs-v1', 'quran-test-history-v1', 'quran-wird-v1', 'rawabit.sessions.v1',
    'quran-adhan-settings', 'quran-device-model-v1', 'quran-audio-downloads', 'quran-mushaf-theme', 'quran-lite-opts']);
  assert.equal(clearAccountData(store), 5);
  assert.deepEqual([...m.keys()].sort(), ['quran-adhan-settings', 'quran-audio-downloads', 'quran-device-model-v1', 'quran-lite-opts', 'quran-mushaf-theme']);
});

test('isAccountKey', () => {
  assert.ok(isAccountKey('quran-test-progress'));
  assert.ok(!isAccountKey('quran-adhan'));
});
