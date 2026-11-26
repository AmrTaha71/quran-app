// Items 4.17 + 4.23 — HEAD-check the audio sources before trusting them.
// One-time / review-time check, NOT shipped (nothing in src/ imports it).
//
// Run (needs open internet; the cloud sandbox blocks these hosts):
//   npx esbuild tools/audio-sources/head-check.ts --bundle --platform=node \
//     --format=esm --outfile=/tmp/head-check.mjs && node /tmp/head-check.mjs
//
// Checks surah 1 and 114 of every riwaya file, and the first and last
// ayah (1:1, 114:6) of every listening reciter. Prints one line per URL
// and exits 1 when any answers anything but 2xx. Write the date and the
// result into the comment above RIWAYAT in src/lib/riwayat.ts, and drop
// `unverified` from a reciter in reciters.ts only after it passes here
// AND plays on a real device.
import { RIWAYAT } from '../../src/lib/riwayat';
import { RECITERS } from '../../src/lib/reciters';

const targets: { label: string; url: string }[] = [];
for (const r of RIWAYAT) for (const s of [1, 114]) targets.push({ label: `riwaya ${r.id} surah ${s}`, url: r.audioUrl(s) });
for (const r of RECITERS) for (const [s, a] of [[1, 1], [114, 6]]) targets.push({ label: `reciter ${r.id} ${s}:${a}`, url: r.audioUrl(s, a) });

let bad = 0;
for (const t of targets) {
  let line: string;
  try {
    const res = await fetch(t.url, { method: 'HEAD', redirect: 'follow' });
    const len = res.headers.get('content-length');
    line = `${res.ok ? 'ok  ' : 'FAIL'} ${res.status} ${len ?? '-'} ${t.label}`;
    if (!res.ok) bad++;
  } catch (e) {
    line = `FAIL net ${t.label}: ${(e as Error).message}`;
    bad++;
  }
  console.log(line);
}
console.log(bad ? `${bad} of ${targets.length} failed` : `all ${targets.length} answered`);
process.exit(bad ? 1 : 0);
