import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Estimated-cost log for the Admin OpenAI balance monitor.
// Best-effort: any failure is swallowed so logging never breaks a response.
async function logUsage(functionName: string, model: string, costUsd: number, userId?: string) {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const client = createClient(url, key);
    await client.from("ai_usage_events").insert({ function_name: functionName, model, cost_usd: costUsd, user_id: userId ?? null });
  } catch { /* ignore logging errors */ }
}

function basicRephrase(text: string, command: string, mode: string): string {
  const fillerWords = [
    "يعني", "اه", "اهه", "ايم", "emm", "كده", "زي كده", "وممكن",
    "ويعني", "هذا", "كذا", "اما", "امم", "مم", "هـ", "هاه",
    "طيب", "يعني كده", "وضوح كده", "ممكن يعني", "هو يعني",
  ];

  if (mode === "keep_original") {
    let result = text;
    for (const word of fillerWords) {
      result = result.replace(new RegExp(`\\b${word}\\b[،.]?\\s*`, "gu"), "");
    }
    result = result
      .replace(/[,]{2,}/gu, "، ")
      .replace(/[.]{2,}/gu, ". ")
      .replace(/\\s+/g, " ")
      .trim();
    return result || text;
  }

  let result = text;

  for (const word of fillerWords) {
    result = result.replace(new RegExp(`\\b${word}\\b[،.]?\\s*`, "gu"), "");
  }

  result = result
    .replace(/\\b(?:الذي|التي)\\b/gu, "اللي")
    .replace(/\\b(?:الذين|اللاتي|اللواتي)\\b/gu, "اللي")
    .replace(/\\b(?:فيما يتعلق ب|بخصوص|فيما يخص)\\b/gu, "عن")
    .replace(/\\b(?:بسبب|نظرا ل)\\b/gu, "لأن")
    .replace(/\\b(?:وعليه|بالتالي|وبناء عليه)\\b/gu, "فـ")
    .replace(/[,]{2,}/gu, "، ")
    .replace(/[.]{2,}/gu, ". ")
    .replace(/\\s+/g, " ")
    .trim();

  const sentences = result.split(/([.،!؟؛])/).filter((s) => s.trim());
  const cleanSentences: string[] = [];
  let current = "";
  for (const part of sentences) {
    current += part;
    if (/[.،!؟؛]/.test(part)) {
      const clean = current.trim();
      if (clean.length > 2) cleanSentences.push(clean);
      current = "";
    }
  }
  if (current.trim().length > 2) cleanSentences.push(current.trim());

  if (command) {
    if (command.includes("أقصر") || command.includes("قصير")) {
      result = cleanSentences.slice(0, Math.max(1, Math.ceil(cleanSentences.length / 2))).join(" ");
    } else if (command.includes("أسهل") || command.includes("بسيط")) {
      result = cleanSentences.join(" ");
    } else if (command.includes("أطول") || command.includes("تفصيل")) {
      result = cleanSentences.map((s) => s.replace(/^[^:]+:/, (m) => m + " ")).join(" ");
    } else {
      result = cleanSentences.join(" ");
    }
  } else {
    result = cleanSentences.join(" ");
  }

  if (result.length > 250) {
    result = cleanSentences.slice(0, Math.max(1, Math.ceil(cleanSentences.length * 0.75))).join(" ");
  }

  return result || text;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  try {
    // v8 (2026-11-20, security): admin-only + daily cap. The function is
    // deployed with verify_jwt=false, so the check is done here: a real
    // user JWT is required (the anon key resolves to no user) and that
    // user must be in admin_users. Without this, anyone could drain the
    // OpenAI balance.
    const authToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!authToken) {
      return new Response(JSON.stringify({ error: "تسجيل الدخول مطلوب" }), { status: 401, headers: jsonHeaders });
    }
    const authClient = createClient(sbUrl, anonKey, { global: { headers: { Authorization: `Bearer ${authToken}` } } });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "تسجيل الدخول مطلوب" }), { status: 401, headers: jsonHeaders });
    }
    const svc = createClient(sbUrl, svcKey);
    const { data: adminRow } = await svc.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) {
      return new Response(JSON.stringify({ error: "هذه الخدمة للمشرفين فقط" }), { status: 403, headers: jsonHeaders });
    }
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count: usedToday } = await svc.from("ai_usage_events").select("id", { count: "exact", head: true })
      .eq("function_name", "smart-rephrase").gte("created_at", since);
    if ((usedToday ?? 0) >= 300) {
      return new Response(JSON.stringify({ error: "تم بلوغ الحد اليومي لإعادة الصياغة" }), { status: 429, headers: jsonHeaders });
    }

    const { text, command, mode } = await req.json();
    if (typeof text === "string" && text.length > 6000) {
      return new Response(JSON.stringify({ error: "النص طويل جدًا" }), { status: 413, headers: jsonHeaders });
    }
    if (command !== undefined && command !== null && (typeof command !== "string" || command.length > 500)) {
      return new Response(JSON.stringify({ error: "الأمر غير صالح" }), { status: 400, headers: jsonHeaders });
    }

    if (!text || typeof text !== "string") {
      return new Response(
        JSON.stringify({ error: "النص مطلوب" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      const rephrased = basicRephrase(text, command || "", mode || "rephrase");
      return new Response(
        JSON.stringify({
          rephrased,
          ai_used: false,
          note: "استخدام المعالجة المحلية: مفتاح الذكاء الاصطناعي غير مكون",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const REPHRASE_PROMPT =
      "أنت خبير في تبسيط لغوي للقرآن الكريم. أعد صياغة النص في عربية واضحة منظمة، كلمات سهلة، جمل قصيرة، مع الحفاظ على المعنى كاملاً.";
    const KEEP_ORIGINAL_PROMPT =
      "نظّف النص من الأخطاء الصوتية وأعد كتابته كما قيل دون تغيير المعنى.";

    let systemPrompt = REPHRASE_PROMPT;
    let userPrompt: string;

    if (mode === "keep_original") {
      systemPrompt = KEEP_ORIGINAL_PROMPT;
      userPrompt = `نظّف هذا النص: ${text}`;
    } else if (command) {
      userPrompt = `أعد صياغة مع تطبيق: "${command}".\n\nالنص: ${text}`;
    } else {
      userPrompt = `أعد صياغة بلغة سهلة:\n\n${text}`;
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      await response.text();
      const fallback = basicRephrase(text, command || "", mode || "rephrase");
      return new Response(
        JSON.stringify({
          rephrased: fallback,
          ai_used: false,
          note: `استخدام المعالجة المحلية: فشل طلب نموذج الذكاء الاصطناعي (رمز ${response.status})`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const rephrased = data.choices?.[0]?.message?.content || basicRephrase(text, command || "", mode || "rephrase");

    // gpt-4o list prices: $2.50/1M input tokens, $10/1M output tokens.
    const usage = data.usage || {};
    await logUsage("smart-rephrase", "gpt-4o",
      (usage.prompt_tokens || 0) * 0.0000025 + (usage.completion_tokens || 0) * 0.00001, user.id);

    return new Response(
      JSON.stringify({ rephrased, ai_used: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
// v8 admin-only + daily cap 2026-11-20
