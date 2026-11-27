// Run: node --test supabase/functions/transcribe-audio/allowlist.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedAudioUrl } from "./allowlist.ts";

const SB = "https://xfhjlukkvjzlmrggvowm.supabase.co";

test("allows project storage and the two app CDNs", () => {
  assert.ok(isAllowedAudioUrl(`${SB}/storage/v1/object/public/audio/a.webm`, SB));
  assert.ok(isAllowedAudioUrl("https://cdn.islamic.network/quran/audio/128/ar.abdullahawadaljuhani/1.mp3", SB));
  assert.ok(isAllowedAudioUrl("https://audio.qurancdn.com/wbw/067_001_001.mp3", SB));
});

test("refuses other hosts, lookalikes and internal addresses", () => {
  assert.equal(isAllowedAudioUrl("https://evil.com/a.mp3", SB), false);
  assert.equal(isAllowedAudioUrl("https://cdn.islamic.network.evil.com/a.mp3", SB), false);
  assert.equal(isAllowedAudioUrl("https://xfhjlukkvjzlmrggvowm.supabase.co.evil.com/a.mp3", SB), false);
  assert.equal(isAllowedAudioUrl("http://169.254.169.254/latest/meta-data", SB), false);
  assert.equal(isAllowedAudioUrl("https://127.0.0.1/a.mp3", SB), false);
});

test("refuses non-https, ports, credentials and junk", () => {
  assert.equal(isAllowedAudioUrl("http://cdn.islamic.network/a.mp3", SB), false);
  assert.equal(isAllowedAudioUrl("https://cdn.islamic.network:8443/a.mp3", SB), false);
  assert.equal(isAllowedAudioUrl("https://user:pw@cdn.islamic.network/a.mp3", SB), false);
  assert.equal(isAllowedAudioUrl("not a url", SB), false);
  assert.equal(isAllowedAudioUrl("", SB), false);
});
