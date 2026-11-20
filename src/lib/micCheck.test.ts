// Run: node --test src/lib/micCheck.test.ts   (fake navigator / AudioContext; no device)
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkMic, reasonOfError, micCheckReasonText } from './micCheck.ts';

type G = Record<string, unknown>;
const g = globalThis as unknown as G;
const saved: G = {};

// Fake audio graph: the analyser fills the byte buffer with a constant amplitude
// (deviation from 128), so RMS == amp/128.
function installAudio(opts: { amp: number; ctxState?: string; gumDelayMs?: number; gumError?: string; muted?: boolean }) {
  let created = 0;
  let resumedBeforeGum = false;
  let gumCalled = false;
  let stopped = 0;
  class FakeCtx {
    state = opts.ctxState ?? 'running';
    constructor() { created++; }
    resume() { if (!gumCalled) resumedBeforeGum = true; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() {
      return {
        fftSize: 2048,
        getByteTimeDomainData(d: Uint8Array) { d.fill(128 + Math.round(opts.amp)); },
      };
    }
  }
  g.window = { AudioContext: FakeCtx };
  const stream = { getTracks: () => [{ stop: () => { stopped++; } }], getAudioTracks: () => [{ muted: !!opts.muted }] };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: () => {
          gumCalled = true;
          return new Promise((res, rej) => setTimeout(() => {
            if (opts.gumError) { const e = new Error('x'); e.name = opts.gumError; rej(e); } else res(stream);
          }, opts.gumDelayMs ?? 0));
        },
      },
    },
  });
  return { created: () => created, resumedBeforeGum: () => resumedBeforeGum, stopped: () => stopped };
}

beforeEach(() => { saved.window = g.window; });
afterEach(() => { g.window = saved.window; });

describe('checkMic', () => {
  it('normal speech level (RMS ~0.03) counts as heard (old 0.08 threshold rejected it)', async () => {
    installAudio({ amp: 4 }); // 4/128 = 0.031
    const r = await checkMic({ sampleMs: 500 });
    assert.equal(r.permission, 'granted');
    assert.equal(r.heardSomething, true);
    assert.equal(r.reason, undefined);
  });

  it('silence -> granted, reason quiet', async () => {
    installAudio({ amp: 0 });
    const r = await checkMic({ sampleMs: 500 });
    assert.equal(r.heardSomething, false);
    assert.equal(r.reason, 'quiet');
  });

  it('AudioContext is created and resumed BEFORE getUserMedia (inside the tap)', async () => {
    const h = installAudio({ amp: 4 });
    await checkMic({ sampleMs: 500 });
    assert.equal(h.created(), 1);
    assert.equal(h.resumedBeforeGum(), true);
  });

  it('context that never runs -> reason suspended (not a silent "quiet")', async () => {
    installAudio({ amp: 0, ctxState: 'suspended' });
    const r = await checkMic({ sampleMs: 500 });
    assert.equal(r.reason, 'suspended');
  });

  it('muted track -> reason muted', async () => {
    installAudio({ amp: 0, muted: true });
    const r = await checkMic({ sampleMs: 500 });
    assert.equal(r.reason, 'muted');
  });

  it('permission answered late (grant + sampling > deadline) is NOT turned into an error', async () => {
    // Old code: one deadline covered prompt + sampling, so a grant at 2.8s + 0.5s sampling
    // overran a 3s deadline and returned 'error'. New: the deadline ends when the mic is granted.
    installAudio({ amp: 4, gumDelayMs: 2800 });
    const r = await checkMic({ sampleMs: 500, timeoutMs: 3000 });
    assert.equal(r.permission, 'granted');
    assert.equal(r.heardSomething, true);
  });

  it('unanswered prompt -> no-answer after the deadline', async () => {
    installAudio({ amp: 4, gumDelayMs: 5000 });
    const r = await checkMic({ sampleMs: 500, timeoutMs: 1500 });
    assert.equal(r.reason, 'no-answer');
    assert.equal(r.permission, 'error');
  });

  it('denied / no device / busy map to distinct reasons', async () => {
    installAudio({ amp: 0, gumError: 'NotAllowedError' });
    assert.equal((await checkMic()).reason, 'denied');
    installAudio({ amp: 0, gumError: 'NotFoundError' });
    assert.equal((await checkMic()).reason, 'no-device');
    installAudio({ amp: 0, gumError: 'NotReadableError' });
    assert.equal((await checkMic()).reason, 'busy');
  });
});

describe('reason text', () => {
  it('every reason has its own Arabic line; quiet shows the level', () => {
    const base = { permission: 'granted' as const, maxLevel: 0.004, heardSomething: false };
    const reasons = ['denied', 'no-device', 'busy', 'unsupported', 'no-answer', 'suspended', 'muted', 'quiet'] as const;
    const texts = reasons.map((reason) => micCheckReasonText({ ...base, reason }));
    assert.equal(new Set(texts).size, reasons.length);
    assert.match(micCheckReasonText({ ...base, reason: 'quiet' }), /٪|%/);
    assert.equal(reasonOfError({ name: 'NotAllowedError' }), 'denied');
  });
});
