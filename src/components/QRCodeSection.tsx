import { useState } from 'react';
import { useEscapeClose } from '../lib/useEscape';
import { QrCode, X, Apple, Smartphone, Monitor, Download } from 'lucide-react';

export default function QRCodeSection() {
  const [open, setOpen] = useState(false);
  useEscapeClose(open, () => setOpen(false));

  // 2026-11-06: the app is NOT on any store yet, so every QR/button
  // points at the live web app and each card says how to install it on
  // that device (Add to Home Screen). When store listings exist, swap
  // `url` per device and restore the store names.
  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://rawabit-alziker-alhakim.vercel.app';
  const stores = [
    { icon: <Monitor className="w-7 h-7" />, label: 'على الكمبيوتر', desc: 'Chrome أو Edge ← أيقونة التثبيت في شريط العنوان', url: appUrl, color: 'grad-emerald-door' },
    { icon: <Apple className="w-7 h-7" />, label: 'على آيفون وآيباد', desc: 'Safari ← مشاركة ← إضافة إلى الشاشة الرئيسية', url: appUrl, color: 'grad-emerald-door' },
    { icon: <Smartphone className="w-7 h-7" />, label: 'على أندرويد', desc: 'Chrome ← القائمة ⋮ ← تثبيت التطبيق', url: appUrl, color: 'grad-emerald-door' },
  ];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-accent-600 to-accent-800 hover:from-accent-700 hover:to-accent-900 text-white font-bold rounded-2xl shadow-lg hover:shadow-xl transition-smooth"
      >
        <QrCode className="w-6 h-6 shrink-0" />
        <span className="text-right">
          <span className="block font-bold">حمّل التطبيق</span>
          <span className="block text-sm font-medium text-white/85">شارك التطبيق مع غيرك</span>
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="حمّل التطبيق" className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl p-6 animate-slide-up my-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center">
                  <QrCode className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-accent-800">حمّل التطبيق</h3>
                  <p className="text-xs text-accent-600">امسح الرمز بكاميرا هاتفك</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="إغلاق" className="icon-action p-2 text-ink-3 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {stores.map((s) => (
                <div key={s.label} className="flex flex-col items-center gap-3 p-5 bg-gradient-to-b from-gray-50 to-white rounded-2xl border-2 border-hairline hover:border-hairline-emerald transition-smooth">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-md ${s.color}`}>
                    {s.icon}
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-accent-800">{s.label}</p>
                    <p className="text-xs text-accent-600">{s.desc}</p>
                  </div>

                  {/* QR Code */}
                  <div className="w-32 h-32 bg-white border-3 border-hairline-emerald rounded-2xl flex items-center justify-center p-2 shadow-sm">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(s.url)}`}
                      alt={`QR ${s.label}`}
                      className="w-full h-full rounded-lg"
                      loading="lazy"
                      onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        img.style.display = 'none';
                        img.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                    <div className="hidden flex-col items-center text-accent-400">
                      <QrCode className="w-10 h-10 mb-1" />
                      <span className="text-xs">{s.desc}</span>
                    </div>
                  </div>

                  <a href={s.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-700">
                    <Download className="w-3.5 h-3.5" />
                    افتح التطبيق
                  </a>
                </div>
              ))}
            </div>

            <p className="text-center text-sm font-semibold text-emerald-800 mt-5">شاركنا الأجر وارسله لأصدقائك</p>
            <p className="text-center text-xs text-accent-600 mt-5">
              امسح الرمز بكاميرا جهازك، وبعدين ثبّته بالخطوات المكتوبة تحت جهازك — قريبًا إن شاء الله على المتاجر
            </p>
          </div>
        </div>
      )}
    </>
  );
}
