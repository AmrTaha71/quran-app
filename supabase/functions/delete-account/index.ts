// delete-account (2026-11-09): the signed-in user deletes their own
// account and data. The caller is identified ONLY from their JWT; no
// user id is accepted from the request body.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Tables that hold per-user rows (column user_id).
const USER_TABLES = ["user_device_settings", "user_lists", "adhan_push_subscriptions", "user_profiles"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "server not configured" }, 500);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "not signed in" }, 401);

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) return json({ error: "not signed in" }, 401);
  const uid = data.user.id;

  // Admins cannot delete themselves here (protects the admin console).
  // Item 1.11: fail CLOSED — if the admin check itself errors (e.g. the
  // table is missing on a fresh database) refuse, never skip the guard.
  const { data: adminRow, error: adminErr } = await admin.from("admin_users").select("user_id").eq("user_id", uid).maybeSingle();
  if (adminErr) return json({ error: "server not configured" }, 500);
  if (adminRow) return json({ error: "admin accounts are deleted from the dashboard" }, 403);

  // Item 1.11: the user's own audio files in rana-audio (public bucket —
  // they would stay playable forever) and their still-pending suggestions.
  // Approved links stay, anonymous (created_by becomes NULL via the FK) —
  // they are reviewed content the admin accepted. Decision recorded here.
  try {
    const { data: links } = await admin
      .from("ayah_links")
      .select("audio_url, synthetic_audio_url, synthetic_audio_url_female, synthetic_audio_url_male")
      .eq("created_by", uid);
    const marker = "/storage/v1/object/public/rana-audio/";
    const paths = new Set<string>();
    for (const l of links ?? []) {
      for (const u of [l.audio_url, l.synthetic_audio_url, l.synthetic_audio_url_female, l.synthetic_audio_url_male]) {
        if (typeof u !== "string") continue;
        const i = u.indexOf(marker);
        if (i < 0) continue;
        const p = decodeURIComponent(u.slice(i + marker.length).split("?")[0]);
        // Never touch the shared generated caches.
        if (p && !p.startsWith("corr/") && !p.startsWith("tafsir/")) paths.add(p);
      }
    }
    if (paths.size > 0) await admin.storage.from("rana-audio").remove([...paths]);
  } catch { /* best effort: account deletion must still go through */ }
  try {
    await admin.from("ayah_links").delete().eq("created_by", uid).eq("status", "pending");
  } catch { /* best effort */ }

  for (const t of USER_TABLES) {
    try { await admin.from(t).delete().eq("user_id", uid); } catch { /* table may not exist */ }
  }
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) return json({ error: delErr.message }, 500);
  return json({ ok: true });
});
