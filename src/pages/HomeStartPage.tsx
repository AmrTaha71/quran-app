import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { BookOpen, LayoutDashboard, Mic, Headphones, Settings } from 'lucide-react';
import BottomNav from '../components/BottomNav';
import { loadWird, WIRD_TYPE_LABEL } from '../lib/wird';
import { dailyDua, ISLAMIC_GREETING } from '../lib/personalTouch';
import { SURAHS } from '../lib/surahs';
import { SURAH_START_PAGES, TOTAL_MUSHAF_PAGES } from '../lib/mushafEditions';
import { getJuzFromPage } from '../lib/quranIndex';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test';

// Light start page (الرئيسية) for logged-in users: NOT a second
// dashboard. One resume card (last Mushaf page, from the same
// quran-mushaf-page key QuranMushafPage itself reads on open, so
// "continue" lands exactly where the user left off), one line for
// today's wird, and quick buttons only. Lists, search and filters
// stay on لوحتي — this page must stay light enough to read at a glance.
function readLastPage(): { page: number; visited: boolean } {
  try {
    const raw = localStorage.getItem('quran-mushaf-page');
    const n = Number(raw);
    if (raw !== null && Number.isInteger(n) && n >= 1 && n <= TOTAL_MUSHAF_PAGES) {
      return { page: n, visited: true };
    }
  } catch {}
  return { page: 1, visited: false };
}

function pageSurah(page: number): string {
  let result = 1;
  for (const { surah, page: startPage } of SURAH_START_PAGES) {
    if (startPage <= page) result = surah;
    else break;
  }
  return SURAHS.find((s) => s.no === result)?.name || '';
}

export default function HomeStartPage({ session, onNavigate }: {
  session: import('@supabase/supabase-js').Session | null;
  onNavigate: (r: Route) => void;
}) {
  const [preferredName, setPreferredName] = useState<string | null>(null);
  const [lastPage] = useState(readLastPage);
  const [wird] = useState(loadWird);
  const today = new Date().toLocaleDateString('en-CA');
  const doneToday = wird.doneDays.includes(today);
  const pagesText =
    wird.target === 1 ? 'صفحة واحدة' : wird.target === 2 ? 'صفحتين' : `${wird.target.toLocaleString('ar-EG')} صفحات`;
  const juz = getJuzFromPage(lastPage.page);

  useEffect(() => {
    const loadName = async () => {
      try {
        const userId = session?.user?.id;
        if (!userId) return;
        const { data } = await supabase.from('user_profiles').select('preferred_name').eq('user_id', userId).single();
        if (data?.preferred_name) setPreferredName(data.preferred_name);
      } catch {}
    };
    loadName();
  }, [session]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-stone-50/30 pb-24">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-emerald-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-lg">
            <BookOpen className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-accent-800">روابط الذكر الحكيم</h1>
            <p className="text-sm text-accent-500">الرئيسية</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5">
        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 mb-4">
          <p className="font-bold text-accent-800">{ISLAMIC_GREETING}</p>
          <p className="text-sm text-accent-500 mt-1">
            {preferredName ? `${dailyDua()} يا ${preferredName}` : dailyDua()}
          </p>
        </div>

        {/* Resume where the user left off */}
        <div className="bg-emerald-600 rounded-2xl shadow-sm p-5 mb-4 text-white">
          <p className="font-bold text-lg">
            {lastPage.visited ? 'أكمل من حيث توقفت' : 'ابدأ من أول المصحف'}
          </p>
          <p className="text-emerald-100 mt-1">
            صفحة {lastPage.page.toLocaleString('ar-EG')} — سورة {pageSurah(lastPage.page)} — جزء {juz.number.toLocaleString('ar-EG')}
          </p>
          <button
            onClick={() => onNavigate('mushaf')}
            className="mt-4 w-full py-3 bg-white text-emerald-700 font-bold rounded-xl flex items-center justify-center gap-2"
          >
            <BookOpen className="w-5 h-5" />
            {lastPage.visited ? `أكمل القراءة — صفحة ${lastPage.page.toLocaleString('ar-EG')}` : 'افتح المصحف'}
          </button>
        </div>

        {/* Today's wird, one line only — the full card lives on لوحتي */}
        <button
          onClick={() => onNavigate('app')}
          className="w-full bg-white rounded-2xl border border-amber-200 shadow-sm p-4 mb-4 text-right"
        >
          <p className="font-bold text-accent-800">
            ورد اليوم: {WIRD_TYPE_LABEL[wird.type]} — {pagesText}
          </p>
          <p className="text-sm text-accent-500 mt-1">
            {doneToday ? 'تم ✓ تقبل الله منك.' : 'لم ينجز بعد — من لوحتي علّمه منجزا.'}
          </p>
        </button>

        {/* Quick buttons only */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onNavigate('app')}
            className="py-3.5 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl flex items-center justify-center gap-2"
          >
            <LayoutDashboard className="w-5 h-5 text-emerald-600" /> لوحتي
          </button>
          <button
            onClick={() => onNavigate('follow')}
            className="py-3.5 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl flex items-center justify-center gap-2"
          >
            <Mic className="w-5 h-5 text-emerald-600" /> الحق الإمام
          </button>
          <button
            onClick={() => onNavigate('test')}
            className="py-3.5 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl flex items-center justify-center gap-2"
          >
            <Headphones className="w-5 h-5 text-emerald-600" /> سمّع لنفسك
          </button>
          <button
            onClick={() => onNavigate('settings')}
            className="py-3.5 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl flex items-center justify-center gap-2"
          >
            <Settings className="w-5 h-5 text-emerald-600" /> الإعدادات
          </button>
        </div>

        <p className="text-center text-sm text-emerald-700 font-semibold mt-6">
          معك في كل آية، حتى نُتمّ حفظ كتاب الله
        </p>
      </main>

      <BottomNav current="home" onNavigate={onNavigate} />
    </div>
  );
}
