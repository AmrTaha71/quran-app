// Native (Capacitor) adhan + Fajr alarm — Android AND iOS (2026-11-13).
// Inside the store apps these are scheduled as OS-level local notifications, so
// they ring with the app closed / screen locked. On the web this file is inert.
//  - Android: exact alarms, one notification channel per tone (channel owns the sound).
//  - iOS: per-notification sound file (<= 30 s), Fajr smart alarm = a chain of
//    notifications one minute apart (iOS keeps max 64 pending, so fewer days).
// Sound files are baked by scripts/gen-alarm-sounds.mjs (alarm_<tone>.wav) and the
// optional adhan clip adhan_short.* is dropped in by the owner (see docs/NATIVE_APPS.md).
import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { ADHAN_PRAYERS, fetchDayFromApi, loadAdhanSettings } from './adhan';
import { ALARM_TONES, loadFajrAlarm, loadFajrTone } from './fajrAlarm';
import { isRecTone } from './alarmRecordings';

interface AlarmSoundPlugin {
  schedule(o: { items: { id: number; at: number; sound: string; title: string; body: string; type: string }[] }): Promise<void>;
  cancelAll(): Promise<void>;
  stop(): Promise<void>;
  takePendingFajr(): Promise<{ pending: boolean }>;
}
const AlarmSound = registerPlugin<AlarmSoundPlugin>('AlarmSound');

/** User setting: ring even when the phone is on silent. Android only (see docs). */
export const SILENT_KEY = 'quran-ring-on-silent';
export const loadRingOnSilent = (): boolean => { try { return localStorage.getItem(SILENT_KEY) === '1'; } catch { return false; } };
export const saveRingOnSilent = (v: boolean): void => { try { localStorage.setItem(SILENT_KEY, v ? '1' : '0'); } catch { /* ignore */ } };
export const platformName = (): string => { try { return Capacitor.getPlatform(); } catch { return 'web'; } };
const useNativeStream = (): boolean => platformName() === 'android' && loadRingOnSilent();

export const isNativeApp = (): boolean => { try { return Capacitor.isNativePlatform(); } catch { return false; } };
const isIOS = (): boolean => { try { return Capacitor.getPlatform() === 'ios'; } catch { return false; } };
/** @deprecated kept for old imports */
export const isNativeAndroid = isNativeApp;

const DAYS = () => (isIOS() ? 3 : 7);
const CHAIN = () => (isIOS() ? 6 : 30); // minutes of repeat after Fajr (smart mode)
const ADHAN_CH = 'adhan';
const alarmCh = (tone: string) => `fajr_alarm_${tone}`;
const ADHAN_SOUND = 'adhan_short.wav';
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const idPrayer = (day: number, idx: number) => 1000 + day * 10 + idx;
const idAlarm = (day: number, k: number) => 5000 + day * 100 + k;
const nativeToneId = (): string => {
  const t = loadFajrTone();
  return ALARM_TONES.some((x) => x.id === t) ? t : 'classic'; // recordings/clips play in-app after the tap
};

export async function enableNativeAlarms(): Promise<{ ok: boolean; reason?: string }> {
  if (!isNativeApp()) return { ok: false, reason: 'not-native' };
  const perm = await LocalNotifications.requestPermissions();
  if (perm.display !== 'granted') return { ok: false, reason: 'notifications-denied' };
  if (!isIOS()) {
    try {
      const exact = await LocalNotifications.checkExactNotificationSetting();
      if (exact.exact_alarm !== 'granted') await LocalNotifications.changeExactNotificationSetting();
    } catch { /* older Android */ }
    await LocalNotifications.createChannel({ id: ADHAN_CH, name: 'الأذان', importance: 5, visibility: 1, vibration: true, sound: ADHAN_SOUND });
    for (const t of ALARM_TONES) {
      await LocalNotifications.createChannel({ id: alarmCh(t.id), name: `منبه الفجر — ${t.name}`, importance: 5, visibility: 1, vibration: true, sound: `alarm_${t.id}.wav` });
    }
  }
  await rescheduleNativeAlarms();
  return { ok: true };
}

/** Re-plan the next days. Call on app start, on settings change, and after solving the alarm. */
export async function rescheduleNativeAlarms(): Promise<void> {
  if (!isNativeApp()) return;
  const settings = loadAdhanSettings();
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  } catch { /* ignore */ }
  try { await AlarmSound.cancelAll(); } catch { /* plugin only on Android */ }
  if (!settings.enabled || !settings.location) return;
  const mode = loadFajrAlarm();
  const tone = nativeToneId();
  const ios = isIOS();
  const list: Parameters<typeof LocalNotifications.schedule>[0]['notifications'] = [];
  const now = Date.now();
  for (let d = 0; d < DAYS(); d++) {
    const date = new Date(); date.setDate(date.getDate() + d);
    let day;
    try { day = await fetchDayFromApi(settings.location, dayKey(date)); } catch { continue; }
    ADHAN_PRAYERS.forEach((p, idx) => {
      const t = day.timings[p.key]; if (!t) return;
      const [h, m] = t.split(':').map(Number);
      const at = new Date(date); at.setHours(h, m, 0, 0);
      if (at.getTime() <= now) return;
      if (p.key === 'Fajr' && mode !== 'off') {
        const n = mode === 'smart' ? CHAIN() : 1;
        for (let k = 0; k < n; k++) {
          list.push({
            id: idAlarm(d, k), title: '⏰ حان وقت الفجر',
            body: mode === 'smart' ? 'افتح التطبيق وحلّ الأسئلة عشان المنبه يقف' : 'اضغط لإيقاف المنبه',
            schedule: { at: new Date(at.getTime() + k * 60000), allowWhileIdle: true },
            channelId: alarmCh(tone), sound: ios ? `alarm_${tone}.wav` : undefined,
            extra: { type: 'fajr-alarm', day: d }, smallIcon: 'ic_stat_icon',
          });
        }
      } else {
        list.push({
          id: idPrayer(d, idx), title: `🕌 حان وقت صلاة ${p.label}`, body: 'تقبّل الله منا ومنكم',
          schedule: { at, allowWhileIdle: true }, channelId: ADHAN_CH, sound: ios ? ADHAN_SOUND : undefined,
          extra: { type: 'adhan', prayer: p.key }, smallIcon: 'ic_stat_icon',
        });
      }
    });
  }
  if (useNativeStream()) {
    // Android «ring on silent»: exact alarms that play on the ALARM stream.
    const items = list.map((n) => {
      const type = (n.extra as { type: string }).type;
      return { id: n.id, at: (n.schedule?.at as Date).getTime(), sound: type === 'fajr-alarm' ? `alarm_${tone}` : 'adhan_short', title: n.title, body: n.body, type };
    });
    if (items.length) await AlarmSound.schedule({ items });
    return;
  }
  if (list.length) await LocalNotifications.schedule({ notifications: list.slice(0, ios ? 60 : 400) });
}

/** User solved the challenges / stopped the alarm: cancel the remaining chain. */
export async function cancelTodayAlarmChain(): Promise<void> {
  if (!isNativeApp()) return;
  try { await AlarmSound.stop(); } catch { /* ignore */ }
  try {
    const pending = await LocalNotifications.getPending();
    const today = new Date().setHours(23, 59, 59, 999);
    const ids = pending.notifications.filter((n) => n.id >= 5000 && n.id < 5100 && (!n.schedule?.at || new Date(n.schedule.at).getTime() <= today)).map((n) => ({ id: n.id }));
    if (ids.length) await LocalNotifications.cancel({ notifications: ids });
  } catch { /* ignore */ }
}

/** Tapping a Fajr-alarm notification opens the challenge screen. */
export function listenNativeAlarmTaps(): () => void {
  if (!isNativeApp()) return () => {};
  const check = () => { AlarmSound.takePendingFajr().then((r) => { if (r.pending) window.dispatchEvent(new Event('fajr-alarm-test')); }).catch(() => {}); };
  check();
  document.addEventListener('visibilitychange', check);
  const sub = LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
    if ((e.notification.extra as { type?: string } | undefined)?.type === 'fajr-alarm') window.dispatchEvent(new Event('fajr-alarm-test'));
  });
  return () => { document.removeEventListener('visibilitychange', check); void sub.then((s) => s.remove()); };
}
