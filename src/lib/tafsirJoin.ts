// tafsirJoin.ts — gapless joining of one quarter's tafsir clips (W5-I,
// 2026-11-19; plan item 13, option A).
//
// The tafsir audio is the King Fahd Complex recording, one MP3 per
// ayah. The old engine gave each clip its own `src` on the shared
// <audio> element, so every clip boundary paid a load gap. Here the
// clips of ONE interstitial are fetched as ArrayBuffers (offline
// download cache first, network second), concatenated frame-for-frame
// into ONE Blob and played through ONE blob URL on the same element.
//
// NOT AN AUDIO EDIT: the MP3 frames are copied byte-for-byte. The only
// bytes dropped are container metadata that would corrupt a
// concatenation: a leading ID3v2 tag, a trailing ID3v1 tag, and the
// Xing/Info VBR header frame (it carries no audio and its frame
// count/length would describe only the first file).
//
// START FAST: clip 1 plays as soon as ITS bytes are in; the rest are
// gathered in the background (2 at a time, in order). A segment is
// built from the contiguous clips that are ready when it is needed;
// if the next clip is not here yet the engine waits for it (it never
// invents silence), and if a clip failed it streams that clip
// directly. Hook-free and React-free.

import { AUDIO_TAFSIR_CACHE } from './audioDownload';

export interface RunClip {
  surah: number;
  ayah: number;
  url: string;
}

export interface JoinedSegment {
  /** Exclusive end index into the run's clips. */
  to: number;
  url: string;
  /** Clip start offsets in seconds, plus the total as the last entry. */
  offsets: number[];
}

// ---- MP3 helpers (Layer III only; anything else is passed through) ----

const BR_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SR: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

interface FrameInfo {
  len: number;
  bitrate: number; // kbps
  sampleRate: number;
  samples: number;
  mono: boolean;
  crc: boolean;
  v1: boolean;
}

function frameAt(u8: Uint8Array, i: number): FrameInfo | null {
  if (i + 4 > u8.length) return null;
  if (u8[i] !== 0xff || (u8[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (u8[i + 1] >> 3) & 3;
  const layer = (u8[i + 1] >> 1) & 3;
  if (ver === 1 || layer !== 1) return null; // reserved version / not Layer III
  const brIdx = (u8[i + 2] >> 4) & 15;
  const srIdx = (u8[i + 2] >> 2) & 3;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const v1 = ver === 3;
  const bitrate = (v1 ? BR_V1 : BR_V2)[brIdx];
  const sampleRate = SR[ver][srIdx];
  const pad = (u8[i + 2] >> 1) & 1;
  const len = Math.floor(((v1 ? 144000 : 72000) * bitrate) / sampleRate) + pad;
  return {
    len,
    bitrate,
    sampleRate,
    samples: v1 ? 1152 : 576,
    mono: ((u8[i + 3] >> 6) & 3) === 3,
    crc: (u8[i + 1] & 1) === 0,
    v1,
  };
}

function id3v2Length(u8: Uint8Array): number {
  if (u8.length >= 10 && u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) {
    const size = ((u8[6] & 0x7f) << 21) | ((u8[7] & 0x7f) << 14) | ((u8[8] & 0x7f) << 7) | (u8[9] & 0x7f);
    return 10 + size + ((u8[5] & 0x10) !== 0 ? 10 : 0);
  }
  return 0;
}

/** Find the first real MP3 frame at/after `from` (tolerates a little junk). */
function firstFrame(u8: Uint8Array, from: number): number {
  const limit = Math.min(u8.length - 4, from + 4096);
  for (let i = from; i < limit; i += 1) {
    const f = frameAt(u8, i);
    if (f === null) continue;
    // Confirm with the next frame header to avoid a false sync.
    const next = frameAt(u8, i + f.len);
    if (next !== null || i + f.len >= u8.length - 4) return i;
  }
  return -1;
}

export interface PreparedMp3 {
  bytes: Uint8Array;
  /** Estimated/declared duration in seconds, or null when unknown. */
  seconds: number | null;
}

/**
 * Strip ID3v2 / ID3v1 / Xing-Info so the audio frames can be
 * concatenated. Unparseable input is returned untouched (seconds null).
 */
export function prepareMp3(buf: ArrayBuffer): PreparedMp3 {
  const all = new Uint8Array(buf);
  try {
    let start = firstFrame(all, id3v2Length(all));
    if (start < 0) return { bytes: all, seconds: null };
    let end = all.length;
    if (end - start >= 128 && all[end - 128] === 0x54 && all[end - 127] === 0x41 && all[end - 126] === 0x47) {
      end -= 128;
    }
    let seconds: number | null = null;
    const first = frameAt(all, start);
    if (first !== null) {
      const side = first.v1 ? (first.mono ? 17 : 32) : first.mono ? 9 : 17;
      const tag = start + 4 + (first.crc ? 2 : 0) + side;
      const isXing =
        tag + 8 <= end &&
        ((all[tag] === 0x58 && all[tag + 1] === 0x69 && all[tag + 2] === 0x6e && all[tag + 3] === 0x67) ||
          (all[tag] === 0x49 && all[tag + 1] === 0x6e && all[tag + 2] === 0x66 && all[tag + 3] === 0x6f));
      if (isXing) {
        const flags = all[tag + 7];
        if ((flags & 1) !== 0 && tag + 12 <= end) {
          const frames =
            ((all[tag + 8] << 24) | (all[tag + 9] << 16) | (all[tag + 10] << 8) | all[tag + 11]) >>> 0;
          if (frames > 0) seconds = (frames * first.samples) / first.sampleRate;
        }
        start += first.len; // drop the metadata frame
      }
      if (seconds === null) seconds = ((end - start) * 8) / (first.bitrate * 1000);
    }
    return { bytes: all.subarray(start, end), seconds };
  } catch {
    return { bytes: all, seconds: null };
  }
}

// ---- clip bytes: offline cache first, then network ----

export async function fetchClipBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(AUDIO_TAFSIR_CACHE);
      const hit = await cache.match(url);
      if (hit && hit.ok) {
        const b = await hit.arrayBuffer();
        if (b.byteLength > 0) return b;
      }
    }
  } catch {
    // Fall through to the network.
  }
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const b = await res.arrayBuffer();
    return b.byteLength > 0 ? b : null;
  } catch {
    return null;
  }
}

// ---- one interstitial's clips ----

export class TafsirClipRun {
  readonly clips: RunClip[];
  // undefined = pending, null = failed, else prepared bytes.
  private data: (PreparedMp3 | null | undefined)[];
  private waiters: (() => void)[] = [];
  private started = false;
  private cancelled = false;
  private abort: AbortController | null = null;

  constructor(clips: RunClip[]) {
    this.clips = clips;
    this.data = clips.map(() => undefined);
  }

  /** Kick the background gather (idempotent): in order, 2 at a time. */
  start(): void {
    if (this.started) return;
    this.started = true;
    try {
      this.abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    } catch {
      this.abort = null;
    }
    let next = 0;
    const worker = async (): Promise<void> => {
      while (!this.cancelled) {
        const i = next;
        next += 1;
        if (i >= this.clips.length) return;
        const buf = await fetchClipBytes(this.clips[i].url, this.abort?.signal);
        if (this.cancelled) return;
        this.data[i] = buf ? prepareMp3(buf) : null;
        this.wake();
      }
    };
    void worker();
    void worker();
  }

  cancel(): void {
    this.cancelled = true;
    try {
      this.abort?.abort();
    } catch {
      // Swallow.
    }
    this.data = this.data.map(() => null);
    this.wake();
  }

  isSettled(i: number): boolean {
    return this.data[i] !== undefined;
  }

  /** Resolves when clip i is settled (ok or failed) or after `ms`. */
  whenSettled(i: number, ms: number): Promise<void> {
    if (this.isSettled(i) || this.cancelled) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      const poll = (): void => {
        if (done) return;
        if (this.isSettled(i) || this.cancelled) finish();
        else this.waiters.push(poll);
      };
      this.waiters.push(poll);
    });
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) {
      try {
        f();
      } catch {
        // Swallow.
      }
    }
  }

  /**
   * Join the contiguous READY clips starting at `from` into one blob.
   * Null when clip `from` is not ready/ok or has no usable data (the
   * caller then streams it directly). A clip whose duration is unknown
   * ends the segment (it is only joined when it is the segment's first
   * and only clip, which needs no offsets).
   */
  buildSegment(from: number): JoinedSegment | null {
    const first = this.data[from];
    if (!first) return null;
    const parts: Uint8Array[] = [first.bytes];
    const offsets: number[] = [0];
    let total = first.seconds ?? 0;
    let to = from + 1;
    while (to < this.clips.length) {
      const d = this.data[to];
      const prev = this.data[to - 1];
      if (!d || !prev || prev.seconds === null || d.seconds === null) break;
      offsets.push(total);
      parts.push(d.bytes);
      total += d.seconds;
      to += 1;
    }
    offsets.push(total);
    // Copy out as ArrayBuffer-backed views for the Blob constructor.
    const blob = new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    // Free the bytes now held by the blob.
    for (let i = from; i < to; i += 1) this.data[i] = null;
    return { to, url, offsets };
  }
}
