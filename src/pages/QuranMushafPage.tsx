import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { signOut } from '../lib/auth';
import { SURAHS } from '../lib/surahs';
import { useLang } from '../lib/LanguageContext';
import { LANGUAGES } from '../lib/translations';
import { LINK_TYPES } from '../lib/types';
import type { QuranVerse, AyahLink } from '../lib/types';
import { JUZ_START_PAGES, HIZB_START_PAGES, getJuzFromPage, getHizbFromPage } from '../lib/quranIndex';
import { MUSHAF_EDITIONS as EDITIONS, SURAH_START_PAGES, getSurahStartPage, TOTAL_MUSHAF_PAGES } from '../lib/mushafEditions';
import BottomNav from '../components/BottomNav';
import {
  BookOpen, ChevronRight, ChevronLeft, Home, LogOut, Globe,
  ZoomIn, ZoomOut, Maximize2, X, Bookmark, Volume2, Layers,
  LayoutGrid, List, BookMarked, Hash,
} from 'lucide-react';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf';

const TOTAL_PAGES = TOTAL_MUSHAF_PAGES;

const EDITION_STORAGE_KEY = 'quran-mushaf-edition';
const PAGE_STORAGE_KEY = 'quran-mushaf-page';
const TARGET_STORAGE_KEY = 'quran-mushaf-target';

function readStoredEdition(): number {
  const raw = Number(localStorage.getItem(EDITION_STORAGE_KEY));
  return Number.isInteger(raw) && raw >= 0 && raw < EDITIONS.length ? raw : 0;
}

function readStoredPage(): number {
  const raw = Number(localStorage.getItem(PAGE_STORAGE_KEY));
  return Number.isInteger(raw) && raw >= 1 && raw <= TOTAL_PAGES ? raw : 1;
}

function getPageSurah(page: number): number {
  let result = 1;
  for (const { surah, page: startPage } of SURAH_START_PAGES) {
    if (startPage <= page) result = surah;
    else break;
  }
  return result;
}

function getLinkTypeColors(types: string[]): string {
  if (!types || types.length === 0) return 'bg-gray-100 text-gray-700';
  const first = types[0];
  const map: Record<string, string> = {
    wajih: 'bg-blue-100 text-blue-700', sifa: 'bg-cyan-100 text-cyan-700',
    mutashabihat: 'bg-teal-100 text-teal-700', sabab_nuzul: 'bg-orange-100 text-orange-700',
    fawaaid: 'bg-emerald-100 text-emerald-700', lafdhi: 'bg-pink-100 text-pink-700',
    adadi: 'bg-amber-100 text-amber-700', maqam: 'bg-indigo-100 text-indigo-700',
    takrir: 'bg-rose-100 text-rose-700',
  };
  return map[first] || 'bg-gray-100 text-gray-700';
}

function formatTypes(types: string[]): string {
  if (!types || types.length === 0) return '';
  return types.map((t) => LINK_TYPES.find((lt) => lt.value === t)?.label || t).join('، ');
}

type IndexTab = 'surah' | 'juz' | 'hizb';

export default function QuranMushafPage({
  session,
  onNavigate,
}: {
  session: import('@supabase/supabase-js').Session | null;
  onNavigate: (r: Route) => void;
}) {
  const { t, lang, setLang } = useLang();
  const [currentPage, setCurrentPage] = useState(readStoredPage);
  const [selectedEdition, setSelectedEdition] = useState(readStoredEdition);
  const [ayahFilter, setAyahFilter] = useState('');
  const [pendingAyah, setPendingAyah] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [showRatelIntro, setShowRatelIntro] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showEditionPicker, setShowEditionPicker] = useState(false);
  const [showEditionPickerInFullscreen, setShowEditionPickerInFullscreen] = useState(false);
  const [showIndex, setShowIndex] = useState(false);
  const [indexTab, setIndexTab] = useState<IndexTab>('surah');
  const [pageInput, setPageInput] = useState('');
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [surahVerses, setSurahVerses] = useState<QuranVerse[]>([]);
  const [verseLinks, setVerseLinks] = useState<AyahLink[]>([]);
  const [selectedVerse, setSelectedVerse] = useState<QuranVerse | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(false);
  // Ayah popup tabs, in the order the user asked for: links, then irab,
  // then tafsir (with a choice of three published tafsirs inside it).
  const [popupTab, setPopupTab] = useState<'links' | 'irab' | 'tafsir'>('links');
  const [tafsirEdition, setTafsirEdition] = useState('ar.muyassar');
  const [tafsirText, setTafsirText] = useState<string | null>(null);
  const [tafsirLoading, setTafsirLoading] = useState(false);
  const [tafsirError, setTafsirError] = useState<string | null>(null);
  const tafsirCache = useRef<Record<string, string>>({});

  const edition = EDITIONS[selectedEdition];
  const currentSurah = getPageSurah(currentPage);
  const currentSurahName = SURAHS.find((s) => s.no === currentSurah)?.name || '';
  // Facing-page peek (printed Mushaf spread, RTL): odd pages sit on the
  // right of the spread, even pages on the left — so the facing page is
  // the next page on the left for odd pages, the previous page on the
  // right for even pages. The peek lives inside the fixed navigation
  // strip, so the main page never moves.
  const facingPage = currentPage % 2 === 1 ? currentPage + 1 : currentPage - 1;
  const facingOnLeft = currentPage % 2 === 1;
  const hasFacingPage = facingPage >= 1 && facingPage <= TOTAL_PAGES;
  const currentJuz = getJuzFromPage(currentPage);
  const currentHizb = getHizbFromPage(currentPage);

  const fetchPageVerses = useCallback(async (page: number) => {
    const surah = getPageSurah(page);
    const { data } = await supabase
      .from('quran_verses')
      .select('*')
      .eq('surah_no', surah)
      .order('ayah_no', { ascending: true });
    setSurahVerses(data || []);
  }, []);

  const fetchVerseLinks = useCallback(async (verseId: number) => {
    setLoadingLinks(true);
    const { data } = await supabase
      .from('ayah_links')
      .select('*')
      .eq('verse_id', verseId)
      .eq('status', 'approved');
    setVerseLinks(data || []);
    setLoadingLinks(false);
  }, []);

  // Published tafsirs served by the free AlQuranCloud API (no key):
  // per-ayah text at /v1/ayah/{surah}:{ayah}/{edition}.
  const TAFSIR_EDITIONS = [
    { id: 'ar.muyassar', name: 'التفسير الميسر' },
    { id: 'ar.jalalayn', name: 'تفسير الجلالين' },
    { id: 'ar.qurtubi', name: 'تفسير القرطبي' },
  ];
  const loadTafsir = useCallback(async (editionId: string, verse: QuranVerse) => {
    const key = `${editionId}:${verse.surah_no}:${verse.ayah_no}`;
    if (tafsirCache.current[key]) {
      setTafsirText(tafsirCache.current[key]);
      setTafsirError(null);
      setTafsirLoading(false);
      return;
    }
    setTafsirLoading(true);
    setTafsirError(null);
    setTafsirText(null);
    try {
      const res = await fetch(`https://api.alquran.cloud/v1/ayah/${verse.surah_no}:${verse.ayah_no}/${editionId}`);
      if (!res.ok) throw new Error('fetch failed');
      const json = await res.json();
      const text = json?.data?.text as string | undefined;
      if (!text) throw new Error('empty');
      tafsirCache.current[key] = text;
      setTafsirText(text);
    } catch {
      setTafsirError('تعذر تحميل التفسير الآن — تحقق من الاتصال وحاول مجدداً');
    }
    setTafsirLoading(false);
  }, []);
  useEffect(() => {
    if (popupTab !== 'tafsir' || !selectedVerse) return;
    loadTafsir(tafsirEdition, selectedVerse);
  }, [popupTab, tafsirEdition, selectedVerse, loadTafsir]);

  useEffect(() => {
    setImageLoading(true);
    setImageError(false);
    fetchPageVerses(currentPage);
  }, [currentPage, fetchPageVerses]);

  // Remember the user's chosen edition and last page, and honour a
  // cross-page jump from لوحتي (stored as { surah, ayah }).
  useEffect(() => {
    localStorage.setItem(EDITION_STORAGE_KEY, String(selectedEdition));
  }, [selectedEdition]);
  useEffect(() => {
    localStorage.setItem(PAGE_STORAGE_KEY, String(currentPage));
  }, [currentPage]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TARGET_STORAGE_KEY);
      if (!raw) return;
      const target = JSON.parse(raw) as { surah?: number; ayah?: number };
      localStorage.removeItem(TARGET_STORAGE_KEY);
      if (target.surah) {
        setCurrentPage(getSurahStartPage(target.surah));
        if (target.ayah) setPendingAyah(target.ayah);
      }
    } catch { /* ignore a malformed stored target */ }
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (pendingAyah === null) return;
    const verse = surahVerses.find((v) => v.ayah_no === pendingAyah);
    if (verse) {
      setSelectedVerse(verse);
      setPopupTab('links');
      fetchVerseLinks(verse.id);
      setPendingAyah(null);
    } else if (surahVerses.length > 0) {
      // Target ayah is not on this surah's list (e.g. a page spanning two
      // surahs) — drop the stale target instead of firing it later.
      setPendingAyah(null);
    }
  }, [pendingAyah, surahVerses, fetchVerseLinks]);

  const goToPage = (page: number) => {
    const clamped = Math.max(1, Math.min(TOTAL_PAGES, page));
    setCurrentPage(clamped);
  };

  // Fullscreen swipe navigation (touch): swipe left = next page, swipe
  // right = previous page, matching the corner buttons. Attached only to
  // the page image so swipes over the verse strip still scroll the strip.
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const handlePageTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
  };
  const handlePageTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const startX = touchStartX.current;
    const startY = touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (showRatelIntro || showEditionPickerInFullscreen || selectedVerse) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) goToPage(currentPage + 1);
    else goToPage(currentPage - 1);
  };

  const goToSurah = (surahNo: number) => {
    goToPage(getSurahStartPage(surahNo));
    setShowIndex(false);
  };

  const visibleVerses = ayahFilter.trim()
    ? surahVerses.filter((v) => String(v.ayah_no) === ayahFilter.trim())
    : surahVerses;

  const openFullscreen = () => {
    setShowRatelIntro(true);
    setShowFullscreen(true);
    setTimeout(() => setShowRatelIntro(false), 3000);
  };

  const handleVerseClick = (verse: QuranVerse) => {
    if (selectedVerse?.id === verse.id) {
      setSelectedVerse(null);
      return;
    }
    setSelectedVerse(verse);
    setPopupTab('links');
    fetchVerseLinks(verse.id);
  };

  const playAudio = (url: string) => { new Audio(url).play(); };

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-100 via-amber-50/30 to-white pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-gradient-to-r from-amber-50 to-stone-50/95 backdrop-blur-md border-b border-amber-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-amber-700 rounded-xl flex items-center justify-center shadow-lg">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-accent-800">المصحف الشريف</h1>
              <p className="text-xs text-accent-500">اقرأ واحفظ وراجع — اضغط على أي آية لمعرفة الرابط</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button onClick={() => setShowLangMenu(!showLangMenu)}
                className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-accent-600 hover:bg-amber-100 rounded-lg transition-smooth">
                <Globe className="w-4 h-4" />
                {LANGUAGES.find((l) => l.code === lang)?.flag}
              </button>
              {showLangMenu && (
                <div className="absolute left-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-200 p-2 min-w-[150px] z-50 animate-slide-up">
                  {LANGUAGES.map((l) => (
                    <button key={l.code} onClick={() => { setLang(l.code); setShowLangMenu(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-smooth ${lang === l.code ? 'bg-amber-50 text-amber-700 font-semibold' : 'hover:bg-gray-50 text-accent-600'}`}>
                      <span>{l.flag}</span>{l.nativeName}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {session && (
              <button onClick={async () => { await signOut(); onNavigate('home'); }}
                className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-smooth">
                <LogOut className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => onNavigate('app')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50 rounded-lg transition-smooth font-semibold">
              <Bookmark className="w-4 h-4" /> لوحتي
            </button>
            <button onClick={() => onNavigate('home')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-accent-600 hover:bg-gray-100 rounded-lg transition-smooth">
              <Home className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Index info bar — Juz / Hizb / Surah */}
        <div className="bg-gradient-to-r from-amber-100 to-stone-100 rounded-2xl border border-amber-200 p-4 mb-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => { setShowIndex(true); setIndexTab('juz'); }}
                className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-amber-50 text-amber-800 rounded-xl text-sm font-semibold transition-smooth border border-amber-300 shadow-sm">
                <LayoutGrid className="w-4 h-4" /> {currentJuz.name}
              </button>
              <button onClick={() => { setShowIndex(true); setIndexTab('hizb'); }}
                className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-emerald-50 text-emerald-800 rounded-xl text-sm font-semibold transition-smooth border border-emerald-300 shadow-sm">
                <Hash className="w-4 h-4" /> الحزب {currentHizb.number}
              </button>
              <button onClick={() => { setShowIndex(true); setIndexTab('surah'); }}
                className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-blue-50 text-blue-800 rounded-xl text-sm font-semibold transition-smooth border border-blue-300 shadow-sm">
                <BookMarked className="w-4 h-4" /> سورة {currentSurahName}
              </button>
            </div>
            <button onClick={() => setShowEditionPicker(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-xl text-sm font-semibold transition-smooth border border-amber-200">
              <Layers className="w-4 h-4" /> {edition.name}
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => { setShowIndex(true); setIndexTab('surah'); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-stone-50 hover:bg-stone-100 text-accent-700 rounded-xl text-sm font-semibold transition-smooth border border-gray-200">
              <List className="w-4 h-4" /> الفهرس
            </button>
            <div className="flex items-center gap-2">
              <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}
                className="p-2 text-accent-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 transition-smooth">
                <ChevronRight className="w-6 h-6" />
              </button>
              <div className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-200">
                <input type="number" value={pageInput || currentPage}
                  onChange={(e) => setPageInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { const n = parseInt(pageInput); if (!isNaN(n)) goToPage(n); setPageInput(''); } }}
                  className="w-16 text-center text-base font-semibold text-accent-700 bg-transparent focus:outline-none"
                  placeholder={currentPage.toString()} />
                <span className="text-sm text-accent-400">/ {TOTAL_PAGES}</span>
              </div>
              <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= TOTAL_PAGES}
                className="p-2 text-accent-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 transition-smooth">
                <ChevronLeft className="w-6 h-6" />
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                className="p-2 text-accent-600 hover:bg-gray-100 rounded-lg transition-smooth"><ZoomOut className="w-5 h-5" /></button>
              <span className="text-sm text-accent-500 w-14 text-center font-semibold">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                className="p-2 text-accent-600 hover:bg-gray-100 rounded-lg transition-smooth"><ZoomIn className="w-5 h-5" /></button>
              <button onClick={openFullscreen}
                className="p-2 text-accent-600 hover:bg-amber-100 rounded-lg transition-smooth"><Maximize2 className="w-5 h-5" /></button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Mushaf page image */}
          <div className="lg:col-span-3 flex flex-col items-center">
            <div className="relative bg-gradient-to-br from-stone-50 to-white rounded-2xl shadow-xl border-2 border-amber-200 overflow-hidden p-3 sm:p-6 max-w-full">
              {imageLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-amber-50/80 z-10">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
                    <p className="text-sm text-accent-500">جارٍ تحميل الصفحة...</p>
                  </div>
                </div>
              )}
              {imageError ? (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                  <BookOpen className="w-14 h-14 text-amber-300 mb-3" />
                  <p className="text-base font-semibold text-accent-600 mb-1">تعذر تحميل الصفحة</p>
                  <p className="text-sm text-accent-400 mb-3">قد يكون الخادم غير متاح حالياً</p>
                  <button onClick={() => { setImageError(false); setImageLoading(true); }}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg transition-smooth">
                    إعادة المحاولة
                  </button>
                </div>
              ) : (
                <img key={`${edition.id}-${currentPage}`} src={edition.imageUrl(currentPage)}
                  alt={`صفحة ${currentPage} — ${edition.name}`}
                  onLoad={() => setImageLoading(false)}
                  onError={() => { setImageError(true); setImageLoading(false); }}
                  className="max-w-full h-auto rounded-lg shadow-md transition-transform duration-300 origin-top"
                  style={{ transform: `scale(${zoom})` }} loading="eager" />
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-accent-600 font-semibold">
              <span>صفحة {currentPage} من {TOTAL_PAGES}</span>
              <span className="text-amber-600">•</span>
              <span>{edition.name}</span>
              <span className="text-amber-600">•</span>
              <span>{currentJuz.name}</span>
              <span className="text-amber-600">•</span>
              <span>الحزب {currentHizb.number}</span>
            </div>

            {/* Quick page jumps */}
            <div className="mt-4 bg-white rounded-2xl border border-gray-200 p-4 shadow-sm w-full">
              <p className="text-sm font-semibold text-accent-500 mb-3">انتقال سريع</p>
              <div className="flex flex-wrap gap-2">
                <QuickJumpBtn label="الفاتحة" onClick={() => goToPage(1)} />
                <QuickJumpBtn label="آية الكرسي" onClick={() => goToPage(24)} />
                <QuickJumpBtn label="جزء عمّ" onClick={() => goToPage(582)} />
                <QuickJumpBtn label="جزء تبارك" onClick={() => goToPage(562)} />
                <QuickJumpBtn label="سورة الكهف" onClick={() => goToPage(293)} />
                <QuickJumpBtn label="آخر الصفحة" onClick={() => goToPage(TOTAL_PAGES)} />
              </div>
            </div>
          </div>

          {/* Verses list with tap-to-show-links */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden sticky top-24">
              <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-emerald-50 to-teal-50">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-emerald-700" />
                  </div>
                  <div>
                    <h3 className="font-bold text-accent-800 text-base">آيات سورة {currentSurahName}</h3>
                    <p className="text-sm text-accent-500">اضغط على أي آية لمعرفة الرابط</p>
                  </div>
                </div>
                {/* Ayah filter: jump straight to one ayah of this surah. */}
                <div className="flex items-center gap-2 mt-3">
                  <label htmlFor="ayah-filter" className="text-sm font-semibold text-accent-600 whitespace-nowrap">
                    رقم الآية:
                  </label>
                  <input id="ayah-filter" type="number" min={1} inputMode="numeric"
                    value={ayahFilter} placeholder="مثال: 255"
                    onChange={(e) => setAyahFilter(e.target.value)}
                    className="w-28 rounded-lg border border-gray-200 bg-white px-3 py-2 text-base font-semibold text-accent-700 focus:outline-none focus:border-emerald-400" />
                  {ayahFilter.trim() && (
                    <button onClick={() => setAyahFilter('')}
                      className="px-3 py-2 text-sm font-semibold text-accent-500 hover:bg-white rounded-lg">
                      إلغاء الفلتر
                    </button>
                  )}
                </div>
              </div>
              <div className="max-h-[600px] overflow-y-auto divide-y divide-gray-50">
                {surahVerses.length === 0 ? (
                  <div className="py-12 text-center text-accent-400">
                    <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    <p className="text-base">لا توجد آيات محملة</p>
                  </div>
                ) : visibleVerses.length === 0 ? (
                  <div className="py-12 text-center text-accent-400">
                    <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    <p className="text-base">لا توجد آية بهذا الرقم في سورة {currentSurahName}</p>
                  </div>
                ) : (
                  visibleVerses.map((verse) => {
                    const isSelected = selectedVerse?.id === verse.id;
                    const hasLinks = verse.has_links;
                    return (
                      <div key={verse.id}
                        onClick={() => handleVerseClick(verse)}
                        className={`p-4 cursor-pointer transition-smooth animate-fade-in ${
                          isSelected ? 'bg-emerald-50 border-r-4 border-emerald-500' :
                          hasLinks ? 'bg-emerald-50/30 border-r-4 border-emerald-300 hover:bg-emerald-50' :
                          'hover:bg-gray-50 border-r-4 border-transparent'
                        }`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="flex items-center justify-center w-8 h-8 bg-emerald-100 text-emerald-700 text-sm font-bold rounded-lg">
                            {verse.ayah_no}
                          </span>
                          <span className="text-sm text-accent-500">آية {verse.ayah_no}</span>
                          {hasLinks && (
                            <span className="flex items-center gap-1 text-sm text-emerald-600 font-semibold bg-emerald-100 px-2 py-0.5 rounded-full">
                              <Bookmark className="w-3.5 h-3.5" /> {verse.links_count} رابط
                            </span>
                          )}
                        </div>
                        <p className="font-arabic text-xl text-accent-800 leading-loose">{verse.ayah_text}</p>

                        {/* Links display when verse is selected */}
                        {isSelected && (
                          <div className="mt-3 animate-slide-up">
                            {loadingLinks ? (
                              <div className="flex items-center justify-center py-4">
                                <div className="w-7 h-7 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
                              </div>
                            ) : verseLinks.length > 0 ? (
                              <div className="space-y-2">
                                {verseLinks.map((link) => (
                                  <div key={link.id} className="bg-white rounded-lg p-3 border border-emerald-100 shadow-sm">
                                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold mb-2 ${getLinkTypeColors(link.link_types)}`}>
                                      {formatTypes(link.link_types)}
                                    </span>
                                    {link.link_title && <p className="text-sm font-bold text-accent-700 mb-1">{link.link_title}</p>}
                                    <p className="text-base text-accent-600 leading-relaxed">{link.link_content}</p>
                                    <div className="flex gap-2 mt-2">
                                      {link.synthetic_audio_url && (
                                        <button onClick={(e) => { e.stopPropagation(); playAudio(link.synthetic_audio_url!); }}
                                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg">
                                          <Volume2 className="w-4 h-4" /> استماع ({link.voice_type === 'female' ? 'نسائي' : 'رجالي'})
                                        </button>
                                      )}
                                      {link.audio_url && (
                                        <button onClick={(e) => { e.stopPropagation(); playAudio(link.audio_url!); }}
                                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg">
                                          <Volume2 className="w-4 h-4" /> مقطع رنا
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center py-4 bg-gray-50 rounded-lg">
                                <p className="text-base text-accent-400">لا توجد روابط لهذه الآية بعد</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom nav: لوحتي first (rightmost in RTL), then المصحف. */}
      <BottomNav current="mushaf" onNavigate={onNavigate} />

      {/* Index modal — Surah / Juz / Hizb */}
      {showIndex && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShowIndex(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col animate-slide-up"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-accent-800">فهرس المصحف</h3>
              <button onClick={() => setShowIndex(false)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            {/* Tabs */}
            <div className="flex border-b border-gray-100">
              {([
                { id: 'surah' as const, label: 'السور', icon: <BookMarked className="w-4 h-4" /> },
                { id: 'juz' as const, label: 'الأجزاء', icon: <LayoutGrid className="w-4 h-4" /> },
                { id: 'hizb' as const, label: 'الأحزاب', icon: <Hash className="w-4 h-4" /> },
              ]).map((tab) => (
                <button key={tab.id} onClick={() => setIndexTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-smooth ${
                    indexTab === tab.id ? 'text-emerald-700 border-b-2 border-emerald-600 bg-emerald-50/50' : 'text-accent-500 hover:text-accent-700 hover:bg-gray-50'
                  }`}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>
            <div className="p-4 overflow-y-auto">
              {indexTab === 'surah' && (
                <div className="grid grid-cols-2 gap-2">
                  {SURAHS.map((s) => (
                    <button key={s.no} onClick={() => goToSurah(s.no)}
                      className={`flex items-center gap-2 p-2.5 rounded-lg text-sm font-semibold transition-smooth ${currentSurah === s.no ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'hover:bg-gray-50 text-accent-600 border border-transparent'}`}>
                      <span className="text-xs text-accent-400">{s.no}.</span>{s.name}
                    </button>
                  ))}
                </div>
              )}
              {indexTab === 'juz' && (
                <div className="grid grid-cols-1 gap-2">
                  {JUZ_START_PAGES.map((j) => (
                    <button key={j.number} onClick={() => { goToPage(j.startPage); setShowIndex(false); }}
                      className={`flex items-center gap-3 p-3 rounded-lg text-sm font-semibold transition-smooth text-right ${currentJuz.number === j.number ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'hover:bg-amber-50 text-accent-600 border border-transparent'}`}>
                      <span className="flex items-center justify-center w-8 h-8 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold">{j.number}</span>
                      <span className="flex-1">{j.name}</span>
                      <span className="text-xs text-accent-400">صفحة {j.startPage}</span>
                    </button>
                  ))}
                </div>
              )}
              {indexTab === 'hizb' && (
                <div className="grid grid-cols-2 gap-2">
                  {HIZB_START_PAGES.map((h) => (
                    <button key={h.number} onClick={() => { goToPage(h.startPage); setShowIndex(false); }}
                      className={`flex items-center gap-2 p-2.5 rounded-lg text-sm font-semibold transition-smooth ${currentHizb.number === h.number ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'hover:bg-gray-50 text-accent-600 border border-transparent'}`}>
                      <span className="text-xs text-accent-400">الحزب {h.number}</span>
                      <span className="text-xs text-accent-400">جزء {h.juz}</span>
                      <span className="text-xs text-accent-400 mr-auto">ص {h.startPage}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edition picker modal */}
      {showEditionPicker && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShowEditionPicker(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slide-up"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-accent-800">اختر طبعة المصحف</h3>
              <button onClick={() => setShowEditionPicker(false)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-2">
              {EDITIONS.map((ed, idx) => (
                <button key={ed.id} onClick={() => { setSelectedEdition(idx); setShowEditionPicker(false); setImageLoading(true); setImageError(false); }}
                  className={`w-full text-right p-3 rounded-xl border-2 transition-smooth ${selectedEdition === idx ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-200 hover:bg-amber-50/30'}`}>
                  <p className="font-bold text-accent-800 text-base">{ed.name}</p>
                  <p className="text-sm text-accent-500 mt-0.5">{ed.description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen viewer with intro */}
      {showFullscreen && (
        <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center select-none overflow-hidden overscroll-contain"
          onClick={() => !showRatelIntro && !showEditionPickerInFullscreen && !selectedVerse && setShowFullscreen(false)}>

          {showRatelIntro && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-br from-emerald-900 via-teal-900 to-emerald-950 transition-opacity duration-1000">
              <div className="absolute inset-0 opacity-10">
                <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-emerald-400 rounded-full blur-3xl animate-pulse-soft" />
                <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-teal-400 rounded-full blur-3xl animate-pulse-soft" />
              </div>
              <div className="relative flex flex-col items-center animate-slide-up">
                <div className="w-24 h-24 bg-white/10 backdrop-blur rounded-3xl flex items-center justify-center shadow-2xl mb-8 border border-white/20">
                  <BookOpen className="w-12 h-12 text-emerald-300" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 leading-relaxed text-center max-w-3xl px-6" style={{ fontFamily: '"Noto Naskh Arabic", "Amiri", serif' }}>
                  اقرأ وارتق، ورتل كما كنت ترتل في الدنيا، فإن منزلتك عند آخر آية تقرؤها
                </h2>
                <p className="text-emerald-200 text-base">اقرأ بتأنٍّ وارتقِ في درجات الحفظ</p>
              </div>
            </div>
          )}

          {!showRatelIntro && (
            <button onClick={(e) => { e.stopPropagation(); setShowFullscreen(false); }}
              className="absolute top-4 right-4 p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-lg z-30 transition-smooth">
              <X className="w-7 h-7" />
            </button>
          )}

          {!showRatelIntro && (
            <button onClick={(e) => { e.stopPropagation(); setShowEditionPickerInFullscreen(true); }}
              className="absolute top-4 left-4 flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-lg z-30 transition-smooth text-sm font-semibold">
              <Layers className="w-5 h-5" /> {edition.name}
            </button>
          )}

          {/* Juz / Hizb info in fullscreen */}
          {!showRatelIntro && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3 z-30 pointer-events-none">
              <span className="px-3 py-1.5 bg-white/10 backdrop-blur text-white text-xs font-semibold rounded-lg">{currentJuz.name}</span>
              <span className="px-3 py-1.5 bg-white/10 backdrop-blur text-white text-xs font-semibold rounded-lg">الحزب {currentHizb.number}</span>
              <span className="px-3 py-1.5 bg-white/10 backdrop-blur text-white text-xs font-semibold rounded-lg">سورة {currentSurahName}</span>
            </div>
          )}

          {!showRatelIntro && !showEditionPickerInFullscreen && (
            <>
              {!imageError ? (
                <img src={edition.imageUrl(currentPage)} alt={`صفحة ${currentPage}`}
                  className="max-h-[100vh] max-w-[100vw] object-contain touch-none"
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  onClick={(e) => e.stopPropagation()}
                  onTouchStart={handlePageTouchStart}
                  onTouchEnd={handlePageTouchEnd} />
              ) : (
                <div className="text-center touch-none" onClick={(e) => e.stopPropagation()}
                  onTouchStart={handlePageTouchStart}
                  onTouchEnd={handlePageTouchEnd}>
                  <BookOpen className="w-14 h-14 text-white/30 mx-auto mb-3" />
                  <p className="text-white/50 text-base">تعذر تحميل الصفحة</p>
                  <button onClick={(e) => { e.stopPropagation(); setImageError(false); setImageLoading(true); }}
                    className="mt-3 px-4 py-2 bg-amber-600 text-white text-sm rounded-lg">إعادة المحاولة</button>
                </div>
              )}

              {/* Page-turn zones: full-height side strips with a large,
                  always-visible arrow + label, so the target is easy to
                  find and to press anywhere along the edge. The strip on
                  the facing-page side also carries a thin sliver of that
                  page (its spine-side edge), so the user always sees
                  whether the open page sits on the right or the left of
                  the spread — while the main page itself stays fixed. */}
              <button onClick={(e) => { e.stopPropagation(); goToPage(currentPage - 1); }} disabled={currentPage <= 1}
                aria-label="الصفحة السابقة"
                className="absolute top-0 bottom-0 right-0 w-24 z-20 flex flex-col items-center justify-center gap-1 bg-gradient-to-l from-white/15 to-transparent disabled:opacity-20 group">
                {!facingOnLeft && hasFacingPage && (
                  <div className="absolute inset-y-0 left-0 w-8 overflow-hidden pointer-events-none border-l border-white/30" title="الصفحة المقابلة">
                    <img src={edition.imageUrl(facingPage)} alt="" draggable={false}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      className="absolute top-0 left-0 h-full w-auto max-w-none opacity-70" />
                  </div>
                )}
                <div className="relative z-10 flex flex-col items-center gap-1">
                  <div className="p-4 bg-white/25 group-hover:bg-white/35 text-white rounded-full shadow-lg ring-1 ring-white/40 transition-smooth group-disabled:opacity-20">
                    <ChevronRight className="w-10 h-10" />
                  </div>
                  <span className="text-xs font-bold text-white/90 drop-shadow">السابق</span>
                </div>
              </button>
              <button onClick={(e) => { e.stopPropagation(); goToPage(currentPage + 1); }} disabled={currentPage >= TOTAL_PAGES}
                aria-label="الصفحة التالية"
                className="absolute top-0 bottom-0 left-0 w-24 z-20 flex flex-col items-center justify-center gap-1 bg-gradient-to-r from-white/15 to-transparent disabled:opacity-20 group">
                {facingOnLeft && hasFacingPage && (
                  <div className="absolute inset-y-0 right-0 w-8 overflow-hidden pointer-events-none border-r border-white/30" title="الصفحة المقابلة">
                    <img src={edition.imageUrl(facingPage)} alt="" draggable={false}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      className="absolute top-0 right-0 h-full w-auto max-w-none opacity-70" />
                  </div>
                )}
                <div className="relative z-10 flex flex-col items-center gap-1">
                  <div className="p-4 bg-white/25 group-hover:bg-white/35 text-white rounded-full shadow-lg ring-1 ring-white/40 transition-smooth group-disabled:opacity-20">
                    <ChevronLeft className="w-10 h-10" />
                  </div>
                  <span className="text-xs font-bold text-white/90 drop-shadow">التالي</span>
                </div>
              </button>

              {/* Verse selector — show all verses */}
              <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center pb-4 pointer-events-auto px-4"
                onClick={(e) => e.stopPropagation()}>
                <div className="bg-black/70 backdrop-blur rounded-xl p-2.5 max-w-[95vw] overflow-x-auto">
                  <div className="flex gap-2">
                    {surahVerses.map((v) => (
                      <button key={v.id} onClick={() => handleVerseClick(v)}
                        className={`flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold transition-smooth flex-shrink-0 ${
                          selectedVerse?.id === v.id ? 'bg-emerald-600 text-white' :
                          v.has_links ? 'bg-emerald-500/30 text-emerald-300 hover:bg-emerald-500/50' : 'bg-white/10 text-white/70 hover:bg-white/20'
                        }`}>
                        {v.ayah_no}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Ayah popup: links, then irab, then tafsir — in that order */}
              {selectedVerse && (
                <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/40"
                  onClick={(e) => { e.stopPropagation(); setSelectedVerse(null); }}>
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[75vh] flex flex-col animate-slide-up"
                    onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between p-4 border-b border-gray-100">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center justify-center w-9 h-9 bg-emerald-100 text-emerald-700 text-base font-bold rounded-lg">
                          {selectedVerse.ayah_no}
                        </span>
                        <div>
                          <p className="text-sm text-accent-500">{selectedVerse.surah_name} — آية {selectedVerse.ayah_no}</p>
                        </div>
                      </div>
                      <button onClick={() => setSelectedVerse(null)}
                        className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="p-4 overflow-y-auto">
                      <p className="font-arabic text-xl text-accent-800 leading-loose mb-3 text-center">{selectedVerse.ayah_text}</p>
                      <div className="flex gap-2 mb-4">
                        <button onClick={() => setPopupTab('links')}
                          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-smooth ${popupTab === 'links' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-accent-600 hover:bg-gray-200'}`}>
                          الروابط
                        </button>
                        <button onClick={() => setPopupTab('irab')}
                          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-smooth ${popupTab === 'irab' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-accent-600 hover:bg-gray-200'}`}>
                          الإعراب
                        </button>
                        <button onClick={() => setPopupTab('tafsir')}
                          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-smooth ${popupTab === 'tafsir' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-accent-600 hover:bg-gray-200'}`}>
                          التفسير
                        </button>
                      </div>
                      {popupTab === 'links' && (loadingLinks ? (
                        <div className="flex items-center justify-center py-6">
                          <div className="w-7 h-7 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
                        </div>
                      ) : verseLinks.length > 0 ? (
                        <div className="space-y-2">
                          {verseLinks.map((link) => (
                            <div key={link.id} className="bg-gray-50 rounded-lg p-3 border border-emerald-100">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold mb-2 ${getLinkTypeColors(link.link_types)}`}>
                                {formatTypes(link.link_types)}
                              </span>
                              {link.link_title && <p className="text-base font-bold text-accent-700 mb-1">{link.link_title}</p>}
                              <p className="text-base text-accent-600 leading-relaxed">{link.link_content}</p>
                              <div className="flex gap-2 mt-2">
                                {link.synthetic_audio_url && (
                                  <button onClick={() => playAudio(link.synthetic_audio_url!)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg">
                                    <Volume2 className="w-4 h-4" /> صوت مولّد
                                  </button>
                                )}
                                {link.audio_url && (
                                  <button onClick={() => playAudio(link.audio_url!)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg">
                                    <Volume2 className="w-4 h-4" /> مقطع رنا
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-6 bg-gray-50 rounded-lg">
                          <Bookmark className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                          <p className="text-base text-accent-400">لا توجد روابط لهذه الآية بعد</p>
                        </div>
                      ))}
                      {popupTab === 'irab' && (
                        <div className="space-y-3">
                          <p className="text-base text-accent-600 leading-relaxed">إعراب الآية كلمة كلمة من Quranic Arabic Corpus — مشروع أكاديمي (جامعة ليدز) يبيّن لكل كلمة نوعها وحالتها الإعرابية وجذرها.</p>
                          <a href={`https://corpus.quran.com/wordbyword.jsp?chapter=${selectedVerse.surah_no}&verse=${selectedVerse.ayah_no}`} target="_blank" rel="noreferrer"
                            className="block text-center py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold rounded-lg transition-smooth">
                            فتح إعراب {selectedVerse.surah_name} — آية {selectedVerse.ayah_no}
                          </a>
                          <p className="text-xs text-accent-400 leading-relaxed text-center">يفتح في صفحة جديدة. أما «الجدول في إعراب القرآن» للصافي فهو المرجع الورقي الكامل، ونصّه غير متاح كخدمة مجانية.</p>
                        </div>
                      )}
                      {popupTab === 'tafsir' && (
                        <div className="space-y-3">
                          <div className="flex gap-2">
                            {TAFSIR_EDITIONS.map((ed) => (
                              <button key={ed.id} onClick={() => setTafsirEdition(ed.id)}
                                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-smooth ${tafsirEdition === ed.id ? 'bg-amber-600 text-white' : 'bg-amber-50 text-accent-600 hover:bg-amber-100'}`}>
                                {ed.name}
                              </button>
                            ))}
                          </div>
                          {tafsirLoading ? (
                            <div className="flex items-center justify-center py-6">
                              <div className="w-7 h-7 border-2 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
                            </div>
                          ) : tafsirError ? (
                            <div className="text-center py-6 bg-gray-50 rounded-lg">
                              <p className="text-base text-accent-500 mb-3">{tafsirError}</p>
                              <button onClick={() => selectedVerse && loadTafsir(tafsirEdition, selectedVerse)}
                                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg">
                                إعادة المحاولة
                              </button>
                            </div>
                          ) : tafsirText ? (
                            <p className="text-base text-accent-700 leading-loose whitespace-pre-line">{tafsirText}</p>
                          ) : null}
                          <p className="text-xs text-accent-400 text-center">المصدر: نصوص تفاسير منشورة عبر AlQuranCloud</p>
                        </div>
                      )}
                    </div>
                    <div className="p-3 border-t border-gray-100">
                      <button onClick={() => setSelectedVerse(null)}
                        className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-accent-700 text-sm font-semibold rounded-lg transition-smooth">
                        إغلاق
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Page indicator */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/0 text-xs pointer-events-none">
                {currentPage}
              </div>
            </>
          )}

          {/* Edition picker in fullscreen */}
          {showEditionPickerInFullscreen && !showRatelIntro && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
              onClick={() => setShowEditionPickerInFullscreen(false)}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slide-up"
                onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-gray-100">
                  <h3 className="text-lg font-bold text-accent-800">اختر طبعة المصحف</h3>
                  <button onClick={() => setShowEditionPickerInFullscreen(false)}
                    className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-4 space-y-2">
                  {EDITIONS.map((ed, idx) => (
                    <button key={ed.id} onClick={() => { setSelectedEdition(idx); setShowEditionPickerInFullscreen(false); setImageLoading(true); setImageError(false); }}
                      className={`w-full text-right p-3 rounded-xl border-2 transition-smooth ${selectedEdition === idx ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-200 hover:bg-amber-50/30'}`}>
                      <p className="font-bold text-accent-800 text-base">{ed.name}</p>
                      <p className="text-sm text-accent-500 mt-0.5">{ed.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QuickJumpBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-4 py-2 bg-gray-50 hover:bg-amber-50 text-accent-600 hover:text-amber-700 text-sm font-semibold rounded-lg border border-gray-200 hover:border-amber-200 transition-smooth">
      {label}
    </button>
  );
}
