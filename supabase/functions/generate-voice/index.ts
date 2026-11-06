// generate-voice — v16 (2026-11-06, dialogue mode)
// ADDS a dialogue mode: {mode:'dialogue', surah, ayah} — the client
// sends NO text and NO voice. The server fetches the Al-Muyassar
// text itself (same AlQuranCloud endpoint as tafsir mode), asks the
// cheap gpt-4o-mini text model to write exactly 2 short host lines
// grounded ONLY in that tafsir text (JSON {"host1","host2"}), then
// speaks them via the existing Realtime path — Host 1 = cedar/male,
// Host 2 = marin/female, speed 1.0 — and caches BOTH files ONCE per
// (surah, ayah) under tafsir/dialogue/<surah>-<ayah>_host<N>_realtime.wav
// (immutable). Azure is IGNORED for dialogue: its Hamed/Zariyah
// voices cannot give the two distinct cedar/marin hosts, so dialogue
// REQUIRES an OpenAI key (503 without one). Cache hits return before
// the cap checks (cost 0); a generation logs ONE 'generate-voice'
// row whose cost_usd is the TOTAL (LLM + both TTS costs), so the
// existing per-user (30/min, 500/day) and global (1000/day, $1/day)
// caps bound dialogue spend exactly like tafsir. A 202 lock-waiter,
// a 429, or any failure makes the client fall back to the natural
// King Fahd recording alone — never a partial dialogue, never
// silence. If only one host file exists the pair is treated as a
// miss and both are regenerated. Text cap 8000 chars, same as tafsir.
// generate-voice — v15 (2026-11-05, Feature 1: tafsir voice variety)
// ADDS a tafsir mode: {mode:'tafsir', surah, ayah, voice} — the
// client sends NO text. The server fetches the Al-Muyassar text
// itself from the free AlQuranCloud endpoint (the same source the
// Mushaf popup uses), generates it with the existing chain, and
// caches it ONCE per (voice, surah, ayah) in the shared rana-audio
// bucket under tafsir/<voice>/<surah>-<ayah>_<engine>.<ext>
// (immutable). Cache hits return before the cap checks (cost 0);
// generations log function_name='generate-voice', so the existing
// per-user (30/min, 500/day) and global (1000/day, $1/day) caps
// bound tafsir spend exactly like corrections. A 202 lock-waiter,
// a 429, or any failure makes the client fall back to the natural
// King Fahd recording — never silence. Text cap 8000 chars (the
// longest Muyassar entries, e.g. 2:282, run ~2k chars; the 2000
// free-text cap does not apply here because the text comes from a
// trusted source, not the caller); over-long text returns 413 and
// the client falls back to natural.
// generate-voice — v14 (2026-10-30, Claude-review fixes on the v13 cache)
// v14 ADDS, corr mode only (free-text mode is UNCHANGED):
// (a) prompt fingerprint in the cache key: v3_<fp>_<voice>_<shape>_<positions>,
// where fp hashes the voice-defining prompt strings for the request's
// engine+voice — a prompt tweak changes the key automatically, so it can
// never serve a year of stale immutable audio under an old key. The cache
// is empty (0 rows), so the format change costs nothing.
// (b) lock TTL 5 min -> 90s + release on ANY failure path (catch-release):
// a failed generation no longer squats its key for 5 minutes.
// (c) shared-cache upload guard: reject generated audio under 1000 bytes
// (empty/truncated) instead of caching a broken clip.
// v13 ADDS, corr mode only (free-text mode is UNCHANGED):
// (a) a shared server cache in the public rana-audio bucket: the
// first generation for a logical key v3_<voice>_<shape>_<positions>
// is stored under corr/<key>_<engine>.<ext> (immutable) and every
// later request for the same key is served from it — one
// generation serves ALL users/devices. Rate is EXCLUDED from the
// key (playbackRate applies at play time); no user_id and no free
// text appear in lock/file names; content is Quran words only.
// (b) an atomic storage-object lock (corr/locks/<key>.json,
// upsert:false, 90s TTL since v14): a waiter gets HTTP 202 with no
// audioUrl, which the client already treats as null (browser
// voice, no dialog); the next occurrence hits the cache.
// (c) telemetry rows with function_name='generate-voice-cache-hit'
// (user_id NULL, cost 0, provider 'cache',
// model 'cache-hit:<logicalKey>'): cap queries filter
// function_name='generate-voice' exactly, so hit rows are excluded
// from per-user AND global caps by construction, while the model
// field carries the key for the Phase 3 gate query (top
// corrections over trailing 30d).
// (d) the playback-rate contract: requests with rateMode:'playback'
// generate at neutral 1.0 on OpenAI paths (the client applies the
// user's rate via audio.playbackRate, pitch-preserved). Callers
// WITHOUT the flag (old tabs, admin link generation) keep
// baked-speed behavior exactly as before. Azure keeps its -10%
// prosody in all modes (moot while Azure is absent).
// v12 below: position-keyed correction mode.
// v12 ADDS: a server-verified correction mode. The client sends a
// Quran position (seeded quran_verses ids + word positions), a
// prompt shape (context-word vs bare-word), and the spoken text it
// built; the server rebuilds the text from the seeded rows
// (corrVerify.ts, a verbatim port of the client's text logic) and
// rejects ANY mismatch with 400. The user-facing correction path
// therefore no longer sends free text, while the free-text mode
// below is UNCHANGED for admin link generation (LinkModal /
// AdminPage send {text, voice} exactly as before, and old cached
// client tabs sending free text keep working).
// v11 below: global daily caps (1000 calls + $1 spend).
// spend cap is the budget guard; the calls cap is a loose backstop
// that also bounds Azure volume (Azure dollars log as null, so they
// never count toward the spend sum).
// Atomicity: the per-user/global cap checks keep their
// check-then-log race (a few calls of overshoot, accepted), but
// corr-mode GENERATION is now reserved by the storage-object lock
// above, so concurrent requests for the same key generate at most
// once. (DDL is unavailable — exec-ddl rejects table creation — so
// the lock lives in storage, not in a reservations table.)
// (v10 below: TTS migration, ordered by Amr 2026-10-29)
// ORDER OF GENERATION:
//   1. Azure TTS first (unchanged; Azure is NOT affected by OpenAI's
//      2027-01-06 shutdown, and its -10% prosody survives here).
//   2. OpenAI Realtime gpt-realtime-2.1-mini via WebSocket (NEW): the
//      vendor's designated replacement for the Speech API models.
//      One-shot flow: session.update -> item.create (the text) ->
//      response.create with a verbatim instruction -> PCM16 deltas
//      -> WAV. The model's spoken transcript is compared to the input
//      (diacritics/punctuation/whitespace stripped, letters exact);
//      on mismatch the audio is discarded and the old chain runs.
//   3. Old Speech chain (gpt-4o-mini-tts -> tts-1-hd) as FALLBACK
//      ONLY. Both models shut down 2027-01-06: after that date this
//      fallback is dead code and must be removed in a cleanup push.
// REALTIME VOICES ARE PROVISIONAL (2026-10-29): onyx/nova do not
// exist in Realtime. cedar (male) / marin (female) are OpenAI's
// recommended pair; Amr's ear is the final judge — if he dislikes
// either, change REALTIME_VOICES below and redeploy (one line).
// SPEED: Realtime supports post-processing speed 0.25-1.5, so the
// male 1.15 / female 1.0 defaults survive; caller speeds above 1.5
// are clamped to 1.5 on this path (the old chain keeps 0.25-4.0).
// CONTRACT UNCHANGED: {audioUrl, voice}. Only the file format
// changes on the Realtime path (WAV instead of MP3); players play
// the URL, so no app change is needed. Logging privacy unchanged:
// no text or audio content is ever logged.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorrSpokenText } from "./corrVerify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const AZURE_VOICES: Record<string, { name: string; locale: string }> = {
  male: { name: "ar-SA-Hamed", locale: "ar-SA" },
  female: { name: "ar-SA-Zariyah", locale: "ar-SA" },
};

const REALTIME_MODEL = "gpt-realtime-2.1-mini";

// GLOBAL CAPS (v11): all users combined, rolling 24h.
const GLOBAL_CALLS_PER_DAY = 1000;
const GLOBAL_SPEND_PER_DAY_USD = 1.0;
// Provisional pilot mapping (see header): OpenAI's recommended pair.
const REALTIME_VOICES: Record<string, string> = {
  male: "cedar",
  female: "marin",
};

// ---- Shared server correction cache (v14, corr mode only) ----
// Logical key: v3_<fp>_<voice>_<shape>_<positions> (fp = prompt
// fingerprint, see below), positions encoded as
// id-w pairs joined by '_' (no special chars in object names).
// Rate is excluded by design. The cached file carries the PRIMARY
// engine suffix, and lookup selects the CURRENT primary engine's
// file only — so a later engine change (e.g. Azure configured)
// never serves the wrong voice from an older file; orphaned files
// from a retired engine simply stop being served. Fallback-engine
// (old Speech chain: onyx/nova) audio is NEVER written here — it
// must never poison a cedar/marin key.
const CORR_CACHE_PREFIX = "corr";
const CORR_LOCK_TTL_MS = 90 * 1000;
// Minimum generated-audio size for a shared-cache write: a real 1-2 word
// clip is many KB (mp3) or tens of KB (wav); anything under 1 KB is an
// empty/truncated response that must never become an immutable entry.
const CORR_MIN_AUDIO_BYTES = 1000;

// ---- Shared server tafsir cache (v15) ----
// One immutable file per (voice, surah, ayah) under
// tafsir/<voice>/, mirroring the corr cache's lock + lookup shape
// (separate prefix so a tafsir key can never collide with a corr
// key, and so corr behavior is untouched). The client never sends
// text: the server fetches the Al-Muyassar text itself, so the
// mode cannot be abused for free-form generation.
const TAFSIR_CACHE_PREFIX = "tafsir";
const TAFSIR_TEXT_MAX_CHARS = 8000;

// Prompt fingerprint: a short deterministic hash of the voice-defining
// prompt strings for the request's engine+voice. Realtime's voice is
// defined by REALTIME_VERBATIM + realtimePersona(voice); Azure's by its
// voice name/locale + prosody. Hashing (not a manual version constant)
// means a prompt tweak changes the key by itself — the failure mode
// Claude flagged (stale voice served for a year under an old key)
// cannot happen by forgetting a bump.
function corrPromptFingerprint(engine: string, voice: "male" | "female"): string {
  const material = engine === "azure"
    ? `azure|${AZURE_VOICES[voice]?.name ?? voice}|${AZURE_VOICES[voice]?.locale ?? ""}|prosody:-10%`
    : `realtime|${REALTIME_VERBATIM}|${realtimePersona(voice)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function corrLogicalKey(
  voice: string | undefined,
  shape: "context" | "bare",
  positions: { id: number; w: number }[],
  engine: string,
): string {
  const v = voice === "female" ? "female" : "male";
  const pos = positions.map((p) => `${p.id}-${p.w}`).join("_");
  const fp = corrPromptFingerprint(engine, v);
  return `v3_${fp}_${v}_${shape}_${pos}`;
}

function corrCacheFileName(key: string, engine: string): string {
  return `${CORR_CACHE_PREFIX}/${key}_${engine}.${engine === "azure" ? "mp3" : "wav"}`;
}

function corrLockPath(key: string): string {
  return `${CORR_CACHE_PREFIX}/locks/${key}.json`;
}

// Existence check via storage list with the EXACT file name as the
// search string: list() prefix-matches names within the folder, and
// no name we ever create extends another corr file name (the
// engine suffix + extension anchor the end), so the exact-name
// filter below can match at most the file itself. Metadata only —
// no audio bytes are downloaded for a lookup.
async function findCorrCachedUrl(
  client: any,
  key: string,
  engine: string,
): Promise<string | null> {
  const fileName = corrCacheFileName(key, engine);
  const base = fileName.slice(CORR_CACHE_PREFIX.length + 1);
  const { data } = await client.storage.from("rana-audio").list(CORR_CACHE_PREFIX, { limit: 1, search: base });
  const hit = (data ?? []).find((f: any) => f.name === base);
  if (!hit) return null;
  return client.storage.from("rana-audio").getPublicUrl(fileName).data.publicUrl;
}

// Atomic claim via create-if-absent (upsert:false). Returns
// 'claimed' or 'locked'. A stale lock (older than the TTL, e.g. a
// crashed winner) is deleted and the claim retried exactly once;
// losing that retry means another worker claimed it first.
async function tryClaimCorrLock(client: any, key: string): Promise<"claimed" | "locked"> {
  const lockName = `${key}.json`;
  const lockPath = corrLockPath(key);
  const { data } = await client.storage.from("rana-audio").list(`${CORR_CACHE_PREFIX}/locks`, { limit: 1, search: lockName });
  const existing = (data ?? []).find((f: any) => f.name === lockName);
  if (existing) {
    const created = Date.parse(existing.created_at ?? "");
    const age = Number.isNaN(created) ? Infinity : Date.now() - created;
    if (age < CORR_LOCK_TTL_MS) return "locked";
    await client.storage.from("rana-audio").remove([lockPath]);
  }
  const { error } = await client.storage.from("rana-audio").upload(
    lockPath,
    new Blob([JSON.stringify({ status: "pending", key })], { type: "application/json" }),
    { contentType: "application/json", upsert: false },
  );
  if (error) return "locked";
  return "claimed";
}

async function releaseCorrLock(client: any, key: string): Promise<void> {
  try {
    await client.storage.from("rana-audio").remove([corrLockPath(key)]);
  } catch { /* best-effort: the TTL expires a leaked lock */ }
}

// Tafsir cache helpers (v15): same shape as the corr helpers,
// under the tafsir/ prefix. The lock key is the cache key itself
// (tafsir_<voice>_<surah>-<ayah>); the file name adds the primary
// engine, so a later engine change never serves the wrong voice.
function tafsirCacheKey(voice: string, surah: number, ayah: number): string {
  return `tafsir_${voice}_${surah}-${ayah}`;
}

function tafsirCacheFileName(voice: string, surah: number, ayah: number, engine: string): string {
  return `${TAFSIR_CACHE_PREFIX}/${voice}/${surah}-${ayah}_${engine}.${engine === "azure" ? "mp3" : "wav"}`;
}

function tafsirLockPath(key: string): string {
  return `${TAFSIR_CACHE_PREFIX}/locks/${key}.json`;
}

async function findTafsirCachedUrl(
  client: any,
  voice: string,
  surah: number,
  ayah: number,
  engine: string,
): Promise<string | null> {
  const fileName = tafsirCacheFileName(voice, surah, ayah, engine);
  const base = fileName.slice(TAFSIR_CACHE_PREFIX.length + 1 + voice.length + 1);
  const { data } = await client.storage.from("rana-audio").list(`${TAFSIR_CACHE_PREFIX}/${voice}`, { limit: 1, search: base });
  const hit = (data ?? []).find((f: any) => f.name === base);
  if (!hit) return null;
  return client.storage.from("rana-audio").getPublicUrl(fileName).data.publicUrl;
}

async function tryClaimTafsirLock(client: any, key: string): Promise<"claimed" | "locked"> {
  const lockName = `${key}.json`;
  const lockPath = tafsirLockPath(key);
  const { data } = await client.storage.from("rana-audio").list(`${TAFSIR_CACHE_PREFIX}/locks`, { limit: 1, search: lockName });
  const existing = (data ?? []).find((f: any) => f.name === lockName);
  if (existing) {
    const created = Date.parse(existing.created_at ?? "");
    const age = Number.isNaN(created) ? Infinity : Date.now() - created;
    if (age < CORR_LOCK_TTL_MS) return "locked";
    await client.storage.from("rana-audio").remove([lockPath]);
  }
  const { error } = await client.storage.from("rana-audio").upload(
    lockPath,
    new Blob([JSON.stringify({ status: "pending", key })], { type: "application/json" }),
    { contentType: "application/json", upsert: false },
  );
  if (error) return "locked";
  return "claimed";
}

async function releaseTafsirLock(client: any, key: string): Promise<void> {
  try {
    await client.storage.from("rana-audio").remove([tafsirLockPath(key)]);
  } catch { /* best-effort: the TTL expires a leaked lock */ }
}

// ---- Dialogue mode helpers (v16) ----
// Cache key: dialogue_<surah>-<ayah>. Files live under
// tafsir/dialogue/ so they share the tafsir prefix (and its lock
// helpers) but can never collide with a single-voice tafsir file.
// The engine suffix is ALWAYS "realtime": dialogue requires the
// OpenAI Realtime path (cedar/marin are the two distinct hosts),
// so Azure is ignored even when configured.
const DIALOGUE_MODEL = "gpt-4o-mini";
const DIALOGUE_PRIMARY_ENGINE = "realtime";

function dialogueCacheKey(surah: number, ayah: number): string {
  return `dialogue_${surah}-${ayah}`;
}

function dialogueCacheFileName(
  surah: number,
  ayah: number,
  host: "host1" | "host2",
  engine: string,
): string {
  return `${TAFSIR_CACHE_PREFIX}/dialogue/${surah}-${ayah}_${host}_${engine}.wav`;
}

// Both host files must exist for a hit; a single file is a miss
// (never serve a half dialogue). Metadata only — no audio bytes.
async function findDialogueCachedUrls(
  client: any,
  surah: number,
  ayah: number,
  engine: string,
): Promise<{ host1Url: string; host2Url: string } | null> {
  const folder = `${TAFSIR_CACHE_PREFIX}/dialogue`;
  const urls: Record<string, string> = {};
  for (const host of ["host1", "host2"] as const) {
    const base = `${surah}-${ayah}_${host}_${engine}.wav`;
    const { data } = await client.storage.from("rana-audio").list(folder, { limit: 1, search: base });
    const hit = (data ?? []).find((f: any) => f.name === base);
    if (!hit) return null;
    urls[host] = client.storage.from("rana-audio")
      .getPublicUrl(`${folder}/${base}`).data.publicUrl;
  }
  return { host1Url: urls.host1, host2Url: urls.host2 };
}

// Write the two host lines with the CHEAP text model (never the
// Realtime model — it is for speech, not text). The prompt is
// Arabic and grounds both lines ONLY in the tafsir text: no
// invented meanings, no new rulings, nothing quoted from outside
// the tafsir. Throws on any LLM failure, invalid JSON, or a line
// that is empty or over 400 chars — the caller turns that into a
// 502 so the client falls back to the natural clip.
// Cost: gpt-4o-mini ≈ $0.15/1M input + $0.60/1M output tokens,
// from the response usage when present, else estimated from chars
// (≈4 chars/token). Lengths only are logged — never the lines.
async function writeDialogueLines(
  tafsirText: string,
  apiKey: string,
): Promise<{ host1: string; host2: string; costUsd: number }> {
  const prompt =
    "اكتب حوارًا قصيرًا بين مقدّمَين عن آية قرآنية، اعتمادًا فقط على نص التفسير الميسّر التالي. " +
    "أعد سطرين قصيرين فقط (جملة أو جملتان لكل سطر) بصيغة JSON فقط، بهذا الشكل تمامًا: " +
    "{\"host1\": \"...\", \"host2\": \"...\"}. " +
    "المقدّم الأول (رجل) يقدّم سؤالًا أو تمهيدًا قصيرًا عن الآية. " +
    "المقدّمة الثانية (امرأة) تردّ بتعليق أو متابعة قصيرة. " +
    "التزم بنص التفسير فقط: لا تخترع معاني جديدة، ولا تضف أحكامًا جديدة، ولا تقتبس شيئًا من خارج التفسير.\n\n" +
    "نص التفسير:\n" + tafsirText;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DIALOGUE_MODEL,
      temperature: 0.3,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "أنت تكتب حوارات قصيرة مبنية على نص تفسير معطى، ولا تضيف شيئًا من عندك.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`dialogue script failed: ${res.status}`);
  }
  const json: any = await res.json().catch(() => null);
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) {
    throw new Error("dialogue script empty");
  }
  let parsed: any = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch { /* stays null */ }
    }
  }
  const host1 = typeof parsed?.host1 === "string" ? parsed.host1.trim() : "";
  const host2 = typeof parsed?.host2 === "string" ? parsed.host2.trim() : "";
  if (!host1 || host1.length > 400 || !host2 || host2.length > 400) {
    throw new Error("dialogue script invalid");
  }
  const usage = json?.usage;
  let costUsd: number;
  if (
    usage && Number.isFinite(Number(usage.prompt_tokens)) &&
    Number.isFinite(Number(usage.completion_tokens))
  ) {
    costUsd = (Number(usage.prompt_tokens) * 0.15 +
      Number(usage.completion_tokens) * 0.6) / 1_000_000;
  } else {
    const inTokens = Math.ceil(prompt.length / 4);
    const outTokens = Math.ceil((host1.length + host2.length) / 4);
    costUsd = (inTokens * 0.15 + outTokens * 0.6) / 1_000_000;
  }
  return { host1, host2, costUsd };
}

async function generateAzureTTS(text: string, voice: "male" | "female", apiKey: string, region: string): Promise<ArrayBuffer> {
  const v = AZURE_VOICES[voice] || AZURE_VOICES.male;
  const ssml = `<speak version='1.0' xml:lang='${v.locale}'><voice xml:lang='${v.locale}' name='${v.name}'><prosody rate='-10%'>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</prosody></voice></speak>`;

  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
    },
    body: ssml,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Azure TTS error: ${response.status} - ${errText}`);
  }

  return response.arrayBuffer();
}

async function generateOpenAITTS(text: string, voice: "male" | "female", apiKey: string, speedOverride?: number): Promise<{ buffer: ArrayBuffer; model: string }> {
  const ttsVoice = voice === "female" ? "nova" : "onyx";
  // gpt-4o-mini-tts first: far more natural prosody than tts-1-hd, and it
  // accepts style instructions. Falls back to tts-1-hd if it ever fails.
  // Both voices must sound EXTREMELY human (2026-10-28): a real
  // person in the room, not a reader — breathing, warmth, feeling.
  const instructions = voice === "female"
    ? "An extremely human, warm, gentle female voice, like a kind Quran teacher sitting right beside you: natural pace, clear Arabic pronunciation, soft pauses and real breathing between phrases, calm and reverent tone, alive and expressive with genuine warmth and feeling in every phrase — never flat, never rushed, never robotic, never like an announcement."
    : "An extremely human, dignified, warm male voice, like a respected Quran teacher speaking to a student face to face: unhurried and natural, with real pauses and breathing between phrases, clear Arabic pronunciation, calm and reverent tone, gentle variation in pace and emotion, alive and conversational with genuine human warmth — never rushed, never monotone, never like a news announcer or a robot.";
  // Male delivery was reported slow: 1.15 keeps it dignified without
  // dragging. Female stays 1.0 (no complaint). Cost is per character,
  // so speed changes nothing on billing. A caller-supplied speed
  // (self-test correction rate, 2026-10-28) overrides both defaults.
  const speed = speedOverride ?? (voice === "male" ? 1.15 : 1.0);
  const attempts = [
    { model: "gpt-4o-mini-tts", body: { model: "gpt-4o-mini-tts", input: text, voice: ttsVoice, response_format: "mp3", speed, instructions } },
    { model: "tts-1-hd", body: { model: "tts-1-hd", input: text, voice: ttsVoice, response_format: "mp3", speed } },
  ];
  let lastError = "";
  for (const a of attempts) {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(a.body),
    });
    if (response.ok) return { buffer: await response.arrayBuffer(), model: a.model };
    lastError = await response.text();
  }
  throw new Error(`OpenAI TTS error: ${lastError}`);
}

// ---- Realtime one-shot speech (v10) ----

// Chunked base64 decode (deltas are small, totals can be megabytes).
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// PCM16 mono @ 24kHz -> WAV (44-byte header, no encoder needed).
function pcm16ToWav(pcm: Uint8Array): ArrayBuffer {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true); // byte rate = 24000 * 2
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, pcm.length, true);
  const wav = new Uint8Array(44 + pcm.length);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm, 44);
  return wav.buffer;
}

// Transcript gate: strip only diacritics, tatweel, punctuation and
// whitespace. Letters stay exact (normalizing ى/ي or ة/ه would mask
// real word changes, e.g. على vs علي). A mismatch is a safe-direction
// failure: the audio is discarded and the old chain runs.
function normalizeForCompare(s: string): string {
  return s.replace(/[ْ-ٖـ\s\p{P}]/gu, "");
}

function realtimePersona(voice: "male" | "female"): string {
  return voice === "female"
    ? "An extremely human, warm, gentle female voice, like a kind Quran teacher sitting right beside you: natural pace, clear Arabic pronunciation, soft pauses and real breathing between phrases, calm and reverent tone, alive and expressive with genuine warmth and feeling in every phrase — never flat, never rushed, never robotic, never like an announcement."
    : "An extremely human, dignified, warm male voice, like a respected Quran teacher speaking to a student face to face: unhurried and natural, with real pauses and breathing between phrases, clear Arabic pronunciation, calm and reverent tone, gentle variation in pace and emotion, alive and conversational with genuine human warmth — never rushed, never monotone, never like a news announcer or a robot.";
}

const REALTIME_VERBATIM =
  "Repeat the user's message aloud, exactly as written, word for word, in Arabic. Do not add, remove, or change any word, do not add greetings, explanations, or any other speech, and do not paraphrase. Speak only the message text itself, with natural pauses and breathing.";

function realtimeCostFromUsage(usage: any): number | null {
  try {
    const inD = usage?.input_token_details;
    const outD = usage?.output_token_details;
    if (!inD || !outD) return null;
    const textIn = Number(inD.text_tokens) || 0;
    const audioIn = Number(inD.audio_tokens) || 0;
    const textOut = Number(outD.text_tokens) || 0;
    const audioOut = Number(outD.audio_tokens) || 0;
    // gpt-realtime-2.1-mini: text in $0.60, audio in $10, text out
    // $2.40, audio out $20 per 1M tokens.
    return (textIn * 0.6 + audioIn * 10 + textOut * 2.4 + audioOut * 20) / 1_000_000;
  } catch {
    return null;
  }
}

// One-shot Realtime speech. Resolves only with verified audio: if the
// model's spoken transcript differs from the input, it throws and the
// caller falls back to the old Speech chain. Deno's WebSocket has no
// custom headers, so auth travels via the documented subprotocols.
async function generateViaRealtime(
  text: string,
  voice: "male" | "female",
  apiKey: string,
  speedOverride?: number,
): Promise<{ wav: ArrayBuffer; costUsd: number | null }> {
  const voiceName = REALTIME_VOICES[voice] || REALTIME_VOICES.male;
  // Realtime speed is post-processing, range 0.25-1.5 (old chain
  // allowed 0.25-4.0): clamp, never reject a caller speed here.
  const rawSpeed = speedOverride ?? (voice === "male" ? 1.15 : 1.0);
  const speed = Math.min(1.5, Math.max(0.25, rawSpeed));

  return await new Promise((resolve, reject) => {
    let finished = false;
    let phase: "session" | "response" | "streaming" = "session";
    let speedRetried = false;
    const pcmChunks: Uint8Array[] = [];
    let pcmLen = 0;
    const transcriptParts: string[] = [];
    let transcriptDone: string | null = null;

    const ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`,
      ["realtime", `openai-insecure-api-key.${apiKey}`],
    );

    const fail = (msg: string) => {
      if (finished) return;
      finished = true;
      try { ws.close(); } catch { /* already closed */ }
      reject(new Error(msg));
    };

    const timer = setTimeout(() => fail("Realtime timed out (60s)"), 60_000);

    const sendResponseCreate = (withSpeed: boolean) => {
      const response: Record<string, unknown> = {
        output_modalities: ["audio"],
        instructions: REALTIME_VERBATIM,
      };
      if (withSpeed) response.output = { speed };
      ws.send(JSON.stringify({ type: "response.create", response }));
    };

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          output_modalities: ["audio"],
          audio: {
            input: { format: { type: "audio/pcm", rate: 24000 } },
            output: { format: { type: "audio/pcm", rate: 24000 }, voice: voiceName },
          },
          instructions: realtimePersona(voice),
        },
      }));
    });

    ws.addEventListener("message", (ev) => {
      if (finished) return;
      const data = typeof ev.data === "string" ? ev.data : null;
      if (!data) return;
      let msg: any;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      const t = msg.type as string;
      if (t === "session.updated") {
        phase = "response";
        ws.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text }],
          },
        }));
        sendResponseCreate(true);
      } else if (t === "response.output_audio.delta" || t === "response.audio.delta") {
        phase = "streaming";
        if (typeof msg.delta === "string" && msg.delta) {
          const bytes = b64ToBytes(msg.delta);
          pcmChunks.push(bytes);
          pcmLen += bytes.length;
        }
      } else if (t === "response.output_audio_transcript.delta" || t === "response.audio_transcript.delta") {
        if (typeof msg.delta === "string") transcriptParts.push(msg.delta);
      } else if (t === "response.output_audio_transcript.done" || t === "response.audio_transcript.done") {
        if (typeof msg.transcript === "string") transcriptDone = msg.transcript;
      } else if (t === "response.done" || t === "response.completed") {
        finished = true;
        clearTimeout(timer);
        try { ws.close(); } catch { /* ignore */ }
        if (pcmLen === 0) {
          reject(new Error("Realtime returned no audio"));
          return;
        }
        const transcript = transcriptDone ?? transcriptParts.join("");
        if (transcript && normalizeForCompare(transcript) !== normalizeForCompare(text)) {
          // Spoken words differ from the requested text: discard.
          // Lengths only in the log — never the texts themselves.
          console.warn(
            `realtime transcript mismatch: input ${text.length} chars, spoken ${transcript.length} chars`,
          );
          reject(new Error("realtime transcript mismatch"));
          return;
        }
        const pcm = new Uint8Array(pcmLen);
        let off = 0;
        for (const c of pcmChunks) {
          pcm.set(c, off);
          off += c.length;
        }
        resolve({ wav: pcm16ToWav(pcm), costUsd: realtimeCostFromUsage(msg.response?.usage) });
      } else if (t === "error") {
        const detail = msg.error?.message || msg.error?.code || "unknown realtime error";
        // A response.create rejected before any audio (e.g. the
        // output/speed field unsupported): retry once without it.
        // Session-phase or mid-stream errors fail straight through
        // to the old chain.
        if (phase === "response" && !speedRetried) {
          speedRetried = true;
          try {
            sendResponseCreate(false);
            return;
          } catch {
            // fall through to fail
          }
        }
        fail(`Realtime error: ${detail}`);
      }
    });

    ws.addEventListener("error", () => {
      if (!finished) fail("Realtime websocket error");
    });
    ws.addEventListener("close", () => {
      if (!finished) fail("Realtime connection closed before response.done");
    });
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Corr lock state lives OUTSIDE the try so the catch below can release
  // a held lock on any failure path (v14 catch-release).
  let corrKey: string | null = null;
  let corrLockHeld = false;
  // Tafsir lock state (v15): same catch-release rule as corr.
  let tafsirKey: string | null = null;
  let tafsirLockHeld = false;
  // Dialogue lock state (v16): same catch-release rule; the lock
  // key is dialogue_<surah>-<ayah>, claimed via the tafsir lock
  // helpers under tafsir/locks/.
  let dialogueKey: string | null = null;
  let dialogueLockHeld = false;
  let supabaseClient: any = null;

  try {
    // 1. AUTH FIRST (lockdown 2026-10-29): only a real logged-in user
    // session may generate. The project's public anon key is NOT
    // enough: auth.getUser() with the anon key returns no user, so
    // it is rejected here. Never accept a token that is not a real
    // user session.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "تسجيل الدخول مطلوب لتوليد الصوت" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const authToken = authHeader.slice("Bearer ".length).trim();
    const authUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!authToken || !authUrl || !anonKey) {
      // Fail closed: without a token or the env to verify it, nobody
      // generates.
      return new Response(
        JSON.stringify({ error: "تسجيل الدخول مطلوب لتوليد الصوت" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const authClient = createClient(authUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${authToken}` } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "تسجيل الدخول مطلوب لتوليد الصوت" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = user.id;

    const body = await req.json();
    const voice = body.voice;
    // Position-keyed correction mode (v12): the client sends a
    // Quran position + prompt shape + the spoken text it built.
    // Light validation happens here; the full rebuild-and-compare
    // verification runs below, after the service client exists.
    // Free-text mode (no mode field) is unchanged: admin link
    // generation keeps sending {text, voice} exactly as before.
    const isCorrMode = body.mode === "corr";
    // Tafsir mode (v15): the client sends a Quran position + voice
    // only — NO text. The server fetches the Al-Muyassar text
    // itself below, so the caller cannot inject arbitrary text.
    const isTafsirMode = body.mode === "tafsir";
    let tafsirSurah: number | null = null;
    let tafsirAyah: number | null = null;
    if (isTafsirMode) {
      if (voice !== "male" && voice !== "female") {
        return new Response(
          JSON.stringify({ error: "صوت التفسير غير صالح" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!Number.isInteger(body.surah) || body.surah < 1 || body.surah > 114) {
        return new Response(
          JSON.stringify({ error: "موضع التفسير غير صالح" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!Number.isInteger(body.ayah) || body.ayah < 1 || body.ayah > 286) {
        return new Response(
          JSON.stringify({ error: "موضع التفسير غير صالح" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      tafsirSurah = body.surah;
      tafsirAyah = body.ayah;
    }
    // Dialogue mode (v16): the client sends a Quran position only —
    // NO text and NO voice (hosts are fixed: Host 1 = cedar/male,
    // Host 2 = marin/female). Same surah/ayah bounds as tafsir.
    const isDialogueMode = body.mode === "dialogue";
    let dialogueSurah: number | null = null;
    let dialogueAyah: number | null = null;
    if (isDialogueMode) {
      if (!Number.isInteger(body.surah) || body.surah < 1 || body.surah > 114) {
        return new Response(
          JSON.stringify({ error: "موضع الحوار غير صالح" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!Number.isInteger(body.ayah) || body.ayah < 1 || body.ayah > 286) {
        return new Response(
          JSON.stringify({ error: "موضع الحوار غير صالح" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      dialogueSurah = body.surah;
      dialogueAyah = body.ayah;
    }
    let corrPositions: { id: number; w: number }[] | null = null;
    let corrShape: "context" | "bare" | null = null;
    let corrSpoken: string | null = null;
    let text: string | null = null;
    if (isCorrMode) {
      if (body.shape !== "context" && body.shape !== "bare") {
        return new Response(
          JSON.stringify({ error: "شكل التصحيح غير صالح" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (typeof body.spoken !== "string" || !body.spoken || body.spoken.length > 2000) {
        return new Response(
          JSON.stringify({ error: "النص مطلوب" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!Array.isArray(body.positions) || body.positions.length === 0 || body.positions.length > 100) {
        return new Response(
          JSON.stringify({ error: "موضع التصحيح غير صالح" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      for (const p of body.positions) {
        if (!p || !Number.isInteger(p.id) || p.id <= 0 || !Number.isInteger(p.w) || p.w < 0) {
          return new Response(
            JSON.stringify({ error: "موضع التصحيح غير صالح" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      corrPositions = body.positions;
      corrShape = body.shape;
      corrSpoken = body.spoken;
    } else if (!isTafsirMode && !isDialogueMode) {
      if (!body.text || typeof body.text !== "string") {
        return new Response(
          JSON.stringify({ error: "النص مطلوب" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // 2. TEXT CAP: one call may not carry more than 2000 characters.
      if (body.text.length > 2000) {
        return new Response(
          JSON.stringify({ error: "النص أطول من الحد المسموح (2000 حرف)" }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      text = body.text;
    }
    // Optional caller speed (0.25-4.0, OpenAI's range). Invalid or
    // absent values keep the per-voice defaults, so older callers
    // (admin/link generation) behave exactly as before. On the
    // Realtime path the speed is clamped to its 0.25-1.5 range.
    const speedOverride = typeof body.speed === "number" && body.speed >= 0.25 && body.speed <= 4 ? body.speed : undefined;
    // v13 playback-rate contract: a caller that sends
    // rateMode:'playback' gets a neutral-speed file (1.0 on OpenAI
    // paths) and applies its own rate at play time via
    // audio.playbackRate. Callers WITHOUT the flag keep baked-speed
    // behavior exactly as before. Azure ignores speed entirely
    // (fixed -10% prosody), so this only affects OpenAI paths.
    const playbackMode = body.rateMode === "playback";
    const effectiveSpeed = playbackMode ? 1.0 : speedOverride;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("VITE_SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const azureKey = Deno.env.get("AZURE_SPEECH_KEY");
    const azureRegion = Deno.env.get("AZURE_SPEECH_REGION") || "eastus";
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    if (!azureKey && !openaiKey) {
      return new Response(
        JSON.stringify({
          error: "استخدم زر التشغيل بالمتصفح — لم يتم تكوين خدمة الصوت الصناعي بعد.",
          browserFallback: true,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Dialogue (v16) REQUIRES the OpenAI Realtime path (cedar/marin
    // are the two distinct hosts): Azure alone cannot serve it, so
    // an Azure-only deployment gets a 503 here and the client falls
    // back to the natural recording. Checked before any spend, lock,
    // or cap consumption.
    if (isDialogueMode && !openaiKey) {
      return new Response(
        JSON.stringify({
          error: "الحوار غير متاح — لم يتم تكوين خدمة الصوت الصناعي بعد.",
          browserFallback: true,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service-role client (storage upload + usage log + rate-limit
    // counts). Created here, before generation, so the rate-limit
    // checks below can use it; reused for the upload afterwards.
    // Assigned (not declared) here so the outer catch can use it for
    // the v14 lock release.
    supabaseClient = createClient(supabaseUrl!, serviceRoleKey!);

    // Position-mode verification (v12): rebuild the spoken text
    // from the seeded quran_verses rows and reject ANY mismatch.
    // Lengths only in the log — never the texts. Runs BEFORE the
    // cap checks, so a rejected forgery never consumes budget.
    // A rejection degrades the client to browser voice (its
    // requestCorrectionAudio treats non-ok as null) — never a
    // user-visible error dialog.
    if (isCorrMode) {
      const ids = [...new Set(corrPositions!.map((p) => p.id))];
      const { data: verseRows, error: verseError } = await supabaseClient
        .from("quran_verses")
        .select("id, ayah_text")
        .in("id", ids);
      if (verseError) {
        throw new Error("تعذر التحقق من موضع التصحيح");
      }
      const ayahTexts = new Map<number, string>();
      for (const r of verseRows ?? []) ayahTexts.set(r.id, r.ayah_text);
      const built = buildCorrSpokenText(ayahTexts, corrPositions!, corrShape!);
      if (built === null || built !== corrSpoken) {
        console.warn(
          `corr position mismatch: built ${built === null ? "null" : built.length + " chars"}, got ${corrSpoken!.length} chars`,
        );
        return new Response(
          JSON.stringify({ error: "تعذر التحقق من موضع التصحيح" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      text = built;
    }
    // Tafsir mode (v15): fetch the Al-Muyassar text server-side
    // from the same free AlQuranCloud endpoint the Mushaf popup
    // uses (no key). A fetch failure or an over-long entry is a
    // client fallback to the natural recording, never a hang: the
    // 4xx/5xx here surfaces as a null URL on the client.
    if (isTafsirMode) {
      let tafsirText: unknown = null;
      try {
        const tRes = await fetch(
          `https://api.alquran.cloud/v1/ayah/${tafsirSurah}:${tafsirAyah}/ar.muyassar`,
        );
        if (!tRes.ok) {
          return new Response(
            JSON.stringify({ error: "تعذر تحميل نص التفسير" }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const tJson: any = await tRes.json().catch(() => null);
        tafsirText = tJson?.data?.text;
      } catch {
        return new Response(
          JSON.stringify({ error: "تعذر تحميل نص التفسير" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (typeof tafsirText !== "string" || !tafsirText) {
        return new Response(
          JSON.stringify({ error: "تعذر تحميل نص التفسير" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // The 2000-char free-text cap does not apply: this text comes
      // from a trusted source, not the caller. The 8000-char bound
      // only guards against a pathological upstream entry.
      if (tafsirText.length > TAFSIR_TEXT_MAX_CHARS) {
        return new Response(
          JSON.stringify({ error: "نص التفسير أطول من الحد المسموح" }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      text = tafsirText;
    }
    // Dialogue mode (v16): fetch the Al-Muyassar text server-side
    // from the same free AlQuranCloud endpoint as tafsir mode (no
    // key). This block intentionally mirrors the tafsir fetch above
    // instead of refactoring it, so the tafsir code path is left
    // byte-for-byte untouched. Same failure contract: 502 on a fetch
    // failure, 413 over 8000 chars — the client falls back to the
    // natural recording in both cases.
    if (isDialogueMode) {
      let dialogueText: unknown = null;
      try {
        const dRes = await fetch(
          `https://api.alquran.cloud/v1/ayah/${dialogueSurah}:${dialogueAyah}/ar.muyassar`,
        );
        if (!dRes.ok) {
          return new Response(
            JSON.stringify({ error: "تعذر تحميل نص التفسير" }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const dJson: any = await dRes.json().catch(() => null);
        dialogueText = dJson?.data?.text;
      } catch {
        return new Response(
          JSON.stringify({ error: "تعذر تحميل نص التفسير" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (typeof dialogueText !== "string" || !dialogueText) {
        return new Response(
          JSON.stringify({ error: "تعذر تحميل نص التفسير" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (dialogueText.length > TAFSIR_TEXT_MAX_CHARS) {
        return new Response(
          JSON.stringify({ error: "نص التفسير أطول من الحد المسموح" }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      text = dialogueText;
    }
    if (!text) {
      throw new Error("النص مطلوب");
    }

    // v13 shared server cache (corr mode only; free-text mode is
    // unchanged and never cached — admin link audio stays unique).
    // A HIT returns BEFORE any cap check: cached audio costs
    // nothing, so caps must not gate it. The hit row uses a
    // DISTINCT function_name, so cap queries (which filter
    // function_name='generate-voice' exactly) exclude it by
    // construction; user_id is NULL (no user linkage) and the
    // logical key rides in the model field for the Phase 3 gate
    // query. Lengths only — no text is ever logged.
    if (isCorrMode) {
      const primaryEngine = azureKey ? "azure" : "realtime";
      corrKey = corrLogicalKey(voice, corrShape!, corrPositions!, primaryEngine);
      const cachedUrl = await findCorrCachedUrl(supabaseClient, corrKey, primaryEngine);
      if (cachedUrl) {
        try {
          await supabaseClient.from("ai_usage_events").insert({
            function_name: "generate-voice-cache-hit",
            model: `cache-hit:${corrKey}`,
            cost_usd: 0,
            user_id: null,
            provider: "cache",
            chars: text.length,
          });
        } catch { /* telemetry must never break a hit */ }
        return new Response(
          JSON.stringify({ audioUrl: cachedUrl, voice }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // v15 shared server cache (tafsir mode only): same before-caps
    // rule as corr — a hit costs nothing, so caps must not gate it,
    // and the hit row uses the DISTINCT function_name, so cap
    // queries exclude it by construction. Lengths only — no text is
    // ever logged.
    if (isTafsirMode) {
      const primaryEngine = azureKey ? "azure" : "realtime";
      tafsirKey = tafsirCacheKey(voice, tafsirSurah!, tafsirAyah!);
      const cachedUrl = await findTafsirCachedUrl(supabaseClient, voice, tafsirSurah!, tafsirAyah!, primaryEngine);
      if (cachedUrl) {
        try {
          await supabaseClient.from("ai_usage_events").insert({
            function_name: "generate-voice-cache-hit",
            model: `cache-hit:${tafsirKey}`,
            cost_usd: 0,
            user_id: null,
            provider: "cache",
            chars: text.length,
          });
        } catch { /* telemetry must never break a hit */ }
        return new Response(
          JSON.stringify({ audioUrl: cachedUrl, voice }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // v16 shared server cache (dialogue mode only): same before-caps
    // rule as corr/tafsir — a hit costs nothing, so caps must not
    // gate it, and the hit row uses the DISTINCT function_name, so
    // cap queries exclude it by construction. BOTH host files must
    // exist; a single file is a miss and both are regenerated.
    // Lengths only — no text is ever logged.
    if (isDialogueMode) {
      dialogueKey = dialogueCacheKey(dialogueSurah!, dialogueAyah!);
      const cached = await findDialogueCachedUrls(
        supabaseClient,
        dialogueSurah!,
        dialogueAyah!,
        DIALOGUE_PRIMARY_ENGINE,
      );
      if (cached) {
        try {
          await supabaseClient.from("ai_usage_events").insert({
            function_name: "generate-voice-cache-hit",
            model: `cache-hit:${dialogueKey}`,
            cost_usd: 0,
            user_id: null,
            provider: "cache",
            chars: text.length,
          });
        } catch { /* telemetry must never break a hit */ }
        return new Response(
          JSON.stringify({ host1Url: cached.host1Url, host2Url: cached.host2Url }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // 3. PER-USER RATE LIMITS, checked before any generation spend:
    // 30 calls/minute and 500 calls/day per authenticated user.
    // NOTE (check-then-log race): rows are logged only after a
    // generation completes, so concurrent bursts may slightly
    // overshoot the caps before their rows land. The day cap bounds
    // total exposure. Accepted: no reservation system.
    const nowMs = Date.now();
    const minuteAgo = new Date(nowMs - 60_000).toISOString();
    const dayAgo = new Date(nowMs - 24 * 60 * 60_000).toISOString();
    const { count: minuteCount, error: minuteError } = await supabaseClient
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("function_name", "generate-voice")
      .eq("user_id", userId)
      .gt("created_at", minuteAgo);
    if (minuteError) {
      throw new Error("تعذر التحقق من حد الاستخدام");
    }
    if ((minuteCount ?? 0) >= 30) {
      return new Response(
        JSON.stringify({ error: "تم تجاوز حد توليد الصوت المسموح في الدقيقة — حاول بعد قليل" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { count: dayCount, error: dayError } = await supabaseClient
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("function_name", "generate-voice")
      .eq("user_id", userId)
      .gt("created_at", dayAgo);
    if (dayError) {
      throw new Error("تعذر التحقق من حد الاستخدام");
    }
    if ((dayCount ?? 0) >= 500) {
      return new Response(
        JSON.stringify({ error: "تم تجاوز حد توليد الصوت المسموح لليوم" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. GLOBAL CAPS (v11), checked before any generation spend:
    // 1000 calls/day + $1.00/day logged OpenAI spend, all users.
    // SUM ignores nulls, so Azure rows (cost_usd null) never count
    // toward the spend sum — the calls cap bounds Azure volume.
    const { count: globalCount, error: globalError } = await supabaseClient
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("function_name", "generate-voice")
      .gt("created_at", dayAgo);
    if (globalError) {
      throw new Error("تعذر التحقق من حد الاستخدام");
    }
    if ((globalCount ?? 0) >= GLOBAL_CALLS_PER_DAY) {
      return new Response(
        JSON.stringify({ error: "تم الوصول للحد اليومي العام لتوليد الصوت — حاول غدًا" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { data: spendRows, error: spendError } = await supabaseClient
      .from("ai_usage_events")
      .select("cost_usd")
      .eq("function_name", "generate-voice")
      .gt("created_at", dayAgo)
      .limit(10000);
    if (spendError) {
      throw new Error("تعذر التحقق من حد الاستخدام");
    }
    const globalSpend = (spendRows ?? []).reduce(
      (sum: number, r: any) => sum + (typeof r.cost_usd === "number" ? r.cost_usd : 0),
      0,
    );
    if (globalSpend >= GLOBAL_SPEND_PER_DAY_USD) {
      return new Response(
        JSON.stringify({ error: "تم الوصول لحد الإنفاق اليومي العام لتوليد الصوت — حاول غدًا" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // v13 atomic reservation (corr mode only, claimed AFTER the cap
    // checks so a capped caller can never squat a lock): at most
    // one generation per key. A waiter gets HTTP 202 with no
    // audioUrl; the client treats that as null (browser voice, no
    // dialog) and the next occurrence hits the cache. A leaked lock
    // (crashed winner) expires via the 90s TTL in tryClaimCorrLock
    // (and is released in the catch below on any failure).
    if (isCorrMode && corrKey) {
      const claim = await tryClaimCorrLock(supabaseClient, corrKey);
      if (claim === "locked") {
        return new Response(
          JSON.stringify({ pending: true }),
          { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      corrLockHeld = true;
    }

    // v15 atomic reservation (tafsir mode only, claimed AFTER the
    // cap checks like corr): at most one generation per key. A
    // waiter gets HTTP 202 with no audioUrl; the client treats that
    // as null and falls back to the natural recording, and the next
    // occurrence hits the cache.
    if (isTafsirMode && tafsirKey) {
      const claim = await tryClaimTafsirLock(supabaseClient, tafsirKey);
      if (claim === "locked") {
        return new Response(
          JSON.stringify({ pending: true }),
          { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      tafsirLockHeld = true;
    }

    // v16 atomic reservation (dialogue mode only, claimed AFTER the
    // cap checks like corr/tafsir, reusing the tafsir lock helpers
    // under tafsir/locks/ with key dialogue_<surah>-<ayah>): at most
    // one dialogue generation per key. A waiter gets HTTP 202; the
    // client treats that as null and falls back to the natural
    // recording, and the next occurrence hits the cache.
    if (isDialogueMode && dialogueKey) {
      const claim = await tryClaimTafsirLock(supabaseClient, dialogueKey);
      if (claim === "locked") {
        return new Response(
          JSON.stringify({ pending: true }),
          { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      dialogueLockHeld = true;
    }

    // ---- Dialogue generation (v16): self-contained early-return
    // branch. Runs AFTER the shared cap checks and the lock claim,
    // like the tafsir generation below, and returns before the
    // single-audio path — the single-audio path is untouched.
    // Order: cheap LLM script -> Realtime both hosts (speed 1.0) ->
    // upload both -> ONE usage row with the TOTAL cost. A script
    // failure is a direct 502 (lock released first); a Realtime
    // throw propagates to the outer catch (500, lock released
    // there). Either way the client falls back to the natural clip
    // alone — never one host alone.
    if (isDialogueMode) {
      let lines: { host1: string; host2: string; costUsd: number };
      try {
        lines = await writeDialogueLines(text, openaiKey!);
      } catch (scriptErr) {
        console.warn(
          `dialogue script failed for ${dialogueSurah}:${dialogueAyah}: ${String((scriptErr as Error)?.message || scriptErr).slice(0, 200)}`,
        );
        if (dialogueLockHeld) {
          await releaseTafsirLock(supabaseClient, dialogueKey!);
          dialogueLockHeld = false;
        }
        return new Response(
          JSON.stringify({ error: "تعذر كتابة حوار التفسير" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const host1Audio = await generateViaRealtime(lines.host1, "male", openaiKey!, 1.0);
      const host2Audio = await generateViaRealtime(lines.host2, "female", openaiKey!, 1.0);

      // Upload guard (same 1000-byte bound as the shared caches):
      // never cache an empty/truncated clip as immutable. A throw
      // goes to the outer catch (500, lock released there).
      if (
        host1Audio.wav.byteLength < CORR_MIN_AUDIO_BYTES ||
        host2Audio.wav.byteLength < CORR_MIN_AUDIO_BYTES
      ) {
        throw new Error("صوت الحوار المولّد أصغر من الحد الأدنى — لم يُحفظ في الذاكرة المشتركة");
      }

      const host1File = dialogueCacheFileName(dialogueSurah!, dialogueAyah!, "host1", DIALOGUE_PRIMARY_ENGINE);
      const host2File = dialogueCacheFileName(dialogueSurah!, dialogueAyah!, "host2", DIALOGUE_PRIMARY_ENGINE);
      const upload1 = await supabaseClient.storage.from("rana-audio").upload(
        host1File,
        new Blob([host1Audio.wav], { type: "audio/wav" }),
        { contentType: "audio/wav", upsert: false, cacheControl: "public, max-age=31536000, immutable" },
      );
      const upload2 = await supabaseClient.storage.from("rana-audio").upload(
        host2File,
        new Blob([host2Audio.wav], { type: "audio/wav" }),
        { contentType: "audio/wav", upsert: false, cacheControl: "public, max-age=31536000, immutable" },
      );
      if (upload1.error || upload2.error) {
        const raced = [upload1.error, upload2.error].some(
          (e) => e && e.message && e.message.includes("already exists"),
        );
        if (raced) {
          // Lost a race to another winner for the same key: if both
          // files are now present, serve them as a cache hit. If the
          // winner has not finished its second upload yet, tell the
          // client to retry later (202) rather than serve a half
          // dialogue.
          const racedUrls = await findDialogueCachedUrls(
            supabaseClient,
            dialogueSurah!,
            dialogueAyah!,
            DIALOGUE_PRIMARY_ENGINE,
          );
          if (dialogueLockHeld) {
            await releaseTafsirLock(supabaseClient, dialogueKey!);
            dialogueLockHeld = false;
          }
          if (racedUrls) {
            try {
              await supabaseClient.from("ai_usage_events").insert({
                function_name: "generate-voice-cache-hit",
                model: `cache-hit:${dialogueKey}`,
                cost_usd: 0,
                user_id: null,
                provider: "cache",
                chars: text.length,
              });
            } catch { /* telemetry must never break a hit */ }
            return new Response(
              JSON.stringify({ host1Url: racedUrls.host1Url, host2Url: racedUrls.host2Url }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({ pending: true }),
            { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        throw new Error(
          "فشل رفع صوت الحوار: " + (upload1.error?.message ?? upload2.error?.message ?? ""),
        );
      }

      const host1Url = supabaseClient.storage.from("rana-audio").getPublicUrl(host1File).data.publicUrl;
      const host2Url = supabaseClient.storage.from("rana-audio").getPublicUrl(host2File).data.publicUrl;

      // ONE usage row for the whole dialogue (one call against the
      // per-user/global CALLS caps); cost_usd is the TOTAL spend
      // (LLM script + both Realtime generations). A null Realtime
      // cost (usage unreported) contributes 0 rather than voiding
      // the row — the LLM cost is always a number.
      const dialogueCost = lines.costUsd +
        (host1Audio.costUsd ?? 0) + (host2Audio.costUsd ?? 0);
      try {
        await supabaseClient.from("ai_usage_events").insert({
          function_name: "generate-voice",
          model: `${DIALOGUE_MODEL}+${REALTIME_MODEL}`,
          cost_usd: dialogueCost,
          user_id: userId,
          provider: "realtime",
          chars: text.length,
        });
      } catch { /* ignore logging errors */ }

      if (dialogueLockHeld) {
        await releaseTafsirLock(supabaseClient, dialogueKey!);
        dialogueLockHeld = false;
      }
      return new Response(
        JSON.stringify({ host1Url, host2Url }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let audioBuffer: ArrayBuffer;
    let ttsModel = "azure";
    let ttsProvider = "azure";
    let ttsCost: number | null = null;
    let audioMime = "audio/mp3";
    let audioExt = "mp3";
    // v13: only PRIMARY-engine audio may enter the shared cache.
    // Fallback-engine (old Speech chain) audio keeps a unique name
    // and is never cached — onyx/nova must never poison a
    // cedar/marin key.
    let corrCacheable = false;
    let corrEngine = "";

    if (azureKey) {
      audioBuffer = await generateAzureTTS(text, voice || "male", azureKey, azureRegion);
      corrCacheable = true;
      corrEngine = "azure";
    } else {
      // v10: Realtime first; the old Speech chain is the fallback.
      try {
        const rt = await generateViaRealtime(text, voice || "male", openaiKey!, effectiveSpeed);
        audioBuffer = rt.wav;
        ttsModel = REALTIME_MODEL;
        ttsProvider = "realtime";
        ttsCost = rt.costUsd;
        audioMime = "audio/wav";
        audioExt = "wav";
        corrCacheable = true;
        corrEngine = "realtime";
      } catch (rtErr) {
        console.warn("realtime failed, falling back to speech api:", String((rtErr as Error)?.message || rtErr).slice(0, 200));
        const result = await generateOpenAITTS(text, voice || "male", openaiKey!, effectiveSpeed);
        audioBuffer = result.buffer;
        ttsModel = result.model;
        ttsProvider = "openai";
        // gpt-4o-mini-tts ≈ $0.015/min at ~1000 chars/min; tts-1-hd $0.030/1k chars.
        ttsCost = ttsModel === "gpt-4o-mini-tts"
          ? (text.length / 1000) * 0.015
          : (text.length / 1000) * 0.030;
      }
    }

    const audioBlob = new Blob([audioBuffer], { type: audioMime });
    // v13: a corr-mode primary-engine win goes to its deterministic
    // shared-cache name (upsert:false — the winner wins; a loser
    // whose upload collides takes the winner's file as a hit
    // below). Fallback-engine and free-text audio keep unique
    // names and are never shared-cache entries. v15: a tafsir-mode
    // primary-engine win goes to its own deterministic shared-cache
    // name under tafsir/<voice>/, by the same rule.
    const isSharedCacheWrite =
      (isCorrMode && corrKey !== null && corrCacheable) ||
      (isTafsirMode && tafsirKey !== null && corrCacheable);
    const fileName =
      isSharedCacheWrite && isTafsirMode
        ? tafsirCacheFileName(voice, tafsirSurah!, tafsirAyah!, corrEngine)
        : isSharedCacheWrite
          ? corrCacheFileName(corrKey!, corrEngine)
          : `synthetic-${Date.now()}.${audioExt}`;

    // v14 upload guard: never cache an empty/truncated clip as immutable.
    // A failed guard throws to the outer catch (lock released there).
    if (isSharedCacheWrite && audioBuffer.byteLength < CORR_MIN_AUDIO_BYTES) {
      throw new Error("الصوت المولّد أصغر من الحد الأدنى — لم يُحفظ في الذاكرة المشتركة");
    }

    const { error: uploadError } = await supabaseClient.storage
      .from("rana-audio")
      .upload(fileName, audioBlob, {
        contentType: audioMime,
        upsert: false,
        ...(isSharedCacheWrite ? { cacheControl: "public, max-age=31536000, immutable" } : {}),
      });

    if (uploadError) {
      // Lost a race to another winner for the same key: the file is
      // ready — serve it as a cache hit (not a generation row).
      // The generation cost here is already spent and unavoidable
      // in this rare race; the lock keeps it rare.
      if (isSharedCacheWrite && uploadError.message && uploadError.message.includes("already exists")) {
        const { data: urlData } = supabaseClient.storage
          .from("rana-audio")
          .getPublicUrl(fileName);
        try {
          await supabaseClient.from("ai_usage_events").insert({
            function_name: "generate-voice-cache-hit",
            model: `cache-hit:${corrKey ?? tafsirKey}`,
            cost_usd: 0,
            user_id: null,
            provider: "cache",
            chars: text.length,
          });
        } catch { /* telemetry must never break a hit */ }
        if (corrLockHeld) await releaseCorrLock(supabaseClient, corrKey!);
        if (tafsirLockHeld) await releaseTafsirLock(supabaseClient, tafsirKey!);
        return new Response(
          JSON.stringify({ audioUrl: urlData.publicUrl, voice }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw new Error("فشل رفع الصوت: " + uploadError.message);
    }

    const { data: urlData } = supabaseClient.storage
      .from("rana-audio")
      .getPublicUrl(fileName);

    // 5. Best-effort usage log for the Admin balance monitor, ALL
    // paths (previously OpenAI only; Azure billing is separate, so
    // its cost is logged as null; Realtime cost comes from the
    // response usage when the API reports it, else null). Wrapped
    // so logging can never break the response. No text or audio
    // content is ever logged.
    try {
      await supabaseClient.from("ai_usage_events").insert({
        function_name: "generate-voice",
        model: ttsModel,
        cost_usd: ttsCost,
        user_id: userId,
        provider: ttsProvider,
        chars: text.length,
      });
    } catch { /* ignore logging errors */ }

    // Release the reservation on the success path. On a generation
    // failure the outer catch returns 500 and releases the lock there
    // (v14); the 90s TTL is only the crashed-process backstop.
    if (corrLockHeld) await releaseCorrLock(supabaseClient, corrKey!);
    if (tafsirLockHeld) await releaseTafsirLock(supabaseClient, tafsirKey!);

    return new Response(
      JSON.stringify({ audioUrl: urlData.publicUrl, voice }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    // DIAG HARDENING (2026-11-06, logging only): surface the 500 in the
    // function logs. Previously the outer catch returned err.message
    // with no console.error, so a server-side failure was invisible
    // in the logs. Only the error message is logged — never any
    // transcript, text, or audio content. Response contract unchanged.
    console.error("[generate-voice] outer catch:", err instanceof Error ? err.message : String(err));
    // v14 catch-release: a lock held at failure time (generation or upload
    // threw after claim) is released here. Previously it leaked until the
    // TTL. Best-effort; never masks the original error.
    if (corrLockHeld && corrKey && supabaseClient) {
      try { await releaseCorrLock(supabaseClient, corrKey); } catch { /* ignore */ }
    }
    if (tafsirLockHeld && tafsirKey && supabaseClient) {
      try { await releaseTafsirLock(supabaseClient, tafsirKey); } catch { /* ignore */ }
    }
    if (dialogueLockHeld && dialogueKey && supabaseClient) {
      try { await releaseTafsirLock(supabaseClient, dialogueKey); } catch { /* ignore */ }
    }
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
