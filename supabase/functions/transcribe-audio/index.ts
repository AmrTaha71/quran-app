import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Estimated-cost log for the Admin OpenAI balance monitor.
// Best-effort: any failure is swallowed so logging never breaks a response.
async function logUsage(functionName: string, model: string, costUsd: number) {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const client = createClient(url, key);
    await client.from("ai_usage_events").insert({ function_name: functionName, model, cost_usd: costUsd });
  } catch { /* ignore logging errors */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { audioUrl, transcript } = await req.json();

    // If the client already transcribed via browser SpeechRecognition, just pass it through
    if (transcript && typeof transcript === "string" && transcript.trim().length > 0) {
      return new Response(
        JSON.stringify({ transcript: transcript.trim() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!audioUrl || typeof audioUrl !== "string") {
      return new Response(
        JSON.stringify({ error: "رابط الملف الصوتي أو النص مطلوب" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "لم يتم تكوين مفتاح OpenAI. استخدم التسجيل المباشر من المتصفح للتحويل الصوتي.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`تعذر تحميل الملف الصوتي: ${audioResponse.status}`);
    }

    const audioBlob = await audioResponse.blob();

    const formData = new FormData();
    // FILENAME BUG FIX (2026-10-27): the old code always named the
    // file audio.webm, even when iOS recorded mp4 bytes — Whisper
    // infers format from the filename, so mp4-in-webm could fail
    // transcription and make "search via recording" look dead on
    // iPhone/iPad while desktop webm worked. Name it by the real
    // uploaded extension instead.
    const urlPath = audioUrl.split("?")[0];
    const rawExt = urlPath.includes(".") ? urlPath.split(".").pop()!.toLowerCase() : "webm";
    const safeExt = ["webm", "mp4", "m4a", "mp3", "wav", "ogg"].includes(rawExt) ? rawExt : "webm";
    formData.append("file", audioBlob, `audio.${safeExt}`);
    formData.append("model", "whisper-1");
    formData.append("language", "ar");
    formData.append("response_format", "verbose_json");

    const whisperResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: formData,
    });

    if (!whisperResponse.ok) {
      const errText = await whisperResponse.text();
      throw new Error(`Whisper API error: ${whisperResponse.status} - ${errText}`);
    }

    const data = await whisperResponse.json();
    const result = data.text || "";

    // Whisper bills per audio minute ($0.006/min): log the duration-based
    // estimate. verbose_json still returns the text field unchanged.
    if (typeof data.duration === "number" && data.duration > 0) {
      await logUsage("transcribe-audio", "whisper-1", (data.duration / 60) * 0.006);
    }

    return new Response(
      JSON.stringify({ transcript: result }),
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
