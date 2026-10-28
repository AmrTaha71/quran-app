// Generates the PWA icons at build time (no binary files in git — the
// push tooling only handles UTF-8 text).
//
// THE ARTWORK ITSELF is the icon: the logo the user chose is stored
// in this repo ONLY as base64 text (scripts/logo-art/*.b64 — plain
// text files, so they can be committed), and this script decodes
// each one back into the real PNG the manifest and iOS need
// (icon-192, icon-512, icon-maskable-512, apple-touch-icon).
// Nothing is redrawn or reinterpreted in code — the bytes written
// are the artwork's own bytes, resized once with PIL when the .b64
// files were made. The maskable variant is the artwork scaled to
// 80% on its own corner color, so the system's circular crop never
// cuts the emblem.
// Runs automatically before `vite build` via the `prebuild` script:
// the PNGs land in public/, and vite copies them into dist/ —
// exactly the files the manifest already declares.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const artDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'logo-art');
const FILES = [
  ['icon-192.b64', 'public/icon-192.png'],
  ['icon-512.b64', 'public/icon-512.png'],
  ['icon-maskable.b64', 'public/icon-maskable-512.png'],
  ['apple-180.b64', 'public/apple-touch-icon.png'],
];

for (const [src, dest] of FILES) {
  try {
    const buf = Buffer.from(readFileSync(path.join(artDir, src), 'utf8'), 'base64');
    if (buf.length === 0) throw new Error('empty decode');
    writeFileSync(dest, buf);
    console.log('generated', dest);
  } catch (e) {
    // Never fail the build over an icon: the app still works, and a
    // missing icon is visible immediately (not a silent break).
    console.warn('icon skipped:', dest, '-', e.message);
  }
}
