import { useEffect, useState } from 'react';
import { useEscapeClose } from '../lib/useEscape';
import { supabase } from '../lib/supabase';
import { BookOpen, LayoutDashboard, Mic, Headphones, Settings, Link, Radio, SunMoon } from 'lucide-react';
import BottomNav from '../components/BottomNav';
import { loadWird, WIRD_TYPE_LABEL } from '../lib/wird';
import { dailyDua, ISLAMIC_GREETING } from '../lib/personalTouch';
import { SURAHS } from '../lib/surahs';
import { readListeningWird } from '../lib/listenPlayback';
import { SURAH_START_PAGES, TOTAL_MUSHAF_PAGES } from '../lib/mushafEditions';
import { getJuzFromPage } from '../lib/quranIndex';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test' | 'listen';

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
  // تربيط اليوم: one approved link, picked deterministically by
  // day-of-year (offset = (dayOfYear - 1) % approvedCount, ordered by
  // id). Any failure or empty result hides the card entirely — link
  // content is never invented.
  const [linkOfDay, setLinkOfDay] = useState<{ surah: number; surahName: string; ayah: number; title: string | null; text: string } | null>(null);
  // First-run 3-step screen: home only, once per device, dismissible.
  const [showIntro, setShowIntro] = useState(() => {
    try { return localStorage.getItem('quran-first-run-seen') !== '1'; } catch { return false; }
  });
  const dismissIntro = () => {
    try { localStorage.setItem('quran-first-run-seen', '1'); } catch { /* ignore */ }
    setShowIntro(false);
  };
  useEscapeClose(showIntro, dismissIntro);
  const [lastPage] = useState(readLastPage);
  // Saved listening wird (display only here — the resume action
  // lives on ListenPage). Read once on mount; a missing/stub module
  // value simply hides the line.
  const [listeningWird] = useState(() => {
    try { return readListeningWird(); } catch { return null; }
  });
  const [wird] = useState(loadWird);
  const today = new Date().toLocaleDateString('en-CA');
  const doneToday = wird.doneDays.includes(today);
  const pagesText =
    wird.target === 1 ? 'صفحة واحدة' : wird.target === 2 ? 'صفحتين' : `${wird.target.toLocaleString('ar-EG')} صفحات`;
  const juz = getJuzFromPage(lastPage.page);

  useEffect(() => {
    const loadLinkOfDay = async () => {
      try {
        const now = new Date();
        const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
        const { count } = await supabase.from('ayah_links').select('id', { count: 'exact', head: true }).eq('status', 'approved');
        if (!count || count <= 0) return;
        const offset = (dayOfYear - 1) % count;
        const { data: link } = await supabase.from('ayah_links')
          .select('id, verse_id, link_content, link_title').eq('status', 'approved')
          .order('id', { ascending: true }).range(offset, offset).single();
        if (!link || !link.link_content) return;
        const { data: verse } = await supabase.from('quran_verses')
          .select('surah_no, surah_name, ayah_no').eq('id', link.verse_id).single();
        if (!verse) return;
        setLinkOfDay({ surah: verse.surah_no, surahName: verse.surah_name, ayah: verse.ayah_no, title: link.link_title, text: link.link_content });
      } catch { /* hide the card entirely on any failure */ }
    };
    loadLinkOfDay();
  }, []);

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
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <img src="/icon-192.png" alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
          <div>
            <h1 className="text-lg font-bold text-accent-800" style={{ fontFamily: "'Noto Naskh Arabic', serif" }}>روابط الذكر الحكيم</h1>
            <p className="text-sm text-accent-600">للحفظ بالتربيطات</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5">
        {/* App mark: the artwork itself, sized so the greeting and
            the resume action stay visible without scrolling. */}
        <div className="flex justify-center mb-5">
          <img src="/icon-512.png" alt="روابط الذكر الحكيم" className="w-56 h-56 object-contain drop-shadow-md" />
        </div>

        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 mb-4">
          <p className="font-bold text-accent-800">{ISLAMIC_GREETING}</p>
          <p className="text-sm text-accent-600 mt-1">
            {preferredName ? `${dailyDua()} يا ${preferredName}` : dailyDua()}
          </p>
          <p className="text-sm text-emerald-700 font-semibold mt-2">
            هنا بتحفظ بالتربيط: اضغط أي آية في المصحف وشوف روابطها.
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
            onClick={() => {
              try {
                sessionStorage.setItem('quran-open-fullscreen', '1');
              } catch {}
              onNavigate('mushaf');
            }}
            className="mt-4 w-full py-3 bg-white text-emerald-700 font-bold rounded-xl flex items-center justify-center gap-2"
          >
            <BookOpen className="w-5 h-5" />
            {lastPage.visited ? `أكمل الحفظ — صفحة ${lastPage.page.toLocaleString('ar-EG')}` : 'افتح المصحف للحفظ'}
          </button>
        </div>

        {/* استمع للقرآن: directly after the resume card, before the wird button. */}
        <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-5 mb-4">
          <p className="font-bold text-accent-800 flex items-center gap-2">
            <Headphones className="w-5 h-5 text-emerald-600" /> استمع للقرآن
          </p>
          <p className="text-sm text-accent-600 mt-1">
            تلاوة متواصلة مع القراءة — استمع للقرآن واقفل الشاشة لو عاوز، ويمكن تحميل السورة للاستماع دون اتصال
          </p>
          {/* أوفلاين — headline feature of this entry (Amr's explicit
              "أوفلاين"): streaming (play) and per-surah download are
              both reachable from the listen page this card opens. */}
          <p className="text-sm text-amber-700 font-bold mt-1">
            أوفلاين: حمّل أي سورة واستمع دون اتصال
          </p>
          {listeningWird && (
            <p className="text-sm text-amber-700 font-bold mt-2">
              لديك ورد استماع محفوظ: سورة {SURAHS.find((s) => s.no === listeningWird.surah)?.name || listeningWird.surah} — آية {listeningWird.ayah}
            </p>
          )}
          <button
            onClick={() => onNavigate('listen')}
            className="mt-4 w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl flex items-center justify-center gap-2"
          >
            <Headphones className="w-5 h-5" />
            استمع للقرآن
          </button>
        </div>

        {/* تربيط اليوم: real approved link only; hidden on any failure */}
        {linkOfDay && (
          <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-4 mb-4">
            <p className="font-bold text-accent-800 flex items-center gap-2">
              <Link className="w-5 h-5 text-amber-600" /> تربيط اليوم
            </p>
            <p className="text-sm text-accent-600 mt-1">
              سورة {linkOfDay.surahName} — آية {linkOfDay.ayah.toLocaleString('ar-EG')}
              {linkOfDay.title ? ` — ${linkOfDay.title}` : ''}
            </p>
            <p className="text-base text-accent-700 leading-relaxed mt-2">
              {linkOfDay.text.length > 140 ? `${linkOfDay.text.slice(0, 140)}…` : linkOfDay.text}
            </p>
            <button
              onClick={() => {
                try { localStorage.setItem('quran-mushaf-target', JSON.stringify({ surah: linkOfDay.surah, ayah: linkOfDay.ayah })); } catch { /* ignore */ }
                onNavigate('mushaf');
              }}
              className="mt-3 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl"
            >
              افتح الآية وسمّعها
            </button>
          </div>
        )}

        {/* Quick buttons: the two feature actions are full-width
            large buttons like the big buttons in the cards above
            (Amr 17:48); لوحتي + الإعدادات stay a small 2-col row. */}
        <button
          onClick={() => onNavigate('follow')}
          className="w-full py-4 mb-3 bg-gradient-to-l from-teal-700 to-teal-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 text-lg shadow-lg shadow-teal-700/30"
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white/20">
            <Mic className="w-6 h-6 text-white" />
          </span>
          الحق الإمام
        </button>
        <button
          onClick={() => onNavigate('test')}
          className="w-full py-4 mb-3 bg-gradient-to-l from-amber-700 to-amber-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 text-lg shadow-lg shadow-amber-700/30"
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white/20">
            <Headphones className="w-6 h-6 text-white" />
          </span>
          سمّع لنفسك
        </button>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onNavigate('app')}
            className="py-3.5 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl flex items-center justify-center gap-2"
          >
            <LayoutDashboard className="w-5 h-5 text-emerald-600" /> لوحتي
          </button>
          <button
            onClick={() => onNavigate('settings')}
            className="py-3.5 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl flex items-center justify-center gap-2"
          >
            <Settings className="w-5 h-5 text-emerald-600" /> الإعدادات
          </button>
        </div>

        {/* Today's wird, moved below the quick buttons (Amr 20:02) —
            the full card lives on لوحتي; the hint opens Settings,
            where the daily wird is configured (first section). */}
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-4 mb-4">
          <button
            onClick={() => onNavigate('app')}
            className="w-full text-right"
          >
            <p className="font-bold text-accent-800">
              ورد اليوم: {WIRD_TYPE_LABEL[wird.type]} — {pagesText}
            </p>
            <p className="text-sm text-accent-600 mt-1">
              {doneToday ? 'تم ✓ تقبل الله منك.' : 'لم ينجز بعد — من لوحتي علّمه منجزا.'}
            </p>
          </button>
          <button
            onClick={() => onNavigate('settings')}
            className="mt-2 text-sm text-emerald-700 font-semibold underline"
          >
            اظبط وردك اليومي من الإعدادات
          </button>
        </div>

        {/* إذاعة القرآن الكريم: SHIP-GATED — disabled "قريبًا" card only.
            No navigation, no playback: the button must not go live on
            an unverified or unpermitted stream (Maspero permission
            pending). The #/radio route stays for testing only; adding
            the live card later is one card + onNavigate('radio'). */}
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 mb-4 opacity-60" aria-disabled="true">
          <p className="font-bold text-accent-800 flex items-center gap-2">
            <Radio className="w-5 h-5 text-stone-500" /> استمع لإذاعة القرآن الكريم
            <span className="text-xs font-bold bg-stone-200 text-stone-700 px-2 py-1 rounded-full">قريبًا</span>
          </p>
          <p className="text-sm text-accent-600 mt-1">
            بث مباشر لإذاعة القرآن الكريم من القاهرة — بانتظار إذن البث من الهيئة الوطنية للإعلام.
          </p>
          <button disabled className="mt-4 w-full py-3 bg-stone-300 text-stone-500 font-bold rounded-xl cursor-not-allowed">
            قريبًا
          </button>
        </div>

        {/* أذكار الصباح والمساء: CARD ONLY — audio out of scope (no
            licensed source yet: Duraihem confirmation / Alafasy
            permission pending). Disabled "قريبًا" card; nothing built,
            nothing hotlinked. Future wiring shape (types only, see
            src/lib/adhkarFuture.ts): one audio file per wird +
            timing table [{text, count, startMs, endMs}] for
            per-dhikr skip. */}
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 mb-4 opacity-60" aria-disabled="true">
          <p className="font-bold text-accent-800 flex items-center gap-2">
            <SunMoon className="w-5 h-5 text-stone-500" /> استمع لأذكار الصباح والمساء
            <span className="text-xs font-bold bg-stone-200 text-stone-700 px-2 py-1 rounded-full">قريبًا</span>
          </p>
          <p className="text-sm text-accent-600 mt-1">
            أذكار الصباح والمساء صوتًا — بانتظار مصدر صوتي مرخّص.
          </p>
          <button disabled className="mt-4 w-full py-3 bg-stone-300 text-stone-500 font-bold rounded-xl cursor-not-allowed">
            قريبًا
          </button>
        </div>

        <p className="text-center text-sm text-emerald-700 font-semibold mt-6">
          معك في كل آية، حتى نُتمّ حفظ كتاب الله
        </p>
      </main>

      {/* First-run screen (home only, once per device): 3 steps, dismissible */}
      {showIntro && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/50" onClick={dismissIntro}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-lg font-bold text-accent-800 mb-1">احفظ القرآن بالتربيطات</p>
            <p className="text-sm text-accent-600 mb-4">٣ خطوات، وكل آية تثبت في ذهنك:</p>
            <ol className="text-right space-y-3 text-base text-accent-700">
              <li><span className="font-bold text-emerald-700">١.</span> افتح الآية — اضغط أي آية في المصحف</li>
              <li><span className="font-bold text-amber-700">٢.</span> شوف رابطها — التربيط يثبّتها في ذهنك</li>
              <li><span className="font-bold text-emerald-700">٣.</span> سمّعها — من حفظك في «سمّع لنفسك»</li>
            </ol>
            <button onClick={dismissIntro}
              className="mt-5 w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl">
              ابدأ
            </button>
          </div>
        </div>
      )}

      <BottomNav current="home" onNavigate={onNavigate} />
    </div>
  );
}
