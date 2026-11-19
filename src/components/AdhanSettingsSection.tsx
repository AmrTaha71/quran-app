import { enableNativeAlarms, isNativeApp, loadRingOnSilent, platformName, rescheduleNativeAlarms, saveRingOnSilent } from '../lib/nativeAlarm';
import { deleteRecording, loadRecordings, recToneId, saveRecording, startRecording, type AlarmRec } from '../lib/alarmRecordings';
import { ALARM_CLIPS, isNightMode, startNightMode, stopNightMode, ALARM_TONES, loadFajrTone, saveFajrTone, startAlarmTone, loadFajrAlarm, saveFajrAlarm, type FajrAlarmMode } from '../lib/fajrAlarm';
import { useEffect, useRef, useState } from 'react';
import DrumSelect from './DrumSelect';
import { MapPin } from 'lucide-react';
import Collapsible from './Collapsible';
import {
  ADHAN_AUDIO_CREDIT,
  ADHAN_VOICES, getAdhanVoice, setAdhanVoice, availableAdhanVoices, isAdhanVoiceDownloaded, downloadAdhanVoice,
  ADHAN_COUNTRIES,
  ADHAN_METHODS, getAdhanMethod, setAdhanMethod,
  ADHAN_PRAYERS,
  ADHAN_CHOICES,
  adhanLocationLabel,
  ensureAdhanDay,
  loadAdhanSettings,
  playAdhanSound,
  saveAdhanSettings,
  timeInTimezone,
  type AdhanDay,
  type AdhanSettings,
} from '../lib/adhan';
import {
  getPushStatus,
  isIOSDevice,
  isStandaloneApp,
  subscribeAdhanPush,
  unsubscribeAdhanPush,
  type PushStatus,
} from '../lib/adhanPush';

// Settings section: prayer-time location + alerts. Location order is
// country FIRST, then city, as the user asked. The only adhan audio
// offered is the open-licensed Commons Makkah adhan (full) plus a
// generated beep — no other muezzin file is used.
export default function AdhanSettingsSection() {
  const [settings, setSettings] = useState<AdhanSettings>(() => loadAdhanSettings());
  const [day, setDay] = useState<AdhanDay | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState('');
  const [countryCode, setCountryCode] = useState('EG');
  const [city, setCity] = useState('');
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [testing, setTesting] = useState(false);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);
  // Web Push (closed-app adhan notification): status is read on
  // mount; subscribing happens only from the button below (a user
  // gesture, which iOS needs for the permission prompt).
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');
  const [method, setMethod] = useState<number | null>(() => getAdhanMethod());
  const [ringSilent, setRingSilent] = useState(() => loadRingOnSilent());

  const refreshPushStatus = async () => {
    setPushStatus(await getPushStatus());
  };

  useEffect(() => {
    void refreshPushStatus();
  }, []);

  const togglePush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    setPushError('');
    try {
      if (pushStatus?.subscribed) {
        await unsubscribeAdhanPush();
      } else {
        const res = await subscribeAdhanPush();
        if (!res.ok) {
          setPushError(
            res.reason === 'unsupported'
              ? 'جهازك أو متصفحك لا يدعم الإشعارات — على آيفون/آيباد لازم التطبيق يكون مضافًا للشاشة الرئيسية، ونظام iOS 16.4 أو أحدث.'
              : res.reason === 'denied'
                ? 'تم رفض إذن الإشعارات — فعّله من إعدادات المتصفح/النظام، ثم حاول مرة أخرى.'
                : res.reason === 'no-vapid-key'
                  ? 'إعداد الإشعارات على الخادم لم يكتمل بعد — جرّب لاحقًا.'
                  : res.reason === 'save-failed'
                    ? 'تعذّر حفظ الاشتراك على الخادم — تأكد من الاتصال، وجرّب مرة أخرى.'
                    : 'تعذّر تفعيل الإشعارات — جرّب مرة أخرى.',
          );
        }
      }
    } finally {
      await refreshPushStatus();
      setPushBusy(false);
    }
  };

  const refreshDay = async (loc: AdhanSettings['location']) => {
    if (!loc) {
      setDay(null);
      return;
    }
    setDayLoading(true);
    setDayError('');
    try {
      setDay(await ensureAdhanDay(loc));
    } catch {
      setDayError('تعذّر جلب مواقيت اليوم — تأكد من الاتصال وحاول تحديث المواقيت.');
    } finally {
      setDayLoading(false);
    }
  };

  useEffect(() => {
    void refreshDay(settings.location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.location]);

  const update = (patch: Partial<AdhanSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveAdhanSettings(next);
      return next;
    });
  };

  const detectGps = () => {
    if (!('geolocation' in navigator)) {
      setGpsError('جهازك لا يدعم تحديد الموقع.');
      return;
    }
    setGpsBusy(true);
    setGpsError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false);
        update({
          location: {
            kind: 'gps',
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            label: 'موقعي الحالي (GPS)',
          },
        });
      },
      () => {
        setGpsBusy(false);
        setGpsError('تعذّر تحديد موقعك — اسمح بالوصول للموقع من إعدادات المتصفح، أو حدّد الدولة والمدينة يدويًا.');
      },
      { timeout: 15000, maximumAge: 60000 }
    );
  };

  const saveManual = () => {
    const trimmed = city.trim();
    if (!trimmed) return;
    const country = ADHAN_COUNTRIES.find((c) => c.code === countryCode);
    if (!country) return;
    update({
      location: { kind: 'manual', country: country.code, countryName: country.name, city: trimmed },
    });
  };

  const toggleTest = () => {
    if (testing) {
      testAudioRef.current?.pause();
      testAudioRef.current = null;
      setTesting(false);
      return;
    }
    const audio = playAdhanSound(settings.sound);
    testAudioRef.current = audio;
    setTesting(true);
    if (audio) {
      audio.onended = () => setTesting(false);
    } else {
      // Beep finishes on its own.
      window.setTimeout(() => setTesting(false), 2000);
    }
  };

  useEffect(() => {
    return () => {
      testAudioRef.current?.pause();
    };
  }, []);

  const nowInTz = day ? timeInTimezone(day.timezone) : '';
  const nextPrayer = day
    ? ADHAN_PRAYERS.find((p) => (day.timings[p.key] ?? '') > nowInTz)
    : undefined;
  const methodLabel = method === null ? 'تلقائي' : ADHAN_METHODS.find((m) => m.id === method)?.label ?? 'تلقائي';
  const soundLabel = settings.sound === 'full' ? 'أذان كامل' : settings.sound === 'takbir' ? 'الله أكبر' : 'تنبيه قصير';

  // Wave 3 (W3-S1): every block is a Collapsible (arrow open/close), in the
  // owner's order: location, times, calculation method, alerts on/off,
  // alert type. The rest (per-prayer, Fajr alarm, closed-app push) follow,
  // closed. Content stays mounted while closed (GPS fix, recording, push
  // state survive). No long intro text.
  return (
    <div id="sec-adhan" className="scroll-mt-36 space-y-3">
      <Collapsible
        title={<span className="flex items-center gap-2"><MapPin className="w-5 h-5 text-emerald-600" /> الموقع</span>}
        summary={settings.location ? adhanLocationLabel(settings.location) : 'غير محدد'}
        defaultOpen={!settings.location}
        storageKey="adhan-location"
      >
        {settings.location ? (
          <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-emerald-50 border border-hairline-emerald">
            <span className="font-medium text-accent-800">{adhanLocationLabel(settings.location)}</span>
            <button
              onClick={() => update({ location: null })}
              className="text-sm font-medium text-red-600 px-3 py-2 min-h-[44px]"
            >
              تغيير
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={detectGps}
              disabled={gpsBusy}
              className="w-full py-3 grad-emerald-door disabled:opacity-50 text-white text-base font-bold rounded-xl transition-smooth polish-press polish-focus"
            >
              {gpsBusy ? 'جارٍ تحديد موقعك…' : '📍 اكتشف موقعي تلقائيًا (GPS)'}
            </button>
            {gpsError && <p className="text-sm text-red-600 mt-2">{gpsError}</p>}
            <p className="text-sm text-accent-600 my-3 text-center">أو يدويًا: الدولة ثم المدينة</p>
            <div className="grid gap-3">
              <label className="block">
                <span className="block text-sm font-medium text-accent-700 mb-1">الدولة</span>
                <DrumSelect label="الدولة" value={countryCode} onChange={setCountryCode}
                  options={ADHAN_COUNTRIES.map((c) => ({ value: c.code, label: c.name }))} />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-accent-700 mb-1">المدينة</span>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="مثال: القاهرة"
                  className="w-full p-3 rounded-xl border border-hairline-input bg-white text-accent-800"
                />
              </label>
              <button
                onClick={saveManual}
                disabled={!city.trim()}
                className="w-full py-3 grad-emerald-door disabled:opacity-50 text-white text-base font-bold rounded-xl transition-smooth polish-press polish-focus"
              >
                حفظ الموقع
              </button>
            </div>
          </>
        )}
      </Collapsible>

      <Collapsible
        title="المواقيت"
        summary={nextPrayer && day ? `${nextPrayer.label} ${day.timings[nextPrayer.key]}` : undefined}
        storageKey="adhan-times"
      >
        {!settings.location ? (
          <p className="text-sm text-accent-600">حدّد الموقع الأول.</p>
        ) : (
          <>
            <div className="flex items-center justify-end mb-2">
              <button onClick={() => void refreshDay(settings.location)} className="text-sm font-semibold text-emerald-700 px-3 py-2 min-h-[44px]">
                تحديث
              </button>
            </div>
            {dayLoading && <p className="text-sm text-accent-600">جارٍ جلب المواقيت…</p>}
            {dayError && <p className="text-sm text-red-600">{dayError}</p>}
            {day && !dayLoading && (
              <>
                <div className="grid grid-cols-5 gap-2 text-center">
                  {ADHAN_PRAYERS.map((p) => (
                    <div
                      key={p.key}
                      className={`rounded-xl border p-2 ${nextPrayer?.key === p.key ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
                    >
                      <p className="text-xs text-accent-600">{p.label}</p>
                      <p className="font-bold text-accent-800 text-sm" dir="ltr">
                        {day.timings[p.key] ?? '—'}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-accent-600 mt-2">
                  {day.hijri && `${day.hijri} • `}
                  {day.timezone}
                </p>
              </>
            )}
          </>
        )}
      </Collapsible>

      <Collapsible title="طريقة الحساب" summary={methodLabel} storageKey="adhan-method">
        <DrumSelect<number>
          label="طريقة الحساب"
          value={method ?? 0}
          onChange={(v) => { const m = v === 0 ? null : v; setAdhanMethod(m); setMethod(m); void refreshDay(settings.location); }}
          options={[{ value: 0, label: 'تلقائي (حسب الدولة)' }, ...ADHAN_METHODS.map((m) => ({ value: m.id, label: m.label }))]}
        />
        {day?.methodName && <p className="text-xs text-accent-600 mt-2">المستخدمة الآن: {day.methodName}</p>}
      </Collapsible>

      <Collapsible title="تفعيل التنبيهات" summary={settings.enabled ? 'مفعّلة' : 'متوقفة'} storageKey="adhan-enable">
        <button
          onClick={() => update({ enabled: !settings.enabled })}
          aria-pressed={settings.enabled}
          className="w-full flex items-center justify-between p-4 rounded-xl border-2 transition-smooth border-hairline hover:border-hairline-emerald polish-press"
        >
          <span className="font-medium text-accent-800">{settings.enabled ? 'مفعّلة' : 'متوقفة'}</span>
          <span className={`w-12 h-7 rounded-full p-1 transition-smooth flex-shrink-0 ${settings.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}>
            <span className={`block w-5 h-5 bg-white rounded-full shadow transition-smooth ${settings.enabled ? 'mr-auto' : ''}`} />
          </span>
        </button>
      </Collapsible>

      <Collapsible title="نوع التنبيه" summary={soundLabel} storageKey="adhan-type">
        <div className="grid gap-2">
          <button
            onClick={() => update({ sound: 'beep' })}
            className={`text-right p-3 rounded-xl border-2 polish-press ${settings.sound === 'beep' ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
          >
            <span className="block font-medium text-accent-800">تنبيه صوتي قصير</span>
          </button>
          <button
            onClick={() => update({ sound: 'full' })}
            className={`text-right p-3 rounded-xl border-2 polish-press ${settings.sound === 'full' ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
          >
            <span className="block font-medium text-accent-800">أذان كامل</span>
          </button>
          {settings.sound === 'full' && <AdhanVoicePicker />}
          <button
            onClick={() => update({ sound: 'takbir' })}
            className={`text-right p-3 rounded-xl border-2 polish-press ${settings.sound === 'takbir' ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
          >
            <span className="block font-medium text-accent-800">«الله أكبر الله أكبر» فقط</span>
          </button>
          {settings.sound === 'takbir' && <AdhanVoicePicker />}
        </div>
        <button
          onClick={toggleTest}
          className="w-full mt-3 py-3 bg-white border-2 border-emerald-500 text-emerald-700 text-base font-bold rounded-xl transition-smooth polish-press"
        >
          {testing ? '⏹ إيقاف التجربة' : '▶ جرّب الصوت'}
        </button>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button
            onClick={() => update({ alertType: 'both' })}
            className={`p-3 rounded-xl border-2 polish-press font-medium text-accent-800 ${settings.alertType === 'both' ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
          >
            صوت + رسالة
          </button>
          <button
            onClick={() => update({ alertType: 'audio' })}
            className={`p-3 rounded-xl border-2 polish-press font-medium text-accent-800 ${settings.alertType === 'audio' ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
          >
            صوت فقط
          </button>
        </div>
        {/* W3-S6: «الأذان حتى لو الموبايل صامت». Only stores the choice (same key
            nativeAlarm.ts already reads on Android); the playback logic is not
            changed here. The text states the real limits per platform. */}
        <button
          onClick={() => { const v = !ringSilent; setRingSilent(v); saveRingOnSilent(v); void rescheduleNativeAlarms(); }}
          aria-pressed={ringSilent}
          className="w-full mt-3 flex items-center justify-between gap-3 p-3 rounded-xl border-2 border-hairline polish-press text-start"
        >
          <span className="font-medium text-accent-800">الأذان حتى لو الموبايل صامت</span>
          <span className={`w-12 h-7 rounded-full p-1 transition-smooth flex-shrink-0 ${ringSilent ? 'bg-emerald-500' : 'bg-gray-300'}`}>
            <span className={`block w-5 h-5 bg-white rounded-full shadow transition-smooth ${ringSilent ? 'mr-auto' : ''}`} />
          </span>
        </button>
        <p className="text-xs text-accent-700 mt-2 leading-relaxed">
          {isNativeApp() && platformName() === 'android'
            ? 'أندرويد: الأذان والمنبه بيرنوا من نظام الجهاز حتى لو الموبايل صامت والتطبيق مقفول.'
            : isNativeApp()
              ? 'آيفون: آبل بتكتم صوت الإشعارات في وضع الصامت ومش بتسمح لتطبيق عادي يتخطاه. التطبيق مقفول + الموبايل صامت = مفيش صوت. افتح الصامت.'
              : 'الاختيار بيتحفظ بس، وبيشتغل في نسخة أندرويد من المتجر (لسه ما نزلتش). على الآيفون والتطبيق مقفول والموبايل صامت: مش ممكن خالص، ده قيد من آبل. وعلى الويب مفيش أذان بصوت والتطبيق مقفول، الإشعار بس.'}
        </p>
        <p className="text-xs text-accent-600 mt-3" dir="auto">{getAdhanVoice().credit || ADHAN_AUDIO_CREDIT}</p>
        <p className="text-xs text-accent-600 mt-1">
          آيفون ممكن يمنع الصوت قبل أول لمسة في التطبيق، وزر «جرّب الصوت» بيفتحه.
        </p>
      </Collapsible>

      <Collapsible title="تنبيه كل صلاة لوحدها" storageKey="adhan-perprayer">
        <div className="grid gap-2">
          {ADHAN_PRAYERS.map((p) => (
            <div key={p.key} className="flex items-center gap-2">
              <span className="w-16 shrink-0 font-medium text-accent-800">{p.label}</span>
              <div className="flex-1 min-w-0">
                <DrumSelect label={`تنبيه ${p.label}`} value={settings.perPrayer[p.key] ?? 'default'}
                  onChange={(v) => update({ perPrayer: { ...settings.perPrayer, [p.key]: v } })}
                  options={ADHAN_CHOICES.map((c) => ({ value: c.id, label: c.label }))} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-accent-600 mt-2">الفجر: لو شغّلت منبه الفجر، المنبه هو اللي يرن.</p>
      </Collapsible>

      <Collapsible title="⏰ منبه الفجر" storageKey="adhan-fajr">
        <FajrAlarmSetting />
      </Collapsible>

      {/* Web Push — adhan notification even when the app is closed. The
          notification carries no audio (iOS cannot auto-play audio from a
          closed app): tapping it opens the app and the adhan plays. iOS needs
          the app added to the Home Screen + iOS 16.4 or newer. */}
      <Collapsible
        title="تنبيه والتطبيق مقفول"
        summary={pushStatus?.subscribed ? 'مفعّل' : undefined}
        storageKey="adhan-push"
      >
        <p className="text-sm text-accent-600 mb-3">
          إشعار وقت كل صلاة حتى والتطبيق مقفول. الإشعار من غير صوت أذان، ولما تضغط عليه التطبيق يفتح والأذان يشتغل.
        </p>
        {isIOSDevice() && !isStandaloneApp() && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
            على آيفون/آيباد الإشعارات تشتغل بس لو أضفت التطبيق للشاشة الرئيسية (iOS 16.4 أو أحدث).
          </p>
        )}
        {!settings.enabled || !settings.location ? (
          <p className="text-sm text-accent-600 bg-gray-50 border border-hairline rounded-xl p-3">
            فعّل التنبيهات وحدّد الموقع الأول.
          </p>
        ) : pushStatus && !pushStatus.supported ? (
          <p className="text-sm text-accent-600 bg-gray-50 border border-hairline rounded-xl p-3">
            جهازك أو متصفحك مش بيدعم إشعارات الويب (على آيفون: أضف التطبيق للشاشة الرئيسية، iOS 16.4 أو أحدث).
          </p>
        ) : (
          <>
            <button
              onClick={() => void togglePush()}
              disabled={pushBusy}
              className="w-full flex items-center justify-between p-4 rounded-xl border-2 transition-smooth border-hairline hover:border-hairline-emerald polish-press disabled:opacity-60"
            >
              <span className="text-right">
                <span className="block font-medium text-accent-800">إشعار الأذان والتطبيق مقفول</span>
                <span className="block text-sm text-accent-600">
                  {pushStatus?.subscribed
                    ? 'مفعّل'
                    : pushStatus?.permission === 'denied'
                      ? 'مرفوض — فعّله من إعدادات المتصفح/النظام'
                      : 'متوقف — اضغط للتفعيل'}
                </span>
              </span>
              <span className={`w-12 h-7 rounded-full p-1 transition-smooth flex-shrink-0 ${pushStatus?.subscribed ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                <span className={`block w-5 h-5 bg-white rounded-full shadow transition-smooth ${pushStatus?.subscribed ? 'mr-auto' : ''}`} />
              </span>
            </button>
            {pushError && <p className="text-sm text-red-600 mt-2">{pushError}</p>}
          </>
        )}
      </Collapsible>
    </div>
  );
}

function AdhanVoicePicker() {
  const [avail, setAvail] = useState<string[]>(['makkah']);
  const [cur, setCur] = useState(getAdhanVoice().id);
  const [dl, setDl] = useState<'no' | 'busy' | 'yes' | 'fail'>('no');
  useEffect(() => { void availableAdhanVoices().then(setAvail); }, []);
  useEffect(() => { setDl('no'); void isAdhanVoiceDownloaded(cur).then((y) => y && setDl('yes')); }, [cur]);
  return (
    <div className="grid gap-1.5 pr-3">
      {ADHAN_VOICES.filter((v) => avail.includes(v.id)).map((v) => (
        <button key={v.id} onClick={() => { setAdhanVoice(v.id); setCur(v.id); }}
          className={`text-right px-3 py-2 rounded-lg border text-sm ${cur === v.id ? 'border-emerald-500 bg-emerald-50 font-semibold' : 'border-hairline'}`}>
          {v.name}
        </button>
      ))}
      <button disabled={dl === 'busy' || dl === 'yes'} onClick={async () => { setDl('busy'); setDl((await downloadAdhanVoice(cur)) ? 'yes' : 'fail'); }}
        className="mt-1 min-h-[44px] rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-70">
        {dl === 'yes' ? '✓ متنزّل، هيشتغل من غير إنترنت' : dl === 'busy' ? 'بينزّل…' : dl === 'fail' ? 'التنزيل فشل، جرّب تاني' : 'عجبك؟ نزّله يشتغل من غير إنترنت'}
      </button>
    </div>
  );
}

function FajrAlarmSetting() {
  const [mode, setMode] = useState<FajrAlarmMode>(loadFajrAlarm());
  const [tone, setTone] = useState(loadFajrTone());
  const [night, setNight] = useState(isNightMode());
  const [recs, setRecs] = useState<AlarmRec[]>([]);
  const [recName, setRecName] = useState('');
  const [recording, setRecording] = useState<{ stop: () => Promise<Blob> } | null>(null);
  const [recErr, setRecErr] = useState('');
  useEffect(() => { void loadRecordings().then(setRecs); }, []);
  const toggleRecord = async () => {
    setRecErr('');
    if (recording) {
      const blob = await recording.stop(); setRecording(null);
      await saveRecording(recName || 'تسجيلي', blob); setRecs(await loadRecordings()); setRecName('');
      return;
    }
    try { setRecording(await startRecording()); } catch { setRecErr('لازم تسمح للميكروفون'); }
  };
  const previewStop = useRef<(() => void) | null>(null);
  const preview = (id: string) => {
    previewStop.current?.();
    previewStop.current = startAlarmTone(id);
    window.setTimeout(() => { previewStop.current?.(); previewStop.current = null; }, 3500);
  };
  const opts: [FajrAlarmMode, string, string][] = [
    ['off', 'بدون منبه', 'أذان الفجر العادي'],
    ['simple', 'منبه عادي', 'نغمة منبه بدل الأذان وزر إيقاف'],
    ['smart', 'منبه ذكي', 'لو كتمته يرن تاني بعد دقيقة، ولا يقف إلا بعد حل ٣ أسئلة (حساب، رقم، شكل مختلف)'],
  ];
  return (
    <div>
      <div className="grid gap-2">
        {opts.map(([k, t, d]) => (
          <button key={k} onClick={() => { setMode(k); saveFajrAlarm(k); void rescheduleNativeAlarms(); }}
            className={`text-right p-3 rounded-xl border-2 polish-press ${mode === k ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}>
            <span className="block font-medium text-accent-800">{t}</span>
            <span className="block text-sm text-accent-600">{d}</span>
          </button>
        ))}
        {mode !== 'off' && (
          <div>
            <p className="font-semibold text-accent-800 mt-1 mb-1 text-sm">نغمة المنبه (اضغط للتجربة)</p>
            <div className="grid grid-cols-3 gap-1.5">
              {[...recs.map((r) => ({ id: recToneId(r.id), name: '🎙 ' + r.name })), ...ALARM_CLIPS, ...ALARM_TONES].map((t) => (
                <button key={t.id} onClick={() => { setTone(t.id); saveFajrTone(t.id); preview(t.id); void rescheduleNativeAlarms(); }}
                  className={`py-2 rounded-lg text-xs font-bold polish-press ${tone === t.id ? 'grad-emerald-door text-white' : 'bg-gray-100 text-accent-700'}`}>{t.name}</button>
              ))}
            </div>
          </div>
        )}
        {ALARM_CLIPS.find((c) => c.id === tone)?.credit && (
          <p className="text-xs text-accent-600" dir="auto">{ALARM_CLIPS.find((c) => c.id === tone)?.credit}</p>
        )}
        {mode !== 'off' && (
          <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3">
            <p className="font-semibold text-accent-800 text-sm mb-1">🎙 سجّل رسالتك بصوتك أو بصوت زوجتك</p>
            <p className="text-xs text-accent-700 mb-2">مثلًا «قوم صلّي الفجر». الرسالة هتتكرر كمنبه، واختارها من النغمات فوق. التسجيل بيفضل على جهازك بس (لحد ٢٠ ثانية).</p>
            <input value={recName} onChange={(e) => setRecName(e.target.value)} placeholder="اسم التسجيل (مثلًا: صوت أمي)" className="w-full border border-gray-200 rounded-lg p-2 text-sm mb-2 bg-white" />
            <button onClick={() => void toggleRecord()} className={`w-full py-3 rounded-xl font-bold polish-press ${recording ? 'grad-amber-door text-white' : 'grad-emerald-door text-white'}`}>
              {recording ? '⏹ إيقاف وحفظ التسجيل' : '⏺ ابدأ التسجيل'}
            </button>
            {recErr && <p className="text-xs text-red-600 font-bold mt-1">{recErr}</p>}
            {recs.map((r) => (
              <div key={r.id} className="flex items-center gap-2 mt-2 text-sm">
                <span className="flex-1 truncate">🎙 {r.name}</span>
                <button onClick={() => preview(recToneId(r.id))} className="px-3 py-1 bg-white border border-emerald-300 rounded-lg">تجربة</button>
                <button onClick={() => { void deleteRecording(r.id).then(async () => { setRecs(await loadRecordings()); if (tone === recToneId(r.id)) { setTone('classic'); saveFajrTone('classic'); } }); }} className="px-3 py-1 bg-white border border-red-300 text-red-600 rounded-lg">حذف</button>
              </div>
            ))}
          </div>
        )}
        {isNativeApp() && (
          <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50 p-3">
            <button onClick={() => { void enableNativeAlarms().then((r) => alert(r.ok ? 'تم تفعيل الأذان والمنبه حتى والتطبيق مقفول' : 'لازم تسمح بالإشعارات (وبالمنبهات الدقيقة في أندرويد)')); }}
              className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl polish-press">تفعيل الأذان والمنبه والتطبيق مقفول</button>
            <p className="text-xs text-accent-700 mt-2 leading-relaxed">بيشتغل من نظام الجهاز نفسه فيرن حتى لو التطبيق مقفول أو الشاشة مقفولة. على آيفون النغمة بتتكرر كل دقيقة لحد ما تفتح التطبيق وتحل الأسئلة.</p>
          </div>
        )}
        {mode !== 'off' && !isNativeApp() && (
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
            <button onClick={() => { if (night) { stopNightMode(); setNight(false); } else { setNight(startNightMode()); } }}
              className={`w-full py-3 rounded-xl font-bold polish-press ${night ? 'grad-amber-door text-white' : 'bg-white border-2 border-amber-400 text-amber-800'}`}>
              {night ? '🌙 وضع الليلة شغّال — اضغط للإيقاف' : '🌙 شغّل المنبه الليلة (آيفون والشاشة مقفولة)'}
            </button>
            <p className="text-xs text-accent-700 mt-2 leading-relaxed">قبل النوم: اضغط الزر، اشحن الجهاز، سيب التطبيق مفتوح في الخلفية (متقفلوش من شاشة التطبيقات)، وارفع صوت الوسائط. هتلاقي «منبه الفجر شغّال» على شاشة القفل. ده أفضل ما يمكن في الويب لكن آيفون ممكن يوقفه (وضع توفير الطاقة مثلًا)، فاحتفظ بمنبه الساعة كاحتياطي.</p>
          </div>
        )}
        {mode !== 'off' && (
          <button onClick={() => window.dispatchEvent(new Event('fajr-alarm-test'))}
            className="w-full py-3 bg-white border-2 border-emerald-500 text-emerald-700 font-bold rounded-xl polish-press">▶ جرّب المنبه الآن</button>
        )}
        <p className="text-xs text-accent-600">المنبه يرن والتطبيق مفتوح فقط (قيد iOS)، ويحتاج لمسة واحدة على التطبيق بعد فتحه. سيب التطبيق مفتوح والشاشة شغالة بالليل.</p>
      </div>
    </div>
  );
}
