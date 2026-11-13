// Bakes the 12 alarm tones into native notification sounds (WAV, 16 s, mono).
// Android: android/app/src/main/res/raw/alarm_<id>.wav
// iOS:     ios/App/App/sounds/alarm_<id>.wav  (then add the folder to the Xcode target)
// Run: node scripts/gen-alarm-sounds.mjs
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const out = '/tmp/alarmTones.mjs';
await build({ entryPoints: ['src/lib/alarmTones.ts'], bundle: true, format: 'esm', outfile: out, logLevel: 'error' });
const { ALARM_TONES, renderTone } = await import(pathToFileURL(out).href);
const SR = 16000, SECONDS = 16;
function wav(samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36);
  b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return b;
}
const dirs = ['android/app/src/main/res/raw', 'ios/App/App/sounds'];
for (const d of dirs) mkdirSync(d, { recursive: true });
for (const t of ALARM_TONES) {
  const buf = wav(renderTone(t.id, SECONDS, SR));
  for (const d of dirs) writeFileSync(`${d}/alarm_${t.id}.wav`, buf);
}
rmSync(out);
console.log(`wrote ${ALARM_TONES.length} tones x ${dirs.length} platforms`);
