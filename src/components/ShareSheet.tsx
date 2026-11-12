// شارك (2026-11-13): one share sheet for the whole app — the social apps
// people use most in the Arab world, plus copy-link and the device's own
// share menu when it has one. Instagram has no web share link, so it is
// reached through «مشاركة من الجهاز» or by pasting the copied link.
import { useState } from 'react';
import { X, Copy, Check, Share2 } from 'lucide-react';
import { useEscapeClose } from '../lib/useEscape';

export default function ShareSheet({ title, text, url, onClose }: { title: string; text: string; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEscapeClose(true, onClose);
  const t = encodeURIComponent(text);
  const u = encodeURIComponent(url);
  const both = encodeURIComponent(`${text}\n${url}`);
  const targets: { name: string; href: string; bg: string }[] = [
    { name: 'واتساب', href: `https://wa.me/?text=${both}`, bg: '#25D366' },
    { name: 'تيليجرام', href: `https://t.me/share/url?url=${u}&text=${t}`, bg: '#229ED9' },
    { name: 'فيسبوك', href: `https://www.facebook.com/sharer/sharer.php?u=${u}`, bg: '#1877F2' },
    { name: 'ماسنجر', href: `fb-messenger://share/?link=${u}`, bg: '#0084FF' },
    { name: 'إكس', href: `https://twitter.com/intent/tweet?text=${t}&url=${u}`, bg: '#111111' },
    { name: 'رسالة SMS', href: `sms:?&body=${both}`, bg: '#3B5B4E' },
    { name: 'إيميل', href: `mailto:?subject=${encodeURIComponent(title)}&body=${both}`, bg: '#7C4410' },
  ];
  const canNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${text}\n${url}`); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };
  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-cream rounded-3xl shadow-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-accent-900">{title}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="p-2 rounded-lg text-accent-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {targets.map((s) => (
            <a key={s.name} href={s.href} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-1.5 polish-press">
              <span className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-md" style={{ background: s.bg }}>{s.name[0]}</span>
              <span className="text-xs font-bold text-accent-800 text-center">{s.name}</span>
            </a>
          ))}
          <button onClick={copy} className="flex flex-col items-center gap-1.5 polish-press">
            <span className="w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-md grad-amber-door">{copied ? <Check className="w-6 h-6" /> : <Copy className="w-6 h-6" />}</span>
            <span className="text-xs font-bold text-accent-800">{copied ? 'اتنسخ' : 'انسخ اللينك'}</span>
          </button>
        </div>
        {canNative && (
          <button onClick={() => { void navigator.share({ title, text, url }).catch(() => {}); }}
            className="mt-4 w-full py-3 grad-emerald-door text-white font-bold rounded-xl flex items-center justify-center gap-2 polish-press">
            <Share2 className="w-5 h-5" /> مشاركة من الجهاز (إنستجرام وغيره)
          </button>
        )}
      </div>
    </div>
  );
}
