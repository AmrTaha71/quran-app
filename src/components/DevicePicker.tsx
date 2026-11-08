// "أنهي جهاز ده؟" — asked once per browser after sign-in (2026-11-08).
// Phones are split by platform (iPhone / Android) and screen size; the
// platform and size go into the account's settings JSON, so device_kind
// stays one of the four values the SQL allows.
import { useState } from 'react';
import { DeviceKind, setLocalDeviceKind, saveDeviceSettings } from '../lib/deviceProfile';

type Platform = 'ios' | 'android';
type ScreenSize = 'small' | 'large';

interface Props {
  userId: string;
  onDone: (kind: DeviceKind) => void;
}

export default function DevicePicker({ userId, onDone }: Props) {
  const [kind, setKind] = useState<DeviceKind | null>(null);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [size, setSize] = useState<ScreenSize | null>(null);
  const [saving, setSaving] = useState(false);

  const isPhone = kind === 'phone';
  const canSave = kind !== null && (!isPhone || (platform !== null && size !== null));

  const save = async () => {
    if (!kind || !canSave) return;
    setSaving(true);
    setLocalDeviceKind(kind);
    const details = isPhone ? { platform, screen: size } : {};
    // Saving to the account is best-effort: the device choice still applies locally.
    await saveDeviceSettings(userId, kind, details).catch(() => false);
    setSaving(false);
    onDone(kind);
  };

  const card = (active: boolean) =>
    `w-full text-right rounded-xl border p-4 ${active ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white'}`;

  return (
    <div dir="rtl" className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-emerald-800">أنهي جهاز ده؟</h2>
        <p className="text-sm text-slate-600">الاختيار ده بيتحفظ عشان الإعدادات تتظبط على الجهاز ده.</p>

        <div className="space-y-2">
          <button type="button" className={card(kind === 'phone')} onClick={() => setKind('phone')}>موبايل</button>
          <button type="button" className={card(kind === 'ipad')} onClick={() => setKind('ipad')}>آيباد</button>
          <button type="button" className={card(kind === 'tv')} onClick={() => setKind('tv')}>تلفزيون</button>
          <button type="button" className={card(kind === 'desktop')} onClick={() => setKind('desktop')}>كمبيوتر</button>
        </div>

        {isPhone && (
          <div className="space-y-3 border-t pt-4">
            <p className="font-semibold text-slate-800">نوع الموبايل</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={card(platform === 'ios')} onClick={() => setPlatform('ios')}>آيفون</button>
              <button type="button" className={card(platform === 'android')} onClick={() => setPlatform('android')}>أندرويد (مش آيفون)</button>
            </div>
            <p className="font-semibold text-slate-800">حجم الشاشة</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={card(size === 'small')} onClick={() => setSize('small')}>صغيرة</button>
              <button type="button" className={card(size === 'large')} onClick={() => setSize('large')}>كبيرة (Plus، Max، Pro Max)</button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={save}
          disabled={!canSave || saving}
          className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-40"
        >
          {saving ? 'بيتحفظ...' : 'تمام'}
        </button>
      </div>
    </div>
  );
}
