// tafsirVoice.ts — Tafsir voice variety for the tadabbur khatma
// (ختمة وتفسير), Feature 1, 2026-11-05.
//
// WHY GENERATED, NOT A SECOND RECORDING: the tafsir audio today is
// ONE natural human recording (King Fahd Complex, see
// threeModeListen.ts). Two web searches found NO second
// freely-licensed per-ayah Arabic tafsir audio recording: the only
// tafsir audio that exists is an Indonesian lecture series on
// archive.org (not Arabic, not per-ayah), and app-store listings
// that say "verse by verse audio" mean Quran recitation, not tafsir
// narration. So variety comes from a generated voice, not a second
// natural one — and the natural recording stays the DEFAULT.
//
// CHOICES (persisted, one key):
//   'natural'   — the King Fahd recording for every quarter (today's
//                  behavior, default).
//   'generated' — a generated voice for every quarter, gender-matched
//                  to the user (male → cedar, female → marin — the
//                  same Realtime voices as self-test corrections, and
//                  the same gender rule as links: unknown → female).
//   'alternate' — natural and generated alternate by quarter (odd
//                  quarters natural, even generated). Deterministic
//                  from the quarter number, so a resume re-plans the
//                  same voices — no saved voice state to go stale.
//
// COST GUARD (the global cap is $1/day / ~$30/month, shared):
//   - ONE generated voice per gender at most (2 server voices total),
//     never a voice per user or per quarter.
//   - Generation is LAZY and per ayah: only an ayah actually listened
//     to is ever generated, never a bulk pre-generation of the Quran.
//   - The server caches each (voice, surah, ayah) ONCE in the shared
//     rana-audio bucket (tafsir/<voice>/<surah>-<ayah>_<engine>.wav,
//     immutable): the first generation serves every user forever, and
//     cache hits return BEFORE the cap checks, so they cost nothing.
//   - Generations that do happen go through the SAME per-user and
//     global caps as corrections (same function_name in the usage
//     log), so tafsir can never blow the cap on its own.
//   - The generated file is neutral-speed (rateMode:'playback'); the
//     journey's playbackRate applies at play time, so one file serves
//     all speeds and a speed change never regenerates.
//   - ANY failure (no session, 429 cap, 202 lock, network, server
//     error) falls back to the NATURAL recording — never silence,
//     never a hang, never an error dialog.
//
// SIZING: the interstitial is still sized from the NATURAL clips'
// durations (threeModePlayback probes those, unchanged). The
// generated clip says the same fixed Al-Muyassar text at a similar
// pace, so the 3–4:1 quarter ratio holds approximately; probing a
// generated clip's duration would mean generating it just to measure
// it, which would waste the very budget this design protects.
//
// TEXT: unchanged — Al-Muyassar, fetched server-side by
// generate-voice from the same free AlQuranCloud endpoint the Mushaf
// popup uses. The client never sends tafsir text, only (surah, ayah,
// voice), so the mode cannot be abused for free-form generation.
//
// Hook-free, React-free, Supabase-free except for the session token
// (same pattern as SelfTestPage's getCorrToken).

import { supabase } from './supabase';
import { getStoredLinkGender } from './linkAudio';
import type { LinkGender } from './linkAudio';
import { quarterContaining } from './quarters';
import { tafsirClipUrl } from './threeModeListen';

export type TafsirVoice = 'natural' | 'generated' | 'alternate';

export const TAFSIR_VOICE_KEY = 'quran-tafsir-voice';

export const TAFSIR_VOICES: { id: TafsirVoice; name: string; description: string }[] = [
  {
    id: 'natural',
    name: 'التسجيل الأصلي',
    description: 'تسجيل مجمع الملك فهد — صوت واحد لكل المقاطع.',
  },
  {
    id: 'generated',
    name: 'صوت مولّد',
    description: 'صوت مولّد يطابق جنسك — يُولَّد كل مقطع مرة واحدة ويُحفظ للجميع.',
  },
  {
    id: 'alternate',
    name: 'تناوب بينهما',
    description: 'ربع بالتسجيل الأصلي وربع بالصوت المولّد — حتى لا يملّ السامع.',
  },
];

export function readTafsirVoice(): TafsirVoice {
  try {
    const raw = localStorage.getItem(TAFSIR_VOICE_KEY);
    if (raw === 'natural' || raw === 'generated' || raw === 'alternate') return raw;
  } catch {
    // Swallow: fall through to the default.
  }
  return 'natural';
}

export function writeTafsirVoice(voice: TafsirVoice): void {
  try {
    localStorage.setItem(TAFSIR_VOICE_KEY, voice);
  } catch {
    // Swallow: persistence must never break playback.
  }
}

// The generated voice follows the user's gender (same rule as
// links: stored gender, unknown → female side).
export function generatedTafsirVoice(): LinkGender {
  return getStoredLinkGender(null);
}

export type TafsirSource = 'natural' | 'generated';

// Effective source for one ayah under a setting. 'alternate' flips
// by quarter (odd = natural, even = generated); the quarter is
// derived from the ayah itself, so the mapping is identical on
// first play and on every resume. Reads the live setting on every
// call, so changing the setting mid-journey takes effect at the
// next tafsir clip (no stale closure, no engine rebuild).
export function tafsirSourceForAyah(
  surah: number,
  ayah: number,
  voice: TafsirVoice = readTafsirVoice(),
): TafsirSource {
  if (voice === 'generated') return 'generated';
  if (voice === 'alternate') {
    const qu = quarterContaining(surah, ayah);
    if (qu !== null && qu.q % 2 === 0) return 'generated';
    return 'natural';
  }
  return 'natural';
}

// What the player shows while a tafsir clip plays: which voice the
// listener is actually hearing (never a person's name — the privacy
// rule: 'صوت مولّد' for synthetic, like links).
export function tafsirVoiceLabelForAyah(surah: number, ayah: number): string {
  const src = tafsirSourceForAyah(surah, ayah);
  if (src === 'natural') return 'صوت التفسير: التسجيل الأصلي';
  const gender = generatedTafsirVoice();
  return `صوت التفسير: صوت مولّد (${gender === 'male' ? 'صوت رجالي' : 'صوت نسائي'})`;
}

// ---- Client cache + generate-voice fetch -------------------------
// In-memory URL cache (the server's shared bucket is the durable
// cache; this mirror only avoids re-fetching inside one session).
// Cap 200 entries, oldest-first eviction — the same shape as
// corrAudioStore's AudioUrlCache, kept local so this module stays
// dependency-light.

const MEM_CACHE_CAP = 200;
const memCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function cacheKey(surah: number, ayah: number, gender: LinkGender): string {
  return `${gender}|${surah}:${ayah}`;
}

function memGet(key: string): string | null {
  const url = memCache.get(key);
  return url === undefined ? null : url;
}

function memSet(key: string, url: string): void {
  if (memCache.has(key)) memCache.delete(key);
  while (memCache.size >= MEM_CACHE_CAP) {
    const oldest = memCache.keys().next();
    if (oldest.done) break;
    memCache.delete(oldest.value);
  }
  memCache.set(key, url);
}

// Session token, cached 5 minutes (same pattern as SelfTestPage's
// getCorrToken). A missing session means "not logged in": the caller
// falls back to the natural recording.
let cachedToken: { token: string; at: number } | null = null;

async function getTafsirToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.at < 5 * 60 * 1000) return cachedToken.token;
  let token = '';
  try {
    const { data: { session } } = await supabase.auth.getSession();
    token = session?.access_token ?? '';
  } catch {
    token = '';
  }
  cachedToken = { token, at: Date.now() };
  return token;
}

// Resolve one tafsir clip's playable URL under the live setting.
// Natural → the King Fahd clip URL (pure string, no fetch).
// Generated → the server's cached/generated URL; ANY failure
// (no session, 429, 202 lock, network, server error, empty reply)
// returns the natural URL instead — the engine's own fallback does
// the same, so this function is doubly safe. Never throws.
export async function resolveTafsirAudio(surah: number, ayah: number): Promise<string | null> {
  const natural = tafsirClipUrl(surah, ayah);
  if (tafsirSourceForAyah(surah, ayah) === 'natural') return natural;
  const gender = generatedTafsirVoice();
  const key = cacheKey(surah, ayah, gender);
  const hit = memGet(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) {
    const url = await pending;
    return url ?? natural;
  }
  const job: Promise<string | null> = (async (): Promise<string | null> => {
    try {
      const base = (import.meta as unknown as { env?: Record<string, unknown> }).env
        ?.VITE_SUPABASE_URL;
      if (typeof base !== 'string' || base.length === 0) return null;
      const doFetch = (token: string) =>
        fetch(`${base}/functions/v1/generate-voice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            mode: 'tafsir',
            surah,
            ayah,
            voice: gender,
            rateMode: 'playback',
          }),
        });
      let res = await doFetch(await getTafsirToken());
      if (res.status === 401) {
        cachedToken = null;
        res = await doFetch(await getTafsirToken());
      }
      if (!res.ok) return null;
      const data: unknown = await res.json().catch(() => ({}));
      const url =
        typeof data === 'object' && data !== null
          ? (data as { audioUrl?: unknown }).audioUrl
          : undefined;
      if (typeof url !== 'string' || url.length === 0) return null;
      memSet(key, url);
      return url;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  const url = await job;
  return url ?? natural;
}

// Warm (prefetch) one ayah's generated tafsir audio in the
// background, while its quarter plays. No-op when the live setting
// does not need a generated clip for this ayah. Fire-and-forget:
// failures are swallowed inside resolveTafsirAudio, and the
// boundary path re-resolves (and falls back to natural) anyway.
export function warmTafsirAudio(surah: number, ayah: number): void {
  try {
    if (tafsirSourceForAyah(surah, ayah) === 'natural') return;
    void resolveTafsirAudio(surah, ayah);
  } catch {
    // Swallow: warming must never break playback.
  }
}
