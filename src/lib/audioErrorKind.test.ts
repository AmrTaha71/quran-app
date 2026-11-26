import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAudioError } from './audioErrorKind.ts';

test('4.18: offline or MEDIA_ERR_NETWORK is a network failure', () => {
  assert.equal(classifyAudioError(4, false), 'network');
  assert.equal(classifyAudioError(2, true), 'network');
});
test('4.18: a 404 (src not supported, online) is a missing file', () => {
  assert.equal(classifyAudioError(4, true), 'missing');
});
test('4.18: anything else stays generic', () => {
  assert.equal(classifyAudioError(3, true), 'other');
  assert.equal(classifyAudioError(null, true), 'other');
});
