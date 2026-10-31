import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeClose } from '../lib/useEscape';
import {
  Share2, X, MessageCircle, Mail, Phone, Facebook, Twitter, Link2,
  Send, Linkedin, Copy, Check,
} from 'lucide-react';
import { APP_URL, buildShareUrl } from '../lib/shareLinks';

export default function ShareButton({
  verseText, surahName, ayahNo, surahNo, pageNo,
}: {
  verseText: string;
  surahName: string;
  ayahNo: number;
  /** Surah number, when known — enables a real ayah deep link. */
  surahNo?: number;
  /** Madinah page number, when known — used only if no ayah is given. */
  pageNo?: number;
}) {
  const [open, setOpen] = useState(false);
  useEscapeClose(open, () => setOpen(false));
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const isGenericAppShare = ayahNo === 0;
  // Real deep link: an ayah share points at that ayah, a page share at
  // that page; only the generic (landing) share stays on the bare URL.
  const shareUrl = isGenericAppShare
    ? APP_URL
    : buildShareUrl({ surah: surahNo, ayah: ayahNo, page: pageNo });
  const shareText = isGenericAppShare
    ? `روابط الذكر الحكيم\n\nاحفظ القرآن بالتربيطات:\n${shareUrl}`
    : `${surahName} — آية ${ayahNo}\n\n${verseText}\n\nحمّل تطبيق روابط الذكر الحكيم:\n${shareUrl}`;
  const encodedText = encodeURIComponent(shareText);
  const encodedUrl = encodeURIComponent(shareUrl);

  // Position the panel from the trigger's viewport rect when it opens,
  // and re-measure on resize: the panel is portalled to <body> (below),
  // so no overflow-hidden ancestor can clip it, and its width is
  // capped at the viewport (min(340px, 100vw - 2rem)).
  const measurePanel = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const width = Math.min(340, vw - 32);
    // Align the panel's right edge with the trigger's right edge
    // (RTL layout), clamped inside the viewport with a 1rem margin.
    const left = Math.min(Math.max(16, rect.right - width), vw - width - 16);
    const top = Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - 16));
    setPanelStyle({ top, left, width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    measurePanel();
    window.addEventListener('resize', measurePanel);
    return () => window.removeEventListener('resize', measurePanel);
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Copy only reports success after the write actually resolves. The
  // async Clipboard API is tried first; on pages where it is
  // unavailable (non-secure context, denied permission) a hidden
  // textarea + execCommand fallback runs. If both fail, no "تم النسخ"
  // is shown — instead the URL is displayed for a manual copy.
  const handleCopy = async () => {
    setCopyFailed(false);
    const text = shareText;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyFailed(true);
    }
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

  // The app is not published in any store yet, so there are no real store
  // links to show. Share the web link for now; store links appear only
  // after actual publication. (Previously this section linked to
  // placeholder store URLs that do not exist — removed.)

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white text-base font-bold rounded-xl shadow-lg hover:shadow-xl transition-smooth active:scale-95"
      >
        <Share2 className="w-6 h-6" />
        مشاركة
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          {/* Portalled to <body> so overflow-hidden verse cards can never
              clip it; width capped at min(340px, 100vw - 2rem) and the
              panel itself scrolls on short landscape heights. */}
          <div ref={panelRef}
            className="fixed z-50 bg-white rounded-2xl shadow-2xl border border-hairline p-5 animate-slide-up max-h-[calc(100dvh-2rem)] overflow-y-auto"
            style={panelStyle ? { top: panelStyle.top, left: panelStyle.left, width: panelStyle.width } : { left: 16, right: 16 }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-base font-bold text-accent-800 flex items-center gap-2">
                <Share2 className="w-5 h-5 text-emerald-600" />
                شاركنا في الأجر
              </p>
              <button onClick={() => setOpen(false)} aria-label="إغلاق" className="icon-action text-ink-3 hover:text-ink-2 p-1 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-emerald-700 font-semibold text-center mb-4 bg-emerald-50 rounded-lg py-2 border border-hairline-emerald">
              «دلّ على الخير كفاعله» — شارك التطبيق واكسب الأجر
            </p>

            {/* Social platforms */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              {socialPlatforms.map((s) => (
                <a
                  key={s.label}
                  href={s.url}
                  onClick={(e) => {
                    if (s.action) { e.preventDefault(); void s.action(); }
                  }}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className={`icon-action flex-col p-3 rounded-xl text-white text-xs font-semibold transition-smooth ${s.color}`}
                >
                  {s.icon}
                  {s.label}
                </a>
              ))}
            </div>

            {/* Store links: pending publication — share the web link meanwhile */}
            <div className="border-t border-hairline pt-4">
              <p className="text-sm text-accent-600 mb-2 text-center">
                التطبيق غير منشور في المتاجر بعد — شارك رابط الويب، وستظهر روابط جوجل بلاي وآب ستور وويندوز هنا بعد النشر الفعلي.
              </p>
              <button
                onClick={() => void handleCopy()}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-white text-sm font-bold transition-smooth bg-teal-600 hover:bg-teal-700"
              >
                <Link2 className="w-5 h-5" />
                {copied ? 'تم نسخ رابط الويب' : 'نسخ رابط الويب'}
              </button>
              {copyFailed && (
                <div className="mt-3">
                  <p className="text-xs font-bold text-red-600 text-center mb-2">تعذّر النسخ التلقائي — انسخ الرابط يدويًا:</p>
                  <input readOnly value={shareUrl} onFocus={(e) => e.target.select()}
                    className="w-full px-3 py-2 rounded-lg border border-hairline bg-gray-50 text-xs text-accent-700 break-all" dir="ltr" />
                </div>
              )}
            </div>

            {/* Native share API */}
            {typeof navigator !== 'undefined' && navigator.share && (
              <button
                onClick={async () => {
                  try {
                    await navigator.share({ title: 'روابط الذكر الحكيم', text: shareText, url: shareUrl });
                  } catch { /* user cancelled */ }
                }}
                className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 bg-gray-50 hover:bg-gray-100 text-accent-700 text-sm font-semibold rounded-xl transition-smooth"
              >
                <Share2 className="w-5 h-5" />
                مشاركة أخرى
              </button>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
