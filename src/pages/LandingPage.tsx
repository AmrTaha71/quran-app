import { useEffect, useState } from 'react';
import { Headphones, Globe, BookMarked, Link, Brain, Moon, BookOpen, HeartHandshake } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { useLang } from '../lib/LanguageContext';
import { LANGUAGES, type Lang } from '../lib/translations';
import ShareButton from '../components/ShareButton';
import QRCodeSection from '../components/QRCodeSection';
import type { Route } from '../lib/routes';

// 2026-11-21: the landing page is ONE screen. Everything the visitor needs
// (what it is, free, start, mushaf, six benefits, share) is visible without
// scrolling, in the visitor's language. Copy is short on purpose: no
// paragraphs, nobody scrolls a landing page.
type Copy = {
  tag: string; free: string; noAds: string; start: string; dash: string; mushaf: string; share: string;
  f: [string, string, string, string, string, string];
};

const COPY: Record<Lang, Copy> = {
  'ar-EG': {
    tag: 'احفظ القرآن بالتربيطات: اربط الآيات بالمعنى وهتثبت في دماغك.',
    free: 'مجاني بالكامل', noAds: 'لا إعلانات ولا اشتراكات', start: 'ابدأ الحفظ', dash: 'لوحتي', mushaf: 'افتح المصحف',
    f: ['تربيطات بالمعنى', 'اختبر نفسك بالصوت', 'استمع في أي وقت', 'فهم الآية', 'مصحف للحفظ', 'مريح للعين'],
    share: 'شاركنا في الأجر: «الدالّ على الخير كفاعله»',
  },
  ar: {
    tag: 'احفظ القرآن بالتربيطات: اربط الآيات بالمعنى لتثبت في ذهنك.',
    free: 'مجاني بالكامل', noAds: 'لا إعلانات ولا اشتراكات', start: 'ابدأ الحفظ', dash: 'لوحتي', mushaf: 'افتح المصحف',
    f: ['تربيطات بالمعنى', 'اختبر نفسك بالصوت', 'استمع في أي وقت', 'فهم الآية', 'مصحف للحفظ', 'مريح للعين'],
    share: 'شاركنا في الأجر: «الدالّ على الخير كفاعله»',
  },
  en: {
    tag: 'Memorize the Quran through links: connect ayahs by meaning so they stick.',
    free: '100% free', noAds: 'No ads, no subscriptions', start: 'Start memorizing', dash: 'My dashboard', mushaf: 'Open the Mushaf',
    f: ['Links by meaning', 'Voice self-test', 'Listen anytime', 'Understand ayahs', 'Mushaf for hifz', 'Easy on the eyes'],
    share: 'Share and share the reward',
  },
  fr: {
    tag: 'Mémorisez le Coran par liens : reliez les versets par le sens.',
    free: '100 % gratuit', noAds: 'Sans pub ni abonnement', start: 'Commencer', dash: 'Mon tableau', mushaf: 'Ouvrir le Mushaf',
    f: ['Liens par le sens', 'Test vocal', 'Écoute continue', 'Comprendre', 'Mushaf de hifz', 'Reposant'],
    share: 'Partagez et partagez la récompense',
  },
  ur: {
    tag: 'ربطوں کے ذریعے قرآن یاد کریں: آیات کو معنی سے جوڑیں۔',
    free: 'بالکل مفت', noAds: 'نہ اشتہار نہ سبسکرپشن', start: 'حفظ شروع کریں', dash: 'میرا ڈیش بورڈ', mushaf: 'مصحف کھولیں',
    f: ['معنی سے ربط', 'آواز سے امتحان', 'کسی وقت سنیں', 'آیت کا فہم', 'حفظ کا مصحف', 'آنکھوں کو آرام'],
    share: 'ثواب میں شریک ہوں',
  },
  tr: {
    tag: 'Kur\'an\'ı bağlantılarla ezberle: ayetleri anlamla bağla.',
    free: 'Tamamen ücretsiz', noAds: 'Reklam ve abonelik yok', start: 'Ezberlemeye başla', dash: 'Panelim', mushaf: 'Mushaf\'ı aç',
    f: ['Anlamla bağlantı', 'Sesli test', 'İstediğin an dinle', 'Ayeti anla', 'Hıfz mushafı', 'Göze rahat'],
    share: 'Paylaş, sevaba ortak ol',
  },
  fa: {
    tag: 'قرآن را با پیوندها حفظ کنید: آیات را با معنا پیوند دهید.',
    free: 'کاملاً رایگان', noAds: 'بدون تبلیغ و اشتراک', start: 'شروع حفظ', dash: 'پیشخوان من', mushaf: 'باز کردن مصحف',
    f: ['پیوند با معنا', 'آزمون صوتی', 'هر زمان گوش کنید', 'فهم آیه', 'مصحف حفظ', 'آرامش چشم'],
    share: 'در ثواب شریک شوید',
  },
  id: {
    tag: 'Hafal Al-Qur\'an lewat tautan: hubungkan ayat berdasarkan makna.',
    free: 'Gratis sepenuhnya', noAds: 'Tanpa iklan & langganan', start: 'Mulai menghafal', dash: 'Dasbor saya', mushaf: 'Buka Mushaf',
    f: ['Tautan makna', 'Uji suara', 'Dengar kapan saja', 'Pahami ayat', 'Mushaf hafalan', 'Nyaman di mata'],
    share: 'Bagikan, raih pahalanya',
  },
  bn: {
    tag: 'লিংকের মাধ্যমে কুরআন মুখস্থ করুন: অর্থ দিয়ে আয়াত জুড়ুন।',
    free: 'সম্পূর্ণ বিনামূল্যে', noAds: 'বিজ্ঞাপন ও সাবস্ক্রিপশন নেই', start: 'মুখস্থ শুরু', dash: 'আমার ড্যাশবোর্ড', mushaf: 'মুসহাফ খুলুন',
    f: ['অর্থে সংযোগ', 'ভয়েস পরীক্ষা', 'যেকোনো সময় শুনুন', 'আয়াত বুঝুন', 'হিফজ মুসহাফ', 'চোখের আরাম'],
    share: 'শেয়ার করে সওয়াবের অংশী হোন',
  },
};

const ICONS = [Link, Brain, Headphones, BookOpen, BookMarked, Moon];

export default function LandingPage({ session, onNavigate }: { session: Session | null; onNavigate: (r: Route) => void }) {
  const { t, lang, setLang } = useLang();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const c = COPY[lang] ?? COPY.en;

  // Warm the first two Mushaf pages while the visitor reads this screen, so
  // «افتح المصحف» opens instantly (first impression). Same-origin WebP, cached by the SW.
  useEffect(() => {
    const t = window.setTimeout(() => {
      [1, 2].forEach((n) => { const im = new Image(); im.decoding = 'async'; im.src = `/mushaf-pages/madinah/${n}.webp`; });
    }, 400);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden page-bg relative">
      <div className="pointer-events-none absolute inset-0 opacity-10">
        <div className="absolute top-10 right-10 w-72 h-72 bg-emerald-300 rounded-full blur-3xl" />
        <div className="absolute bottom-10 left-10 w-96 h-96 bg-amber-300 rounded-full blur-3xl" />
      </div>

      {/* Header: language + login only. The app name lives in the hero, once. */}
      <header className="relative z-50 shrink-0">
        <div className="max-w-3xl mx-auto px-4 pt-1 pb-0 flex items-center justify-between">
          <div className="relative">
            <button
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-accent-600 hover:bg-white/60 rounded-lg transition-smooth"
              aria-label="Language"
            >
              <Globe className="w-5 h-5" />
              {LANGUAGES.find((l) => l.code === lang)?.flag}
            </button>
            {showLangMenu && (
              <div className="absolute start-0 mt-2 bg-white rounded-xl shadow-xl border border-hairline p-2 min-w-[150px] z-50 animate-slide-up">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => { setLang(l.code); setShowLangMenu(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-smooth ${
                      lang === l.code ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'hover:bg-gray-50 text-accent-600'
                    }`}
                  >
                    <span>{l.flag}</span>
                    {l.nativeName}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => onNavigate(session ? 'app' : 'auth')}
            className="px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-white/60 rounded-xl transition-smooth"
          >
            {session ? c.dash : t('login')}
          </button>
          {/* No admin button here on purpose (2026-10-27). */}
        </div>
      </header>

      {/* Everything below fits one screen; spacing flexes with the height. */}
      <main className="relative flex-1 min-h-0 flex flex-col justify-evenly items-center text-center px-4 pb-2 max-w-2xl w-full mx-auto">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 sm:w-20 sm:h-20 bg-gradient-to-br from-emerald-500 to-teal-700 rounded-2xl sm:rounded-3xl flex items-center justify-center shadow-xl mb-2">
            <Link className="w-6 h-6 sm:w-10 sm:h-10 text-white" />
          </div>
          <h1 className="text-2xl sm:text-5xl font-bold font-display-ar text-accent-800 leading-tight">{t('appName')}</h1>
          <p className="mt-1 text-sm sm:text-lg text-accent-600 max-w-md leading-snug [@media(max-height:600px)]:hidden">{c.tag}</p>
        </div>

        <div className="free-banner w-full flex items-center justify-center gap-3 px-4 py-2 sm:py-3 rounded-2xl bg-emerald-600 text-white shadow-xl">
          <HeartHandshake className="w-7 h-7 shrink-0" />
          <div className="text-start leading-tight">
            <p className="font-extrabold text-lg sm:text-2xl">{c.free}</p>
            <p className="text-xs sm:text-base font-semibold opacity-95">{c.noAds}</p>
          </div>
        </div>

        <div className="w-full flex gap-3">
          <button
            onClick={() => onNavigate(session ? 'app' : 'auth')}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 sm:py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold rounded-xl shadow-lg transition-smooth"
          >
            <Headphones className="w-5 h-5 shrink-0" />
            {session ? c.dash : c.start}
          </button>
          <button
            onClick={() => onNavigate('mushaf')}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 sm:py-3.5 bg-amber-600 hover:bg-amber-700 text-white text-base font-bold rounded-xl shadow-lg transition-smooth"
          >
            <BookMarked className="w-5 h-5 shrink-0" />
            {c.mushaf}
          </button>
        </div>

        <div className="w-full grid grid-cols-3 gap-2.5">
          {c.f.map((title, i) => {
            const Icon = ICONS[i];
            return (
              <div key={i} className="bg-white/85 backdrop-blur rounded-2xl px-1.5 py-2 border border-hairline-emerald shadow-sm flex flex-col items-center gap-1">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-emerald-700" />
                </div>
                <p className="font-bold text-accent-800 text-xs sm:text-sm leading-tight">{title}</p>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div className="flex flex-wrap justify-center items-center gap-3">
            <ShareButton verseText={t('appName')} surahName={t('appTagline')} ayahNo={0} />
            <QRCodeSection />
          </div>
          <p className="text-sm text-emerald-700 font-semibold [@media(max-height:600px)]:hidden">{c.share}</p>
        </div>
      </main>
    </div>
  );
}
