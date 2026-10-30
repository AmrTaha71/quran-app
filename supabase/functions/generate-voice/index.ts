// generate-voice — v12 (2026-10-30, position-keyed correction mode,
// ordered by Amr 2026-10-30 as part of the cost-reduction plan)
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
// Atomicity: same check-then-log race as the per-user caps —
// concurrent in-flight requests can overshoot by a few calls
// (≈cents of spend/day). Accepted; a reservation-row fix remains
// available as hardening if Amr asks for it.
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
    } else {
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

    // Service-role client (storage upload + usage log + rate-limit
    // counts). Created here, before generation, so the rate-limit
    // checks below can use it; reused for the upload afterwards.
    const supabaseClient = createClient(supabaseUrl!, serviceRoleKey!);

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
    if (!text) {
      throw new Error("النص مطلوب");
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

    let audioBuffer: ArrayBuffer;
    let ttsModel = "azure";
    let ttsProvider = "azure";
    let ttsCost: number | null = null;
    let audioMime = "audio/mp3";
    let audioExt = "mp3";

    if (azureKey) {
      audioBuffer = await generateAzureTTS(text, voice || "male", azureKey, azureRegion);
    } else {
      // v10: Realtime first; the old Speech chain is the fallback.
      try {
        const rt = await generateViaRealtime(text, voice || "male", openaiKey!, speedOverride);
        audioBuffer = rt.wav;
        ttsModel = REALTIME_MODEL;
        ttsProvider = "realtime";
        ttsCost = rt.costUsd;
        audioMime = "audio/wav";
        audioExt = "wav";
      } catch (rtErr) {
        console.warn("realtime failed, falling back to speech api:", String((rtErr as Error)?.message || rtErr).slice(0, 200));
        const result = await generateOpenAITTS(text, voice || "male", openaiKey!, speedOverride);
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
    const fileName = `synthetic-${Date.now()}.${audioExt}`;

    const { error: uploadError } = await supabaseClient.storage
      .from("rana-audio")
      .upload(fileName, audioBlob, { contentType: audioMime });

    if (uploadError) {
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

    return new Response(
      JSON.stringify({ audioUrl: urlData.publicUrl, voice }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
