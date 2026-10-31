import { useEffect, useState } from 'react';
import { Headphones, Globe, BookMarked, Share2, Link } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { TOTAL_VERSES } from '../lib/types';
import { useLang } from '../lib/LanguageContext';
import { formatNum } from '../lib/numerals';
import { LANGUAGES } from '../lib/translations';
import CircularProgressIndicator from '../components/CircularProgressIndicator';
import ShareButton from '../components/ShareButton';
import QRCodeSection from '../components/QRCodeSection';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'follow';

export default function LandingPage({ session, onNavigate }: { session: Session | null; onNavigate: (r: Route) => void }) {
  const { t, lang, setLang } = useLang();
  const [stats, setStats] = useState({ total: TOTAL_VERSES, withLinks: 0 });
  const [showLangMenu, setShowLangMenu] = useState(false);

  useEffect(() => {
    (async () => {
      const { count } = await supabase
        .from('quran_verses')
        .select('*', { count: 'exact', head: true })
        .eq('has_links', true);
      setStats({ total: TOTAL_VERSES, withLinks: count || 0 });
    })();
  }, []);

  const percentage = Math.round((stats.withLinks / stats.total) * 100);

  return (
    <div className="min-h-screen page-bg">
      <header className="sticky top-0 z-50 app-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-lg">
              <Link className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-accent-800">{t('appName')}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowLangMenu(!showLangMenu)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-accent-600 hover:bg-gray-100 rounded-lg transition-smooth"
              >
                <Globe className="w-5 h-5" />
                {LANGUAGES.find((l) => l.code === lang)?.flag}
              </button>
              {showLangMenu && (
                <div className="absolute left-0 mt-2 bg-white rounded-xl shadow-xl border border-hairline p-2 min-w-[150px] z-50 animate-slide-up">
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
              className="px-5 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 rounded-xl transition-smooth"
            >
              {session ? 'لوحتي' : t('login')}
            </button>
            {/* No admin button here on purpose (2026-10-27): normal
                users never see an admin entry. */}
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden py-24 px-4">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-10 w-72 h-72 bg-emerald-300 rounded-full blur-3xl" />
          <div className="absolute bottom-10 left-10 w-96 h-96 bg-amber-300 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-emerald-500 to-teal-700 rounded-3xl flex items-center justify-center shadow-2xl mx-auto mb-6">
            <Link className="w-10 h-10 text-white" />
          </div>

          <h2 className="text-4xl md:text-6xl font-bold font-display-ar text-accent-800 mb-4">
            {t('appName')}
          </h2>
          <p className="text-xl text-accent-600 mb-10 max-w-2xl mx-auto leading-relaxed">
            {(lang === 'ar' || lang === 'ar-EG')
              ? 'احفظ القرآن بالتربيطات: كل آية مربوطة بما قبلها وما بعدها، عشان تثبت في ذهنك.'
              : 'Memorize the Quran through links: every ayah connected to what comes before and after it, so it sticks.'}
          </p>

          <div className="flex flex-col items-center gap-6 mb-10">
            <CircularProgressIndicator value={percentage} size={160} label={t('progress')} />
            <div className="text-center">
              <p className="text-3xl font-bold text-emerald-600">
                {formatNum(stats.withLinks, lang)} {t('indexedVerses')}
              </p>
              <p className="text-base text-accent-500">
                {(lang === 'ar' || lang === 'ar-EG') ? 'من أصل' : 'out of'} {formatNum(stats.total, lang)} {t('verse')}
              </p>
              <p className="text-sm text-amber-link mt-1">{formatNum(stats.total - stats.withLinks, lang)} {t('remaining')}</p>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-4 mb-10">
            <button
              onClick={() => onNavigate(session ? 'app' : 'auth')}
              className="flex items-center gap-2 px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-semibold rounded-xl shadow-lg hover:shadow-xl transition-smooth"
            >
              <Headphones className="w-6 h-6" />
              {session ? 'لوحتي' : t('userApp')}
            </button>
            <button
              onClick={() => onNavigate('mushaf')}
              className="flex items-center gap-2 px-8 py-4 bg-amber-600 hover:bg-amber-700 text-white text-base font-semibold rounded-xl shadow-lg hover:shadow-xl transition-smooth"
            >
              <BookMarked className="w-6 h-6" />
              افتح المصحف للحفظ
            </button>
          </div>

          {/* Share section */}
          <div className="flex flex-wrap justify-center items-center gap-4">
            <ShareButton verseText={t('appName')} surahName={t('appTagline')} ayahNo={0} />
            <QRCodeSection />
          </div>

          <p className="mt-6 text-lg text-emerald-700 font-semibold">
            شاركنا في الأجر — «دلّ على الخير كفاعله»
          </p>
        </div>
      </section>

      <footer className="py-10 px-4 border-t border-hairline-emerald bg-white">
        <div className="max-w-6xl mx-auto text-center text-base text-accent-500">
          <p>{t('appName')} © 2026</p>
          <p className="mt-2 text-sm text-emerald-700 font-semibold">معك في كل آية، حتى نُتمّ حفظ كتاب الله</p>
        </div>
      </footer>
    </div>
  );
}
