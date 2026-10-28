// Generates the PWA icons at build time (no binary files in git — the
// push tooling only handles UTF-8 text). Pure Node, no dependencies:
// draws the app emblem — emerald rounded square, gold medallion
// rings, 8-point star above an open gold-bound Mushaf — and writes
// real PNGs via zlib + a small CRC32 implementation.
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
  const rad = maskable || apple ? 0 : size / 5;
  const half = size / 2;
  // Maskable icons are cropped to the center 80% on install, so the
  // whole emblem scales in a little to stay inside the safe zone.
  const ms = maskable ? 0.86 : 1;
  const w = size / 72; // gold line width
  const R1 = 0.44 * size * ms; // medallion outer ring
  const R2 = 0.39 * size * ms; // medallion inner ring
  const starCy = -0.205 * size * ms; // 8-point star center (above book)
  const starR = 0.085 * size * ms;
  const bookCy = 0.13 * size * ms; // open book center
  const bookW = 0.56 * size * ms;
  const bookH = 0.30 * size * ms;
  const bookDip = 0.055 * size * ms; // center top dips toward the spine
  // Open-book page test: top edge dips at the center spine, bottom
  // edge straight. Returns true when (px, py) is inside the page
  // shape of the given width/height (used twice: gold backing, then
  // cream pages on top for the outline effect).
  const inBookShape = (px, py, bw, bh) => {
    if (Math.abs(px) > bw / 2) return false;
    const t = 1 - Math.abs(px) / (bw / 2); // 1 at spine, 0 at outer edge
    const top = bookCy - bh / 2 + bookDip * t;
    return py >= top && py <= bookCy + bh / 2;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - c;
      const py = y + 0.5 - c;
      let inside = true;
      if (rad > 0) {
        const qx = Math.abs(px);
        const qy = Math.abs(py);
        const dx = Math.max(qx - (half - rad), 0);
        const dy = Math.max(qy - (half - rad), 0);
        inside = dx * dx + dy * dy <= rad * rad;
      }
      if (!inside) {
        pixels[y * size + x] = [0, 0, 0, 0];
        continue;
      }
      const dist = Math.hypot(px, py);
      let color = EMERALD;
      if (Math.abs(dist - R1) <= w / 2 || Math.abs(dist - R2) <= w / 2) color = GOLD;
      // 8-point star as intersecting outlines: a square ring crossed
      // by a diamond ring, plus a small filled diamond at the center.
      const sx = px;
      const sy = py - starCy;
      if (Math.abs(Math.max(Math.abs(sx), Math.abs(sy)) - starR) <= w / 2
        || Math.abs(Math.abs(sx) + Math.abs(sy) - starR) <= w / 2
        || Math.abs(sx) + Math.abs(sy) <= starR / 3.5) color = GOLD;
      // Open Mushaf: gold backing slightly larger, cream pages on top,
      // gold spine down the middle.
      if (inBookShape(px, py, bookW + 3 * w, bookH + 3 * w)) color = GOLD;
      if (inBookShape(px, py, bookW, bookH)) color = CREAM;
      if (Math.abs(px) <= w * 0.9 && py >= bookCy - bookH / 2 + bookDip && py <= bookCy + bookH / 2) color = GOLD;
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
