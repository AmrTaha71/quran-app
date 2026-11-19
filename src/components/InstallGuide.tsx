// «ثبّت التطبيق» guide (W3-S5), the body of the Settings door `pwa`.
//
// What is really possible:
//  - Android / Chromium: one tap, IF the browser handed us the install
//    prompt (src/lib/installPrompt.ts keeps it from app start). Otherwise
//    the browser menu steps.
//  - iPhone / iPad: Apple gives websites NO way to open "Add to Home Screen"
//    or install in one tap. So this shows the 3 steps as pictures, plus two
//    helpers (copy the link, open the Share sheet) that save the first step.
//  - In-app browsers (Facebook, Instagram, ...): cannot install at all; the
//    page must be opened in Safari / Chrome first.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Check, Copy, Ellipsis, ExternalLink, Share, SquarePlus, Smartphone } from 'lucide-react';
import { getInstallPrompt, runInstallPrompt, subscribeInstall, wasInstalledNow } from '../lib/installPrompt';
import { pressFeedback } from '../lib/pressFeedback';

type Platform = 'ios' | 'android' | 'other';

function detectPlatform(): Platform {
  try {
    const ua = window.navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    if (isIOS) return 'ios';
    if (/Android/.test(ua)) return 'android';
  } catch { /* fall through */ }
  return 'other';
}

function isStandaloneNow(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch { return false; }
}

/** Facebook / Instagram / Line / Twitter / Google app webviews cannot install a web app. */
function inAppBrowser(): boolean {
  try { return /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|GSA\//i.test(window.navigator.userAgent || ''); } catch { return false; }
}

function Step({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3 items-start">
      <span className="w-8 h-8 shrink-0 rounded-full grad-emerald-door text-white font-bold flex items-center justify-center" aria-hidden="true">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-accent-800">{title}</p>
        <div className="mt-2 flex items-center justify-center rounded-xl border border-hairline bg-white py-3">{icon}</div>
        {children && <p className="text-sm text-accent-600 mt-2">{children}</p>}
      </div>
    </li>
  );
}

/** A tiny drawing of the iPhone Safari bottom bar with the target button ringed. */
function BarPicture({ target }: { target: 'share' | 'more' }) {
  const ring = 'ring-2 ring-offset-2 ring-amber-500 rounded-lg';
  return (
    <div className="flex items-center gap-6 px-5 py-2 rounded-2xl bg-gray-100 text-accent-600" dir="ltr" aria-hidden="true">
      <span className="text-lg">‹</span>
      <span className="text-lg">›</span>
      <span className={`p-1.5 ${target === 'share' ? ring + ' text-accent-800' : ''}`}><Share className="w-6 h-6" /></span>
      <span className="text-lg">📖</span>
      <span className={`p-1.5 ${target === 'more' ? ring + ' text-accent-800' : ''}`}><Ellipsis className="w-6 h-6" /></span>
    </div>
  );
}

export default function InstallGuide() {
  const [platform] = useState<Platform>(detectPlatform);
  const [standalone] = useState(isStandaloneNow);
  const [inApp] = useState(inAppBrowser);
  const prompt = useSyncExternalStore(subscribeInstall, getInstallPrompt, () => null);
  const installed = useSyncExternalStore(subscribeInstall, wasInstalledNow, () => false);
  const [outcome, setOutcome] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = window.setTimeout(() => setCopied(false), 2500); return () => window.clearTimeout(t); }, [copied]);

  const url = typeof window !== 'undefined' ? window.location.origin : '';
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setOutcome('تعذّر النسخ، انسخ الرابط من شريط العنوان.'); }
  };
  const openShare = async () => {
    try { await navigator.share({ url, title: 'تربيطات آيات القرآن' }); } catch { /* cancelled or unsupported */ }
  };
  const install = async () => {
    const r = await runInstallPrompt();
    setOutcome(r === 'accepted' ? 'اتثبّت. افتح التطبيق من أيقونة الشاشة الرئيسية.' : r === 'dismissed' ? 'اتلغى التثبيت. تقدر تحاول تاني من هنا.' : 'ما قدرناش نفتح نافذة التثبيت، جرّب الخطوات اللي تحت.');
  };

  if (standalone || installed) {
    return (
      <section id="sec-pwa" className="glass-card rounded-2xl p-5 scroll-mt-36">
        <p className="font-semibold text-emerald-700 flex items-center gap-2"><Check className="w-5 h-5" /> التطبيق مثبّت. بيفتح من أيقونة الشاشة الرئيسية.</p>
      </section>
    );
  }

  return (
    <section id="sec-pwa" className="glass-card rounded-2xl p-5 md:p-6 scroll-mt-36 space-y-4">
      <h2 className="text-base md:text-lg font-semibold text-accent-800 flex items-center gap-2">
        <Smartphone className="w-5 h-5 text-emerald-600" /> ثبّت التطبيق على جهازك
      </h2>

      {inApp && (
        <div className="rounded-xl bg-amber-50 border border-hairline-amber p-3 space-y-2">
          <p className="text-sm font-semibold text-amber-800">إنت فاتح الرابط جوه تطبيق (فيسبوك أو غيره) والتثبيت مش بيشتغل من هنا. افتحه في {platform === 'ios' ? 'سفاري' : 'كروم'}.</p>
          <button type="button" onClick={() => void copyLink()} onPointerDown={pressFeedback}
            className="w-full min-h-[48px] rounded-xl bg-white border-2 border-amber-400 text-amber-800 font-bold flex items-center justify-center gap-2 polish-press">
            <Copy className="w-5 h-5" /> {copied ? 'اتنسخ ✓' : 'انسخ الرابط'}
          </button>
        </div>
      )}

      {platform === 'ios' ? (
        <>
          <p className="text-sm text-accent-700 leading-relaxed">
            آبل مش بتسمح لأي موقع يثبّت التطبيق بنقرة واحدة، فمفيش زرار يعملها. التثبيت 3 خطوات بإيدك من سفاري:
          </p>
          <ol className="space-y-5">
            <Step n={1} icon={<BarPicture target="share" />} title="دوس زرار المشاركة">
              تحت في الآيفون، وفوق في الآيباد. لو مش لاقيه دوس «⋯» الأول.
            </Step>
            <Step n={2} icon={<span className="flex items-center gap-2 rounded-xl bg-gray-100 px-4 py-2 text-accent-800 font-semibold"><SquarePlus className="w-6 h-6" aria-hidden="true" /> إضافة إلى الشاشة الرئيسية</span>} title="اختار «إضافة إلى الشاشة الرئيسية»">
              لو مش ظاهرة، اسحب القائمة لفوق.
            </Step>
            <Step n={3} icon={<span className="rounded-xl bg-emerald-600 px-6 py-2 text-white font-bold">إضافة</span>} title="دوس «إضافة»">
              وبعدين افتح التطبيق من الأيقونة الجديدة.
            </Step>
          </ol>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void copyLink()} onPointerDown={pressFeedback}
              className="min-h-[48px] rounded-xl bg-white border-2 border-emerald-600 text-emerald-800 font-bold flex items-center justify-center gap-2 polish-press">
              <Copy className="w-5 h-5" /> {copied ? 'اتنسخ ✓' : 'انسخ الرابط'}
            </button>
            <button type="button" onClick={() => void openShare()} onPointerDown={pressFeedback}
              className="min-h-[48px] rounded-xl bg-white border-2 border-emerald-600 text-emerald-800 font-bold flex items-center justify-center gap-2 polish-press">
              <ExternalLink className="w-5 h-5" /> افتح المشاركة
            </button>
          </div>
          <p className="text-sm text-amber-800 bg-amber-50 border border-hairline-amber rounded-xl px-3 py-2 leading-relaxed">
            مهم: النسخة المثبتة ليها تخزين منفصل عن سفاري، هتدخل حسابك تاني وأي صفحات حمّلتها قبل كده مش هتبقى فيها. ثبّت الأول وبعدين حمّل.
          </p>
        </>
      ) : prompt ? (
        <button type="button" onClick={() => void install()} onPointerDown={pressFeedback}
          className="w-full min-h-[56px] py-3 grad-emerald-door text-white text-lg font-bold rounded-xl polish-press polish-focus">
          ثبّت التطبيق (نقرة واحدة)
        </button>
      ) : platform === 'android' ? (
        <p className="text-sm text-accent-700 leading-relaxed">
          زرار التثبيت المباشر لسه ما ظهرش في متصفحك. من كروم: القائمة (⋮) ثم «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».
        </p>
      ) : (
        <p className="text-sm text-accent-700 leading-relaxed">
          من قائمة المتصفح اختار «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».
        </p>
      )}
      {outcome && <p className="text-sm text-accent-600" role="status">{outcome}</p>}
    </section>
  );
}
