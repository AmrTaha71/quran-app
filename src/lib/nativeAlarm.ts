// Android native alarms (2026-11-13). Inside the Capacitor Android shell the
// adhan and the Fajr alarm are scheduled as EXACT alarms, so they ring with
// the app closed. On the web / iOS this file does nothing.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { ADHAN_PRAYERS, fetchDayFromApi, loadAdhanSettings } from './adhan';
import { loadFajrAlarm } from './fajrAlarm';

export const isNativeAndroid = (): boolean => {
  try { return Capacitor.getPlatform() === 'android'; } catch { return false; }
};

const DAYS_AHEAD = 7;
const CHAIN = 30; // smart alarm: one exact alarm per minute for 30 min
const ADHAN_CH = 'adhan';
const ALARM_CH = 'fajr_alarm';
// Sound files go in android/app/src/main/res/raw (adhan_short.mp3, alarm.mp3).
// A missing file falls back to the system default sound.

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const idPrayer = (day: number, idx: number) => 1000 + day * 10 + idx;
const idAlarm = (day: number, k: number) => 5000 + day * 100 + k;

export async function enableNativeAlarms(): Promise<{ ok: boolean; reason?: string }> {
  if (!isNativeAndroid()) return { ok: false, reason: 'not-android' };
  const perm = await LocalNotifications.requestPermissions();
  if (perm.display !== 'granted') return { ok: false, reason: 'notifications-denied' };
  try {
    const exact = await LocalNotifications.checkExactNotificationSetting();
    if (exact.exact_alarm !== 'granted') await LocalNotifications.changeExactNotificationSetting();
  } catch { /* older Android: not needed */ }
  await LocalNotifications.createChannel({ id: ADHAN_CH, name: 'الأذان', importance: 5, visibility: 1, vibration: true, sound: 'adhan_short.mp3' });
  await LocalNotifications.createChannel({ id: ALARM_CH, name: 'منبه الفجر', importance: 5, visibility: 1, vibration: true, sound: 'alarm.mp3' });
  await rescheduleNativeAlarms();
  return { ok: true };
}

/** Re-plan the next 7 days. Call on app start, on settings change, and after solving the alarm. */
export async function rescheduleNativeAlarms(): Promise<void> {
  if (!isNativeAndroid()) return;
  const settings = loadAdhanSettings();
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  } catch { /* ignore */ }
  if (!settings.enabled || !settings.location) return;
  const mode = loadFajrAlarm();
  const list: Parameters<typeof LocalNotifications.schedule>[0]['notifications'] = [];
  const now = Date.now();
  for (let d = 0; d < DAYS_AHEAD; d++) {
    const date = new Date(); date.setDate(date.getDate() + d);
    let day;
    try { day = await fetchDayFromApi(settings.location, dayKey(date)); } catch { continue; }
    ADHAN_PRAYERS.forEach((p, idx) => {
      const t = day.timings[p.key]; if (!t) return;
      const [h, m] = t.split(':').map(Number);
      const at = new Date(date); at.setHours(h, m, 0, 0);
      if (at.getTime() <= now) return;
      if (p.key === 'Fajr' && mode !== 'off') {
        const n = mode === 'smart' ? CHAIN : 1;
        for (let k = 0; k < n; k++) {
          const when = new Date(at.getTime() + k * 60000);
          list.push({ id: idAlarm(d, k), title: '⏰ حان وقت الفجر', body: mode === 'smart' ? 'افتح التطبيق وحلّ الأسئلة عشان المنبه يقف' : 'اضغط لإيقاف المنبه',
            schedule: { at: when, allowWhileIdle: true }, channelId: ALARM_CH, extra: { type: 'fajr-alarm', day: d }, smallIcon: 'ic_stat_icon' });
        }
      } else {
        list.push({ id: idPrayer(d, idx), title: `🕌 حان وقت صلاة ${p.label}`, body: 'تقبّل الله منا ومنكم',
          schedule: { at, allowWhileIdle: true }, channelId: ADHAN_CH, extra: { type: 'adhan', prayer: p.key }, smallIcon: 'ic_stat_icon' });
      }
    });
  }
  if (list.length) await LocalNotifications.schedule({ notifications: list });
}

/** User solved the challenges / stopped the alarm: cancel today's remaining chain. */
export async function cancelTodayAlarmChain(): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    const pending = await LocalNotifications.getPending();
    const ids = pending.notifications.filter((n) => n.id >= 5000 && n.id < 5000 + 100).map((n) => ({ id: n.id }));
    if (ids.length) await LocalNotifications.cancel({ notifications: ids });
  } catch { /* ignore */ }
}

/** Tapping a Fajr-alarm notification opens the challenge screen. */
export function listenNativeAlarmTaps(): () => void {
  if (!isNativeAndroid()) return () => {};
  const sub = LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
    if ((e.notification.extra as { type?: string } | undefined)?.type === 'fajr-alarm') window.dispatchEvent(new Event('fajr-alarm-test'));
  });
  return () => { void sub.then((s) => s.remove()); };
}
