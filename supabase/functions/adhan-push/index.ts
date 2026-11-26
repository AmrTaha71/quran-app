// adhan-push — Edge Function. DEPLOYED (live v4, checked 2026-11-26) and
// scheduled by pg_cron job 'adhan-push-every-minute' (runs succeeding).
// Phase 1 (items 1.7 + 9.3): 2-minute send window + per-device dedupe
// (last_sent_prayer) instead of the fragile exact-minute match, and a
// LIMIT on the subscriptions load. Needs migration
// 20261126000006_adhan_push_unsubscribe_rpc.sql applied BEFORE deploying.
//
// PURPOSE: send a Web Push notification at prayer time to every device
// subscribed through the app (Settings → مواعيد الأذان → تنبيه الأذان
// والتطبيق مقفول). The notification itself carries NO audio — iOS
// cannot auto-play audio from a closed app. Tapping it opens the app
// at `/?adhan=<Prayer>` (or wakes the open tab via a service-worker
// message) and AdhanScheduler plays the adhan there.
//
// HOW IT RUNS: pg_cron calls this function once a minute (SQL at the
// bottom). Each run:
//   1. Loads all rows from `adhan_push_subscriptions` (service role).
//   2. Groups by distinct location (+timezone); fetches today's
//      timings from AlAdhan once per distinct location (same method
//      mapping as the client: Egypt → 5, Saudi Arabia → 4).
//   3. For each subscription, compares the current time in ITS
//      timezone with today's five prayer times; inside the first
//      SEND_WINDOW_MIN minutes after a prayer time, and only if that
//      device has not already been sent this prayer today
//      (last_sent_prayer = "YYYY-MM-DD:Prayer"), sends a Web Push
//      (npm:web-push, VAPID) and records it.
//   4. Deletes subscriptions the push service reports as dead
//      (HTTP 404/410 — uninstalled app / revoked permission).
//
// SAFETY: the function only sends inside the short window after a
// prayer time and at most once per device per prayer per day, so a
// late, skipped or duplicate cron run neither misses nor repeats. The cron call must carry the shared secret header
// `x-cron-secret` (env CRON_SECRET); without it the function refuses.
// verify_jwt is false (config.toml) because pg_cron cannot mint a
// user JWT — the secret header is the auth, matching the repo's other
// cron-called functions.
//
// SCALE NOTE: AlAdhan is fetched once per distinct location per
// minute (deduped), not once per subscriber. With a handful of users
// in 1–2 cities that is ~1–2 fetches/minute. If users spread to many
// cities, cache a day's timings per location in a small table instead
// of fetching every minute — do NOT widen the per-minute fetch.
//
// DEPLOY-TIME VERIFICATION STILL OWED (cannot be checked from the
// worktree): `npm:web-push` must resolve + run under the Supabase
// Edge runtime (it uses node:crypto/https); deploy the function, then
// invoke it once by hand at a non-prayer minute and confirm a 200
// with `{ sent: 0 }` and no crash.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Cron-Secret, Authorization, Apikey",
};

const PRAYERS = [
  { key: "Fajr", label: "الفجر" },
  { key: "Dhuhr", label: "الظهر" },
  { key: "Asr", label: "العصر" },
  { key: "Maghrib", label: "المغرب" },
  { key: "Isha", label: "العشاء" },
] as const;

type AdhanLocation =
  | { kind: "gps"; lat: number; lng: number; label: string }
  | { kind: "manual"; country: string; countryName: string; city: string };

// A cron run can be late by up to a minute (or one run can be skipped):
// send if now is within [prayer, prayer + SEND_WINDOW_MIN).
const SEND_WINDOW_MIN = 2;
// Hard cap per run (item 1.7): spam rows must not make one run unbounded.
const MAX_SUBSCRIPTIONS_PER_RUN = 10000;

interface SubscriptionRow {
  endpoint: string;
  last_sent_prayer: string | null;
  p256dh: string;
  auth: string;
  location: AdhanLocation;
  timezone: string;
}

const METHOD_BY_COUNTRY: Record<string, number> = { EG: 5, SA: 4 };
const API_NAME_BY_COUNTRY: Record<string, string> = {
  EG: "Egypt",
  SA: "Saudi Arabia",
};

function toApiDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${d}-${m}-${y}`;
}

function dateInTimezone(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
}

function timeInTimezone(tz: string): string {
  try {
    const s = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
    return s.startsWith("24:") ? `00:${s.slice(3)}` : s;
  } catch {
    return "";
  }
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function cleanTime(raw: string): string {
  return raw.split(" ")[0];
}

async function fetchTimings(location: AdhanLocation, dateKey: string): Promise<Record<string, string> | null> {
  let url: string;
  if (location.kind === "gps") {
    url = `https://api.aladhan.com/v1/timings/${toApiDate(dateKey)}?latitude=${location.lat}&longitude=${location.lng}`;
  } else {
    const method = METHOD_BY_COUNTRY[location.country]
      ? `&method=${METHOD_BY_COUNTRY[location.country]}`
      : "";
    const countryApi = API_NAME_BY_COUNTRY[location.country] ?? location.countryName;
    url = `https://api.aladhan.com/v1/timingsByCity/${toApiDate(dateKey)}?city=${encodeURIComponent(location.city)}&country=${encodeURIComponent(countryApi)}${method}`;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { code: number; data?: { timings: Record<string, string> } };
    if (json.code !== 200 || !json.data) return null;
    const timings: Record<string, string> = {};
    for (const [k, v] of Object.entries(json.data.timings)) timings[k] = cleanTime(v);
    return timings;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Cron auth: shared secret header (see file header). No secret
  // configured = server not set up = refuse, never send unauthenticated.
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return json({ error: "unauthorized" }, 401);
  }
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "";
  if (!vapidPublic || !vapidPrivate || !vapidSubject) {
    return json({ error: "vapid-not-configured" }, 500);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "supabase-not-configured" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: rows, error } = await supabase
    .from("adhan_push_subscriptions")
    .select("endpoint, p256dh, auth, location, timezone, last_sent_prayer")
    .limit(MAX_SUBSCRIPTIONS_PER_RUN);
  if (error) return json({ error: "subscriptions-load-failed", detail: error.message }, 500);
  const subs = (rows ?? []) as SubscriptionRow[];

  // Group by distinct location+timezone so AlAdhan is fetched once
  // per place, not once per subscriber.
  const groups = new Map<string, { location: AdhanLocation; timezone: string; subs: SubscriptionRow[] }>();
  for (const sub of subs) {
    if (!sub.endpoint || !sub.p256dh || !sub.auth || !sub.location || !sub.timezone) continue;
    const key = JSON.stringify({ location: sub.location, timezone: sub.timezone });
    const g = groups.get(key) ?? { location: sub.location, timezone: sub.timezone, subs: [] };
    g.subs.push(sub);
    groups.set(key, g);
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  let sent = 0;
  let deleted = 0;
  const errors: string[] = [];
  for (const group of groups.values()) {
    const dateKey = dateInTimezone(group.timezone);
    const timings = await fetchTimings(group.location, dateKey);
    if (!timings) {
      errors.push(`timings-unavailable:${group.timezone}`);
      continue;
    }
    const nowMin = toMinutes(timeInTimezone(group.timezone));
    if (nowMin === null) continue;
    const due = PRAYERS.find((p) => {
      const t = toMinutes(timings[p.key] ?? "");
      return t !== null && nowMin >= t && nowMin - t < SEND_WINDOW_MIN;
    });
    if (!due) continue; // Not inside a prayer window for this place — send nothing.
    const sentKey = `${dateKey}:${due.key}`;
    const payload = JSON.stringify({
      title: `🕌 حان الآن وقت صلاة ${due.label}`,
      body: "اضغط لفتح التطبيق وسماع الأذان",
      prayer: due.key,
      url: `/?adhan=${due.key}`,
    });
    for (const sub of group.subs) {
      if (sub.last_sent_prayer === sentKey) continue; // already sent this prayer today
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 120, urgency: "high" },
        );
        sent++;
        await supabase
          .from("adhan_push_subscriptions")
          .update({ last_sent_at: new Date().toISOString(), last_sent_prayer: sentKey })
          .eq("endpoint", sub.endpoint);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Dead endpoint (app uninstalled / permission revoked):
          // prune so future runs stop trying.
          const { error: delErr } = await supabase
            .from("adhan_push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
          if (!delErr) deleted++;
        } else {
          errors.push(`send-failed:${status ?? "unknown"}`);
        }
      }
    }
  }
  return json({ ok: true, checked: subs.length, sent, deleted, errors });
});

// ------------------------------------------------------------------
// SETUP (run once, in the Supabase SQL editor / dashboard — NOT here):
//
// 1. Secrets (Dashboard → Edge Functions → adhan-push → Secrets, or
//    `supabase secrets set`):
//      VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — from
//        `npx web-push generate-vapid-keys` (run once, locally)
//      VAPID_SUBJECT — a contact URL, e.g.
//        https://rawabit-alziker-alhakim.vercel.app
//      CRON_SECRET — a long random string (also used in the cron SQL
//        below); never commit it.
//
// 2. Table: apply supabase/migrations/*_adhan_push_subscriptions.sql
//    (creates `adhan_push_subscriptions` + RLS).
//
// 3. Deploy: `supabase functions deploy adhan-push`
//    (verify_jwt = false is set in supabase/config.toml — the
//    x-cron-secret header is the auth, because pg_cron cannot mint
//    a user JWT).
//
// 4. Schedule (SQL editor; needs the pg_cron + pg_net extensions
//    enabled first: Dashboard → Database → Extensions):
//      select cron.schedule(
//        'adhan-push-every-minute',
//        '* * * * *',
//        $$
//        select net.http_post(
//          url := 'https://<PROJECT_REF>.supabase.co/functions/v1/adhan-push',
//          headers := jsonb_build_object(
//            'Content-Type', 'application/json',
//            'x-cron-secret', '<CRON_SECRET>'
//          ),
//          body := '{}'::jsonb
//        );
//        $$
//      );
//    Replace <PROJECT_REF> and <CRON_SECRET> with the real values.
//    To stop it later: select cron.unschedule('adhan-push-every-minute');
//
// 5. Client env (Vercel): VITE_VAPID_PUBLIC_KEY = <public key>.
//    Without it the Settings toggle reports "server setup incomplete"
//    and subscribing is refused — the foreground adhan is unaffected.
