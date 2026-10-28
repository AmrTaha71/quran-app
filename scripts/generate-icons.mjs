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
  // (Apple's mask only rounds the corners, so it keeps full size.)
  const ms = maskable ? 0.82 : 1;
  const w = size / 40; // thick gold line width — thin lines read as
  // "poor" at home-screen size; filled gold reads as luxurious.
  const frameW = size / 24; // gold frame just inside the icon edge
  const R1 = 0.44 * size * ms; // medallion outer ring
  const R2 = 0.375 * size * ms; // medallion inner ring
  const midR = (R1 + R2) / 2; // ring of small gold dots
  const dotR = size / 64;
  const starCy = -0.21 * size * ms; // filled 8-point star above book
  const starR = 0.105 * size * ms;
  const bookCy = 0.14 * size * ms; // gold-bound open book center
  const bookW = 0.60 * size * ms;
  const bookH = 0.34 * size * ms;
  const bookDip = 0.05 * size * ms; // center top dips toward the spine
  const coverW = size / 34; // gold binding thickness around the pages
  // Rounded-square membership test (for the frame): true when the
  // pixel is inside a rounded square of the given half-size and
  // corner radius.
  const inRounded = (px, py, h, r) => {
    if (r <= 0) return Math.abs(px) <= h && Math.abs(py) <= h;
    const dx = Math.max(Math.abs(px) - (h - r), 0);
    const dy = Math.max(Math.abs(py) - (h - r), 0);
    return dx * dx + dy * dy <= r * r;
  };
  // Open-book page test: top edge dips at the center spine, bottom
  // edge straight. Used twice: gold cover, then cream pages inset.
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
      if (rad > 0 && !inRounded(px, py, half, rad)) {
        pixels[y * size + x] = [0, 0, 0, 0];
        continue;
      }
      // Radial emerald gradient: lighter jewel center, deeper edge.
      const t = Math.min(Math.hypot(px, py) / (half), 1);
      let color = [
        Math.round(11 + (4 - 11) * t),
        Math.round(122 + (84 - 122) * t),
        Math.round(94 + (60 - 94) * t),
        255,
      ];
      // Gold frame (not for maskable: the safe-zone crop would cut it).
      if (!maskable && !inRounded(px, py, half - frameW, Math.max(rad - frameW, 0))) color = GOLD;
      const dist = Math.hypot(px, py);
      if (Math.abs(dist - R1) <= w / 2 || Math.abs(dist - R2) <= w / 2) color = GOLD;
      // 12 small gold dots on the ring between the two medallion rings.
      if (dist > 0.3 * size) {
        const ang = Math.atan2(py, px);
        const dotAng = Math.round(ang / (Math.PI / 6)) * (Math.PI / 6);
        const ddx = px - midR * Math.cos(dotAng);
        const ddy = py - midR * Math.sin(dotAng);
        if (ddx * ddx + ddy * ddy <= dotR * dotR) color = GOLD;
      }
      // Filled 8-point star: union of a square and a larger diamond
      // (diamond circumradius starR*√2, so its vertices poke out of
      // the square's edges while the square's corners poke out of the
      // diamond — 8 points total; a same-size diamond would just
      // vanish inside the square).
      const sx = px;
      const sy = py - starCy;
      if (Math.max(Math.abs(sx), Math.abs(sy)) <= starR
        || Math.abs(sx) + Math.abs(sy) <= starR * Math.SQRT2) color = GOLD;
      // Open Mushaf: solid gold binding, cream pages inset, gold spine.
      if (inBookShape(px, py, bookW, bookH)) color = GOLD;
      if (inBookShape(px, py, bookW - 2 * coverW, bookH - 2 * coverW)) color = CREAM;
      if (Math.abs(px) <= coverW * 0.55 && py >= bookCy - bookH / 2 + bookDip && py <= bookCy + bookH / 2) color = GOLD;
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
