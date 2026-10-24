import { useState, useRef, useEffect } from 'react';
import {
  Share2, X, MessageCircle, Mail, Phone, Facebook, Twitter, Link2,
  Send, Linkedin, Copy, Check, Smartphone, Apple, Play,
} from 'lucide-react';

export default function ShareButton({
  verseText, surahName, ayahNo,
}: {
  verseText: string;
  surahName: string;
  ayahNo: number;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const appUrl = 'https://quran-links.app';
  const shareText = `${surahName} — آية ${ayahNo}\n\n${verseText}\n\nحمّل تطبيق روابط الذكر الحكيم:\n${appUrl}`;
  const encodedText = encodeURIComponent(shareText);
  const encodedUrl = encodeURIComponent(appUrl);

  const handleCopy = () => {
    navigator.clipboard.writeText(`${shareText}\n${appUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const socialPlatforms = [
    {
      icon: <MessageCircle className="w-8 h-8" />,
      label: 'واتساب',
      color: 'bg-green-500 hover:bg-green-600',
      url: `https://wa.me/?text=${encodedText}`,
    },
    {
      icon: <Send className="w-8 h-8" />,
      label: 'تيليجرام',
      color: 'bg-sky-500 hover:bg-sky-600',
      url: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
    },
    {
      icon: <Facebook className="w-8 h-8" />,
      label: 'فيسبوك',
      color: 'bg-blue-600 hover:bg-blue-700',
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`,
    },
    {
      icon: <Twitter className="w-8 h-8" />,
      label: 'إكس',
      color: 'bg-gray-800 hover:bg-gray-900',
      url: `https://twitter.com/intent/tweet?text=${encodedText}`,
    },
    {
      icon: <Linkedin className="w-8 h-8" />,
      label: 'لينكدإن',
      color: 'bg-blue-700 hover:bg-blue-800',
      url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    },
    {
      icon: <Mail className="w-8 h-8" />,
      label: 'بريد',
      color: 'bg-amber-500 hover:bg-amber-600',
      url: `mailto:?subject=${encodeURIComponent('روابط الذكر الحكيم')}&body=${encodedText}`,
    },
    {
      icon: <Phone className="w-8 h-8" />,
      label: 'رسالة SMS',
      color: 'bg-purple-500 hover:bg-purple-600',
      url: `sms:?&body=${encodedText}`,
    },
    {
      icon: copied ? <Check className="w-8 h-8" /> : <Copy className="w-8 h-8" />,
      label: copied ? 'تم النسخ' : 'نسخ الرابط',
      color: copied ? 'bg-emerald-600' : 'bg-teal-600 hover:bg-teal-700',
      url: '#copy',
      action: handleCopy,
    },
  ];

  const storeLinks = [
    {
      icon: <Play className="w-5 h-5" />,
      label: 'جوجل بلاي',
      color: 'bg-green-600 hover:bg-green-700',
      url: 'https://play.google.com/store/apps/details?id=com.quranlinks.app',
    },
    {
      icon: <Apple className="w-5 h-5" />,
      label: 'آب ستور',
      color: 'bg-gray-900 hover:bg-black',
      url: 'https://apps.apple.com/app/quran-links/id1234567890',
    },
    {
      icon: <Smartphone className="w-5 h-5" />,
      label: 'ويندوز',
      color: 'bg-blue-600 hover:bg-blue-700',
      url: 'https://www.microsoft.com/store/apps/quran-links',
    },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white text-base font-bold rounded-xl shadow-lg hover:shadow-xl transition-smooth active:scale-95"
      >
        <Share2 className="w-6 h-6" />
        مشاركة
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-2 bg-white rounded-2xl shadow-2xl border border-gray-200 p-5 w-[340px] sm:w-[380px] animate-slide-up right-0">
            <div className="flex items-center justify-between mb-4">
              <p className="text-base font-bold text-accent-800 flex items-center gap-2">
                <Share2 className="w-5 h-5 text-emerald-600" />
                شاركنا في الأجر
              </p>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-emerald-700 font-semibold text-center mb-4 bg-emerald-50 rounded-lg py-2 border border-emerald-100">
              «دلّ على الخير كفاعله» — شارك التطبيق واكسب الأجر
            </p>

            {/* Social platforms */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              {socialPlatforms.map((s) => (
                <a
                  key={s.label}
                  href={s.url}
                  onClick={(e) => {
                    if (s.action) { e.preventDefault(); s.action(); }
                  }}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl text-white text-xs font-semibold transition-smooth ${s.color}`}
                >
                  {s.icon}
                  {s.label}
                </a>
              ))}
            </div>

            {/* Download links */}
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-bold text-accent-600 mb-2 text-center">حمّل التطبيق من:</p>
              <div className="flex gap-2">
                {storeLinks.map((s) => (
                  <a
                    key={s.label}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-white text-xs font-bold transition-smooth ${s.color}`}
                  >
                    {s.icon}
                    {s.label}
                  </a>
                ))}
              </div>
            </div>

            {/* Native share API */}
            {typeof navigator !== 'undefined' && navigator.share && (
              <button
                onClick={async () => {
                  try {
                    await navigator.share({ title: 'روابط الذكر الحكيم', text: shareText, url: appUrl });
                  } catch { /* user cancelled */ }
                }}
                className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 bg-gray-50 hover:bg-gray-100 text-accent-700 text-sm font-semibold rounded-xl transition-smooth"
              >
                <Share2 className="w-5 h-5" />
                مشاركة أخرى
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
