// transcribe-audio — Whisper transcription of an admin's uploaded clip.
//
// Item 1.3 (phase 1, 2026-11-26) hardening. Before: no auth check, fetch()
// of ANY URL from the body (SSRF, incl. cloud metadata), no size limit, no
// timeout, no retry, no per-user cap, every error a generic 500.
// Now:
//   • a real signed-in user session is required (401 otherwise) — the anon
//     key alone is not a user; verify_jwt = true in config.toml as well;
//   • audioUrl must be a file in THIS project's public rana-audio bucket
//     (403 for any other host/path — closes SSRF);
//   • 10 MB max (Content-Length checked before download, body read capped);
//   • per-user daily cap checked BEFORE Whisper is called;
//   • 60 s timeout on every fetch; one retry on 429/500/502/503 after 2 s;
//   • distinct Arabic messages instead of a raw 500.
// Duration: Whisper bills per minute but the duration is unknown until the
// audio is decoded; the 10 MB cap bounds it (~10 min of 128 kbps audio).
// Caller today: LinkModal.tsx (admin) — it already sends the user JWT.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 2_000;
const RETRY_STATUSES = new Set([429, 500, 502, 503]);
const DAILY_CAP_PER_USER = 60;
const BUCKET_PATH = "/storage/v1/object/public/rana-audio/";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Estimated-cost log for the Admin OpenAI balance monitor.
// Best-effort: any failure is swallowed so logging never breaks a response.
async function logUsage(userId: string, costUsd: number) {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const client = createClient(url, key);
    await client.from("ai_usage_events").insert({
      function_name: "transcribe-audio", model: "whisper-1", provider: "openai",
      cost_usd: costUsd, user_id: userId,
    });
  } catch { /* ignore logging errors */ }
}

async function fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// One retry only, for transient upstream statuses.
async function fetchRetry(input: string, init: () => RequestInit): Promise<Response> {
  const first = await fetchWithTimeout(input, init());
  if (!RETRY_STATUSES.has(first.status)) return first;
  try { await first.body?.cancel(); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  return await fetchWithTimeout(input, init());
}

// Allow-list: only files inside this project's public rana-audio bucket.
function allowedAudioUrl(raw: string, supabaseUrl: string): URL | null {
  let u: URL;
  let base: URL;
  try {
    u = new URL(raw);
    base = new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.origin !== base.origin) return null;
  if (u.username || u.password) return null;
  if (!u.pathname.startsWith(BUCKET_PATH)) return null;
  const rest = decodeURIComponent(u.pathname.slice(BUCKET_PATH.length));
  if (!rest || rest.includes("..") || rest.includes("\\")) return null;
  return u;
}

async function readCapped(res: Response): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(new ArrayBuffer(0));
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    // 1. AUTH FIRST: a real user session, never just the anon key.
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!authHeader.startsWith("Bearer ") || !supabaseUrl || !anonKey) {
      return json({ error: "تسجيل الدخول مطلوب" }, 401);
    }
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return json({ error: "تسجيل الدخول مطلوب" }, 401);

    const body = await req.json().catch(() => ({}));
    const { audioUrl, transcript } = body as { audioUrl?: unknown; transcript?: unknown };

    // Client already transcribed in the browser: just pass it through.
    if (typeof transcript === "string" && transcript.trim().length > 0) {
      return json({ transcript: transcript.trim() });
    }
    if (typeof audioUrl !== "string" || !audioUrl) {
      return json({ error: "رابط الملف الصوتي أو النص مطلوب" }, 400);
    }

    // 2. SSRF guard.
    const safeUrl = allowedAudioUrl(audioUrl, supabaseUrl);
    if (!safeUrl) return json({ error: "رابط الملف الصوتي غير مسموح" }, 403);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return json({
        error: "لم يتم تكوين مفتاح OpenAI. استخدم التسجيل المباشر من المتصفح للتحويل الصوتي.",
      }, 503);
    }

    // 3. Per-user daily cap BEFORE any paid call (fail closed if unreadable).
    if (!serviceKey) return json({ error: "الخدمة غير مهيأة" }, 500);
    const service = createClient(supabaseUrl, serviceKey);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: capErr } = await service
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("function_name", "transcribe-audio")
      .eq("user_id", user.id)
      .gte("created_at", since);
    if (capErr) return json({ error: "الخدمة غير مهيأة" }, 500);
    if ((count ?? 0) >= DAILY_CAP_PER_USER) {
      return json({ error: "وصلت للحد اليومي لتحويل الصوت، حاول بكرة" }, 429);
    }

    // 4. Download (size-capped, timed out, one retry).
    let audioResponse: Response;
    try {
      audioResponse = await fetchRetry(safeUrl.toString(), () => ({}));
    } catch {
      return json({ error: "تعذر تحميل الملف الصوتي (انتهت المهلة)" }, 504);
    }
    if (!audioResponse.ok) {
      return json({ error: `تعذر تحميل الملف الصوتي: ${audioResponse.status}` }, 502);
    }
    const declared = Number(audioResponse.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) {
      try { await audioResponse.body?.cancel(); } catch { /* ignore */ }
      return json({ error: "الملف الصوتي أكبر من 10 ميجا" }, 413);
    }
    const bytes = await readCapped(audioResponse);
    if (!bytes) return json({ error: "الملف الصوتي أكبر من 10 ميجا" }, 413);
    if (bytes.byteLength === 0) return json({ error: "الملف الصوتي فارغ" }, 400);

    // Whisper infers the format from the filename (2026-10-27 iOS mp4 fix).
    const rawExt = safeUrl.pathname.includes(".") ? safeUrl.pathname.split(".").pop()!.toLowerCase() : "webm";
    const safeExt = ["webm", "mp4", "m4a", "mp3", "wav", "ogg"].includes(rawExt) ? rawExt : "webm";
    const audioBlob = new Blob([bytes]);

    // 5. Whisper (timed out, one retry on 429/5xx). FormData is rebuilt per try.
    let whisperResponse: Response;
    try {
      whisperResponse = await fetchRetry("https://api.openai.com/v1/audio/transcriptions", () => {
        const formData = new FormData();
        formData.append("file", audioBlob, `audio.${safeExt}`);
        formData.append("model", "whisper-1");
        formData.append("language", "ar");
        formData.append("temperature", "0");
        formData.append("response_format", "verbose_json");
        return { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: formData };
      });
    } catch {
      return json({ error: "خدمة التحويل لم ترد في الوقت، حاول تاني" }, 504);
    }
    if (whisperResponse.status === 429) {
      return json({ error: "الخدمة مشغولة، حاول بعد دقيقة" }, 429);
    }
    if (!whisperResponse.ok) {
      return json({ error: "تعذر تحويل الصوت لنص الآن، حاول بعد قليل" }, 502);
    }

    const data = await whisperResponse.json();
    const result = data.text || "";

    // Whisper bills per audio minute ($0.006/min): log the duration-based
    // estimate (also feeds the daily cap above).
    const minutes = typeof data.duration === "number" && data.duration > 0 ? data.duration / 60 : 0;
    await logUsage(user.id, minutes * 0.006);

    return json({ transcript: result });
  } catch {
    return json({ error: "حصل خطأ غير متوقع في تحويل الصوت" }, 500);
  }
});
