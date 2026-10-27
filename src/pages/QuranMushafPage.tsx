import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import { supabase } from '../lib/supabase';
import { signOut } from '../lib/auth';
import { SURAHS } from '../lib/surahs';
import { RECITERS, DEFAULT_RECITER_ID, type Reciter } from '../lib/reciters';
import { useLang } from '../lib/LanguageContext';
import { LANGUAGES } from '../lib/translations';
import { LINK_TYPES } from '../lib/types';
import type { QuranVerse, AyahLink } from '../lib/types';
import { JUZ_START_PAGES, HIZB_START_PAGES, getJuzFromPage, getHizbFromPage } from '../lib/quranIndex';
import { dailyDua } from '../lib/personalTouch';
import { MUSHAF_EDITIONS as EDITIONS, SURAH_START_PAGES, getSurahStartPage, TOTAL_MUSHAF_PAGES } from '../lib/mushafEditions';
import { loadVerseIndex } from '../lib/searchIndex';
import { buildOrderedVerses, findLock, advanceTracking, heardWords, type TrackedPosition, type OrderedVerse } from '../lib/imamTracker';
import { MADINAH_PAPER_BOXES, MADINAH_NORMALIZED_ASPECT } from '../lib/madinahPaperBoxes';
import BottomNav from '../components/BottomNav';
import {
  BookOpen, ChevronRight, ChevronLeft, Home, LogOut, Globe,
  ZoomIn, ZoomOut, Maximize2, X, Bookmark, Volume2, Layers, Link,
  LayoutGrid, List, BookMarked, Hash, Heart, Play, Square, Repeat, Mic, RefreshCw, Clock,
} from 'lucide-react';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'follow';

const TOTAL_PAGES = TOTAL_MUSHAF_PAGES;

const EDITION_STORAGE_KEY = 'quran-mushaf-edition';
const PAGE_STORAGE_KEY = 'quran-mushaf-page';
const TARGET_STORAGE_KEY = 'quran-mushaf-target';
const FOLLOW_STORAGE_KEY = 'quran-follow-mode';
const PAGE_LIST_STORAGE_KEY = 'quran-mushaf-page-lists';

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

const WORSHIP_STORAGE_KEY = 'quran-worship-seconds';

// Worship timer: counts the time the reader actually spends in the
// Mushaf, and keeps the total across visits (localStorage). It ticks in
// its own component so the once-a-30s update never re-renders the page,
// and it pauses while the tab is hidden, so only real devotion time is
// counted. Render it in exactly ONE place at a time (normal toolbar XOR
// fullscreen pill) — the normal view stays mounted under fullscreen,
// so two instances would double-count.
function formatWorship(totalSeconds: number): string {
  if (totalSeconds < 60) return 'أقل من دقيقة';
  const m = Math.floor(totalSeconds / 60);
  if (m < 60) return `${m} دقيقة`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h} ساعة` : `${h} ساعة و ${mm} دقيقة`;
}

function WorshipTimer({ dark }: { dark?: boolean }) {
  const [total, setTotal] = useState<number>(() => {
    try { return Number(localStorage.getItem(WORSHIP_STORAGE_KEY)) || 0; } catch { return 0; }
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setTotal((t) => t + 30);
      try {
        const next = (Number(localStorage.getItem(WORSHIP_STORAGE_KEY)) || 0) + 30;
        localStorage.setItem(WORSHIP_STORAGE_KEY, String(next));
      } catch {}
    }, 30000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold whitespace-nowrap ${dark ? 'bg-black/60 text-white ring-1 ring-white/40' : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'}`} title="وقتك في التعبّد بحفظ كتاب الله">
      <Clock className="w-4 h-4" />
      بقالك {formatWorship(total)} بتتعبد بحفظ كتاب الله
    </span>
  );
}

// Facing-page strip image with deterministic presence. A transient
// load failure used to hide the strip silently (onError ->
// display:none), so the strip popped in and out page by page and
// read as a shake while flipping. Now a first failure retries once
// with a cache-busting URL (bypasses any bad cache entry and
// re-attempts transient network failures); a second failure renders
// a placeholder with the facing page number instead of vanishing,
// so the strip is always present. Keyed by facing page at the call
// site, so the attempt state resets on every page turn.
function FacingStripImg({ src, pageNo, className, style }: {
  src: string;
  pageNo: number;
  className: string;
  style: CSSProperties | undefined;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#f5f0e1]">
        <span className="text-[#8a7a4a] font-bold text-2xl">{pageNo}</span>
      </div>
    );
  }
  const url = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}sw-retry=1`;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      onError={() => { if (attempt === 0) setAttempt(1); else setFailed(true); }}
      className={className}
      style={style}
    />
  );
}

export default function QuranMushafPage({
  session,
  onNavigate,
  startInFollow,
}: {
  session: import('@supabase/supabase-js').Session | null;
  onNavigate: (r: Route) => void;
  // True when the dedicated follow route (#/follow) is open: follow
  // mode starts at once. The same instance serves mushaf|follow, so a
  // live tracking session survives switching between the two routes.
  startInFollow?: boolean;
}) {
  const { t, lang, setLang } = useLang();
  const [currentPage, setCurrentPage] = useState(readStoredPage);
  const [selectedEdition, setSelectedEdition] = useState(readStoredEdition);
  const [ayahFilter, setAyahFilter] = useState('');
  // Search-jump highlight: the ayah tapped in لوحتي, marked amber on
  // its exact words until the page turns or fullscreen exits.
  const [searchHighlight, setSearchHighlight] = useState<{ surah: number; ayah: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [showRatelIntro, setShowRatelIntro] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showEditionPicker, setShowEditionPicker] = useState(false);
  const [showEditionPickerInFullscreen, setShowEditionPickerInFullscreen] = useState(false);
  // Clean reading mode: hides every fullscreen control (top buttons,
  // chips, side strips, verse strip) so only the page shows. Word taps
  // and swipes keep working; tapping the page margin restores controls.
  const [cleanMode, setCleanMode] = useState(false);
  // Golden frame: a pointer-events-none overlay above the page image.
  // It never touches layout, so tap mapping and the no-dance geometry
  // are unaffected. Persisted across visits.
  const [goldFrame, setGoldFrame] = useState(() => {
    try { return localStorage.getItem('quran-gold-frame') === '1'; } catch { return false; }
  });
  const toggleGoldFrame = () => {
    setGoldFrame((v) => {
      const next = !v;
      try { localStorage.setItem('quran-gold-frame', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };
  const [showCleanHint, setShowCleanHint] = useState(false);
  useEffect(() => {
    if (!cleanMode) return;
    setShowCleanHint(true);
    const t = setTimeout(() => setShowCleanHint(false), 4000);
    return () => clearTimeout(t);
  }, [cleanMode]);
  const [showIndex, setShowIndex] = useState(false);
  const [indexTab, setIndexTab] = useState<IndexTab>('surah');
  const [pageInput, setPageInput] = useState('');
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  // Natural aspect of the loaded page image (default 0.63 = Madani page).
  // Reserving the box with aspect-ratio means the layout never collapses
  // while the next page loads — a collapsing width was one of the two
  // causes of the page visibly shifting left/right on page turns.
  const [imgAspect, setImgAspect] = useState(0.63);
  const [surahVerses, setSurahVerses] = useState<QuranVerse[]>([]);
  // Ayahs actually printed on the current Mushaf page (from the free
  // Quranpedia API, mushaf 1 = Hafs, Madani pagination). While it loads
  // — or if it fails — the strip falls back to the full surah list, so
  // it never goes empty. Spanned pages can hold the tail of earlier
  // surahs too, so their Supabase rows are fetched separately.
  const [pageAyahRefs, setPageAyahRefs] = useState<{ surah: number; ayah: number }[] | null>(null);
  const [spannedVerses, setSpannedVerses] = useState<QuranVerse[]>([]);
  const surahPageListCache = useRef<Record<number, { number: number; page_number: number }[]>>({});
  const [verseLinks, setVerseLinks] = useState<AyahLink[]>([]);
  const [selectedVerse, setSelectedVerse] = useState<QuranVerse | null>(null);
  // Ayah recitation (open audio CDNs, see lib/reciters.ts),
  // with a repeat switch for memorization. Stops when the popup ayah changes.
  const reciteRef = useRef<HTMLAudioElement | null>(null);
  const [reciting, setReciting] = useState(false);
  const [reciteLoop, setReciteLoop] = useState(false);
  const [reciteError, setReciteError] = useState('');
  const [reciterId, setReciterId] = useState(() => {
    try {
      const saved = localStorage.getItem('quran-reciter') || '';
      return RECITERS.some((r) => r.id === saved) ? saved : DEFAULT_RECITER_ID;
    } catch { return DEFAULT_RECITER_ID; }
  });
  const reciter = RECITERS.find((r) => r.id === reciterId) ?? RECITERS[0];
  const [showReciters, setShowReciters] = useState(false);
  const stopRecitation = useCallback(() => {
    if (reciteRef.current) { reciteRef.current.pause(); reciteRef.current = null; }
    setReciting(false);
  }, []);
  const changeReciter = (id: string) => {
    setReciterId(id);
    try { localStorage.setItem('quran-reciter', id); } catch { /* ignore */ }
  };
  useEffect(() => { stopRecitation(); setShowReciters(false); }, [selectedVerse?.id, stopRecitation]);
  const startRecitation = (verse: QuranVerse, r: Reciter) => {
    stopRecitation();
    changeReciter(r.id);
    setReciteError('');
    const audio = new Audio(r.audioUrl(verse.surah_no, verse.ayah_no));
    audio.loop = reciteLoop;
    audio.onended = () => { if (!audio.loop) setReciting(false); };
    audio.onerror = () => { setReciteError('تعذرت التلاوة — تحقق من الاتصال وحاول تاني'); setReciting(false); };
    reciteRef.current = audio;
    audio.play().then(() => setReciting(true)).catch(() => {
      if (reciteRef.current === audio) reciteRef.current = null;
      setReciteError('تعذرت التلاوة — تحقق من الاتصال وحاول تاني'); setReciting(false);
    });
  };
  // Two-step listen flow: first tap on "استمع للآية" reveals the reciter
  // names, picking one starts playback; while playing the button stops
  // and hides the names again.
  const handleListenButton = (verse: QuranVerse) => {
    if (reciting) { stopRecitation(); setShowReciters(false); return; }
    if (!showReciters) { setShowReciters(true); return; }
    startRecitation(verse, reciter);
  };
  const [loadingLinks, setLoadingLinks] = useState(false);
  // Ayah popup tabs: links first, biggest and clearest (the app is
  // about the links), then mutashabihat, then irab, then tafsir
  // (with a choice of three published tafsirs inside it). Links is
  // the default tab; hopping between similar ayahs keeps the
  // mutashabihat tab so verses can still be compared by hopping.
  const [popupTab, setPopupTab] = useState<'mutashabihat' | 'links' | 'irab' | 'tafsir'>('links');
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
  // the next page for odd pages, the previous page for even pages.
  // The peek window is PINNED to the left side on every page: the old
  // alternating side made the whole composition lurch left/right on
  // every turn (measured on the user's video: the main page itself is
  // stable within ~1% across parities, but the total bright mass swung
  // ~14% as the strip jumped sides), which is what the eye reads as a
  // shake. The image inside still pins the facing page's SPINE edge
  // (its right edge for odd current pages, its left edge for even
  // ones), so the peek always shows the spine-adjacent slice.
  const facingPage = currentPage % 2 === 1 ? currentPage + 1 : currentPage - 1;
  const facingOnLeft = currentPage % 2 === 1;
  const hasFacingPage = facingPage >= 1 && facingPage <= TOTAL_PAGES;
  // Framed facing-page strip: a wide, full-opacity slice of the facing page
  // with a spine shadow, so it reads as part of the neighbouring page of an
  // open book (not a ghost sliver) and visually anchors the main page.
  const FACING_STRIP_W = 'min(22vw, 170px)';
  const currentJuz = getJuzFromPage(currentPage);
  const currentHizb = getHizbFromPage(currentPage);
  // The strip shows only this page's ayahs (in page order) once their
  // refs have loaded; otherwise it falls back to the full surah list.
  const stripVerses: QuranVerse[] = pageAyahRefs
    ? pageAyahRefs.map((r) => {
        const pool = r.surah === currentSurah ? surahVerses : spannedVerses;
        return pool.find((v) => v.ayah_no === r.ayah);
      }).filter((v): v is QuranVerse => Boolean(v))
    : surahVerses;

  const fetchPageVerses = useCallback(async (page: number) => {
    const surah = getPageSurah(page);
    const { data } = await supabase
      .from('quran_verses')
      .select('*')
      .eq('surah_no', surah)
      .order('ayah_no', { ascending: true });
    setSurahVerses(data || []);
  }, []);

  // One surah's ayah->page list from Quranpedia (cached in memory and
  // localStorage; the lists are static, so caching is safe).
  const loadSurahPageList = useCallback(async (surah: number) => {
    if (surahPageListCache.current[surah]) return surahPageListCache.current[surah];
    try {
      const raw = localStorage.getItem(`${PAGE_LIST_STORAGE_KEY}:${surah}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { number: number; page_number: number }[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          surahPageListCache.current[surah] = parsed;
          return parsed;
        }
      }
    } catch { /* ignore a malformed cache entry */ }
    const res = await fetch(`https://api.quranpedia.net/v1/mushafs/1/${surah}`);
    if (!res.ok) throw new Error('page list fetch failed');
    const json = await res.json();
    const list = (Array.isArray(json) ? json : [])
      .map((a: any) => ({ number: Number(a.number), page_number: Number(a.page_number) }))
      .filter((a) => Number.isInteger(a.number) && Number.isInteger(a.page_number));
    if (list.length === 0) throw new Error('empty page list');
    surahPageListCache.current[surah] = list;
    try { localStorage.setItem(`${PAGE_LIST_STORAGE_KEY}:${surah}`, JSON.stringify(list)); } catch { /* ignore */ }
    return list;
  }, []);

  // The ayah refs printed on one page, in page order. Walks backwards
  // from the page's surah while each surah starts on this page, so a
  // page shared by several short surahs (e.g. page 604) is fully covered.
  const loadPageAyahs = useCallback(async (page: number) => {
    const surah = getPageSurah(page);
    try {
      const refs: { surah: number; ayah: number }[] = [];
      let s = surah;
      while (s >= 1) {
        const list = await loadSurahPageList(s);
        const onPage = list.filter((a) => a.page_number === page);
        if (onPage.length === 0) break;
        refs.unshift(...onPage.map((a) => ({ surah: s, ayah: a.number })));
        if (!onPage.some((a) => a.number === 1)) break;
        s -= 1;
      }
      setPageAyahRefs(refs.length > 0 ? refs : null);
      const other = refs.filter((r) => r.surah !== surah);
      if (other.length > 0) {
        const bySurah = new Map<number, number[]>();
        for (const r of other) {
          const arr = bySurah.get(r.surah) || [];
          arr.push(r.ayah);
          bySurah.set(r.surah, arr);
        }
        const rows: QuranVerse[] = [];
        for (const [os, ayahs] of bySurah) {
          const { data } = await supabase.from('quran_verses').select('*').eq('surah_no', os).in('ayah_no', ayahs);
          if (data) rows.push(...data);
        }
        setSpannedVerses(rows);
      } else {
        setSpannedVerses([]);
      }
    } catch {
      setPageAyahRefs(null);
      setSpannedVerses([]);
    }
  }, [loadSurahPageList]);

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

  // Mutashabihat (similar verses) tab: published reviewed phrase data
  // FIRST, computed detection as fallback. The published source is
  // Tarteel's Quranic Universal Library (QUL) "Mutashabihat ul Quran"
  // dataset (phrases.json + phrase_verses.json, bundled under
  // public/mutashabihat/ so the popup reads them same-origin, in-window;
  // ranges are 0-based inclusive token ranges of the raw Hafs text).
  // Quran.com's related-verses endpoint was tested and is NOT usable by
  // a third-party app (direct route 404s, its proxy rejects cross-origin
  // browser fetches), and QUL itself has no live API (its download needs
  // a sign-in) — hence the bundled open mirror of the same QUL data.
  // Fallback: computed from the app's own seeded quran_verses table
  // (ayah_text_clean = diacritic-stripped), where an ayah counts as
  // mutashabih when it shares a contiguous phrase of 3+ words, indexed
  // by word trigrams so each lookup stays fast.
  type QuranTextRow = { id: number; surah_no: number; surah_name: string; ayah_no: number; ayah_text: string; ayah_text_clean: string | null };
  type SimilarAyah = { verse: QuranTextRow; shared: string[]; run: number };
  const cleanArabic = (t: string) => t.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u08D3-\u08FF\u0640\u200C-\u200F\u061C\u061F]/g, '').replace(/ـ/g, '').trim();
  const wordsOf = (r: QuranTextRow) => (r.ayah_text_clean || cleanArabic(r.ayah_text)).split(/\s+/).filter((w) => w.length > 0);
  const [mutashabihat, setMutashabihat] = useState<SimilarAyah[] | null>(null);
  const [mutashabihatLoading, setMutashabihatLoading] = useState(false);
  const [mutashabihatError, setMutashabihatError] = useState<string | null>(null);
  const quranTextCache = useRef<QuranTextRow[] | null>(null);
  const trigramIndex = useRef<Map<string, number[]> | null>(null);
  // Published QUL phrase data (bundled JSON, fetched once per session).
  type QulPhrase = { surahs: number; ayahs: number; count: number; source: { key: string; from: number; to: number }; ayah: Record<string, number[][]> };
  type QulData = { phrases: Record<string, QulPhrase>; phraseVerses: Record<string, number[]> };
  type QulPhraseEntry = { id: number; text: string; ayahs: number; surahs: number; others: { key: string; surah_no: number; ayah_no: number; surah_name: string }[] };
  const [qulPhrases, setQulPhrases] = useState<QulPhraseEntry[] | null>(null);
  const [mutashabihatSource, setMutashabihatSource] = useState<'qul' | 'computed' | null>(null);
  const qulDataCache = useRef<QulData | null>(null);
  // Shared in-flight promise: rapid tab opens/hops must not refetch.
  const qulDataPromise = useRef<Promise<QulData | null> | null>(null);
  const loadQulData = useCallback(async (): Promise<QulData | null> => {
    if (qulDataCache.current) return qulDataCache.current;
    if (!qulDataPromise.current) {
      qulDataPromise.current = (async () => {
        try {
          const [pRes, vRes] = await Promise.all([fetch('/mutashabihat/phrases.json'), fetch('/mutashabihat/phrase_verses.json')]);
          if (!pRes.ok || !vRes.ok) throw new Error('fetch failed');
          const data: QulData = { phrases: await pRes.json(), phraseVerses: await vRes.json() };
          qulDataCache.current = data;
          return data;
        } catch { return null; }
      })();
      // A failed load clears itself so the next tab open retries.
      qulDataPromise.current.then((d) => { if (!d) qulDataPromise.current = null; });
    }
    return qulDataPromise.current;
  }, []);

  const quranTextPromise = useRef<Promise<QuranTextRow[] | null> | null>(null);
  const loadQuranText = useCallback(async (): Promise<QuranTextRow[] | null> => {
    if (quranTextCache.current) return quranTextCache.current;
    if (!quranTextPromise.current) {
      quranTextPromise.current = (async () => {
        try {
          const rows: QuranTextRow[] = [];
          const PAGE = 1000;
          for (let from = 0; ; from += PAGE) {
            const { data, error } = await supabase.from('quran_verses')
              .select('id,surah_no,surah_name,ayah_no,ayah_text,ayah_text_clean')
              .order('surah_no', { ascending: true }).order('ayah_no', { ascending: true })
              .range(from, from + PAGE - 1);
            if (error || !data) throw new Error('fetch failed');
            rows.push(...(data as QuranTextRow[]));
            if (data.length < PAGE) break;
          }
          if (rows.length < 6000) throw new Error('incomplete');
          const idx = new Map<string, number[]>();
          rows.forEach((r, i) => {
            const words = wordsOf(r);
            for (let j = 0; j + 2 < words.length; j++) {
              const key = `${words[j]} ${words[j + 1]} ${words[j + 2]}`;
              const arr = idx.get(key);
              if (arr) arr.push(i); else idx.set(key, [i]);
            }
          });
          quranTextCache.current = rows;
          trigramIndex.current = idx;
          return rows;
        } catch { return null; }
      })();
      quranTextPromise.current.then((d) => { if (!d) quranTextPromise.current = null; });
    }
    return quranTextPromise.current;
  }, []);

  const findSimilar = useCallback(async (verse: QuranVerse) => {
    setMutashabihat(null);
    setQulPhrases(null);
    setMutashabihatSource(null);
    setMutashabihatError(null);
    setMutashabihatLoading(true);
    // QUL FIRST — measured on the real corpus, the lookup itself is
    // ~1ms and both JSONs parse in ~18ms; the old order loaded all
    // 6,236 verses (7 sequential paginated queries) before even
    // consulting QUL, and that wait was the slowness. The published
    // phrase data now answers without the table: labels need only the
    // source ayahs' words, fetched by one small query over the distinct
    // source surahs, with surah names from the SURAHS constant.
    const qul = await loadQulData();
    const qulKey = `${verse.surah_no}:${verse.ayah_no}`;
    const qulIds = qul?.phraseVerses[qulKey];
    if (qul && qulIds && qulIds.length > 0) {
      let labelRows: { surah_no: number; ayah_no: number; ayah_text: string }[] | null = null;
      try {
        const srcSurahs = [...new Set(qulIds.map((id) => qul.phrases[String(id)]?.source.key.split(':')[0]).filter(Boolean).map(Number))];
        const { data, error } = await supabase.from('quran_verses')
          .select('surah_no,ayah_no,ayah_text').in('surah_no', srcSurahs);
        if (error || !data) throw new Error('label fetch failed');
        labelRows = data as { surah_no: number; ayah_no: number; ayah_text: string }[];
      } catch {
        // Label fetch failed: use the full table for labels instead.
        labelRows = await loadQuranText();
      }
      if (labelRows) {
        const entries: QulPhraseEntry[] = [];
        for (const id of qulIds) {
          const ph = qul.phrases[String(id)];
          if (!ph) continue;
          const [sNo, aNo] = ph.source.key.split(':').map(Number);
          const srcRow = labelRows.find((r) => r.surah_no === sNo && r.ayah_no === aNo);
          const srcWords = srcRow ? srcRow.ayah_text.split(/\s+/).filter((w) => w.length > 0) : [];
          const text = srcWords.slice(ph.source.from, ph.source.to + 1).join(' ');
          if (!text) continue;
          const others = Object.keys(ph.ayah).filter((k) => k !== qulKey).map((k) => {
            const [os, oa] = k.split(':').map(Number);
            return { key: k, surah_no: os, ayah_no: oa, surah_name: SURAHS.find((s) => s.no === os)?.name || `سورة ${os}` };
          }).sort((x, y) => x.surah_no - y.surah_no || x.ayah_no - y.ayah_no);
          entries.push({ id, text, ayahs: ph.ayahs, surahs: ph.surahs, others });
        }
        if (entries.length > 0) {
          entries.sort((a, b) => b.text.split(/\s+/).length - a.text.split(/\s+/).length);
          setQulPhrases(entries);
          setMutashabihatSource('qul');
          setMutashabihatLoading(false);
          return;
        }
      }
      // QUL ids existed but produced no usable labels: fall through to
      // the computed detection below.
    }
    // Fallback: computed detection from the text itself. The full table
    // + trigram index load lazily, only when QUL has nothing for this
    // ayah (measured: index build ~90ms, lookup <11ms on real data).
    const rows = await loadQuranText();
    if (!rows || !trigramIndex.current) {
      setMutashabihatError('تعذر تحميل نص القرآن للمقارنة — تحقق من الاتصال وحاول مجدداً');
      setMutashabihatLoading(false);
      return;
    }
    const target = rows.find((r) => r.surah_no === verse.surah_no && r.ayah_no === verse.ayah_no);
    if (!target) {
      setMutashabihatError('لا توجد بيانات نصية لهذه الآية');
      setMutashabihatLoading(false);
      return;
    }
    const tWords = wordsOf(target);
    const cand = new Set<number>();
    for (let j = 0; j + 2 < tWords.length; j++) {
      const arr = trigramIndex.current.get(`${tWords[j]} ${tWords[j + 1]} ${tWords[j + 2]}`);
      if (arr) for (const i of arr) cand.add(i);
    }
    const results: SimilarAyah[] = [];
    for (const i of cand) {
      const row = rows[i];
      if (row.surah_no === verse.surah_no && row.ayah_no === verse.ayah_no) continue;
      const cWords = wordsOf(row);
      let best = 0; let bestStart = 0;
      for (let a = 0; a < cWords.length; a++) {
        for (let b = 0; b < tWords.length; b++) {
          let len = 0;
          while (a + len < cWords.length && b + len < tWords.length && cWords[a + len] === tWords[b + len]) len++;
          if (len > best) { best = len; bestStart = a; }
        }
      }
      if (best >= 3) results.push({ verse: row, shared: cWords.slice(bestStart, bestStart + best), run: best });
    }
    results.sort((x, y) => y.run - x.run || x.verse.surah_no - y.verse.surah_no || x.verse.ayah_no - y.verse.ayah_no);
    setMutashabihat(results.slice(0, 12));
    setMutashabihatSource('computed');
    setMutashabihatLoading(false);
  }, [loadQuranText, loadQulData]);

  useEffect(() => {
    if (popupTab !== 'mutashabihat' || !selectedVerse) return;
    findSimilar(selectedVerse);
  }, [popupTab, selectedVerse, findSimilar]);

  // Warm the QUL phrase JSONs shortly after the Mushaf mounts (idle,
  // best-effort): the first mutashabihat tab open then skips its only
  // remaining fetch. The full verse table is NOT preloaded — it is
  // needed only for the computed fallback.
  useEffect(() => {
    const t = setTimeout(() => { void loadQulData(); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Jump from a similar ayah to that ayah's own popup, staying on the
  // mutashabihat tab so similar verses can be compared by hopping.
  const handleSimilarClick = (row: QuranTextRow) => {
    const verse: QuranVerse = { id: row.id, surah_no: row.surah_no, surah_name: row.surah_name, ayah_no: row.ayah_no, ayah_text: row.ayah_text, has_links: false, links_count: 0, is_protected: false, created_at: '', updated_at: '' };
    setSelectedVerse(verse);
    setPopupTab('mutashabihat');
    fetchVerseLinks(row.id);
  };

  // Hop from a published QUL phrase to one of its occurrence ayahs.
  const hopToQulAyah = (surahNo: number, ayahNo: number) => {
    const row = quranTextCache.current?.find((r) => r.surah_no === surahNo && r.ayah_no === ayahNo);
    if (row) handleSimilarClick(row);
  };

  // Render a similar ayah's display text with the shared phrase
  // highlighted: display words are cleaned with the same diacritic
  // strip as the stored clean text, so the match lines up.
  const renderWithShared = (displayText: string, shared: string[]) => {
    const dispWords = displayText.split(/\s+/).filter((w) => w.length > 0);
    const cleaned = dispWords.map((w) => cleanArabic(w));
    let start = -1;
    for (let i = 0; i + shared.length <= cleaned.length; i++) {
      if (shared.every((w, k) => cleaned[i + k] === w)) { start = i; break; }
    }
    return dispWords.map((w, i) => (start >= 0 && i >= start && i < start + shared.length
      ? <mark key={i} className="bg-amber-200 rounded px-0.5">{w} </mark>
      : <span key={i}>{w} </span>));
  };

  useEffect(() => {
    setImageLoading(true);
    setImageError(false);
    fetchPageVerses(currentPage);
    setPageAyahRefs(null);
    loadPageAyahs(currentPage);
  }, [currentPage, fetchPageVerses, loadPageAyahs]);

  // Preload the neighbouring pages so turning feels instant.
  useEffect(() => {
    for (const p of [currentPage - 1, currentPage + 1]) {
      if (p >= 1 && p <= TOTAL_PAGES) {
        const img = new Image();
        img.src = edition.imageUrl(p);
      }
    }
  }, [currentPage, edition]);

  // Remember the user's chosen edition and last page, and honour a
  // cross-page jump from لوحتي (stored as { surah, ayah }).
  useEffect(() => {
    localStorage.setItem(EDITION_STORAGE_KEY, String(selectedEdition));
  }, [selectedEdition]);
  useEffect(() => {
    localStorage.setItem(PAGE_STORAGE_KEY, String(currentPage));
  }, [currentPage]);
  // A jump from لوحتي (stored as { surah, ayah }): go to the ayah's
  // ACTUAL page (not the surah's first page), open the Mushaf fullscreen
  // at once (no intro), and highlight the ayah's words exactly — no
  // popup until the user taps a highlighted word.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TARGET_STORAGE_KEY);
      if (!raw) return;
      const target = JSON.parse(raw) as { surah?: number; ayah?: number };
      localStorage.removeItem(TARGET_STORAGE_KEY);
      if (!target.surah) return;
      const startPage = getSurahStartPage(target.surah);
      const go = (page: number) => {
        setCurrentPage(page);
        if (target.ayah) setSearchHighlight({ surah: target.surah as number, ayah: target.ayah });
        setShowFullscreen(true);
        requestNativeFullscreen();
      };
      if (!target.ayah) { go(startPage); return; }
      loadSurahPageList(target.surah)
        .then((list) => {
          const entry = list.find((a) => a.number === target.ayah);
          go(entry ? entry.page_number : startPage);
        })
        .catch(() => go(startPage));
    } catch { /* ignore a malformed stored target */ }
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToPage = (page: number) => {
    const clamped = Math.max(1, Math.min(TOTAL_PAGES, page));
    setCurrentPage(clamped);
    setSearchHighlight(null);
  };

  // Fullscreen swipe navigation (touch): swipe left = next page, swipe
  // right = previous page, matching the corner buttons. Attached only to
  // the page image so swipes over the verse strip still scroll the strip.
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  // Timestamp of the last swipe page-turn: the compatibility click that
  // follows a swipe must not be treated as a word tap.
  const lastSwipeAt = useRef(0);
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
    if (Math.abs(dx) >= 60 && Math.abs(dx) >= Math.abs(dy)) {
      lastSwipeAt.current = Date.now();
      if (dx < 0) goToPage(currentPage + 1);
      else goToPage(currentPage - 1);
    }
    // Taps are handled by the wrapper's onClick, NOT here: opening the
    // popup from touchend raced with the compatibility click that follows
    // every touch — the popup's own backdrop caught that click and closed
    // instantly, so word taps looked dead while strip buttons (click-only)
    // worked fine.
  };

  const goToSurah = (surahNo: number) => {
    goToPage(getSurahStartPage(surahNo));
    setShowIndex(false);
  };

  const visibleVerses = ayahFilter.trim()
    ? surahVerses.filter((v) => String(v.ayah_no) === ayahFilter.trim())
    : surahVerses;

  // Best-effort native fullscreen (iPad Safari supports it for elements
  // in recent versions): removes Safari's own chrome entirely so the page
  // truly fills the screen. Silently ignored where unsupported, where the
  // app-level fullscreen view below still applies.
  const requestNativeFullscreen = () => {
    try {
      const el = document.documentElement as any;
      const p = el.requestFullscreen?.() || el.webkitRequestFullscreen?.();
      (p as any)?.catch?.(() => {});
    } catch {}
  };
  const exitFullscreenView = () => {
    try {
      const d = document as any;
      const p = d.exitFullscreen?.() || d.webkitExitFullscreen?.();
      (p as any)?.catch?.(() => {});
    } catch {}
    setShowFullscreen(false);
    setCleanMode(false);
    setSearchHighlight(null);
  };

  // Follow-the-imam state + wake-lock helpers. These MUST sit above the
  // follow-functions block: useCallback deps arrays are evaluated eagerly
  // during render, so a deps entry referencing a const declared below
  // throws a TDZ ReferenceError on first render and blanks the page
  // (no error boundary) — that is exactly what broke #/mushaf in c9587b5.
  // Follow-the-imam mode ("الحق الإمام"): listen to the imam, lock onto
  // the ayah being recited, open its Mushaf page fullscreen, and move a
  // clear amber highlight along with the recitation. Listening runs on
  // the browser's live speech recognition where available (free, instant)
  // and falls back to 8-second Whisper chunks via the transcribe-audio
  // edge function where it is not (Safari) — the fallback lags ~10s and
  // spends OpenAI balance, and is labelled as such in the panel.
  const [followOn, setFollowOn] = useState(false);
  const [followReady, setFollowReady] = useState(false); // panel shown, engine not started yet
  const [followEngine, setFollowEngine] = useState<'live' | 'whisper' | null>(null);
  const [followStatus, setFollowStatus] = useState<'listening' | 'locked' | 'lost'>('listening');
  const [followPos, setFollowPos] = useState<TrackedPosition | null>(null);
  const [followHeard, setFollowHeard] = useState('');
  const [followError, setFollowError] = useState<string | null>(null);
  const [followManual, setFollowManual] = useState('');
  // Visible follow diagnostics (no silent failure): index-load state,
  // Whisper chunk phase / count / consecutive failures. The lobby shows
  // all of these, so a tap that does nothing visible is impossible.
  const [followIndexLoading, setFollowIndexLoading] = useState(false);
  const [followChunkPhase, setFollowChunkPhase] = useState<'idle' | 'recording' | 'uploading' | 'transcribing'>('idle');
  const [followChunkCount, setFollowChunkCount] = useState(0);
  const [followChunkFails, setFollowChunkFails] = useState(0);
  const followOrderedRef = useRef<OrderedVerse[] | null>(null);
  const followBufferRef = useRef<string[]>([]);
  const followListeningRef = useRef(false);
  const followMissRef = useRef(0);
  const followPosRef = useRef<TrackedPosition | null>(null);
  const followStatusRef = useRef<'listening' | 'locked' | 'lost'>('listening');
  const recognitionRef = useRef<any>(null);
  const followStreamRef = useRef<MediaStream | null>(null);
  const followWakeLockRef = useRef<any>(null);
  const followActiveRef = useRef(false);
  const followVisListenerRef = useRef(false);

  // The screen must NEVER sleep during a prayer. Browsers release wake
  // locks when the tab hides and sometimes when the system intervenes,
  // so a single request is not enough: re-acquire on visibility return
  // and on release while still following. A denied request just throws
  // and is swallowed, so the release handler cannot spin.
  const acquireWakeLock = useCallback(async () => {
    if (!followActiveRef.current) return;
    const nav = navigator as any;
    if (!nav.wakeLock?.request) return;
    try {
      const wl = await nav.wakeLock.request('screen');
      followWakeLockRef.current = wl;
      wl.addEventListener('release', () => {
        followWakeLockRef.current = null;
        if (followActiveRef.current && document.visibilityState === 'visible') {
          setTimeout(() => { void acquireWakeLock(); }, 1000);
        }
      });
    } catch {}
  }, []);
  const handleFollowVisibility = useCallback(() => {
    if (document.visibilityState === 'visible') void acquireWakeLock();
  }, [acquireWakeLock]);
  const ensureWakeLockTracking = useCallback(() => {
    if (!followVisListenerRef.current) {
      document.addEventListener('visibilitychange', handleFollowVisibility);
      followVisListenerRef.current = true;
    }
    void acquireWakeLock();
  }, [handleFollowVisibility, acquireWakeLock]);

  // --- Follow-the-imam mode ---
  const enterFollowMode = useCallback(() => {
    setFollowOn(true);
    // Follow mode gets its own fullscreen page at once (no intro, no
    // normal-view panel): the start button lives in the fullscreen
    // lobby below, which is also the gesture browsers honour for mic.
    setShowFullscreen(true);
    requestNativeFullscreen();
    followActiveRef.current = true;
    setFollowReady(true);
    setFollowStatus('listening');
    followStatusRef.current = 'listening';
    setFollowPos(null);
    followPosRef.current = null;
    setFollowHeard('');
    setFollowError(null);
    setFollowIndexLoading(false);
    setFollowChunkPhase('idle');
    setFollowChunkCount(0);
    setFollowChunkFails(0);
    followBufferRef.current = [];
    followMissRef.current = 0;
    setCleanMode(false);
    // Word-level highlighting needs the Madinah word boxes, so follow
    // mode always uses the Madinah edition (harmless if already selected).
    const madinahIdx = EDITIONS.findIndex((e) => e.id === 'madinah');
    if (madinahIdx >= 0) setSelectedEdition(madinahIdx);
  }, []);

  const stopFollow = useCallback(() => {
    followListeningRef.current = false;
    followActiveRef.current = false;
    if (followVisListenerRef.current) {
      document.removeEventListener('visibilitychange', handleFollowVisibility);
      followVisListenerRef.current = false;
    }
    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null;
    followStreamRef.current?.getTracks().forEach((t) => t.stop());
    followStreamRef.current = null;
    try { followWakeLockRef.current?.release(); } catch {}
    followWakeLockRef.current = null;
    setFollowOn(false);
    // Back to the START branch, not the listening branch: on the follow
    // route the lobby stays visible after a stop, and showing "listening"
    // with a dead engine left the user stuck with no way to start again
    // (that dead state was part of "listening doesn't work").
    setFollowReady(true);
    setFollowIndexLoading(false);
    setFollowChunkPhase('idle');
    setFollowChunkCount(0);
    setFollowChunkFails(0);
    setFollowPos(null);
    followPosRef.current = null;
    setFollowEngine(null);
    try { sessionStorage.removeItem(FOLLOW_STORAGE_KEY); } catch {}
  }, []);

  const jumpToTracked = useCallback(async (pos: TrackedPosition) => {
    try {
      const list = await loadSurahPageList(pos.surah);
      const entry = list.find((a) => a.number === pos.ayah);
      const page = entry ? entry.page_number : getSurahStartPage(pos.surah);
      goToPage(page);
      setSelectedVerse(null);
      setShowFullscreen(true);
      requestNativeFullscreen();
    } catch {
      setFollowError('تعذر تحديد صفحة الآية — تأكد من الاتصال بالإنترنت');
    }
    // goToPage / setters are stable enough here; loadSurahPageList is memoized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSurahPageList]);

  const onFollowFinal = useCallback((text: string) => {
    const words = heardWords(text);
    if (words.length === 0) return;
    const ordered = followOrderedRef.current;
    if (!ordered) return;
    const buffer = [...followBufferRef.current, ...words].slice(-80);
    followBufferRef.current = buffer;
    const pos = followPosRef.current;
    if (!pos || followStatusRef.current === 'lost') {
      const lock = findLock(buffer, ordered);
      if (lock) {
        followPosRef.current = lock;
        setFollowPos(lock);
        followStatusRef.current = 'locked';
        setFollowStatus('locked');
        followMissRef.current = 0;
        void jumpToTracked(lock);
      }
      return;
    }
    const adv = advanceTracking(pos, words, ordered);
    if (adv && (adv.surah !== pos.surah || adv.ayah !== pos.ayah || adv.word !== pos.word)) {
      followPosRef.current = adv;
      setFollowPos(adv);
      followMissRef.current = 0;
      void jumpToTracked(adv);
    } else {
      followMissRef.current += 1;
      if (followMissRef.current >= 4) {
        followStatusRef.current = 'lost';
        setFollowStatus('lost');
      }
    }
  }, [jumpToTracked]);

  // Engine callbacks are registered once at start; they always call the
  // latest onFollowFinal through this ref so they never go stale.
  const followFinalRef = useRef(onFollowFinal);
  useEffect(() => { followFinalRef.current = onFollowFinal; });

  const recordChunk = (ms: number): Promise<Blob> => new Promise((resolve, reject) => {
    const stream = followStreamRef.current;
    if (!stream) { reject(new Error('no stream')); return; }
    const mime = MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => resolve(new Blob(chunks, { type: mime || 'audio/webm' }));
    rec.onerror = () => reject(new Error('record failed'));
    rec.start();
    setTimeout(() => { try { rec.stop(); } catch {} }, ms);
  });

  // Whisper chunk loop only. The mic stream and the login check are done
  // by startFollowListening BEFORE the verse-index await (inside the tap
  // gesture) — see below — so by the time this runs, the stream exists
  // and the loop just records, uploads, transcribes, and reports its
  // phase, so the lobby never looks frozen while chunks are in flight.
  const runWhisperLoop = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid || !followStreamRef.current) return;
    let consecutiveFails = 0;
    while (followListeningRef.current) {
      let chunkPath = '';
      try {
        setFollowChunkCount((c) => c + 1);
        setFollowChunkPhase('recording');
        const blob = await recordChunk(8000);
        if (!followListeningRef.current) break;
        // The chunk file's extension matches its real bytes (iOS records
        // mp4, desktop webm) so stored chunks are honestly named.
        const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
        chunkPath = `follow/${uid}/${Date.now()}.${ext}`;
        setFollowChunkPhase('uploading');
        const { error: upErr } = await supabase.storage.from('rana-audio').upload(chunkPath, blob);
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('rana-audio').getPublicUrl(chunkPath);
        setFollowChunkPhase('transcribing');
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ audioUrl: urlData.publicUrl }),
        });
        if (!res.ok) throw new Error('transcribe failed');
        const data = await res.json();
        if (data.transcript) {
          setFollowHeard(data.transcript);
          followFinalRef.current(data.transcript);
        }
        consecutiveFails = 0;
        setFollowChunkFails(0);
        setFollowError(null);
      } catch {
        // One failed chunk must not kill the session — but after several
        // in a row, say so instead of looking frozen.
        consecutiveFails += 1;
        setFollowChunkFails(consecutiveFails);
        if (consecutiveFails >= 3) {
          setFollowError('تعذر الاستماع عبر الخادم — تأكد من الاتصال، أو اكتب الكلمات يدوياً بالأسفل');
        }
        await new Promise((r) => setTimeout(r, 1500));
      } finally {
        if (chunkPath) {
          try { await supabase.storage.from('rana-audio').remove([chunkPath]); } catch {}
        }
      }
    }
    setFollowChunkPhase('idle');
  }, [session]);

  // Two iOS-Safari failure modes lived here, both looking exactly like
  // "listening doesn't work":
  // (1) The old order awaited the verse index (7 sequential queries,
  // seconds on mobile) BEFORE requesting the mic — and iOS Safari
  // rejects getUserMedia requested outside the tap gesture with
  // NotAllowedError and NO permission prompt, so the user got a
  // misleading "allow the mic in browser settings" error for a
  // permission they never denied. Now the mic (Whisper path) and the
  // live recognizer (live path) start FIRST, inside the tap, and the
  // index loads after — onFollowFinal safely drops transcripts until
  // the index is ready.
  // (2) During the index load the lobby showed no change at all, so a
  // tap looked dead. Now followIndexLoading shows "loading the ayah
  // index…" in the lobby, and the listening branch shows the engine
  // (live vs Whisper), the chunk phase, and the failure count.
  const startFollowListening = useCallback(async () => {
    if (followListeningRef.current) return; // double-tap guard: one loop only
    setFollowError(null);
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      setFollowEngine('live');
      const rec = new SR();
      rec.lang = 'ar-SA';
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e: any) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i][0];
          if (r.isFinal) followFinalRef.current(r.transcript);
          else interim += r.transcript + ' ';
        }
        if (interim.trim()) setFollowHeard(interim.trim());
      };
      rec.onerror = (e: any) => {
        if (e.error === 'not-allowed') {
          setFollowError('اسمح بالميكروفون من إعدادات المتصفح ثم اضغط بدء الاستماع');
          followListeningRef.current = false;
          setFollowReady(true);
        } else if (e.error === 'network') {
          setFollowError('الاستماع المباشر يحتاج اتصالاً بالإنترنت');
        }
      };
      rec.onend = () => {
        if (followListeningRef.current) { try { rec.start(); } catch {} }
      };
      recognitionRef.current = rec;
      try {
        rec.start();
      } catch {
        setFollowError('تعذر بدء الاستماع — جرّب الإدخال اليدوي بالأسفل');
        setFollowReady(true);
        return;
      }
      followListeningRef.current = true;
      setFollowReady(false);
      setFollowStatus('listening');
      followStatusRef.current = 'listening';
      // Keep the screen on through a long Taraweeh (re-acquired if lost).
      ensureWakeLockTracking();
      setFollowIndexLoading(true);
      try {
        if (!followOrderedRef.current) {
          const verses = await loadVerseIndex();
          followOrderedRef.current = buildOrderedVerses(verses);
        }
      } catch {
        try { rec.stop(); } catch {}
        recognitionRef.current = null;
        followListeningRef.current = false;
        setFollowReady(true);
        setFollowError('تعذر تحميل فهرس الآيات — تأكد من الاتصال بالإنترنت');
      } finally {
        setFollowIndexLoading(false);
      }
      return;
    }
    // Whisper path (Safari): mic FIRST, inside the tap gesture.
    setFollowEngine('whisper');
    if (!window.MediaRecorder) {
      setFollowError('هذا المتصفح لا يدعم التسجيل — اكتب الكلمات يدوياً بالأسفل');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setFollowError('اسمح بالميكروفون من إعدادات المتصفح ثم اضغط بدء الاستماع');
      return;
    }
    followStreamRef.current = stream;
    const uid = session?.user?.id;
    if (!uid) {
      stream.getTracks().forEach((t) => t.stop());
      followStreamRef.current = null;
      setFollowError('الاستماع عبر الخادم يحتاج تسجيل دخول — أو اكتب الكلمات يدوياً بالأسفل');
      return;
    }
    followListeningRef.current = true;
    setFollowReady(false);
    setFollowStatus('listening');
    followStatusRef.current = 'listening';
    ensureWakeLockTracking();
    setFollowIndexLoading(true);
    try {
      if (!followOrderedRef.current) {
        const verses = await loadVerseIndex();
        followOrderedRef.current = buildOrderedVerses(verses);
      }
    } catch {
      followListeningRef.current = false;
      stream.getTracks().forEach((t) => t.stop());
      followStreamRef.current = null;
      setFollowReady(true);
      setFollowError('تعذر تحميل فهرس الآيات — تأكد من الاتصال بالإنترنت');
      setFollowIndexLoading(false);
      return;
    }
    setFollowIndexLoading(false);
    if (!followListeningRef.current) {
      // Stopped while the index was loading: never start the loop.
      stream.getTracks().forEach((t) => t.stop());
      followStreamRef.current = null;
      return;
    }
    void runWhisperLoop();
  }, [runWhisperLoop, ensureWakeLockTracking, session]);

  const manualFollowLock = useCallback(async () => {
    const words = heardWords(followManual);
    if (words.length < 2) {
      setFollowError('اكتب كلمات أكثر — كلمتين على الأقل');
      return;
    }
    setFollowIndexLoading(true);
    try {
      if (!followOrderedRef.current) {
        const verses = await loadVerseIndex();
        followOrderedRef.current = buildOrderedVerses(verses);
      }
    } catch {
      setFollowError('تعذر تحميل فهرس الآيات — تأكد من الاتصال بالإنترنت');
      setFollowIndexLoading(false);
      return;
    }
    setFollowIndexLoading(false);
    const lock = findLock(words, followOrderedRef.current, Math.min(4, words.length));
    if (!lock) {
      setFollowError('لم أجد آية مطابقة — جرّب كلمات أخرى سمعتها بوضوح');
      return;
    }
    followPosRef.current = lock;
    setFollowPos(lock);
    followStatusRef.current = 'locked';
    setFollowStatus('locked');
    followMissRef.current = 0;
    setFollowReady(false);
    // Even a manual lock follows a whole prayer, so the screen stays on.
    ensureWakeLockTracking();
    void jumpToTracked(lock);
  }, [followManual, jumpToTracked, ensureWakeLockTracking]);

  const resyncFollow = useCallback(() => {
    followPosRef.current = null;
    setFollowPos(null);
    followMissRef.current = 0;
    followStatusRef.current = 'listening';
    setFollowStatus('listening');
  }, []);

  // Dedicated follow route (#/follow): opening it starts follow mode
  // at once, and re-opens fullscreen if a live session is already
  // running (so returning mid-prayer never loses the lock and never
  // strands a live mic with no UI). No flag, no event, no stale state
  // from older sessions — the route itself is the entry point.
  useEffect(() => {
    if (!startInFollow) return;
    if (!followActiveRef.current) enterFollowMode();
    else setShowFullscreen(true);
    // Only when the route switches to follow; enterFollowMode is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startInFollow]);

  const openFullscreen = () => {
    setShowRatelIntro(true);
    setShowFullscreen(true);
    requestNativeFullscreen();
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

  // Word taps (Madinah edition only): per-page word boxes from qurancoor
  // (MIT), remapped from its tight text-block crop onto the app's framed
  // page image. PARITY-AWARE calibration: the old single mapping (A=11)
  // was the average of the two parities, so boxes sat ~5% off on every
  // page — tolerable for ayah-level taps, visibly wrong for word-level
  // highlights. Frame-masked ink fit on real scans (pages 42/43) gives
  // odd text [6,83], even [17,94] (same 77 width, gutter-shifted),
  // top 14, height 74. Raw h.x >= 880 boxes are the dataset's spurious
  // border boxes (no word under them) and are dropped, so taps on the
  // border open nothing.
  type WordBox = { key: string; surah: number; ayah: number; left: number; top: number; width: number; height: number };
  const [pageWordBoxes, setPageWordBoxes] = useState<WordBox[] | null>(null);
  const wordBoxCache = useRef<Record<number, WordBox[]>>({});
  const pageWrapRef = useRef<HTMLDivElement | null>(null);
  const [tapFlash, setTapFlash] = useState<WordBox | null>(null);
  const tapFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (edition.id !== 'madinah') { setPageWordBoxes(null); return; }
    const cached = wordBoxCache.current[currentPage];
    if (cached) { setPageWordBoxes(cached); return; }
    let cancelled = false;
    const file = String(currentPage).padStart(3, '0');
    // raw.githubusercontent FIRST: jsdelivr cannot serve this repo at
    // all — it refuses packages over 50 MB ("Package size exceeded the
    // configured limit of 50 MB"), so jsdelivr stays only as a fallback
    // in case the repo ever shrinks below that limit. Same file either way.
    const urls = [
      `https://raw.githubusercontent.com/bodoorzahera/Quran-coordinate/master/src/qurancoor/data/page-${file}.json`,
      `https://cdn.jsdelivr.net/gh/bodoorzahera/Quran-coordinate@master/src/qurancoor/data/page-${file}.json`,
    ];
    const loadCoords = async (i: number): Promise<any | null> => {
      if (i >= urls.length) return null;
      try { const r = await fetch(urls[i]); if (r.ok) return await r.json(); } catch {}
      return loadCoords(i + 1);
    };
    loadCoords(0)
      .then((j) => {
        if (cancelled) return;
        if (!j || !j.coords) { setPageWordBoxes(null); return; }
        const boxes: WordBox[] = [];
        // Parity-aware calibration (see the note above the loader):
        // odd pages text [6,83], even [17,94]; raw h.x >= 880 is the
        // dataset's spurious border box, dropped for both parities.
        const calA = currentPage % 2 === 1 ? 6 : 17;
        for (const [key, v] of Object.entries<any>(j.coords)) {
          const h = v?.h;
          if (!h) continue;
          if (h.x >= 880) continue;
          const parts = key.split(':').map(Number);
          if (parts.length < 2 || !parts[0] || !parts[1]) continue;
          const left = calA + ((h.x - 40) / 840) * 77;
          boxes.push({
            key,
            surah: parts[0],
            ayah: parts[1],
            left,
            top: 14 + ((h.y - 25) / 1380) * 74,
            width: (h.w / 840) * 77,
            height: (h.h / 1380) * 74,
          });
        }
        wordBoxCache.current[currentPage] = boxes;
        setPageWordBoxes(boxes);
      })
      .catch(() => { if (!cancelled) setPageWordBoxes(null); });
    return () => { cancelled = true; };
  }, [currentPage, edition.id]);

  // Madinah paper-box normalization — the page-turn dance fix. The
  // sufone scans frame the paper differently per page (two widths,
  // ~80% vs ~91%, and two horizontal positions: odd pages sit at left
  // 5%, even pages at 3.7% or 15.3%), so consecutive pages jumped up
  // to ~10% of the image width on turns. Mapping each page's measured
  // paper box onto the fixed wrapper pins every paper's left/right
  // edges to identical container coordinates: the paper always fills
  // the wrapper width exactly. Vertically the paper is TOP-pinned
  // (not centered): centering let the first line drift ~1.3% of the
  // wrapper height between pages whose paper heights differ, while
  // top-pinning holds the first line steady — any band sits below
  // the paper, and a taller-than-wrapper paper only loses its bottom
  // margin, never text. Pure % math (no DOM measurement). Taps and
  // the tap flash go through the same mapping, so word taps stay
  // calibrated on the normalized image. Other editions are untouched
  // (their scans never danced).
  // Fit + center normalization (dance fix 2026-10-26). The wrapper
  // aspect equals the image aspect (0.7070), so one uniform scale
  // fits the box in both dims: s = min(1/pw, 1/ph). The box is
  // centered horizontally (its center lands at 50% of the wrapper
  // on every page) and its top is pinned at the wrapper top. The
  // old width-fill + left-pin version made the alternating gutter
  // (odd frames left, even frames right) show up as a ~10% sideways
  // jump of the text on every page turn.
  const normForPaperBox = (box: number[] | undefined) => {
    if (!box) return null;
    const [pl, pt, pr, pb] = box;
    const pw = (pr - pl) / 100;
    const ph = (pb - pt) / 100;
    if (pw <= 0 || ph <= 0) return null;
    const s = Math.min(1 / pw, 1 / ph);
    const imgW = s * 100; // % of wrapper width
    const imgH = s * 100; // % of wrapper height
    const imgL = 50 - ((pl + pr) / 2) * s; // % of wrapper width
    const imgT = -pt * s; // % of wrapper height
    return { pl, pt, pr, pw, ph, imgW, imgH, imgL, imgT };
  };
  const madinahPaperBox = edition.id === 'madinah' ? MADINAH_PAPER_BOXES[currentPage - 1] : undefined;
  const madinahNorm = normForPaperBox(madinahPaperBox);
  // Same normalization for the FACING page (the peek sliver): the old
  // sliver rendered the facing image unnormalized at 115vh, so its
  // paper jumped against the pinned main page on every turn. The
  // sliver below pins the facing page's SPINE edge (its paper edge,
  // not the raw image edge) at the window's edge, at the main page's
  // scale and vertical alignment, so the peek stays stable too.
  const facingNorm = edition.id === 'madinah' && hasFacingPage
    ? normForPaperBox(MADINAH_PAPER_BOXES[facingPage - 1])
    : null;
  // Container % -> full-image % (identity when not normalized).
  // Displayed position of image point X is imgL + X * imgW / 100,
  // so the inverse is X = (displayed - imgL) * 100 / imgW.
  const containerToImagePercent = (fx: number, fy: number): [number, number] => {
    if (!madinahNorm) return [fx, fy];
    return [(fx - madinahNorm.imgL) * 100 / madinahNorm.imgW, (fy - madinahNorm.imgT) * 100 / madinahNorm.imgH];
  };
  // Full-image % word box -> container % rect (for the tap flash).
  const imageBoxToContainer = (b: WordBox) => {
    if (!madinahNorm) return b;
    return {
      ...b,
      left: madinahNorm.imgL + (b.left * madinahNorm.imgW) / 100,
      top: madinahNorm.imgT + (b.top * madinahNorm.imgH) / 100,
      width: (b.width * madinahNorm.imgW) / 100,
      height: (b.height * madinahNorm.imgH) / 100,
    };
  };

  const handleWordTap = async (clientX: number, clientY: number) => {
    const wrap = pageWrapRef.current;
    const boxes = pageWordBoxes;
    if (!wrap || !boxes) return;
    const rect = wrap.getBoundingClientRect();
    const [px, py] = containerToImagePercent(
      ((clientX - rect.left) / rect.width) * 100,
      ((clientY - rect.top) / rect.height) * 100,
    );
    // Smallest containing box wins, not the first: the source data has
    // a few word boxes that overlap their neighbour (e.g. page 371
    // words 26:109:5/6, page 500 words 45:17:14/15, where the later
    // word's box sits almost entirely inside the earlier word's) —
    // first-match picked the neighbour, smallest-area picks the word
    // actually tapped. Non-overlapping taps are unaffected (only one
    // box contains the point).
    let box: WordBox | null = null;
    for (const b of boxes) {
      if (px >= b.left && px <= b.left + b.width && py >= b.top && py <= b.top + b.height) {
        if (!box || b.width * b.height < box.width * box.height) box = b;
      }
    }
    // Forgiving fallback: a tap in a small gap between words still opens
    // the nearest word — but only inside the text block, so border taps
    // still open nothing. Vertical distance counts double: a wrong line
    // is a wrong ayah, a wrong word on the same line usually is not.
    if (!box && px >= 8 && px <= 92 && py >= 10 && py <= 90) {
      let best: WordBox | null = null;
      let bestD = Infinity;
      for (const b of boxes) {
        const d = Math.hypot(px - (b.left + b.width / 2), (py - (b.top + b.height / 2)) * 2);
        if (d < bestD) { bestD = d; best = b; }
      }
      if (best && bestD < 4) box = best;
    }
    if (!box) return;
    setTapFlash(box);
    if (tapFlashTimer.current) clearTimeout(tapFlashTimer.current);
    tapFlashTimer.current = setTimeout(() => setTapFlash(null), 700);
    const pool = [...stripVerses, ...surahVerses, ...spannedVerses];
    let row = pool.find((v) => v.surah_no === box.surah && v.ayah_no === box.ayah);
    if (!row) {
      const { data } = await supabase.from('quran_verses').select('*').eq('surah_no', box.surah).eq('ayah_no', box.ayah).limit(1);
      row = data?.[0] ?? undefined;
    }
    if (row) handleVerseClick(row);
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
        {/* A personal word before reading — a daily dua for the reader.
            Prefixed with the intention reminder: whoever opens the
            Mushaf is here to memorize or link memorization. Same quiet
            line, no new chrome. */}
        <p className="flex items-center justify-center gap-1.5 text-center text-sm text-amber-700/90 font-semibold mb-4">
          <Heart className="w-4 h-4" /> استحضر النية · {dailyDua()}
        </p>

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
              <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} title="تصغير الصفحة" aria-label="تصغير الصفحة"
                className="p-2 text-accent-600 hover:bg-gray-100 rounded-lg transition-smooth"><ZoomOut className="w-5 h-5" /></button>
              <span className="text-sm text-accent-500 w-14 text-center font-semibold">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))} title="تكبير الصفحة" aria-label="تكبير الصفحة"
                className="p-2 text-accent-600 hover:bg-gray-100 rounded-lg transition-smooth"><ZoomIn className="w-5 h-5" /></button>
              <button onClick={openFullscreen} title="ملء الشاشة" aria-label="ملء الشاشة"
                className="p-2 text-accent-600 hover:bg-amber-100 rounded-lg transition-smooth"><Maximize2 className="w-5 h-5" /></button>
              <button onClick={toggleGoldFrame} title="إطار ذهبي حول الصفحة"
                className={`px-2.5 py-2 text-sm font-bold rounded-lg transition-smooth ${goldFrame ? 'bg-amber-200 text-amber-800 ring-1 ring-amber-400' : 'text-accent-600 hover:bg-amber-100'}`}>
                إطار ذهبي
              </button>
              {!showFullscreen && <WorshipTimer />}
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
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  onLoad={() => setImageLoading(false)}
                  onError={() => { setImageError(true); setImageLoading(false); }}
                  className="max-w-full h-auto rounded-lg shadow-md transition-transform duration-300 origin-top [-webkit-touch-callout:none]"
                  style={{ transform: `scale(${zoom})` }} loading="eager" />
              )}
              {goldFrame && (
                <div className="absolute inset-0 pointer-events-none z-10 shadow-[inset_0_0_0_3px_#b48214,inset_0_0_0_8px_#f0c85a] rounded-2xl" />
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
                                          <Volume2 className="w-4 h-4" /> المقطع الأصلي
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

      {/* Bottom nav: الرئيسية first (rightmost in RTL). */}
      <BottomNav current={startInFollow ? 'follow' : 'mushaf'} onNavigate={onNavigate} />

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
          onClick={() => {
            // In clean mode, taps on the black bands restore controls.
            if (cleanMode) { setCleanMode(false); return; }
            // While following the imam, a band tap must not drop the
            // fullscreen view (the phone is held through a long prayer);
            // the X button and the follow bar's stop button still exit.
            if (!showRatelIntro && !showEditionPickerInFullscreen && !selectedVerse && !followOn) exitFullscreenView();
          }}>

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
                <h2 className="text-4xl sm:text-5xl font-bold text-white mb-3 leading-relaxed text-center max-w-3xl px-6" style={{ fontFamily: '"Noto Naskh Arabic", "Amiri", serif' }}>
                  اقرأ وارتق، ورتل
                </h2>
                <p className="text-xl sm:text-2xl text-white/90 leading-relaxed text-center max-w-3xl px-6" style={{ fontFamily: '"Noto Naskh Arabic", "Amiri", serif' }}>
                  كما كنت ترتل في الدنيا، فإن منزلتك عند آخر آية تقرؤها
                </p>

              </div>
            </div>
          )}

          {/* Follow lobby: follow mode's own fullscreen page. The start
              button and manual input live here now (not on the normal
              Mushaf page). Hides once the imam locks onto an ayah. On
              the dedicated follow route it also shows after a stop, so
              the user can always start again from here. */}
          {(followOn || startInFollow) && !followPos && !showRatelIntro && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6" onClick={(e) => e.stopPropagation()}>
              <div className="w-full max-w-md bg-emerald-900 rounded-2xl p-5 shadow-2xl text-white">
                <p className="font-bold flex items-center gap-2 text-lg"><Mic className="w-6 h-6 text-amber-300" /> الحق الإمام</p>
                <p className="text-sm text-emerald-100 leading-relaxed mt-2">
                  اضغط بدء الاستماع، وقرّب الجوال منك، وأول ما يلاقي الإمام الآية هيفتح المصحف ويظللها بتظليل واضح يمشي مع صوته.
                </p>
                {followReady ? (
                  <>
                    {/* The start button also (re-)enters follow mode:
                        after a stop, followOn is false, and the engine
                        alone would track without showing any highlight
                        or status bar. Entering first is harmless on a
                        fresh entry (it only resets an empty state). */}
                    <button onClick={() => { enterFollowMode(); startFollowListening(); }}
                      disabled={followIndexLoading}
                      className="mt-4 w-full py-3.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white text-base font-bold rounded-xl transition-smooth flex items-center justify-center gap-2">
                      <Mic className="w-5 h-5" /> ابدأ الاستماع للإمام
                    </button>
                    {followIndexLoading && <p className="text-xs text-amber-200 mt-2">جارٍ تحميل فهرس الآيات…</p>}
                    <div className="flex gap-2 mt-3">
                      <input value={followManual} onChange={(e) => setFollowManual(e.target.value)}
                        placeholder="أو اكتب كلمات سمعتها من الإمام..."
                        className="flex-1 px-3 py-2.5 rounded-xl text-sm text-accent-800 bg-white/95 border border-emerald-200 focus:outline-none" />
                      <button onClick={() => { enterFollowMode(); manualFollowLock(); }}
                        disabled={followIndexLoading}
                        className="px-4 py-2.5 bg-white disabled:opacity-60 text-emerald-800 text-sm font-bold rounded-xl">ابحث</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold mt-4">
                      {followStatus === 'lost' ? 'فقدت الإمام مؤقتاً — بستنى كلمات أوضح لإعادة القفل...' : 'جارٍ الاستماع للإمام...'}
                    </p>
                    {followIndexLoading && <p className="text-xs text-amber-200 mt-2">جارٍ تحميل فهرس الآيات…</p>}
                    {followEngine === 'live' && <p className="text-xs text-emerald-200 mt-2">المحرك: مباشر من المتصفح</p>}
                    {followEngine === 'whisper' && (
                      <p className="text-xs text-emerald-200 mt-2">
                        المحرك: عبر الخادم (Whisper) — تأخير ~١٠ ثوانٍ
                        {followChunkPhase !== 'idle' && ` • ${followChunkPhase === 'recording' ? 'بتسجّل المقطع…' : followChunkPhase === 'uploading' ? 'برفع المقطع…' : 'بفرّغ الصوت…'} (المقطع ${followChunkCount})`}
                        {followChunkFails > 0 && ` • فشل ${followChunkFails}/٣`}
                      </p>
                    )}
                    {followHeard && <p className="text-xs text-emerald-200 mt-1 truncate">سمعت: {followHeard}</p>}
                    <div className="flex gap-2 mt-4">
                      <button onClick={resyncFollow}
                        className="flex-1 py-2.5 bg-white/10 hover:bg-white/20 text-sm font-bold rounded-xl transition-smooth flex items-center justify-center gap-1.5">
                        <RefreshCw className="w-4 h-4" /> إعادة المزامنة
                      </button>
                      <button onClick={stopFollow}
                        className="flex-1 py-2.5 bg-white/10 hover:bg-white/20 text-sm font-bold rounded-xl transition-smooth flex items-center justify-center gap-1.5">
                        <Square className="w-4 h-4" /> إيقاف
                      </button>
                    </div>
                  </>
                )}
                {followError && <p className="text-xs text-red-300 mt-2">{followError}</p>}
              </div>
            </div>
          )}

          {!showRatelIntro && !cleanMode && (
            <button onClick={(e) => { e.stopPropagation(); if (startInFollow) { stopFollow(); onNavigate('app'); } else { exitFullscreenView(); } }}
              title="إغلاق"
              className="absolute top-4 right-4 p-2.5 bg-black/60 hover:bg-black/75 text-white rounded-lg z-30 transition-smooth ring-1 ring-white/40 shadow-lg">
              <X className="w-7 h-7" />
            </button>
          )}

          {/* Worship timer, top-center: always visible (even in clean
              mode — it is a reminder, not a control), never blocking
              taps. Hidden only during the intro splash. */}
          {!showRatelIntro && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
              <WorshipTimer dark />
            </div>
          )}

          {/* Clean reading: hide every control, keep only the page. */}
          {!showRatelIntro && !showEditionPickerInFullscreen && !cleanMode && (
            <button onClick={(e) => { e.stopPropagation(); setShowEditionPickerInFullscreen(false); setCleanMode(true); requestNativeFullscreen(); }}
              title="قراءة نظيفة — إخفاء كل الأدوات"
              className="absolute top-4 right-20 p-2.5 bg-black/60 hover:bg-black/75 text-white rounded-lg z-30 transition-smooth ring-1 ring-white/40 shadow-lg">
              <Maximize2 className="w-7 h-7" />
            </button>
          )}

          {cleanMode && showCleanHint && !selectedVerse && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-black/70 text-white text-sm font-semibold rounded-full pointer-events-none whitespace-nowrap">
              اضغط على هامش الصفحة لإظهار الأدوات
            </div>
          )}

          {!showRatelIntro && !cleanMode && (
            <button onClick={(e) => { e.stopPropagation(); setShowEditionPickerInFullscreen(true); }}
              className="absolute top-4 left-4 flex items-center gap-2 px-4 py-2.5 bg-black/60 hover:bg-black/75 text-white rounded-lg z-30 transition-smooth text-sm font-semibold ring-1 ring-white/40 shadow-lg">
              <Layers className="w-5 h-5" /> {edition.name}
            </button>
          )}

          {!showRatelIntro && !cleanMode && (
            <button onClick={(e) => { e.stopPropagation(); toggleGoldFrame(); }}
              className={`absolute top-[68px] left-4 flex items-center gap-2 px-4 py-2.5 rounded-lg z-30 transition-smooth text-sm font-semibold ring-1 shadow-lg ${goldFrame ? 'bg-amber-500/90 text-white ring-amber-300' : 'bg-black/60 hover:bg-black/75 text-white ring-white/40'}`}>
              إطار ذهبي
            </button>
          )}

          {/* Juz / Hizb info in fullscreen */}
          {!showRatelIntro && !cleanMode && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3 z-30 pointer-events-none">
              <span className="px-3 py-1.5 bg-black/60 backdrop-blur text-white text-xs font-semibold rounded-lg ring-1 ring-white/30 shadow">{currentJuz.name}</span>
              <span className="px-3 py-1.5 bg-black/60 backdrop-blur text-white text-xs font-semibold rounded-lg ring-1 ring-white/30 shadow">الحزب {currentHizb.number}</span>
              <span className="px-3 py-1.5 bg-black/60 backdrop-blur text-white text-xs font-semibold rounded-lg ring-1 ring-white/30 shadow">سورة {currentSurahName}</span>
            </div>
          )}

          {!showRatelIntro && !showEditionPickerInFullscreen && (
            <>
              {!imageError ? (
                // Wrapper owns size, zoom and touch. Fullscreen fill +
                // no-dance: vh (the large viewport, stable when Safari's
                // chrome shows/hides) so the page fills the whole layout
                // viewport — svh left bands whose size changed with the
                // chrome state. The Madinah zoom is a LAYOUT size (115vh
                // tall, cropped by the container), NOT a transform
                // scale: a scaled layer re-rasterizes in Safari on every
                // image swap, which read as dancing on page turns.
                // Madinah paper-box normalization (see madinahNorm):
                // fit + center — the image is scaled so its paper box
                // fits the wrapper and centered on the box, so the
                // frame lands on the same screen rect on every page
                // despite the alternating gutter (odd frames left,
                // even frames right). Other editions keep exact fit
                // + adaptive aspect.
                // CRITICAL for tap precision: the wrapper aspect must
                // actually HOLD on every screen. A definite height
                // (h-[115vh]) plus max-w-[100vw] breaks it on narrow
                // screens — the cap shrinks the width while the height
                // stays, so the rendered aspect is no longer the style
                // aspect, object-contain letterboxes the image inside
                // its box, and every tap maps up to ~3 image-% points
                // off vertically (measured: 60% of taps correct, 14%
                // wrong ayah, 26% missed on iPad portrait). So the
                // Madinah size is width-driven via min(): width =
                // min(100vw, 100svh x aspect), height derived from the
                // aspect — the aspect holds on all screens, contain
                // becomes a no-op, and the tap math is exact. The
                // factor is 100, not 115: at 115 the page stood taller
                // than the viewport on squarer windows, so its top and
                // bottom ornaments were clipped and the page sat
                // off-center (measured on real screenshots); at 100
                // the whole page always fits inside the screen, and
                // on tall portrait screens 100vw still binds, so the
                // page stays maximal there.
                <div ref={pageWrapRef}
                  className={`relative ${edition.id === 'madinah' ? '' : 'h-screen'} w-auto max-w-[100vw] ${madinahNorm ? 'overflow-hidden' : ''}`}
                  style={edition.id === 'madinah'
                    ? { aspectRatio: String(MADINAH_NORMALIZED_ASPECT), width: `min(100vw, ${100 * MADINAH_NORMALIZED_ASPECT}svh)` }
                    : { aspectRatio: String(imgAspect) }}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Word tap (click, not touchend — see touchend note).
                    // Clicks right after a swipe are ignored via lastSwipeAt.
                    if (showRatelIntro || showEditionPickerInFullscreen || selectedVerse) return;
                    if (cleanMode) {
                      // Margin/frame taps restore the controls; word taps
                      // still open the ayah popup. Margins are judged in
                      // full-image %, through the normalization mapping.
                      const rect = e.currentTarget.getBoundingClientRect();
                      const [px, py] = containerToImagePercent(
                        ((e.clientX - rect.left) / rect.width) * 100,
                        ((e.clientY - rect.top) / rect.height) * 100,
                      );
                      // Margins are judged against the parity-aware
                      // text block (odd [6,83], even [17,94], y [14,88]).
                      const tbL = currentPage % 2 === 1 ? 6 : 17;
                      if (px < tbL || px > tbL + 77 || py < 14 || py > 88) { setCleanMode(false); return; }
                    }
                    if (Date.now() - lastSwipeAt.current < 500) return;
                    void handleWordTap(e.clientX, e.clientY);
                  }}
                  onTouchStart={handlePageTouchStart}
                  onTouchEnd={handlePageTouchEnd}>
                  {/* key: remount on page change (like the normal view) so the
                      previous page's image is never shown for a frame at the
                      new page's position while the new image loads — that
                      one-frame jump read as a slight shake on every turn. */}
                  <img key={`${edition.id}-${currentPage}`} src={edition.imageUrl(currentPage)} alt={`صفحة ${currentPage}`}
                    className={`${madinahNorm ? 'absolute touch-none' : 'h-full w-full'} object-contain [-webkit-touch-callout:none]`}
                    style={madinahNorm ? { left: `${madinahNorm.imgL}%`, top: `${madinahNorm.imgT}%`, width: `${madinahNorm.imgW}%`, height: `${madinahNorm.imgH}%` } : undefined}
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                    onLoad={(e) => {
                      const im = e.currentTarget;
                      if (im.naturalWidth > 0 && im.naturalHeight > 0) setImgAspect(im.naturalWidth / im.naturalHeight);
                    }}
                    // Without this, a failed fullscreen image was a
                    // silent blank page: imageError drives the error
                    // block with its retry button, in both views.
                    onError={() => setImageError(true)} />
                  {goldFrame && (
                    <div className="absolute inset-0 z-10 pointer-events-none shadow-[inset_0_0_0_3px_#b48214,inset_0_0_0_8px_#f0c85a]" />
                  )}
                  {tapFlash && (() => {
                    const f = imageBoxToContainer(tapFlash);
                    return (
                      <div className="absolute rounded-md ring-2 ring-amber-300 bg-amber-300/20 pointer-events-none"
                        style={{ left: `${f.left}%`, top: `${f.top}%`, width: `${f.width}%`, height: `${f.height}%` }} />
                    );
                  })()}
                  {/* Follow-the-imam highlight: the whole tracked ayah is
                      marked amber, the word being recited right now is
                      strongest with a ring, words already recited are a
                      solid amber, words ahead are faint — so the eye
                      follows the imam at a glance, even on a phone. */}
                  {followOn && followPos && pageWordBoxes && (() => {
                    const boxes = pageWordBoxes
                      .filter((b) => b.surah === followPos.surah && b.ayah === followPos.ayah)
                      .map((b) => ({ ...b, wordNo: Number(b.key.split(':')[2]) || 0 }))
                      .sort((a, b) => a.wordNo - b.wordNo);
                    if (boxes.length === 0) return null;
                    return (<>
                      {boxes.map((b) => {
                        const f = imageBoxToContainer(b);
                        const isCurrent = b.wordNo - 1 === followPos.word;
                        const isPassed = b.wordNo - 1 < followPos.word;
                        return (
                          <div key={b.key} className={`absolute rounded-sm pointer-events-none ${isCurrent ? 'bg-amber-400/70 ring-2 ring-amber-500' : isPassed ? 'bg-amber-400/40' : 'bg-amber-300/25'}`}
                            style={{ left: `${f.left}%`, top: `${f.top}%`, width: `${f.width}%`, height: `${f.height}%` }} />
                        );
                      })}
                    </>);
                  })()}
                  {/* Search-jump highlight: the ayah tapped in لوحتي,
                      marked amber exactly on its words until the page
                      turns or fullscreen exits. */}
                  {!followOn && searchHighlight && pageWordBoxes && (() => {
                    const boxes = pageWordBoxes.filter((b) => b.surah === searchHighlight.surah && b.ayah === searchHighlight.ayah);
                    if (boxes.length === 0) return null;
                    return (<>
                      {boxes.map((b) => {
                        const f = imageBoxToContainer(b);
                        return (
                          <div key={b.key} className="absolute rounded-sm pointer-events-none bg-amber-400/50 ring-1 ring-amber-400"
                            style={{ left: `${f.left}%`, top: `${f.top}%`, width: `${f.width}%`, height: `${f.height}%` }} />
                        );
                      })}
                    </>);
                  })()}
                </div>
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

              {/* In clean mode the strips and verse strip below are hidden;
                  the page wrapper and the ayah popup stay visible. */}
              {!cleanMode && (<>
              {/* Page-turn zones: full-height side strips with a large,
                  always-visible arrow + label, so the target is easy to
                  find and to press anywhere along the edge. The left
                  zone also carries a framed slice of the facing page
                  (its spine-side edge, full opacity, spine shadow),
                  pinned to the left on every page so the composition
                  never jumps between turns — while the main page
                  itself stays fixed. */}
              <button onClick={(e) => { e.stopPropagation(); goToPage(currentPage - 1); }} disabled={currentPage <= 1}
                aria-label="الصفحة السابقة"
                className="absolute top-0 bottom-0 right-0 w-24 z-20 flex flex-col items-center justify-center gap-1 bg-gradient-to-l from-black/40 to-transparent disabled:opacity-20 group">
                <div className="relative z-10 flex flex-col items-center gap-1">
                  <div className="p-4 bg-black/60 group-hover:bg-black/75 text-white rounded-full shadow-xl ring-1 ring-white/50 transition-smooth group-disabled:opacity-20">
                    <ChevronRight className="w-10 h-10" />
                  </div>
                  <span className="text-xs font-bold text-white bg-black/60 px-2.5 py-1 rounded-full ring-1 ring-white/30 shadow">السابق</span>
                </div>
              </button>
              <button onClick={(e) => { e.stopPropagation(); goToPage(currentPage + 1); }} disabled={currentPage >= TOTAL_PAGES}
                aria-label="الصفحة التالية"
                className="absolute top-0 bottom-0 left-0 w-24 z-20 flex flex-col items-center justify-center gap-1 bg-gradient-to-r from-black/40 to-transparent disabled:opacity-20 group">
                {hasFacingPage && (
                  <div className="absolute top-1/2 -translate-y-1/2 right-0 overflow-hidden pointer-events-none border-r border-black/30 shadow-[0_0_24px_rgba(0,0,0,0.45)]" style={{ width: FACING_STRIP_W, height: facingNorm ? `calc(min(100vw, ${100 * MADINAH_NORMALIZED_ASPECT}svh) / ${MADINAH_NORMALIZED_ASPECT})` : '100%' }} title="الصفحة المقابلة">
                    <FacingStripImg key={`facing-${facingPage}`} src={edition.imageUrl(facingPage)} pageNo={facingPage}
                      // Madinah: a window into the facing page at the
                      // main page's scale and vertical alignment. The
                      // window is pinned to the LEFT on every page (the
                      // old alternating side read as a shake), and the
                      // image inside pins the facing page's SPINE edge
                      // to the window edge the interior extends from:
                      // its right edge at the window's right edge for
                      // odd current pages (interior lies left of the
                      // spine), its left edge at the window's LEFT edge
                      // for even current pages (interior lies right of
                      // the spine). Pinning the left edge to the right
                      // edge instead put the whole cream interior
                      // outside the window on even pages — the visible
                      // sliver showed only black scan margin + a
                      // hairline of frame, which is why the strip
                      // "disappeared" on every even page even though
                      // the image had loaded fine (so no retry or
                      // placeholder ever triggered).
                      // Other editions keep the old centered sliver.
                      className={`absolute ${facingNorm ? '' : 'top-1/2 -translate-y-1/2 right-0'} ${!facingNorm ? (edition.id === 'madinah' ? 'h-[115vh]' : 'h-screen') : ''} w-auto max-w-none opacity-100 [-webkit-touch-callout:none]`}
                      style={facingNorm ? {
                        width: `calc(${(facingNorm.imgW / 100).toFixed(4)} * min(100vw, ${100 * MADINAH_NORMALIZED_ASPECT}svh))`,
                        height: `calc(${(facingNorm.imgH / 100).toFixed(4)} * min(100vw, ${100 * MADINAH_NORMALIZED_ASPECT}svh) / ${MADINAH_NORMALIZED_ASPECT})`,
                        left: facingOnLeft
                          ? `calc(${FACING_STRIP_W} - ${((facingNorm.pr) / 100).toFixed(4)} * ${(facingNorm.imgW / 100).toFixed(4)} * min(100vw, ${100 * MADINAH_NORMALIZED_ASPECT}svh))`
                          : `calc(0px - ${((facingNorm.pl) / 100).toFixed(4)} * ${(facingNorm.imgW / 100).toFixed(4)} * min(100vw, ${100 * MADINAH_NORMALIZED_ASPECT}svh))`,
                        top: `calc(0px - ${(facingNorm.pt / 100).toFixed(4)} * min(100vw, ${100 * MADINAH_NORMALIZED_ASPECT}svh) / ${MADINAH_NORMALIZED_ASPECT})`,
                      } : undefined} />
                    <div className="absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-black/30 to-transparent pointer-events-none" />
                  </div>
                )}
                <div className="relative z-10 flex flex-col items-center gap-1">
                  <div className="p-4 bg-black/60 group-hover:bg-black/75 text-white rounded-full shadow-xl ring-1 ring-white/50 transition-smooth group-disabled:opacity-20">
                    <ChevronLeft className="w-10 h-10" />
                  </div>
                  <span className="text-xs font-bold text-white bg-black/60 px-2.5 py-1 rounded-full ring-1 ring-white/30 shadow">التالي</span>
                </div>
              </button>

              {/* Verse selector — only the ayahs printed on this page */}
              <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center pb-[calc(1rem_+_env(safe-area-inset-bottom))] pointer-events-auto px-4"
                onClick={(e) => e.stopPropagation()}>
                {followOn && (
                  <div className="mb-2 flex items-center gap-2 bg-amber-500 text-white pl-2 pr-4 py-2 rounded-full shadow-xl font-bold text-sm max-w-[95vw]">
                    <Mic className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">
                      {followStatus === 'locked' && followPos
                        ? `الإمام الآن: سورة ${SURAHS.find((s) => s.no === followPos.surah)?.name || ''} — آية ${followPos.ayah}`
                        : followStatus === 'lost' ? 'فقدت الإمام مؤقتاً…' : 'جارٍ الاستماع للإمام…'}
                    </span>
                    <button onClick={resyncFollow} title="إعادة المزامنة"
                      className="p-1.5 bg-white/20 hover:bg-white/30 rounded-full flex-shrink-0"><RefreshCw className="w-4 h-4" /></button>
                    <button onClick={stopFollow} title="إيقاف المتابعة"
                      className="p-1.5 bg-white/20 hover:bg-white/30 rounded-full flex-shrink-0"><Square className="w-4 h-4" /></button>
                  </div>
                )}
                <p className="text-white/90 text-xs font-semibold mb-1.5 bg-black/60 px-3 py-1 rounded-full">آيات هذه الصفحة — اضغط رقم الآية لفتح المتشابهات والروابط والإعراب والتفسير</p>
                <div className="bg-black/85 backdrop-blur rounded-xl p-2.5 max-w-[95vw] overflow-x-auto">
                  <div className="flex gap-2">
                    {stripVerses.map((v) => (
                      <button key={v.id} onClick={() => handleVerseClick(v)}
                        className={`flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold transition-smooth flex-shrink-0 ${
                          followPos && followPos.surah === v.surah_no && followPos.ayah === v.ayah_no ? 'bg-amber-500 text-white ring-2 ring-amber-300' :
                          selectedVerse?.id === v.id ? 'bg-emerald-600 text-white' :
                          v.has_links ? 'bg-emerald-500/30 text-emerald-300 hover:bg-emerald-500/50' : 'bg-white/20 text-white hover:bg-white/30'
                        }`}>
                        {v.ayah_no}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              </>)}

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
                    <div className="p-4 overflow-y-auto min-h-0 flex-1">
                      <p className="font-arabic text-xl text-accent-800 leading-loose mb-3 text-center">{selectedVerse.ayah_text}</p>
                      {/* الروابط first and above everything: the app is
                          about the links, so it gets its own full-width
                          green button on top, not just a tab. Tapping it
                          always shows the links; the ring marks it active. */}
                      <button onClick={() => setPopupTab('links')}
                        className={`w-full mb-3 py-3 rounded-xl text-base font-bold transition-smooth flex items-center justify-center gap-2 ${popupTab === 'links' ? 'bg-emerald-600 text-white ring-2 ring-emerald-300' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                        <Link className="w-5 h-5" />
                        الروابط
                      </button>
                      <div className="flex gap-2 mb-4">
                        <button onClick={() => setPopupTab('mutashabihat')}
                          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-smooth ${popupTab === 'mutashabihat' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-accent-600 hover:bg-gray-200'}`}>
                          المتشابهات
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
                      {popupTab === 'mutashabihat' && (mutashabihatLoading ? (
                        <div className="flex items-center justify-center py-6">
                          <div className="w-7 h-7 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
                        </div>
                      ) : mutashabihatError ? (
                        <div className="text-center py-6 bg-gray-50 rounded-lg">
                          <p className="text-base text-accent-500 mb-3">{mutashabihatError}</p>
                          <button onClick={() => selectedVerse && findSimilar(selectedVerse)}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg">
                            إعادة المحاولة
                          </button>
                        </div>
                      ) : qulPhrases && qulPhrases.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs text-accent-400 leading-relaxed text-center">عبارات مشتركة مراجعة لهذه الآية — اضغط أي آية لعرض متشابهاتها.</p>
                          {qulPhrases.map((e) => (
                            <div key={e.id} className="bg-gray-50 rounded-lg p-3 border border-emerald-100">
                              <p className="font-arabic text-lg font-bold text-accent-800 leading-loose"><mark className="bg-amber-200 rounded px-0.5">{e.text}</mark></p>
                              <p className="text-sm text-accent-500 mb-2">تتكرر في {e.ayahs} آية في {e.surahs} سورة</p>
                              <div className="flex flex-wrap gap-1.5">
                                {e.others.slice(0, 12).map((o) => (
                                  <button key={o.key} onClick={() => hopToQulAyah(o.surah_no, o.ayah_no)}
                                    className="px-2.5 py-1 bg-white border border-emerald-200 hover:bg-emerald-50 rounded-full text-sm font-semibold text-emerald-700">
                                    {o.surah_name} — {o.ayah_no}
                                  </button>
                                ))}
                                {e.others.length > 12 && <span className="text-sm text-accent-400 self-center">و{e.others.length - 12} آية أخرى</span>}
                              </div>
                            </div>
                          ))}
                          <p className="text-xs text-accent-400 leading-relaxed text-center">المصدر: بيانات «المتشابهات» من مكتبة القرآن العالمية (QUL) — مشروع Tarteel.</p>
                        </div>
                      ) : mutashabihat && mutashabihat.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs text-accent-400 leading-relaxed text-center">آيات تشترك مع هذه الآية في عبارة من ٣ كلمات فأكثر — محسوبة من نص المصحف نفسه، والعبارة المشتركة مظللة بالأصفر. اضغط أي آية لعرض متشابهاتها.</p>
                          {mutashabihat.map((s) => (
                            <button key={`${s.verse.surah_no}:${s.verse.ayah_no}`} onClick={() => handleSimilarClick(s.verse)}
                              className="block w-full text-right bg-gray-50 hover:bg-emerald-50 rounded-lg p-3 border border-emerald-100">
                              <p className="text-sm font-bold text-accent-700 mb-1">{s.verse.surah_name} — آية {s.verse.ayah_no} <span className="text-emerald-700 font-semibold">· {s.run} كلمات مشتركة</span></p>
                              <p className="font-arabic text-lg text-accent-800 leading-loose">{renderWithShared(s.verse.ayah_text, s.shared)}</p>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-6 bg-gray-50 rounded-lg">
                          <p className="text-base text-accent-400">لا توجد آيات تشترك مع هذه الآية في عبارة من ٣ كلمات فأكثر</p>
                        </div>
                      ))}
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
                                    <Volume2 className="w-4 h-4" /> المقطع الأصلي
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
                          <p className="text-base text-accent-600 leading-relaxed">إعراب موجز بالعربي، يظهر هنا داخل النافذة قدام الصفحة من غير ما تسيب المصحف.</p>
                          <iframe
                            key={`${selectedVerse.surah_no}:${selectedVerse.ayah_no}`}
                            src={`https://quranpedia.net/embed?surah=${selectedVerse.surah_no}&ayah=${selectedVerse.ayah_no}&type=e3rab&lock=1&ayah_text=0`}
                            title={`إعراب ${selectedVerse.surah_name} — آية ${selectedVerse.ayah_no}`}
                            className="w-full h-[55vh] rounded-lg border border-gray-200 bg-white"
                          />
                          <a href={`https://quranpedia.net/embed?surah=${selectedVerse.surah_no}&ayah=${selectedVerse.ayah_no}&type=e3rab&lock=1`} target="_blank" rel="noreferrer"
                            className="block text-center text-sm font-semibold text-emerald-700 hover:text-emerald-800">
                            فتح الإعراب في صفحة مستقلة (اختياري)
                          </a>
                          <p className="text-xs text-accent-400 leading-relaxed text-center">المصدر: «المجتبى من مشكل إعراب القرآن الكريم» لأحمد بن محمد الخراط، عبر الموسوعة القرآنية (Quranpedia). إن لم يظهر إعراب موجز لهذه الآية، فالإعراب التفصيلي كلمة كلمة (بالإنجليزية) متاح هنا: <a href={`https://corpus.quran.com/wordbyword.jsp?chapter=${selectedVerse.surah_no}&verse=${selectedVerse.ayah_no}`} target="_blank" rel="noreferrer" className="text-emerald-700 underline">Quranic Arabic Corpus</a>.</p>
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
                      {/* التلاوة تحت: recitation controls live at the bottom of the popup,
                          below the tab content, so الروابط and the tabs stay on top. */}
                      <div className="flex items-center gap-2 mt-2 mb-3">
                        <button onClick={() => selectedVerse && handleListenButton(selectedVerse)}
                          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-smooth ${reciting ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'}`}>
                          {reciting ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                          {reciting ? `إيقاف التلاوة — ${reciter.name}` : 'استمع للآية'}
                        </button>
                        <button onClick={() => {
                          const next = !reciteLoop;
                          setReciteLoop(next);
                          if (reciteRef.current) reciteRef.current.loop = next;
                        }}
                          title="تكرار الآية للحفظ"
                          className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-bold transition-smooth ${reciteLoop ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-accent-600 hover:bg-gray-200'}`}>
                          <Repeat className="w-4 h-4" /> تكرار
                        </button>
                      </div>
                      {showReciters && (
                        <div className="mb-4">
                          <p className="text-xs text-accent-400 text-center mb-2">اختر القارئ</p>
                          <div className="flex flex-wrap gap-1.5">
                            {RECITERS.map((r) => (
                              <button key={r.id} onClick={() => selectedVerse && startRecitation(selectedVerse, r)}
                                className={`px-3 py-1.5 rounded-full text-sm font-bold transition-smooth ${r.id === reciterId ? 'bg-amber-600 text-white' : 'bg-gray-100 text-accent-600 hover:bg-gray-200'}`}>
                                {r.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {reciteError && <p className="text-xs text-red-500 text-center mb-3">{reciteError}</p>}
                    <div className="p-3 border-t border-gray-100">
                      <button onClick={() => setSelectedVerse(null)}
                        className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-accent-700 text-sm font-semibold rounded-lg transition-smooth">
                        إغلاق
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Page number — always visible (even in clean mode),
                  never blocking taps. It used to render as invisible
                  text (text-white/0) at screen center, which is why the
                  number seemed to disappear in fullscreen. It now sits
                  below the top-center timer/info row, over the page's
                  top ornament, as a small dark pill like the others. */}
              <div className="absolute top-[68px] left-1/2 -translate-x-1/2 z-30 pointer-events-none">
                <span className="px-3 py-1.5 bg-black/60 backdrop-blur text-white text-xs font-bold rounded-lg ring-1 ring-white/30 shadow">صفحة {currentPage}</span>
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
