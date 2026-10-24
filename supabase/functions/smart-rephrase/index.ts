const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

  try {
    const { text, command, mode } = await req.json();

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
// force redeploy Sun Oct 11 13:28:30 UTC 2026
