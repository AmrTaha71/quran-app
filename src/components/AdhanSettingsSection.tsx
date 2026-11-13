import { ALARM_TONES, loadFajrTone, saveFajrTone, startAlarmTone, loadFajrAlarm, saveFajrAlarm, type FajrAlarmMode } from '../lib/fajrAlarm';
import { useEffect, useRef, useState } from 'react';
import DrumSelect from './DrumSelect';
import { Bell, MapPin, Volume2 } from 'lucide-react';
import {
  ADHAN_AUDIO_CREDIT,
  ADHAN_VOICES, getAdhanVoice, setAdhanVoice, availableAdhanVoices, isAdhanVoiceDownloaded, downloadAdhanVoice,
  ADHAN_COUNTRIES,
  ADHAN_PRAYERS,
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

  return (
    <section id="sec-adhan" className="bg-white rounded-2xl border border-hairline shadow-sm scroll-mt-36 p-5">
      <h2 className="text-base font-semibold text-accent-800 flex items-center gap-2 mb-1">
        <Bell className="w-5 h-5 text-emerald-600" /> مواعيد الأذان
      </h2>
      <p className="text-sm text-accent-600 mb-4">
        مواقيت الصلاة لموقعك، وتنبيه بالأذان وقت كل صلاة — التنبيه يشتغل والتطبيق مفتوح فقط، لأن تطبيقات الويب على آيفون لا تعمل في الخلفية.
      </p>

      {/* Master switch */}
      <button
        onClick={() => update({ enabled: !settings.enabled })}
        className="w-full flex items-center justify-between p-4 rounded-xl border-2 transition-smooth border-hairline hover:border-hairline-emerald polish-press"
      >
        <span className="text-right">
          <span className="block font-medium text-accent-800">تفعيل تنبيهات الأذان</span>
          <span className="block text-sm text-accent-600">
            {settings.enabled ? 'مفعّلة — التنبيه هيشتغل وقت كل صلاة والتطبيق مفتوح' : 'متوقفة — فعّلها بعد ضبط الموقع'}
          </span>
        </span>
        <span className={`w-12 h-7 rounded-full p-1 transition-smooth flex-shrink-0 ${settings.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}>
          <span className={`block w-5 h-5 bg-white rounded-full shadow transition-smooth ${settings.enabled ? 'mr-auto' : ''}`} />
        </span>
      </button>

      {/* Location */}
      <div className="mt-4">
        <p className="font-semibold text-accent-800 flex items-center gap-2 mb-2">
          <MapPin className="w-5 h-5 text-emerald-600" /> الموقع
        </p>
        {settings.location ? (
          <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-emerald-50 border border-hairline-emerald">
            <span className="font-medium text-accent-800">{adhanLocationLabel(settings.location)}</span>
            <button
              onClick={() => update({ location: null })}
              className="text-sm font-medium text-red-600 px-2 py-1"
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
            <p className="text-sm text-accent-600 my-3 text-center">أو حدّد موقعك يدويًا — الدولة أولًا، ثم المدينة:</p>
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
      </div>

      {/* Today's times */}
      {settings.location && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-accent-800">مواقيت اليوم</p>
            <button onClick={() => void refreshDay(settings.location)} className="text-sm font-semibold text-emerald-700 px-2 py-1">
              تحديث المواقيت
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
              <p className="text-sm text-accent-700 mt-3">
                {nextPrayer
                  ? `الصلاة القادمة: ${nextPrayer.label} — ${day.timings[nextPrayer.key]}`
                  : 'انتهت صلوات اليوم — الصلاة القادمة فجر الغد.'}
              </p>
              <p className="text-xs text-accent-600 mt-1">
                {day.hijri && `${day.hijri} • `}
                {day.methodName && `طريقة الحساب: ${day.methodName} • `}
                النطاق الزمني: {day.timezone}
              </p>
            </>
          )}
        </div>
      )}

      {/* Alert type */}
      <div className="mt-4">
        <p className="font-semibold text-accent-800 mb-2">نوع التنبيه</p>
        <div className="grid gap-2">
          <button
            onClick={() => update({ alertType: 'both' })}
            className={`text-right p-3 rounded-xl border-2 polish-press ${settings.alertType === 'both' ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
          >
            <span className="block font-medium text-accent-800">صوتي + على الشاشة</span>
            <span className="block text-sm text-accent-600">الأذان يُسمَع وتظهر رسالة وقت الصلاة</span>
          </button>
          <button
            onClick={() => update({ alertType: 'audio' })}
            className={`text-right p-3 rounded-xl border-2 polish-press ${settings.alertType === 'audio' ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
          >
            <span className="block font-medium text-accent-800">صوتي فقط</span>
            <span className="block text-sm text-accent-600">الأذان يُسمَع من غير رسالة على الشاشة</span>
          </button>
        </div>
      </div>

      {/* Sound */}
      <div className="mt-4">
        <p className="font-semibold text-accent-800 mb-2 flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-emerald-600" /> صوت التنبيه
        </p>
        <div className="grid gap-2">
          <button
            onClick={() => update({ sound: 'full' })}
            className={`text-right p-3 rounded-xl border-2 polish-press ${settings.sound === 'full' ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
          >
            <span className="block font-medium text-accent-800">أذان كامل</span>
            <span className="block text-sm text-accent-600">اختار المؤذن من تحت</span>
          </button>
          {settings.sound === 'full' && <AdhanVoicePicker />}
          <button
            onClick={() => update({ sound: 'beep' })}
            className={`text-right p-3 rounded-xl border-2 polish-press ${settings.sound === 'beep' ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
          >
            <span className="block font-medium text-accent-800">تنبيه صوتي قصير</span>
            <span className="block text-sm text-accent-600">نغمة تنبيه مولّدة من الجهاز — من غير ملف صوتي</span>
          </button>
          <button
            onClick={() => update({ sound: 'takbir' })}
            className={`text-right p-3 rounded-xl border-2 polish-press ${settings.sound === 'takbir' ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
          >
            <span className="block font-medium text-accent-800">«الله أكبر الله أكبر» فقط</span>
            <span className="block text-sm text-accent-600">أول جملة من الأذان كتنبيه قصير (بصوت المؤذن المختار)</span>
          </button>
          {settings.sound === 'takbir' && <AdhanVoicePicker />}
        </div>
        <button
          onClick={toggleTest}
          className="w-full mt-3 py-3 bg-white border-2 border-emerald-500 text-emerald-700 text-base font-bold rounded-xl transition-smooth polish-press"
        >
          {testing ? '⏹ إيقاف التجربة' : '▶ جرّب الصوت المختار'}
        </button>
        <p className="text-xs text-accent-600 mt-2" dir="auto">{getAdhanVoice().credit || ADHAN_AUDIO_CREDIT}</p>
        <p className="text-xs text-accent-600 mt-1">
          ملحوظة: آيفون/آيباد ممكن يمنع تشغيل الصوت قبل ما تلمس أي حاجة في التطبيق — زرار «جرّب الصوت» بيفتح الصوت، وأي ضغطة بعد فتح التطبيق تكفي للتنبيهات اللي بعدها.
        </p>
      </div>

      <FajrAlarmSetting />

      {/* Web Push — adhan notification even when the app is closed.
          The notification itself carries no audio (iOS cannot
          auto-play audio from a closed app): tapping it opens the
          app and the adhan plays. iOS needs the app added to the
          Home Screen + iOS 16.4 or newer. */}
      <div className="mt-4">
        <p className="font-semibold text-accent-800 mb-2 flex items-center gap-2">
          <Bell className="w-5 h-5 text-emerald-600" /> تنبيه الأذان والتطبيق مقفول
        </p>
        <p className="text-sm text-accent-600 mb-3">
          إشعار يوصلك وقت كل صلاة حتى لو التطبيق مقفول — تضغط عليه فيفتح التطبيق ويشتغل الأذان. الصوت نفسه لا يشتغل من التطبيق المقفول (نظام آيفون يمنع ذلك)، الإشعار هو اللي يوصلك والضغطة هي اللي تشغّل الأذان.
        </p>
        {isIOSDevice() && !isStandaloneApp() && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
            على آيفون/آيباد: الإشعارات لا تعمل إلا إذا أضفت التطبيق إلى الشاشة الرئيسية — من متصفح سفاري اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»، وافتح التطبيق من الأيقونة المضافة، ثم فعّل التنبيهات من هنا.
          </p>
        )}
        {!settings.enabled || !settings.location ? (
          <p className="text-sm text-accent-600 bg-gray-50 border border-hairline rounded-xl p-3">
            فعّل تنبيهات الأذان وحدّد الموقع أولًا من الأقسام اللي فوق، وبعدها تقدر تفعّل الإشعار هنا.
          </p>
        ) : pushStatus && !pushStatus.supported ? (
          <p className="text-sm text-accent-600 bg-gray-50 border border-hairline rounded-xl p-3">
            جهازك أو متصفحك لا يدعم إشعارات الويب — على آيفون/آيباد لازم التطبيق يكون مضافًا للشاشة الرئيسية، ونظام iOS 16.4 أو أحدث.
          </p>
        ) : (
          <>
            <button
              onClick={() => void togglePush()}
              disabled={pushBusy}
              className="w-full flex items-center justify-between p-4 rounded-xl border-2 transition-smooth border-hairline hover:border-hairline-emerald polish-press disabled:opacity-60"
            >
              <span className="text-right">
                <span className="block font-medium text-accent-800">تفعيل إشعار الأذان والتطبيق مقفول</span>
                <span className="block text-sm text-accent-600">
                  {pushStatus?.subscribed
                    ? 'مفعّلة — هيوصلك إشعار وقت كل صلاة حتى لو التطبيق مقفول'
                    : pushStatus?.permission === 'denied'
                      ? 'مرفوضة — إذن الإشعارات مرفوض من إعدادات المتصفح/النظام'
                      : 'متوقفة — اضغط للتفعيل والسماح بالإشعارات'}
                </span>
              </span>
              <span className={`w-12 h-7 rounded-full p-1 transition-smooth flex-shrink-0 ${pushStatus?.subscribed ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                <span className={`block w-5 h-5 bg-white rounded-full shadow transition-smooth ${pushStatus?.subscribed ? 'mr-auto' : ''}`} />
              </span>
            </button>
            {pushError && <p className="text-sm text-red-600 mt-2">{pushError}</p>}
            {pushStatus?.subscribed && (
              <p className="text-xs text-accent-600 mt-2">
                لو غيّرت الموقع من القسم اللي فوق، الاشتراك بيتحدّث تلقائيًا مع فتح التطبيق — من غير ما تعيد التفعيل.
              </p>
            )}
          </>
        )}
      </div>
    </section>
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
    <div className="mt-4">
      <p className="font-semibold text-accent-800 mb-2">⏰ منبه الفجر</p>
      <div className="grid gap-2">
        {opts.map(([k, t, d]) => (
          <button key={k} onClick={() => { setMode(k); saveFajrAlarm(k); }}
            className={`text-right p-3 rounded-xl border-2 polish-press ${mode === k ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}>
            <span className="block font-medium text-accent-800">{t}</span>
            <span className="block text-sm text-accent-600">{d}</span>
          </button>
        ))}
        {mode !== 'off' && (
          <div>
            <p className="font-semibold text-accent-800 mt-1 mb-1 text-sm">نغمة المنبه (اضغط للتجربة)</p>
            <div className="grid grid-cols-3 gap-1.5">
              {ALARM_TONES.map((t) => (
                <button key={t.id} onClick={() => { setTone(t.id); saveFajrTone(t.id); preview(t.id); }}
                  className={`py-2 rounded-lg text-xs font-bold polish-press ${tone === t.id ? 'grad-emerald-door text-white' : 'bg-gray-100 text-accent-700'}`}>{t.name}</button>
              ))}
            </div>
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
