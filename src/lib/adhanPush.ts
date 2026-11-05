// Web Push for adhan alerts — notifications even when the app is
// closed.
//
// HONEST BOUNDARY (do not promise past this): a web app on iOS
// CANNOT play audio while closed, and cannot show a notification
// while closed without Web Push (server + service worker + user
// permission). What this delivers: at prayer time the server sends a
// push; the device shows a notification even with the app closed; the
// user taps it, the app opens, and the adhan plays (see the `?adhan=`
// deep link handled in AdhanScheduler, and the service-worker
// `message` path for the already-open case).
//
// iOS EXTRA CONDITION (Apple, since iOS 16.4): Web Push works ONLY
// for a web app added to the Home Screen, and only on iOS 16.4+.
// In a plain Safari tab, `PushManager` is absent and this module
// reports 'unsupported'. The Settings UI says this plainly.
//
// SETUP (one-time, coordinator/Amr — NOT done by this code):
//   1. Generate a VAPID key pair: `npx web-push generate-vapid-keys`
//   2. Vercel env (client): VITE_VAPID_PUBLIC_KEY = <public key>
//   3. Supabase secrets (server, function adhan-push):
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
//      (subject is a contact URL, e.g. the live app URL), CRON_SECRET
//   4. Apply supabase/migrations/*_adhan_push_subscriptions.sql
//      (creates the table + RLS) and schedule the per-minute pg_cron
//      call (SQL in the function file header).
// Until (2)+(4) are done, subscribing fails gracefully with a
// readable reason — the foreground adhan is unaffected.

import { supabase } from './supabase';
import {
  ADHAN_DAY_KEY,
  ADHAN_PRAYERS,
  loadAdhanSettings,
  type AdhanLocation,
  type AdhanPrayerKey,
} from './adhan';

export type PushStatus = {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
};

export type PushSubscribeResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'no-vapid-key' | 'denied' | 'subscribe-failed' | 'save-failed' };

const SUBSCRIPTIONS_TABLE = 'adhan_push_subscriptions';

// Same standalone test as SettingsPage (installed PWA, any browser).
export function isStandaloneApp(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

export function isIOSDevice(): boolean {
  try {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  } catch {
    return false;
  }
}

export function pushSupported(): boolean {
  try {
    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  } catch {
    return false;
  }
}

function vapidPublicKey(): string | null {
  const key = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '';
  return key.trim() ? key.trim() : null;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) {
    return { supported: false, permission: 'unsupported', subscribed: false };
  }
  try {
    const permission = Notification.permission;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return { supported: true, permission, subscribed: !!sub };
  } catch {
    return { supported: true, permission: Notification.permission, subscribed: false };
  }
}

interface PushLocationSnapshot {
  location: AdhanLocation | null;
  timezone: string | null;
}

// Location + timezone the server needs to compute prayer times for
// this device. Timezone comes from the cached AlAdhan day when
// available (authoritative for the chosen location), else the device
// timezone as a fallback.
function pushLocationSnapshot(): PushLocationSnapshot {
  const settings = loadAdhanSettings();
  let timezone: string | null = null;
  try {
    const cached = localStorage.getItem(ADHAN_DAY_KEY);
    if (cached) {
      const p = JSON.parse(cached) as { day?: { timezone?: string } };
      if (typeof p.day?.timezone === 'string' && p.day.timezone) timezone = p.day.timezone;
    }
  } catch {
    // Fall through to the device timezone.
  }
  if (!timezone) {
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    } catch {
      timezone = null;
    }
  }
  return { location: settings.location, timezone };
}

async function saveSubscriptionToServer(sub: PushSubscription): Promise<boolean> {
  const json = sub.toJSON();
  const keys = (json.keys ?? {}) as { p256dh?: string; auth?: string };
  if (!json.endpoint || !keys.p256dh || !keys.auth) return false;
  const snap = pushLocationSnapshot();
  if (!snap.location || !snap.timezone) return false;
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    userId = null;
  }
  const { error } = await supabase.from(SUBSCRIPTIONS_TABLE).upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      location: snap.location,
      timezone: snap.timezone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );
  return !error;
}

async function deleteSubscriptionFromServer(endpoint: string): Promise<void> {
  try {
    await supabase.from(SUBSCRIPTIONS_TABLE).delete().eq('endpoint', endpoint);
  } catch {
    // Best-effort: the server prunes dead endpoints on 410/404 too.
  }
}

// Called from the Settings toggle — a user gesture, which iOS needs
// for the permission prompt. Subscribes (or reuses an existing
// subscription) and stores it server-side with the current location.
export async function subscribeAdhanPush(): Promise<PushSubscribeResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  const vapidKey = vapidPublicKey();
  if (!vapidKey) return { ok: false, reason: 'no-vapid-key' };
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };
  if (Notification.permission === 'default') {
    const granted = await Notification.requestPermission();
    if (granted !== 'granted') return { ok: false, reason: 'denied' };
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
    }
    const saved = await saveSubscriptionToServer(sub);
    if (!saved) return { ok: false, reason: 'save-failed' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'subscribe-failed' };
  }
}

// Called from the Settings toggle. Unsubscribes locally and removes
// the server row so no more pushes are sent to this device.
export async function unsubscribeAdhanPush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await deleteSubscriptionFromServer(endpoint);
  } catch {
    // Unsubscribe is best-effort from the UI side.
  }
}

// Silent re-sync, called on app launch / foreground by
// AdhanPushManager: if permission is already granted and a
// subscription exists, re-store it with the CURRENT location +
// timezone (so a location change reaches the server without the
// user re-toggling). Never prompts, never subscribes on its own.
export async function syncAdhanPushSubscription(): Promise<void> {
  if (!pushSupported()) return;
  try {
    if (Notification.permission !== 'granted') return;
    const settings = loadAdhanSettings();
    if (!settings.enabled || !settings.location) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await saveSubscriptionToServer(sub);
  } catch {
    // Silent sync must never surface an error.
  }
}

export function isValidAdhanPrayerKey(value: string | null): value is AdhanPrayerKey {
  if (!value) return false;
  return (ADHAN_PRAYERS as readonly { key: string }[]).some((p) => p.key === value);
}

export function prayerLabel(key: AdhanPrayerKey): string {
  return ADHAN_PRAYERS.find((p) => p.key === key)?.label ?? key;
}
