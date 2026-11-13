// «اتجاه القبلة» (2026-11-13): compass pointing at the Kaaba. Location is
// read once from the device and never leaves it. iOS asks for compass
// permission on a tap, so the compass starts from a button.
import { useEffect, useRef, useState } from 'react';
import { Compass, X } from 'lucide-react';
import { getPosition, kaabaDistanceKm, qiblaBearing } from '../lib/qibla';

type Pos = { lat: number; lng: number };

export default function QiblaSheet({ onClose }: { onClose: () => void }) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [err, setErr] = useState('');
  const [heading, setHeading] = useState<number | null>(null);
  const [compassErr, setCompassErr] = useState('');
  const listening = useRef(false);

  useEffect(() => {
    let alive = true;
    getPosition().then((p) => alive && setPos(p)).catch(() => alive && setErr('ما قدرتش أعرف مكانك. اسمح للموقع من إعدادات المتصفح وجرّب تاني.'));
    return () => { alive = false; };
  }, []);

  const onOrient = (e: any) => {
    // iOS gives webkitCompassHeading (clockwise from north); Android gives alpha (counter-clockwise).
    let h: number | null = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
    if (h !== null) setHeading(h);
  };

  const startCompass = async () => {
    setCompassErr('');
    try {
      const D: any = (window as any).DeviceOrientationEvent;
      if (D && typeof D.requestPermission === 'function') {
        const r = await D.requestPermission();
        if (r !== 'granted') { setCompassErr('لازم تسمح للبوصلة عشان السهم يتحرك.'); return; }
      }
      if (!listening.current) {
        listening.current = true;
        window.addEventListener('deviceorientationabsolute', onOrient as any, true);
        window.addEventListener('deviceorientation', onOrient as any, true);
      }
      setTimeout(() => { setHeading((h) => { if (h === null) setCompassErr('الجهاز ده مفيهوش بوصلة. استخدم الزاوية المكتوبة تحت.'); return h; }); }, 2500);
    } catch { setCompassErr('مقدرتش أشغّل البوصلة على الجهاز ده.'); }
  };
  useEffect(() => () => {
    window.removeEventListener('deviceorientationabsolute', onOrient as any, true);
    window.removeEventListener('deviceorientation', onOrient as any, true);
  }, []);

  const bearing = pos ? qiblaBearing(pos.lat, pos.lng) : null;
  const rotate = bearing === null ? 0 : heading === null ? bearing : (bearing - heading + 360) % 360;
  const aligned = heading !== null && bearing !== null && Math.min(rotate, 360 - rotate) < 4;

  return (
    <div dir="rtl" className="fixed inset-0 z-[80] bg-black/50 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-emerald-800 flex items-center gap-2"><Compass className="w-6 h-6" /> اتجاه القبلة</h2>
          <button onClick={onClose} aria-label="إغلاق" className="p-2 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg p-3">{err}</p>}
        {!pos && !err && <p className="text-center text-accent-700">بحدد مكانك…</p>}

        {pos && bearing !== null && (
          <>
            <div className="relative mx-auto w-64 h-64 rounded-full border-4 border-amber-400 bg-emerald-50 flex items-center justify-center">
              <span className="absolute top-1 text-xs font-bold text-emerald-900">شمال</span>
              <div className="absolute inset-4" style={{ transform: `rotate(${rotate}deg)`, transition: 'transform 0.25s ease-out' }}>
                <div className="absolute left-1/2 top-0 -translate-x-1/2 flex flex-col items-center">
                  <span className={`text-3xl ${aligned ? 'drop-shadow-[0_0_8px_#d4a017]' : ''}`} aria-hidden="true">🕋</span>
                  <div className="w-2 h-24 rounded-full" style={{ background: aligned ? '#b8860b' : '#065f46' }} />
                </div>
              </div>
              <div className="w-3 h-3 rounded-full bg-emerald-900" />
            </div>
            <p className="text-center font-bold text-emerald-900 text-lg">
              {aligned ? 'تمام، ده اتجاه القبلة' : `القبلة ${Math.round(bearing).toLocaleString('ar-EG')}° من الشمال`}
            </p>
            <p className="text-center text-sm text-accent-700">المسافة للكعبة حوالي {Math.round(kaabaDistanceKm(pos.lat, pos.lng)).toLocaleString('ar-EG')} كم</p>
            {heading === null && (
              <button onClick={startCompass} className="w-full min-h-[52px] rounded-xl grad-amber-door text-white font-bold">شغّل البوصلة</button>
            )}
            {compassErr && <p className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3">{compassErr}</p>}
            <p className="text-xs text-accent-500 text-center">امسك الجهاز مسطّح بعيد عن الحديد والمغناطيس. الدقة تقريبية، ولو في شك اتأكد من اتجاه المسجد.</p>
          </>
        )}
      </div>
    </div>
  );
}
