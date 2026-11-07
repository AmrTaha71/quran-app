// Seamless ayah joins (2026-11-07): each per-ayah recording carries its
// own silence at the start and end, so playing them one after another
// leaves a gap and a repeated letter. This module decodes an ayah file,
// trims only the silence at both ends (keeping a short pad so no word is
// clipped, and keeping any pause the reciter makes inside the ayah), and
// returns a small WAV blob URL. Any failure (CORS, decode, offline)
// resolves to null so the caller falls back to the original URL.
const PAD_SECONDS = 0.04;
const THRESHOLD = 0.015; // about -36 dBFS
const MAX_CACHE = 40;

type Ctx = AudioContext;
let ctx: Ctx | null = null;
function audioContext(): Ctx | null {
  if (ctx) return ctx;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
  const C = Ctor.AudioContext ?? Ctor.webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  return ctx;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function trimOne(sourceUrl: string): Promise<string | null> {
  const c = audioContext();
  if (!c) return null;
  const res = await fetch(sourceUrl);
  if (!res.ok) return null;
  const decoded = await c.decodeAudioData(await res.arrayBuffer());
  const chans = decoded.numberOfChannels;
  const len = decoded.length;
  const mono = new Float32Array(len);
  for (let ch = 0; ch < chans; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += data[i] / chans;
  }
  let start = 0;
  while (start < len && Math.abs(mono[start]) < THRESHOLD) start++;
  let end = len - 1;
  while (end > start && Math.abs(mono[end]) < THRESHOLD) end--;
  if (start >= end) return null;
  const pad = Math.round(PAD_SECONDS * decoded.sampleRate);
  const from = Math.max(0, start - pad);
  const to = Math.min(len, end + pad);
  const blob = encodeWav(mono.subarray(from, to), decoded.sampleRate);
  return URL.createObjectURL(blob);
}

const cache = new Map<string, Promise<string | null>>();
const order: string[] = [];

/** Trimmed WAV blob URL for an ayah file, or null when it cannot be made. */
export function trimmedAyahUrl(sourceUrl: string): Promise<string | null> {
  const hit = cache.get(sourceUrl);
  if (hit) return hit;
  const p = trimOne(sourceUrl).catch(() => null);
  cache.set(sourceUrl, p);
  order.push(sourceUrl);
  while (order.length > MAX_CACHE) {
    const old = order.shift();
    if (old === undefined) break;
    const oldP = cache.get(old);
    cache.delete(old);
    void oldP?.then((u) => { if (u) URL.revokeObjectURL(u); });
  }
  return p;
}
