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

async function generateOpenAITTS(text: string, voice: "male" | "female", apiKey: string): Promise<ArrayBuffer> {
  const ttsVoice = voice === "female" ? "nova" : "onyx";
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "tts-1-hd", input: text, voice: ttsVoice, response_format: "mp3", speed: 0.9 }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI TTS error: ${response.status} - ${errText}`);
  }

  return response.arrayBuffer();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { text, voice } = await req.json();

    if (!text || typeof text !== "string") {
      return new Response(
        JSON.stringify({ error: "النص مطلوب" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    let audioBuffer: ArrayBuffer;

    if (azureKey) {
      audioBuffer = await generateAzureTTS(text, voice || "male", azureKey, azureRegion);
    } else {
      audioBuffer = await generateOpenAITTS(text, voice || "male", openaiKey!);
    }

    const audioBlob = new Blob([audioBuffer], { type: "audio/mp3" });
    const fileName = `synthetic-${Date.now()}.mp3`;

    const supabaseClient = createClient(supabaseUrl!, serviceRoleKey!);

    const { error: uploadError } = await supabaseClient.storage
      .from("rana-audio")
      .upload(fileName, audioBlob, { contentType: "audio/mp3" });

    if (uploadError) {
      throw new Error("فشل رفع الصوت: " + uploadError.message);
    }

    const { data: urlData } = supabaseClient.storage
      .from("rana-audio")
      .getPublicUrl(fileName);

    // Best-effort usage log for the Admin balance monitor (OpenAI path
    // only; Azure billing is separate and not tracked here).
    // tts-1-hd list price: $0.030 per 1,000 characters.
    if (!azureKey) {
      try {
        await supabaseClient.from("ai_usage_events").insert({
          function_name: "generate-voice", model: "tts-1-hd", cost_usd: (text.length / 1000) * 0.030,
        });
      } catch { /* ignore logging errors */ }
    }

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
