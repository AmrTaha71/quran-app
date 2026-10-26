import { useState, useEffect, useCallback, useRef } from 'react';
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
import { MADINAH_PAPER_BOXES, MADINAH_NORMALIZED_ASPECT } from '../lib/madinahPaperBoxes';
import BottomNav from '../components/BottomNav';
import {
  BookOpen, ChevronRight, ChevronLeft, Home, LogOut, Globe,
  ZoomIn, ZoomOut, Maximize2, X, Bookmark, Volume2, Layers,
  LayoutGrid, List, BookMarked, Hash, Heart, Play, Square, Repeat,
} from 'lucide-react';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf';

const TOTAL_PAGES = TOTAL_MUSHAF_PAGES;

const EDITION_STORAGE_KEY = 'quran-mushaf-edition';
const PAGE_STORAGE_KEY = 'quran-mushaf-page';
const TARGET_STORAGE_KEY = 'quran-mushaf-target';
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
  // Ayah popup tabs, in the order the user asked for: mutashabihat,
  // then links, then irab, then tafsir (with a choice of three
  // published tafsirs inside it). Mutashabihat is the default tab.
  const [popupTab, setPopupTab] = useState<'mutashabihat' | 'links' | 'irab' | 'tafsir'>('mutashabihat');
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
  const loadQulData = useCallback(async (): Promise<QulData | null> => {
    if (qulDataCache.current) return qulDataCache.current;
    try {
      const [pRes, vRes] = await Promise.all([fetch('/mutashabihat/phrases.json'), fetch('/mutashabihat/phrase_verses.json')]);
      if (!pRes.ok || !vRes.ok) throw new Error('fetch failed');
      const data: QulData = { phrases: await pRes.json(), phraseVerses: await vRes.json() };
      qulDataCache.current = data;
      return data;
    } catch { return null; }
  }, []);

  const loadQuranText = useCallback(async (): Promise<QuranTextRow[] | null> => {
    if (quranTextCache.current) return quranTextCache.current;
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
  }, []);

  const findSimilar = useCallback(async (verse: QuranVerse) => {
    setMutashabihat(null);
    setQulPhrases(null);
    setMutashabihatSource(null);
    setMutashabihatError(null);
    setMutashabihatLoading(true);
    const rows = await loadQuranText();
    if (!rows || !trigramIndex.current) {
      setMutashabihatError('تعذر تحميل نص القرآن للمقارنة — تحقق من الاتصال وحاول مجدداً');
      setMutashabihatLoading(false);
      return;
    }
    // Published QUL data first: the open ayah's phrase ids, each phrase
    // labelled by slicing its source ayah's raw words by the stored
    // range, with the other ayahs it appears in as hop targets.
    const qul = await loadQulData();
    const qulKey = `${verse.surah_no}:${verse.ayah_no}`;
    const qulIds = qul?.phraseVerses[qulKey];
    if (qul && qulIds && qulIds.length > 0) {
      const surahName = new Map<number, string>();
      rows.forEach((r) => { if (!surahName.has(r.surah_no)) surahName.set(r.surah_no, r.surah_name); });
      const entries: QulPhraseEntry[] = [];
      for (const id of qulIds) {
        const ph = qul.phrases[String(id)];
        if (!ph) continue;
        const [sNo, aNo] = ph.source.key.split(':').map(Number);
        const srcRow = rows.find((r) => r.surah_no === sNo && r.ayah_no === aNo);
        const srcWords = srcRow ? srcRow.ayah_text.split(/\s+/).filter((w) => w.length > 0) : [];
        const text = srcWords.slice(ph.source.from, ph.source.to + 1).join(' ');
        if (!text) continue;
        const others = Object.keys(ph.ayah).filter((k) => k !== qulKey).map((k) => {
          const [os, oa] = k.split(':').map(Number);
          return { key: k, surah_no: os, ayah_no: oa, surah_name: surahName.get(os) || `سورة ${os}` };
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
    // Fallback: computed detection from the text itself.
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
      setPopupTab('mutashabihat');
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
  };

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
    setPopupTab('mutashabihat');
    fetchVerseLinks(verse.id);
  };

  // Word taps (Madinah edition only): per-page word boxes from qurancoor
  // (MIT), remapped from its tight text-block crop onto the app's framed
  // page image — calibration verified against the sufone page 7 overlay
  // test (vertical alignment exact on every line, horizontal within ~1/4
  // word). Boxes whose calibrated left edge is >= 88% are the dataset's
  // spurious border boxes (no word under them) and are dropped, so taps
  // on the border open nothing. A tap only needs ayah-level accuracy:
  // words of one ayah are adjacent, so edge errors matter only at ayah
  // boundaries, and the popup shows the ayah text on top for confirmation.
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
        for (const [key, v] of Object.entries<any>(j.coords)) {
          const h = v?.h;
          if (!h) continue;
          const left = 11 + ((h.x - 40) / 840) * 77;
          if (left >= 88) continue;
          const parts = key.split(':').map(Number);
          if (parts.length < 2 || !parts[0] || !parts[1]) continue;
          boxes.push({
            key,
            surah: parts[0],
            ayah: parts[1],
            left,
            top: 13 + ((h.y - 25) / 1380) * 74,
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
  const MADINAH_IMG_ASPECT = 0.7070; // sufone png-d150 natural 1240x1754
  const normForPaperBox = (box: number[] | undefined) => {
    if (!box) return null;
    const [pl, pt, pr, pb] = box;
    const pw = (pr - pl) / 100;
    const ph = (pb - pt) / 100;
    if (pw <= 0 || ph <= 0) return null;
    const imgW = 100 / pw; // % of wrapper width
    const imgH = (MADINAH_NORMALIZED_ASPECT / (pw * MADINAH_IMG_ASPECT)) * 100; // % of wrapper height
    const imgL = -pl / pw; // % of wrapper width
    // Top-pinned: the paper's top edge sits at the wrapper's top edge.
    const imgT = -imgH * (pt / 100); // % of wrapper height
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
  const containerToImagePercent = (fx: number, fy: number): [number, number] => {
    if (!madinahNorm) return [fx, fy];
    return [madinahNorm.pl + fx * madinahNorm.pw, ((fy - madinahNorm.imgT) / madinahNorm.imgH) * 100];
  };
  // Full-image % word box -> container % rect (for the tap flash).
  const imageBoxToContainer = (b: WordBox) => {
    if (!madinahNorm) return b;
    return {
      ...b,
      left: (b.left - madinahNorm.pl) / madinahNorm.pw,
      top: madinahNorm.imgT + (b.top * madinahNorm.imgH) / 100,
      width: b.width / madinahNorm.pw,
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
        {/* A personal word before reading — a daily dua for the reader */}
        <p className="flex items-center justify-center gap-1.5 text-center text-sm text-amber-700/90 font-semibold mb-4">
          <Heart className="w-4 h-4" /> {dailyDua()}
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
              <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                className="p-2 text-accent-600 hover:bg-gray-100 rounded-lg transition-smooth"><ZoomOut className="w-5 h-5" /></button>
              <span className="text-sm text-accent-500 w-14 text-center font-semibold">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                className="p-2 text-accent-600 hover:bg-gray-100 rounded-lg transition-smooth"><ZoomIn className="w-5 h-5" /></button>
              <button onClick={openFullscreen}
                className="p-2 text-accent-600 hover:bg-amber-100 rounded-lg transition-smooth"><Maximize2 className="w-5 h-5" /></button>
              <button onClick={toggleGoldFrame} title="إطار ذهبي حول الصفحة"
                className={`px-2.5 py-2 text-sm font-bold rounded-lg transition-smooth ${goldFrame ? 'bg-amber-200 text-amber-800 ring-1 ring-amber-400' : 'text-accent-600 hover:bg-amber-100'}`}>
                إطار ذهبي
              </button>
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
          onClick={() => {
            // In clean mode, taps on the black bands restore controls.
            if (cleanMode) { setCleanMode(false); return; }
            if (!showRatelIntro && !showEditionPickerInFullscreen && !selectedVerse) exitFullscreenView();
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
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 leading-relaxed text-center max-w-3xl px-6" style={{ fontFamily: '"Noto Naskh Arabic", "Amiri", serif' }}>
                  اقرأ وارتق، ورتل كما كنت ترتل في الدنيا، فإن منزلتك عند آخر آية تقرؤها
                </h2>

              </div>
            </div>
          )}

          {!showRatelIntro && !cleanMode && (
            <button onClick={(e) => { e.stopPropagation(); exitFullscreenView(); }}
              className="absolute top-4 right-4 p-2.5 bg-black/60 hover:bg-black/75 text-white rounded-lg z-30 transition-smooth ring-1 ring-white/40 shadow-lg">
              <X className="w-7 h-7" />
            </button>
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
                // the wrapper aspect is the fixed minimum paper aspect
                // and the image is absolutely positioned per page so
                // its paper box fills the wrapper width exactly — the
                // scan framing can no longer shift the page between
                // turns. Other editions keep exact fit + adaptive aspect.
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
                // min(100vw, 115vh x aspect), height derived from the
                // aspect — the aspect holds on all screens, contain
                // becomes a no-op, and the tap math is exact.
                <div ref={pageWrapRef}
                  className={`relative ${edition.id === 'madinah' ? '' : 'h-screen'} w-auto max-w-[100vw] ${madinahNorm ? 'overflow-hidden' : ''}`}
                  style={edition.id === 'madinah'
                    ? { aspectRatio: String(MADINAH_NORMALIZED_ASPECT), width: `min(100vw, ${115 * MADINAH_NORMALIZED_ASPECT}vh)` }
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
                      if (px < 11 || px > 88 || py < 13 || py > 87) { setCleanMode(false); return; }
                    }
                    if (Date.now() - lastSwipeAt.current < 500) return;
                    void handleWordTap(e.clientX, e.clientY);
                  }}
                  onTouchStart={handlePageTouchStart}
                  onTouchEnd={handlePageTouchEnd}>
                  <img src={edition.imageUrl(currentPage)} alt={`صفحة ${currentPage}`}
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
                  find and to press anywhere along the edge. The strip on
                  the facing-page side also carries a framed slice of that
                  page (its spine-side edge, full opacity, spine shadow),
                  so it reads as part of the facing page of an open book
                  and the main page stays visually anchored — while the
                  main page itself stays fixed. */}
              <button onClick={(e) => { e.stopPropagation(); goToPage(currentPage - 1); }} disabled={currentPage <= 1}
                aria-label="الصفحة السابقة"
                className="absolute top-0 bottom-0 right-0 w-24 z-20 flex flex-col items-center justify-center gap-1 bg-gradient-to-l from-black/40 to-transparent disabled:opacity-20 group">
                {!facingOnLeft && hasFacingPage && (
                  <div className="absolute inset-y-0 left-0 overflow-hidden pointer-events-none border-l border-black/30 shadow-[0_0_24px_rgba(0,0,0,0.45)]" style={{ width: FACING_STRIP_W }} title="الصفحة المقابلة">
                    <img src={edition.imageUrl(facingPage)} alt="" draggable={false}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      // Madinah: a window into the facing page at the
                      // main page's scale and vertical alignment, with
                      // the facing paper's spine edge (left edge) pinned
                      // to the window's edge — so the peek no longer
                      // jumps against the pinned main page. Other
                      // editions keep the old centered full-height sliver.
                      className={`absolute ${facingNorm ? '' : 'top-1/2 -translate-y-1/2 left-0'} ${!facingNorm ? (edition.id === 'madinah' ? 'h-[115vh]' : 'h-screen') : ''} w-auto max-w-none opacity-100 [-webkit-touch-callout:none]`}
                      style={facingNorm ? {
                        width: `calc(${(facingNorm.imgW / 100).toFixed(4)} * min(100vw, ${115 * MADINAH_NORMALIZED_ASPECT}vh))`,
                        height: `calc(${(facingNorm.imgH / 100).toFixed(4)} * min(100vw, ${115 * MADINAH_NORMALIZED_ASPECT}vh) / ${MADINAH_NORMALIZED_ASPECT})`,
                        left: `calc(0px - ${(facingNorm.pl / 100).toFixed(4)} * ${(facingNorm.imgW / 100).toFixed(4)} * min(100vw, ${115 * MADINAH_NORMALIZED_ASPECT}vh))`,
                        top: `calc((100vh - min(100vw, ${115 * MADINAH_NORMALIZED_ASPECT}vh) / ${MADINAH_NORMALIZED_ASPECT}) / 2 - ${(-facingNorm.imgT / 100).toFixed(4)} * min(100vw, ${115 * MADINAH_NORMALIZED_ASPECT}vh) / ${MADINAH_NORMALIZED_ASPECT})`,
                      } : undefined} />
                    <div className="absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-black/30 to-transparent pointer-events-none" />
                  </div>
                )}
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
                {facingOnLeft && hasFacingPage && (
                  <div className="absolute inset-y-0 right-0 overflow-hidden pointer-events-none border-r border-black/30 shadow-[0_0_24px_rgba(0,0,0,0.45)]" style={{ width: FACING_STRIP_W }} title="الصفحة المقابلة">
                    <img src={edition.imageUrl(facingPage)} alt="" draggable={false}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      // Madinah: same normalized peek as the other
                      // sliver, but the facing page's spine edge here
                      // is its RIGHT edge, pinned to the window's right
                      // edge. See the other sliver's note.
                      className={`absolute ${facingNorm ? '' : 'top-1/2 -translate-y-1/2 right-0'} ${!facingNorm ? (edition.id === 'madinah' ? 'h-[115vh]' : 'h-screen') : ''} w-auto max-w-none opacity-100 [-webkit-touch-callout:none]`}
                      style={facingNorm ? {
                        width: `calc(${(facingNorm.imgW / 100).toFixed(4)} * min(100vw, ${115 * MADINAH_NORMALIZED_ASPECT}vh))`,
                        height: `calc(${(facingNorm.imgH / 100).toFixed(4)} * min(100vw, ${115 * MADINAH_NORMALIZED_ASPECT}vh) / ${MADINAH_NORMALIZED_ASPECT})`,
                        left: `calc(${FACING_STRIP_W} - ${(facingNorm.pr / 100).toFixed(4)} * ${(facingNorm.imgW / 100).toFixed(4)} * min(100vw, ${115 * MADINAH_NORMALIZED_ASPECT}vh))`,
                        top: `calc((100vh - min(100vw, ${115 * MADINAH_NORMALIZED_ASPECT}vh) / ${MADINAH_NORMALIZED_ASPECT}) / 2 - ${(-facingNorm.imgT / 100).toFixed(4)} * min(100vw, ${115 * MADINAH_NORMALIZED_ASPECT}vh) / ${MADINAH_NORMALIZED_ASPECT})`,
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
                <p className="text-white/90 text-xs font-semibold mb-1.5 bg-black/60 px-3 py-1 rounded-full">آيات هذه الصفحة — اضغط رقم الآية لفتح المتشابهات والروابط والإعراب والتفسير</p>
                <div className="bg-black/85 backdrop-blur rounded-xl p-2.5 max-w-[95vw] overflow-x-auto">
                  <div className="flex gap-2">
                    {stripVerses.map((v) => (
                      <button key={v.id} onClick={() => handleVerseClick(v)}
                        className={`flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold transition-smooth flex-shrink-0 ${
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
                    <div className="p-4 overflow-y-auto">
                      <p className="font-arabic text-xl text-accent-800 leading-loose mb-3 text-center">{selectedVerse.ayah_text}</p>
                      <div className="flex items-center gap-2 mb-3">
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
                      <div className="flex gap-2 mb-4">
                        <button onClick={() => setPopupTab('mutashabihat')}
                          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-smooth ${popupTab === 'mutashabihat' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-accent-600 hover:bg-gray-200'}`}>
                          المتشابهات
                        </button>
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
