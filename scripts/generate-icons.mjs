// Generates the PWA icons at build time (no binary files in git — the
// push tooling only handles UTF-8 text). Pure Node, no dependencies:
// draws the app emblem as a CIRCLE — the medallion from
// src/components/EmblemMedallion.tsx (luminous emerald disc, thick
// gold coin frame, fused star-and-book mark, 3-value gold foil) —
// and writes real PNGs via zlib + a small CRC32 implementation.
// Corners are transparent, so the home screen shows a round icon
// under any platform mask.
// Runs automatically before `vite build` via the `prebuild` script.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const EMERALD = [6, 95, 70, 255];
const GOLD = [240, 200, 90, 255];
const CREAM = [248, 241, 222, 255];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function png(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const p = pixels[y * size + x];
      raw[row + 1 + x * 4] = p[0];
      raw[row + 1 + x * 4 + 1] = p[1];
      raw[row + 1 + x * 4 + 2] = p[2];
      raw[row + 1 + x * 4 + 3] = p[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIcon(size, { maskable = false, apple = false } = {}) {
  const pixels = new Array(size * size);
  const c = size / 2;
  const half = size / 2;
  // Maskable icons are cropped to the center 80% on install, so the
  // whole emblem scales in a little to stay inside the safe zone.
  // (Apple's mask only rounds the corners, so it keeps full size.)
  // The medallion (EmblemMedallion.tsx), translated to pixel tests.
  // Medallion viewBox is 240, center (120,120); every fraction below
  // is viewBox value / 240, times `size`.
  // Maskable icons are cropped to the center 80% on install, so the
  // WHOLE medallion scales by ms = 0.82 there (the frame band's
  // outer edge then lands at 0.3998 x size — just inside the 0.40
  // safe circle). Apple keeps full size (its mask only rounds
  // corners).
  const ms = maskable ? 0.82 : 1;
  const discR = 0.4917 * size * ms; // emerald disc (r=118)
  const frameR = 0.4583 * size * ms; // thick coin frame band (r=110)
  const frameW = 0.0583 * size * ms; // frame band width (14)
  const hairR = 0.4167 * size * ms; // bright hairline (r=100)
  const starCy = -0.1333 * size * ms; // star center (88 -> -32)
  const starR = 0.1042 * size * ms; // star half-side (25)
  const jewelR = 0.0375 * size * ms; // emerald diamond heart (9)
  const bookCy = 0.1083 * size * ms; // book center (146 -> +26)
  const bookW = 0.625 * size * ms; // book width (150)
  const bookH = 0.35 * size * ms; // book height (84)
  const bookDip = 0.0667 * size * ms; // spine dip (16)
  const coverW = 0.0417 * size * ms; // gold binding inset (10)
  // Gold foil: 3 values with one light direction (diagonal, bright
  // top-left to deep bottom-right) — flat single gold is what made
  // the old icon read as poster paint.
  const goldAt = (px, py) => {
    const t = Math.max(0, Math.min(1, ((px + py) / (2 * half)) * 0.5 + 0.5));
    const lerp = (a, b, k) => Math.round(a + (b - a) * k);
    if (t < 0.45) {
      const k = t / 0.45;
      return [lerp(249, 240, k), lerp(224, 200, k), lerp(138, 90, k), 255];
    }
    const k = (t - 0.45) / 0.55;
    return [lerp(240, 201, k), lerp(200, 147, k), lerp(90, 43, k), 255];
  };
  // Emerald jewel: luminous center, deep rim (3 stops).
  const emeraldAt = (dist) => {
    const t = Math.min(dist / discR, 1);
    const lerp = (a, b, k) => Math.round(a + (b - a) * k);
    if (t < 0.55) {
      const k = t / 0.55;
      return [lerp(19, 6, k), lerp(148, 95, k), lerp(110, 70, k), 255];
    }
    const k = (t - 0.55) / 0.45;
    return [lerp(6, 3, k), lerp(95, 59, k), lerp(70, 42, k), 255];
  };
  // Open-book page test: top edge CURLS down toward the spine
  // (sine curl — steep near the spine, flat toward the outer edge),
  // bottom edge straight. Used twice: gold cover, cream pages inset.
  const inBookShape = (px, py, bw, bh) => {
    if (Math.abs(px) > bw / 2) return false;
    const s = Math.sin((Math.PI / 2) * (1 - Math.abs(px) / (bw / 2)));
    const top = bookCy - bh / 2 + bookDip * s;
    return py >= top && py <= bookCy + bh / 2;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - c;
      const py = y + 0.5 - c;
      // Round icon: outside the disc is transparent, so the home
      // screen shows a circle, not a square.
      const dist = Math.hypot(px, py);
      if (dist > discR) {
        pixels[y * size + x] = [0, 0, 0, 0];
        continue;
      }
      let color = emeraldAt(dist);
      // Thick coin frame band + bright hairline.
      if (Math.abs(dist - frameR) <= frameW / 2) color = goldAt(px, py);
      if (Math.abs(dist - hairR) <= 0.0052 * size * ms) color = GOLD;
      // Fused star: filled 8-point star (square + sqrt2 diamond).
      const sx = px;
      const sy = py - starCy;
      if (Math.max(Math.abs(sx), Math.abs(sy)) <= starR
        || Math.abs(sx) + Math.abs(sy) <= starR * Math.SQRT2) color = goldAt(px, py);
      // Jewel heart: small emerald diamond at the star's center.
      if (Math.abs(sx) + Math.abs(sy) <= jewelR) color = EMERALD;
      // Open Mushaf: solid gold binding, cream pages inset, gold spine.
      if (inBookShape(px, py, bookW, bookH)) color = goldAt(px, py);
      if (inBookShape(px, py, bookW - 2 * coverW, bookH - 2 * coverW)) color = CREAM;
      if (Math.abs(px) <= 0.0167 * size * ms && py >= bookCy - bookH / 2 + bookDip && py <= bookCy + bookH / 2) color = goldAt(px, py);
      pixels[y * size + x] = color;
    }
  }
  return png(size, pixels);
}

for (const [path, size, opts] of [
  ['public/icon-192.png', 192, {}],
  ['public/icon-512.png', 512, {}],
  ['public/icon-maskable-512.png', 512, { maskable: true }],
  ['public/apple-touch-icon.png', 180, { apple: true }],
]) {
  writeFileSync(path, makeIcon(size, opts));
  console.log(`generated ${path}`);
}
