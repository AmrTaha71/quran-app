// Run: node --test src/lib/sharedAudio.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeAudio { paused = false; pause() { this.paused = true; } }
(globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
const m = await import('./sharedAudio.ts');

test('4.21: silenceSharedAudio pauses, notifies the holder, and never auto-resumes', () => {
  let resumed = 0;
  let preempted = 0;
  m.registerResume('adhkar', () => { resumed++; });
  m.acquireAudio('adhkar', () => {});
  m.acquireAudio('listen', () => { preempted++; }); // adhkar waits on the stack
  m.silenceSharedAudio();
  assert.equal(preempted, 1);
  assert.equal(m.currentAudioOwner(), null);
  assert.equal((m.getSharedAudio() as unknown as FakeAudio).paused, true);
  assert.equal(resumed, 0);
  m.clearResumeStack();
});
