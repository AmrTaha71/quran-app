// 15.11 (2026-11-26): a daily review reminder at a time the user picks,
// with what is waiting («عندك N كلمة: M من أخطائك»). Local only: in the
// store apps an OS local notification (rings with the app closed); on the
// web a notification while the app is open (needs permission). No push
// (adhan-push is not deployed, 9.3).
import { LocalNotifications } from '@capacitor/local-notifications';
import { isNativeApp } from './nativeAlarm';
import { getDueWords } from './srsStore';
import { listWeakWords } from './wordMistakes';
import { dueWordsText } from './srsHome';

export const REVIEW_REMINDER_KEY = 'quran-review-reminder-v1';
export type ReviewReminder = { on: boolean; time: string };
const DEFAULT: ReviewReminder = { on: false, time: '06:30' };
const ID_BASE = 9100; // 9100..9106: the next 7 days
const SHOWN_KEY = 'quran-review-reminder-shown';

export function loadReviewReminder(): ReviewReminder {
  try {
    const v = JSON.parse(localStorage.getItem(REVIEW_REMINDER_KEY) || 'null');
    if (v && typeof v.on === 'boolean' && /^\d{2}:\d{2}$/.test(v.time)) return v;
  } catch { /* default */ }
  return DEFAULT;
}

export function reminderBody(): string {
  let due = 0, weak = 0;
  try { due = getDueWords().length; } catch { /* 0 */ }
  try { weak = listWeakWords().length; } catch { /* 0 */ }
  const total = due + weak;
  return total > 0 ? `عندك ${dueWordsText(total)} النهاردة: ${dueWordsText(weak)} من أخطائك` : 'وقت مراجعة حفظك — خمس دقايق تكفي.';
}

export async function saveReviewReminder(r: ReviewReminder): Promise<{ ok: boolean; reason?: string }> {
  try { localStorage.setItem(REVIEW_REMINDER_KEY, JSON.stringify(r)); } catch { /* ignore */ }
  if (isNativeApp()) return scheduleNative(r);
  if (r.on && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }
  if (r.on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') return { ok: false, reason: 'notifications-denied' };
  return { ok: true };
}

async function scheduleNative(r: ReviewReminder): Promise<{ ok: boolean; reason?: string }> {
  try {
    await LocalNotifications.cancel({ notifications: Array.from({ length: 7 }, (_, i) => ({ id: ID_BASE + i })) });
    if (!r.on) return { ok: true };
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return { ok: false, reason: 'notifications-denied' };
    const [h, m] = r.time.split(':').map(Number);
    const now = new Date();
    const body = reminderBody();
    const items = Array.from({ length: 7 }, (_, i) => {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m, 0);
      return { id: ID_BASE + i, title: 'مراجعة حفظك', body, schedule: { at } };
    }).filter((n) => n.schedule.at.getTime() > now.getTime());
    await LocalNotifications.schedule({ notifications: items });
    return { ok: true };
  } catch { return { ok: false, reason: 'schedule-failed' }; }
}

/** Web, app open: show today's reminder once when its time has passed. Native: re-plan the week. */
export function reviewReminderTick(now = new Date()): void {
  const r = loadReviewReminder();
  if (!r.on) return;
  if (isNativeApp()) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const today = now.toLocaleDateString('en-CA');
  const [h, m] = r.time.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
  try { if (localStorage.getItem(SHOWN_KEY) === today) return; localStorage.setItem(SHOWN_KEY, today); } catch { return; }
  try { new Notification('مراجعة حفظك', { body: reminderBody(), icon: '/icon-192.png' }); } catch { /* ignore */ }
}

/** On app start in the store apps: keep the next 7 days planned. */
export function replanReviewReminder(): void {
  if (isNativeApp()) { const r = loadReviewReminder(); if (r.on) void scheduleNative(r); }
}
