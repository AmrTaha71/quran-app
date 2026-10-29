import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const AZURE_VOICES: Record<string, { name: string; locale: string }> = {
  male: { name: "ar-SA-Hamed", locale: "ar-SA" },
  female: { name: "ar-SA-Zariyah", locale: "ar-SA" },
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

    const { text, voice, speed: reqSpeed } = await req.json();

    if (!text || typeof text !== "string") {
      return new Response(
        JSON.stringify({ error: "النص مطلوب" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // 2. TEXT CAP: one call may not carry more than 2000 characters.
    if (text.length > 2000) {
      return new Response(
        JSON.stringify({ error: "النص أطول من الحد المسموح (2000 حرف)" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Optional caller speed (0.25-4.0, OpenAI's range). Invalid or
    // absent values keep the per-voice defaults, so older callers
    // (admin/link generation) behave exactly as before.
    const speedOverride = typeof reqSpeed === "number" && reqSpeed >= 0.25 && reqSpeed <= 4 ? reqSpeed : undefined;

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

    let audioBuffer: ArrayBuffer;
    let ttsModel = "azure";

    if (azureKey) {
      audioBuffer = await generateAzureTTS(text, voice || "male", azureKey, azureRegion);
    } else {
      const result = await generateOpenAITTS(text, voice || "male", openaiKey!, speedOverride);
      audioBuffer = result.buffer;
      ttsModel = result.model;
    }

    const audioBlob = new Blob([audioBuffer], { type: "audio/mp3" });
    const fileName = `synthetic-${Date.now()}.mp3`;

    const { error: uploadError } = await supabaseClient.storage
      .from("rana-audio")
      .upload(fileName, audioBlob, { contentType: "audio/mp3" });

    if (uploadError) {
      throw new Error("فشل رفع الصوت: " + uploadError.message);
    }

    const { data: urlData } = supabaseClient.storage
      .from("rana-audio")
      .getPublicUrl(fileName);

    // 4. Best-effort usage log for the Admin balance monitor, BOTH
    // paths (previously OpenAI only; Azure billing is separate, so
    // its cost is logged as null). Wrapped so logging can never
    // break the response.
    // gpt-4o-mini-tts ≈ $0.015/min at ~1000 chars/min; tts-1-hd $0.030/1k chars.
    try {
      const cost = azureKey
        ? null
        : ttsModel === "gpt-4o-mini-tts"
          ? (text.length / 1000) * 0.015
          : (text.length / 1000) * 0.030;
      await supabaseClient.from("ai_usage_events").insert({
        function_name: "generate-voice",
        model: ttsModel,
        cost_usd: cost,
        user_id: userId,
        provider: azureKey ? "azure" : "openai",
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
// force redeploy Sun Oct 11 13:28:30 UTC 2026
