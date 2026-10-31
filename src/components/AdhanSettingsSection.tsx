import { useEffect, useRef, useState } from 'react';
import { Bell, MapPin, Volume2 } from 'lucide-react';
import {
  ADHAN_AUDIO_CREDIT,
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
        className="w-full flex items-center justify-between p-4 rounded-xl border-2 transition-smooth border-hairline hover:border-hairline-emerald"
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
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-base font-bold rounded-xl transition-smooth"
            >
              {gpsBusy ? 'جارٍ تحديد موقعك…' : '📍 اكتشف موقعي تلقائيًا (GPS)'}
            </button>
            {gpsError && <p className="text-sm text-red-600 mt-2">{gpsError}</p>}
            <p className="text-sm text-accent-600 my-3 text-center">أو حدّد موقعك يدويًا — الدولة أولًا، ثم المدينة:</p>
            <div className="grid gap-3">
              <label className="block">
                <span className="block text-sm font-medium text-accent-700 mb-1">الدولة</span>
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="w-full p-3 rounded-xl border border-hairline-input bg-white text-accent-800"
                >
                  {ADHAN_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
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
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white text-base font-bold rounded-xl transition-smooth"
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
            className={`text-right p-3 rounded-xl border-2 ${settings.alertType === 'both' ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
          >
            <span className="block font-medium text-accent-800">صوتي + على الشاشة</span>
            <span className="block text-sm text-accent-600">الأذان يُسمَع وتظهر رسالة وقت الصلاة</span>
          </button>
          <button
            onClick={() => update({ alertType: 'audio' })}
            className={`text-right p-3 rounded-xl border-2 ${settings.alertType === 'audio' ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
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
            className={`text-right p-3 rounded-xl border-2 ${settings.sound === 'full' ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
          >
            <span className="block font-medium text-accent-800">أذان كامل — المسجد الحرام</span>
            <span className="block text-sm text-accent-600">المصدر الوحيد المفتوح الترخيص في القايمة</span>
          </button>
          <button
            onClick={() => update({ sound: 'beep' })}
            className={`text-right p-3 rounded-xl border-2 ${settings.sound === 'beep' ? 'border-emerald-500 bg-emerald-50' : 'border-hairline'}`}
          >
            <span className="block font-medium text-accent-800">تنبيه صوتي قصير</span>
            <span className="block text-sm text-accent-600">نغمة تنبيه مولّدة من الجهاز — من غير ملف صوتي</span>
          </button>
          <div className="text-right p-3 rounded-xl border-2 border-hairline opacity-60">
            <span className="block font-medium text-accent-800">
              «الله أكبر الله أكبر» فقط <span className="text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">قريبًا</span>
            </span>
            <span className="block text-sm text-accent-600">
              نقطة القصّ لسه مش مؤكدة من التسجيل — مش هنقصّ على تخمين، وهيتضاف بعد التحقق من التوقيت.
            </span>
          </div>
        </div>
        <button
          onClick={toggleTest}
          className="w-full mt-3 py-3 bg-white border-2 border-emerald-500 text-emerald-700 text-base font-bold rounded-xl transition-smooth"
        >
          {testing ? '⏹ إيقاف التجربة' : '▶ جرّب الصوت المختار'}
        </button>
        <p className="text-xs text-accent-600 mt-2">{ADHAN_AUDIO_CREDIT}</p>
        <p className="text-xs text-accent-600 mt-1">
          ملحوظة: آيفون/آيباد ممكن يمنع تشغيل الصوت قبل ما تلمس أي حاجة في التطبيق — زرار «جرّب الصوت» بيفتح الصوت، وأي ضغطة بعد فتح التطبيق تكفي للتنبيهات اللي بعدها.
        </p>
      </div>
    </section>
  );
}
