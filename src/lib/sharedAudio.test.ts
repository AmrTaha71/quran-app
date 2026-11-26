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

test('4.29: a source preempted within 10 minutes resumes; an older one does not', () => {
  let t = 1_000_000;
  m.__setNowForTest(() => t);
  let resumed = 0;
  m.registerResume('listen', () => { resumed++; });
  m.acquireAudio('listen', () => {});
  m.acquireAudio('radio', () => {});
  t += 5 * 60 * 1000;
  m.releaseAudio('radio');
  assert.equal(resumed, 1);

  m.acquireAudio('listen', () => {});
  m.acquireAudio('radio', () => {});
  t += 60 * 60 * 1000;
  m.releaseAudio('radio');
  assert.equal(resumed, 1);
  assert.equal(m.hasWaitingResumes(), false);
  m.unregisterResume('listen');
});
