import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import { supabase } from '../lib/supabase';
import { signOut } from '../lib/auth';
import { SURAHS, SURAH_AYAH_COUNTS } from '../lib/surahs';
import { getQuranTextCache } from '../lib/quranTextCache';
import { formatAr } from '../lib/numerals';
import { RECITERS, DEFAULT_RECITER_ID, type Reciter } from '../lib/reciters';
import { useLang, currentSpeechLocale } from '../lib/LanguageContext';
import { LANGUAGES } from '../lib/translations';
import { LINK_TYPES } from '../lib/types';
import type { QuranVerse, AyahLink } from '../lib/types';
import { JUZ_START_PAGES, HIZB_START_PAGES, getJuzFromPage, getHizbFromPage } from '../lib/quranIndex';
import { dailyDua } from '../lib/personalTouch';
import { MUSHAF_EDITIONS as EDITIONS, SURAH_START_PAGES, getSurahStartPage, TOTAL_MUSHAF_PAGES } from '../lib/mushafEditions';
import { loadVerseIndex } from '../lib/searchIndex';
import { buildOrderedVerses, findLock, findInterimLock, heardWords, FOLLOW_TRIGGER_WORDS, FOLLOW_LOCK_MIN_WORDS, FOLLOW_INTERIM_MIN_WORDS, type TrackedPosition, type OrderedVerse } from '../lib/imamTracker';
import { MADINAH_PAPER_BOXES, MADINAH_NORMALIZED_ASPECT, coverNormForPaperBox, madinahFrameBand, MADINAH_COVER_MAX_ASPECT } from '../lib/madinahPaperBoxes';
import { getStoredLinkGender, resolveLinkAudio } from '../lib/linkAudio';
import { parseHash } from '../lib/shareLinks';
import { HAFS_UNAVAILABLE_PAGE } from '../lib/pageDownload';
import BottomNav from '../components/BottomNav';
import ShareButton from '../components/ShareButton';
import {
  BookOpen, ChevronRight, ChevronLeft, Home, LogOut, Globe,
  ZoomIn, ZoomOut, Maximize2, X, Bookmark, Volume2, Layers, Link,
  LayoutGrid, List, BookMarked, Hash, Heart, Play, Square, Repeat, Mic, Clock,
} from 'lucide-react';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'follow';

const TOTAL_PAGES = TOTAL_MUSHAF_PAGES;

const EDITION_STORAGE_KEY = 'quran-mushaf-edition';
const PAGE_STORAGE_KEY = 'quran-mushaf-page';
const TARGET_STORAGE_KEY = 'quran-mushaf-target';
const FOLLOW_STORAGE_KEY = 'quran-follow-mode';
// Live-engine restart budget (merged live-engine role): SpeechRecognition
// fires onend on every pause/network blip, so a plain "restart on end"
// loop is normal — until the mic is dead, when onend fires immediately
// and forever. More than LIVE_RESTART_MAX restarts inside
// LIVE_RESTART_WINDOW_MS with no speech received means the mic is dead:
// stop and prompt the user to tap ابدأ الاستماع again instead of looping
// silently. Any onresult resets the budget (speech heard = mic alive).
const LIVE_RESTART_MAX = 5;
const LIVE_RESTART_WINDOW_MS = 10000;
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
// jsdelivr occasionally answers "Package size exceeded" 404 for files
// that exist (measured ~12% of first attempts from one network); the
// same file is also served from raw.githubusercontent, so after the
// jsdelivr retries the image falls back to the other host instead of
// failing. Only the Madinah sufone path has a known mirror.
function madinahFallbackSrc(src: string): string | null {
  const prefix = 'https://cdn.jsdelivr.net/gh/sufone/medina-mushaf@master/';
  return src.startsWith(prefix) ? src.replace(prefix, 'https://raw.githubusercontent.com/sufone/medina-mushaf/master/') : null;
}

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
  const fallback = madinahFallbackSrc(src);
  const url = attempt === 0 ? src : attempt === 1 ? `${src}${src.includes('?') ? '&' : '?'}sw-retry=1` : fallback!;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      onError={() => { if (attempt === 0) setAttempt(1); else if (attempt === 1 && fallback) setAttempt(2); else setFailed(true); }}
      className={className}
      style={style}
    />
  );
}

// Main page image with automatic retries. A single transient failure
// (a network wobble while flipping fast) used to flip the whole page
// straight into the error block, so several pages in one flipping
// session ended up "not loaded", each waiting for a manual retry tap.
// Now the image retries twice on its own — first immediately with a
// cache-busting URL, then once more after a short delay for brief
// network drops — then falls back to the raw.githubusercontent mirror
// for Madinah pages, and only then reports failure, so the existing
// error block + manual retry stay as the last resort, not the first
// response. Keyed by page at the call site, so attempts reset on
// every turn, and the delay timer is cleared on unmount.
function RetryPageImg({ src, alt, className, style, loading, onLoad, onFinalError }: {
  src: string;
  alt: string;
  className: string;
  style: CSSProperties | undefined;
  loading?: 'eager' | 'lazy';
  onLoad?: (e: { currentTarget: HTMLImageElement }) => void;
  onFinalError: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const fallback = madinahFallbackSrc(src);
  const url = attempt === 0 ? src : attempt === 3 && fallback ? fallback : `${src}${src.includes('?') ? '&' : '?'}img-retry=${attempt}`;
  return (
    <img
      src={url}
      alt={alt}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      loading={loading ?? 'eager'}
      onLoad={onLoad}
      onError={() => {
        if (attempt === 0) setAttempt(1);
        else if (attempt === 1) timerRef.current = setTimeout(() => setAttempt(2), 400);
        else if (attempt === 2 && fallback) setAttempt(3);
        else onFinalError();
      }}
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
  // SHAKE FIX 2026-10-28: the fullscreen image follows displayedPage
  // (the page whose image has actually loaded), not currentPage, so a
  // fast turn never shows a white gap while the next image downloads —
  // the previous page stays put until the new one is ready. Pills and
  // the verse strip still follow currentPage instantly (tap feedback).
  const [displayedPage, setDisplayedPage] = useState(readStoredPage);
  const displayedPageGenRef = useRef(0);
  // Displayed-page load state (STREAM S2): pending while the requested
  // page's image has not landed yet, slow once it passes ~5s (the
  // fullscreen slow indicator appears), and gateNonce lets the slow
  // indicator's retry button re-run the probe at once.
  const [pageLoadPending, setPageLoadPending] = useState(false);
  const [pageLoadSlow, setPageLoadSlow] = useState(false);
  const [gateNonce, setGateNonce] = useState(0);
  // Book-slide direction for the fullscreen flip animation (RTL:
  // next page enters from the left). Updated in the gate below, so
  // every path (arrows, swipe, jumps, follow) gets the right direction.
  const [turnDir, setTurnDir] = useState<1 | -1>(1);
  // Ref mirror of turnDir + the moment the displayed page last changed:
  // slide-consistent tap math (below) needs both synchronously during
  // the 300ms slide, not next render's state.
  const turnDirRef = useRef<1 | -1>(1);
  const slideStartRef = useRef<{ at: number; dir: 1 | -1 } | null>(null);
  const displayedPageRef = useRef(displayedPage);
  const [selectedEdition, setSelectedEdition] = useState(readStoredEdition);
  const [ayahFilter, setAyahFilter] = useState('');
  // Search-jump highlight: the ayah tapped in لوحتي, marked amber on
  // its exact words until the page turns or fullscreen exits.
  const [searchHighlight, setSearchHighlight] = useState<{ surah: number; ayah: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  // Viewport aspect (width / height) for the Madinah cover geometry.
  // DANCE FIX 2026-10-27 (user video: pages zoom/shift on every
  // turn): the old code updated this on every 'resize'. On iOS
  // Safari window.innerHeight CHANGES when the chrome shows/hides
  // and when the native-fullscreen banner appears/disappears, so
  // every tap that toggled the chrome recomputed coverNorm and the
  // paper zoomed ~10% (at aspect 0.85 the frame-cap binds, at 0.70
  // it does not) — and the cover wrapper is 100dvh tall while the
  // norm is in % of innerHeight, so the two disagreed whenever the
  // chrome was hidden. The aspect is therefore FROZEN: it is set
  // once when fullscreen opens (so entry geometry matches the
  // screen the user is actually looking at) and only on a real
  // rotation (orientationchange, width/height swap), never on a
  // chrome resize. With a frozen aspect + a 100vw x 100dvh wrapper,
  // every page's paper rect is the same pixels on every turn,
  // chrome state or not. Tap precision is unaffected: the tap
  // mapping reads the same frozen norm as the rendered percentages.
  const [viewportAspect, setViewportAspect] = useState(() =>
    typeof window !== 'undefined' && window.innerHeight > 0
      ? window.innerWidth / window.innerHeight : 0.695);
  const [showFullscreen, setShowFullscreen] = useState(false);
  useEffect(() => {
    if (showFullscreen) setViewportAspect(window.innerWidth / Math.max(1, window.innerHeight));
  }, [showFullscreen]);
  useEffect(() => {
    const update = () => setViewportAspect(window.innerWidth / Math.max(1, window.innerHeight));
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  // FULLSCREEN 100%: entering/exiting NATIVE fullscreen changes the real
  // viewport (chrome gone = taller viewport), unlike a chrome show/hide
  // toggle — so the frozen aspect must re-freeze exactly here, or the
  // paper keeps the pre-native size and a band is left on screen.
  useEffect(() => {
    if (!showFullscreen) return;
    const update = () => setViewportAspect(window.innerWidth / Math.max(1, window.innerHeight));
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
    };
  }, [showFullscreen]);
  const [showRatelIntro, setShowRatelIntro] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showEditionPicker, setShowEditionPicker] = useState(false);
  const [showEditionPickerInFullscreen, setShowEditionPickerInFullscreen] = useState(false);
  // Clean reading mode: hides every fullscreen control (top buttons,
  // chips, side strips, verse strip) so only the page shows. Word taps
  // and swipes keep working; tapping the page margin restores controls.
  const [cleanMode, setCleanMode] = useState(false);
  // وضع الحفظ (identity): in fullscreen, the ayah popup hides the ayah
  // text and shows its links first, with an "أظهر الآية" reveal. This
  // touches ONLY the popup text rendering — never page geometry, word
  // boxes, or tap mapping. Persisted across visits like goldFrame.
  const [hifzMode, setHifzMode] = useState(() => {
    try { return localStorage.getItem('quran-hifz-mode') === '1'; } catch { return false; }
  });
  const [hifzRevealed, setHifzRevealed] = useState(false);
  const toggleHifzMode = () => {
    setHifzMode((v) => {
      const next = !v;
      try { localStorage.setItem('quran-hifz-mode', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };
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
  // D4 (follow latency): in-flight page-list promises, keyed by surah.
  // Without this, a follow pre-warm fetch and the lock's own fetch for
  // the same surah run concurrently (the cache is only filled AFTER a
  // fetch resolves), so the lock pays a second full network round trip
  // for a list already being downloaded. Joining the in-flight promise
  // costs nothing and changes no result: success still fills the cache,
  // failure still throws to the caller, and the entry is cleared on
  // settle so a later call can retry after a failure.
  const surahPageListPromise = useRef<Record<number, Promise<{ number: number; page_number: number }[]>>>({});
  const [verseLinks, setVerseLinks] = useState<AyahLink[]>([]);
  const [selectedVerse, setSelectedVerse] = useState<QuranVerse | null>(null);
  // SUGGEST-A-LINK (2026-10-28, requested 2026-10-27): users propose a
  // link from the ayah popup; it lands in ayah_links as status='pending'
  // with created_by = the user (is_ai_draft=false), so the admin queue
  // shows it for review — never auto-published. Label is gender-aware
  // (اقترح تربيط / اقترحي تربيط) from user_profiles.gender.
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestText, setSuggestText] = useState('');
  const [suggestTitle, setSuggestTitle] = useState('');
  const [suggestType, setSuggestType] = useState(LINK_TYPES[0]?.value ?? 'wajih');
  const [suggestSending, setSuggestSending] = useState(false);
  const [suggestSent, setSuggestSent] = useState(false);
  const [suggestError, setSuggestError] = useState('');
  const [suggestGender, setSuggestGender] = useState<'male' | 'female' | null>(null);
  useEffect(() => {
    if (!session) return;
    supabase.from('user_profiles').select('gender').eq('user_id', session.user.id).maybeSingle()
      .then(({ data }) => { if (data?.gender === 'female' || data?.gender === 'male') setSuggestGender(data.gender); });
  }, [session]);
  // Link-voice gender (2026-10-28 policy): male users always hear
  // the generated male voice, female users hear the original or the
  // generated female voice. Same profile source as suggestGender;
  // localStorage mirror ('quran-user-gender', written by Settings)
  // covers the moment before the profile loads.
  const [linkGender, setLinkGender] = useState<'male' | 'female'>(() => getStoredLinkGender(null));
  useEffect(() => {
    if (!session) return;
    supabase.from('user_profiles').select('gender').eq('user_id', session.user.id).maybeSingle()
      .then(({ data }) => { if (data?.gender === 'female' || data?.gender === 'male') setLinkGender(data.gender); });
  }, [session]);
  useEffect(() => { setSuggestOpen(false); setSuggestSent(false); setSuggestError(''); }, [selectedVerse?.id]);
  const submitSuggestion = async () => {
    if (!selectedVerse || !session) return;
    const text = suggestText.trim();
    if (!text) { setSuggestError('اكتب التربيط الأول'); return; }
    setSuggestSending(true); setSuggestError('');
    const { error } = await supabase.from('ayah_links').insert({
      verse_id: selectedVerse.id, link_content: text, link_title: suggestTitle.trim() || null,
      link_types: [suggestType], status: 'pending', created_by: session.user.id, is_ai_draft: false,
    });
    setSuggestSending(false);
    if (error) { setSuggestError('تعذّر إرسال الاقتراح — حاول تاني'); return; }
    setSuggestSent(true); setSuggestText(''); setSuggestTitle('');
  };
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
  // S4 voice safety: link audio owns ONE element (the old playAudio
  // created an orphan Audio per tap — it kept playing after popup
  // close / ayah change and overlapped recitation and corrections).
  // stopLinkAudio is called on popup close, ayah change, recitation
  // start, and page unmount; errors surface as text, never silence.
  const linkAudioRef = useRef<HTMLAudioElement | null>(null);
  const [linkAudioError, setLinkAudioError] = useState('');
  const stopLinkAudio = () => {
    try { linkAudioRef.current?.pause(); } catch {}
    linkAudioRef.current = null;
  };
  const playLinkAudio = (url: string) => {
    stopLinkAudio();
    setLinkAudioError('');
    const a = new Audio(url);
    linkAudioRef.current = a;
    a.onended = () => { if (linkAudioRef.current === a) linkAudioRef.current = null; };
    a.onerror = () => {
      if (linkAudioRef.current === a) linkAudioRef.current = null;
      setLinkAudioError('تعذر تشغيل الصوت — تحقق من الاتصال وحاول تاني');
    };
    a.play().catch(() => {
      if (linkAudioRef.current === a) linkAudioRef.current = null;
      setLinkAudioError('تعذر تشغيل الصوت — تحقق من الاتصال وحاول تاني');
    });
  };
  const changeReciter = (id: string) => {
    setReciterId(id);
    try { localStorage.setItem('quran-reciter', id); } catch { /* ignore */ }
  };
  useEffect(() => { stopRecitation(); stopLinkAudio(); setShowReciters(false); setHifzRevealed(false); }, [selectedVerse?.id, stopRecitation]);
  // In وضع الحفظ the popup always opens on its links first.
  useEffect(() => { if (selectedVerse && hifzMode) setPopupTab('links'); }, [selectedVerse, hifzMode]);
  const startRecitation = (verse: QuranVerse, r: Reciter) => {
    stopRecitation();
    // S4: recitation must never overlap a playing link voice.
    stopLinkAudio();
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
  // STREAM S2 displayed-page-lag discipline: in fullscreen the image
  // follows displayedPage, so every fullscreen LABEL (top chips, page
  // pill) must follow displayedPage too while it lags currentPage —
  // showing the new page's Juz/Surah over the old page's image was
  // the defect. Normal view has no such split (its image is keyed on
  // currentPage), so labels there stay on currentPage.
  const labelPage = showFullscreen ? displayedPage : currentPage;
  const labelSurahName = SURAHS.find((s) => s.no === getPageSurah(labelPage))?.name || '';
  const labelJuz = getJuzFromPage(labelPage);
  const labelHizb = getHizbFromPage(labelPage);
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
    // D4: join an in-flight fetch for this surah instead of starting a
    // second one (see surahPageListPromise). The network result, the
    // cache fill, and the throw-on-failure behaviour are unchanged.
    const inFlight = surahPageListPromise.current[surah];
    if (inFlight) return inFlight;
    const p = (async () => {
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
    })();
    surahPageListPromise.current[surah] = p;
    try {
      return await p;
    } finally {
      if (surahPageListPromise.current[surah] === p) delete surahPageListPromise.current[surah];
    }
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
          // Phase 1 text cache: a surah hit (with link fields, so
          // the strip dots stay correct) skips the network; a miss
          // fetches as before and writes through.
          const cachedSurah = await getQuranTextCache().getSurah(os, SURAH_AYAH_COUNTS[os - 1] || 0, { requireLinks: true });
          if (cachedSurah) {
            for (const r of cachedSurah) {
              if (!ayahs.includes(r.ayah_no)) continue;
              rows.push({ id: r.id, surah_no: r.surah_no, surah_name: r.surah_name, ayah_no: r.ayah_no, ayah_text: r.ayah_text, has_links: r.has_links as boolean, links_count: r.links_count as number, is_protected: r.is_protected as boolean, created_at: '', updated_at: '' });
            }
          } else {
            const { data } = await supabase.from('quran_verses').select('*').eq('surah_no', os).in('ayah_no', ayahs);
            if (data) {
              rows.push(...data);
              void getQuranTextCache().putRows(data);
            }
          }
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
  type QulOtherAyah = { key: string; surah_no: number; ayah_no: number; surah_name: string; row: QuranTextRow; ranges: number[][] };
  type QulPhraseEntry = { id: number; text: string; ayahs: number; surahs: number; others: QulOtherAyah[] };
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
          // Phase 1 text cache: a full-table hit skips all 7
          // paginated queries (and works offline). The trigram
          // index below rebuilds from the rows exactly as before,
          // so computed results are identical; a miss falls through
          // to the network path, whose rows are then written through.
          let rows: QuranTextRow[] | null = await getQuranTextCache().getAll(6000);
          if (!rows) {
            const fetched: QuranTextRow[] = [];
            const PAGE = 1000;
            for (let from = 0; ; from += PAGE) {
              const { data, error } = await supabase.from('quran_verses')
                .select('id,surah_no,surah_name,ayah_no,ayah_text,ayah_text_clean')
                .order('surah_no', { ascending: true }).order('ayah_no', { ascending: true })
                .range(from, from + PAGE - 1);
              if (error || !data) throw new Error('fetch failed');
              fetched.push(...(data as QuranTextRow[]));
              if (data.length < PAGE) break;
            }
            if (fetched.length < 6000) throw new Error('incomplete');
            void getQuranTextCache().putRows(fetched);
            rows = fetched;
          }
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
      let labelRows: { id: number; surah_no: number; ayah_no: number; ayah_text: string; ayah_text_clean: string | null }[] | null = null;
      try {
        // Labels must cover the OTHER ayahs too, not just the sources:
        // the cards below render each other ayah's full text and hop
        // from its stored row, so a fresh session never needs the
        // full table (the old chip hop read quranTextCache, which
        // the QUL path never loads, and silently did nothing).
        const allSurahs = [...new Set(qulIds.flatMap((id) => {
          const ph = qul.phrases[String(id)];
          if (!ph) return [] as number[];
          return [ph.source.key, ...Object.keys(ph.ayah)].map((k) => k.split(':')[0]).filter(Boolean).map(Number);
        }))];
        // Phase 1 text cache: surahs already cached (with clean
        // text) skip the network; only the missing surahs are
        // fetched, in the same single query shape as before. A
        // fetch failure with every surah cached still proceeds;
        // otherwise the full-table fallback below runs, unchanged.
        const cachedLabelRows: { id: number; surah_no: number; ayah_no: number; ayah_text: string; ayah_text_clean: string | null }[] = [];
        const missingSurahs: number[] = [];
        for (const s of allSurahs) {
          const hit = await getQuranTextCache().getSurah(s, SURAH_AYAH_COUNTS[s - 1] || 0, { requireClean: true });
          if (hit) cachedLabelRows.push(...hit);
          else missingSurahs.push(s);
        }
        if (missingSurahs.length > 0) {
          const { data, error } = await supabase.from('quran_verses')
            .select('id,surah_no,ayah_no,ayah_text,ayah_text_clean').in('surah_no', missingSurahs);
          if (error || !data) throw new Error('label fetch failed');
          void getQuranTextCache().putRows(data);
          labelRows = [...cachedLabelRows, ...(data as { id: number; surah_no: number; ayah_no: number; ayah_text: string; ayah_text_clean: string | null }[])];
        } else {
          labelRows = cachedLabelRows;
        }
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
          const others: QulOtherAyah[] = [];
          for (const k of Object.keys(ph.ayah)) {
            if (k === qulKey) continue;
            const [os, oa] = k.split(':').map(Number);
            const oRow = labelRows.find((r) => r.surah_no === os && r.ayah_no === oa);
            if (!oRow || !oRow.ayah_text) continue;
            const oName = SURAHS.find((s) => s.no === os)?.name || `سورة ${os}`;
            others.push({
              key: k, surah_no: os, ayah_no: oa, surah_name: oName,
              row: { id: oRow.id, surah_no: os, surah_name: oName, ayah_no: oa, ayah_text: oRow.ayah_text, ayah_text_clean: oRow.ayah_text_clean ?? null },
              ranges: ph.ayah[k] ?? [],
            });
          }
          others.sort((x, y) => x.surah_no - y.surah_no || x.ayah_no - y.ayah_no);
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

  // Render an other ayah's text with its QUL occurrence ranges
  // highlighted. QUL ranges index the raw Hafs token split while the
  // seeded text is IndoPak, so a range can misalign: every range is
  // clamped to the displayed split, and a range that lands nowhere
  // simply highlights nothing — the text itself is always shown.
  const renderWithRanges = (displayText: string, ranges: number[][]) => {
    const dispWords = displayText.split(/\s+/).filter((w) => w.length > 0);
    const hi = new Set<number>();
    for (const r of ranges || []) {
      if (!Array.isArray(r) || r.length < 2) continue;
      const rawFrom = Number(r[0]);
      const rawTo = Number(r[1]);
      if (!Number.isFinite(rawFrom) || !Number.isFinite(rawTo)) continue;
      const from = Math.max(0, Math.floor(rawFrom));
      const to = Math.min(dispWords.length - 1, Math.floor(rawTo));
      for (let i = from; i <= to; i++) hi.add(i);
    }
    return dispWords.map((w, i) => (hi.has(i)
      ? <mark key={i} className="bg-amber-200 rounded px-0.5">{w} </mark>
      : <span key={i}>{w} </span>));
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

  // D4 (follow latency): set by jumpToTracked immediately before a
  // follow-lock page change, consumed by the neighbour-preload effect
  // below. On the lock turn the target image itself is the critical
  // download; firing six neighbour images at +400ms would share the
  // connection with it on exactly the slow networks where lock latency
  // hurts. Skipping ONE turn's neighbour preload is safe: the next
  // manual turn re-arms preloading, and follow has no tracking after
  // lock, so no page is ever needed "next" without a turn. This ref is
  // declared here (not in the follow block) so the effect below can
  // read it; refs are not useCallback deps, so there is no TDZ risk.
  const followLockPreloadSkipRef = useRef(false);
  // Preload the neighbouring pages so turning feels instant — but
  // ONLY after the user settles (400ms without a turn). The old code
  // fired ±3 preloads on EVERY turn, so fast flips flooded the
  // connection with dozens of parallel requests and some page loads
  // failed transiently (the black broken-image gaps). With the gate
  // above, a lag no longer shows a gap (the old page stays), so
  // waiting for a settle is safe. ±1 first, then ±2, ±3, so the
  // nearest pages always win the race.
  useEffect(() => {
    // D4: follow-lock turn — the target image owns the connection.
    // Consume the flag exactly once; every other turn preloads as before.
    if (followLockPreloadSkipRef.current) {
      followLockPreloadSkipRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      for (const p of [currentPage - 1, currentPage + 1, currentPage - 2, currentPage + 2, currentPage - 3, currentPage + 3]) {
        if (p >= 1 && p <= TOTAL_PAGES) {
          const img = new Image();
          img.src = edition.imageUrl(p);
        }
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [currentPage, edition]);

  // Displayed-page gate (SHAKE FIX 2026-10-28, hardened 2026-10-28,
  // reworked STREAM S2): advance displayedPage ONLY when the new
  // page's image actually LOADS. The first version advanced on probe
  // error too ("so the retries / error block can run") — but a
  // transient failure is common when fast flips flood the connection,
  // and then the user stared at a broken image on a black screen for
  // 1-2s while RetryPageImg's slow chain ran (measured on the user's
  // video: black gaps of 1.83s, 1.33s, 1.00s). Now the probe retries
  // quickly on its own and the previous page stays until a good load.
  // S2 changes: (1) the old per-attempt 5s watchdog (3 attempts =
  // ~15s of pinned old page, taps ignored throughout) is replaced by
  // ONE global 12s gate deadline per turn — probes retry every 300ms
  // until the deadline, then advance so the error block with its retry
  // button can show; (2) past ~5s a real loading indicator appears in
  // fullscreen with a retry control (gateNonce re-runs the probe at
  // once) instead of a silent stall.
  useEffect(() => {
    const p = currentPage;
    const g = ++displayedPageGenRef.current;
    if (displayedPageRef.current === p) {
      setPageLoadPending(false);
      setPageLoadSlow(false);
      return;
    }
    const deadlineAt = Date.now() + 12000;
    setPageLoadPending(true);
    setPageLoadSlow(false);
    const slowTimer = setTimeout(() => {
      if (displayedPageGenRef.current === g) setPageLoadSlow(true);
    }, 5000);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const probe = () => {
      if (displayedPageGenRef.current !== g) return;
      const img = new Image();
      img.src = edition.imageUrl(p);
      const done = () => {
        clearTimer();
        if (displayedPageGenRef.current !== g) return;
        const old = displayedPageRef.current;
        if (old !== p) {
          const dir: 1 | -1 = p > old ? 1 : -1;
          setTurnDir(dir);
          turnDirRef.current = dir;
        }
        displayedPageRef.current = p;
        setDisplayedPage(p);
        setPageLoadPending(false);
        setPageLoadSlow(false);
      };
      const onFail = () => {
        clearTimer();
        if (displayedPageGenRef.current !== g) return;
        // Global deadline, not a per-attempt watchdog: retries keep
        // coming every 300ms, but the old page is never pinned past
        // 12s — at the deadline we advance so the error block shows.
        if (Date.now() >= deadlineAt) { done(); return; }
        timer = setTimeout(probe, 300);
      };
      if (img.complete && img.naturalWidth > 0) { done(); return; }
      if (img.complete && img.naturalWidth === 0) { onFail(); return; }
      img.onload = done;
      img.onerror = onFail;
      // Watchdog for THIS attempt: only the time left to the deadline.
      timer = setTimeout(onFail, Math.max(0, deadlineAt - Date.now()));
    };
    probe();
    return () => { clearTimeout(slowTimer); clearTimer(); };
  }, [currentPage, edition, gateNonce]);

  // Slide start tracking for slide-consistent tap math (below): the
  // displayed image remounts (and its 300ms slide restarts) exactly
  // when displayedPage changes.
  useEffect(() => {
    slideStartRef.current = { at: Date.now(), dir: turnDirRef.current };
  }, [displayedPage]);

  // Remember the user's chosen edition and last page, and honour a
  // cross-page jump from لوحتي (stored as { surah, ayah }).
  useEffect(() => {
    localStorage.setItem(EDITION_STORAGE_KEY, String(selectedEdition));
  }, [selectedEdition]);
  useEffect(() => {
    localStorage.setItem(PAGE_STORAGE_KEY, String(currentPage));
  }, [currentPage]);
  // A share deep link in the hash (STREAM S2, see src/lib/shareLinks):
  // #/mushaf?page=5 jumps straight to that page in normal view, and
  // #/mushaf?surah=2&ayah=255 is handed to the لوحتي-jump effect below
  // (declared after this one, so it consumes the stored target on the
  // same mount) — same fullscreen + highlight behaviour as a لوحتي
  // jump. Declared before that effect on purpose: mount effects run
  // in declaration order. A bare #/mushaf is a no-op here.
  useEffect(() => {
    const parsed = parseHash(window.location.hash);
    if (parsed.route !== 'mushaf') return;
    if (parsed.page) { setCurrentPage(parsed.page); return; }
    if (parsed.surah) {
      try {
        localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify({ surah: parsed.surah, ayah: parsed.ayah }));
      } catch { /* storage unavailable: the jump below just won't run */ }
    }
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // STREAM S2: normal-view zoom never carries across a turn — a
    // zoomed (cropped) page used to stay zoomed on the next page,
    // hiding its edges until the user noticed and zoomed back out.
    setZoom(1);
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
  // MERGED auto-fullscreen rule: an auto-lock fires from a transcript
  // callback, NOT a gesture, so mobile browsers may refuse this native
  // request (iPhone Safari: element fullscreen unsupported; Android
  // Chrome: gesture-gated). That refusal must NEVER gate the page open:
  // the app-level fullscreen view (fixed overlay) is the real fullscreen
  // and opens regardless; this call is fire-and-forget on top of it.
  const requestNativeFullscreen = () => {
    // D4: already in native fullscreen — follow entry already requested
    // it and the lock path requests it again. A second request is pure
    // overhead (and, from a non-gesture transcript callback, a second
    // refusal); the app-level fixed overlay is already open either way,
    // so skipping when already fullscreen cannot change what is shown.
    try {
      const d = document as any;
      if (d.fullscreenElement || d.webkitFullscreenElement) return;
    } catch {}
    // Installed PWA (standalone): there is no Safari chrome and no
    // fullscreen banner, so native fullscreen is redundant — skip it.
    // In a Safari tab the banner ("<site> is in full screen") is iOS's
    // own UI that no website can remove; it auto-hides after a few
    // seconds. The app-level fixed overlay is the real fullscreen and
    // opens regardless; this call is fire-and-forget on top of it.
    try {
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
      if (standalone) return;
    } catch {}
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

  // Resume-to-fullscreen entry: HomeStartPage's resume action sets
  // sessionStorage 'quran-open-fullscreen' before navigating here.
  // Consumed once on mount (read then remove): a later refresh or a
  // shared link never reopens fullscreen, and shared links never
  // carry the flag. Native fullscreen is fire-and-forget — a silent
  // refusal (notably iPhone Safari, which lacks the API for page
  // elements) never shows an error; the fixed overlay is the real
  // fullscreen and opens regardless.
  useEffect(() => {
    let present = false;
    try {
      present = sessionStorage.getItem('quran-open-fullscreen') !== null;
      if (present) sessionStorage.removeItem('quran-open-fullscreen');
    } catch {}
    if (!present) return;
    setShowFullscreen(true);
    requestNativeFullscreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // MERGED followStatus: listening | locked ONLY. 'found' (pending
  // confirmation) and 'lost' (re-lock after tracking) are both deleted:
  // there is no confirmation card and no tracking after a lock, so a
  // wrong lock is escaped via the post-lock "مش دي؟ كمّل الاستماع"
  // button (one-tap fresh start) or via إيقاف / X + a fresh start,
  // not resync.
  const [followStatus, setFollowStatus] = useState<'listening' | 'locked'>('listening');
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
  // Set synchronously at start-tap time and cleared once the engine is
  // running (or on any early return): the listening flag alone is set
  // only AFTER the mic-permission await on the Whisper path, so on a
  // browser whose permission prompt is not modal (desktop Chrome) a
  // second tap during the prompt used to start a second stream and a
  // second chunk loop. The generation below is the backstop for
  // stop-then-restart races: any continuation whose generation no
  // longer matches must abort instead of starting a stale loop.
  const followStartingRef = useRef(false);
  const followStartGenRef = useRef(0);
  // E3 (mic-permission wait, 2026-10-28): explicit "waiting for the
  // browser's mic permission" state. The live engine's rec.start()
  // returns synchronously while Safari's permission prompt is still
  // pending/queued, and until now the lobby claimed "listening" during
  // that whole window — so a slow or queued prompt looked exactly like
  // a frozen app, and repeated taps were silently swallowed by the
  // starting/listening guards. The flag below is set synchronously at
  // tap time and cleared ONLY by a permission decision: the first
  // engine result (grant proven), any engine error (denied or engine
  // ran), audio capture starting (onaudiostart, fallback onstart —
  // P0-2), a grant/denial on the Whisper path, or a terminal stop.
  // It is NEVER cleared by a timer or a retry: while it is set and
  // audio never started, no auto-restart may fire (see onend + the
  // transient-safety guard); once audio started, a silence auto-end
  // restarts on budget instead of stopping honestly (P0-2).
  // followMicWaitStartedAt anchors the elapsed-seconds ticker in the
  // lobby so the next device test can tell which side was slow: if
  // the waiting line persists with a growing count, Safari never
  // showed the prompt; if it flips to the terminal message, the
  // engine ended before any decision.
  const [followMicWaiting, setFollowMicWaiting] = useState(false);
  const [followMicWaitStartedAt, setFollowMicWaitStartedAt] = useState<number | null>(null);
  const followMicWaitingRef = useRef(false);
  // B4 (Bolt note 2): the silent pre-audiostart retry is made VISIBLE
  // in the lobby waiting line (e.g. "محاولة 2/2 بعد إنهاء صامت قبل
  // الإذن") alongside the elapsed ticker, so a device test can
  // report whether Safari silently ends sessions. This waiting-line
  // evidence is the event surface — no full follow event log is
  // built. The note is set ONLY by the R3 retry branch (below) and
  // cleared by every wait-state change (see the setter): any
  // grant / result / stop / cancel ends the wait, so the note can
  // never strand past the wait it describes.
  const [followWaitRetryNote, setFollowWaitRetryNote] = useState<string | null>(null);
  // N4 (Claude reply 7, Q4): rAF heartbeat diagnostic for the follow
  // mic-permission wait. The tick counter is a REF, not state — it
  // never re-renders on its own; the lobby's existing 1s ticker
  // re-renders while waiting, so the visible line below refreshes
  // every second from the ref. Only MILESTONE entries are recorded
  // (never per-frame), so the capped log cannot flood. The loop
  // starts with the wait (the setter is called with true only on a
  // tap) and stops on every wait clear via this same setter, plus
  // teardown belt-and-braces — it never leaks past the wait.
  // Diagnostic-only: no follow behavior reads these values.
  // R3: the visible line renders each milestone as "event +Nms"
  // (offset from the tap event) plus document.visibilityState,
  // and the summary persists after the wait ends until the next
  // tap (start() resets it) — the wait-clear event carries the
  // final tick count. rAF stops in background, which resembles
  // freezing; the visibility state disambiguates.
  const followHeartbeatTicksRef = useRef(0);
  const followHeartbeatRafRef = useRef<number | null>(null);
  const followHeartbeatEventsRef = useRef<{ event: string; ticks: number; at: number }[]>([]);
  const followHeartbeatFirstResultRef = useRef(false);
  const followHeartbeatStop = () => {
    if (followHeartbeatRafRef.current !== null) {
      cancelAnimationFrame(followHeartbeatRafRef.current);
      followHeartbeatRafRef.current = null;
    }
  };
  const followHeartbeatPush = (event: string) => {
    followHeartbeatEventsRef.current.push({ event, ticks: followHeartbeatTicksRef.current, at: Date.now() });
    if (followHeartbeatEventsRef.current.length > 200) followHeartbeatEventsRef.current.shift();
  };
  const followHeartbeatStart = () => {
    followHeartbeatTicksRef.current = 0;
    followHeartbeatEventsRef.current = [];
    followHeartbeatFirstResultRef.current = false;
    followHeartbeatStop();
    const loop = () => {
      followHeartbeatTicksRef.current += 1;
      followHeartbeatRafRef.current = requestAnimationFrame(loop);
    };
    followHeartbeatRafRef.current = requestAnimationFrame(loop);
    followHeartbeatPush('tap');
  };
  const setFollowMicWaitingState = useCallback((waiting: boolean, startedAt: number | null = null) => {
    const wasWaiting = followMicWaitingRef.current;
    followMicWaitingRef.current = waiting;
    setFollowMicWaiting(waiting);
    setFollowMicWaitStartedAt(waiting ? startedAt : null);
    setFollowWaitRetryNote(null);
    if (waiting) followHeartbeatStart();
    else {
      // R3: record the clear as a milestone, but only when a wait
      // was actually up — redundant setter(false) calls must not
      // append spurious events to a previous summary.
      if (wasWaiting) followHeartbeatPush('wait-clear');
      followHeartbeatStop();
    }
  }, []);
  // P0-2 (Claude): true once the live engine has begun capturing audio
  // in this session (onaudiostart, fallback onstart — both fire only
  // once the service starts, i.e. after Safari granted the mic, never
  // while the prompt is pending). This is what separates the two
  // pre-result onend cases: engine-ran-then-ended (silence auto-end,
  // budgeted restart) vs engine-never-ran (honest stop). Reset at tap
  // time, on every terminal stop, and by stopFollowEngines, so a
  // previous session's grant can never authorize restarts in a new one.
  const followAudioStartedRef = useRef(false);
  // R3 (Claude-2): silent pre-audiostart onend retries, per tap.
  // Safari sometimes ends the engine on its own before capture; the
  // old code honest-stopped on the first such end, which could kill
  // a session before the first word. At most 2 retries per tap; the
  // budget resets ONLY on onaudiostart/onstart (markFollowAudioStarted),
  // on first result, and on a fresh tap — never on a retry itself,
  // so a loop that never gets audiostart exhausts and stops honestly.
  const followPreAudioRetryRef = useRef(0);
  // P0-2 (Claude): elapsed-seconds ticker for the permission wait.
  // The static "started at HH:MM:SS" stamp could not tell a 2s wait
  // from a 2-minute one; the ticker makes a stuck prompt visible, and
  // the "press stop" hint appears only after 8s so a normal short
  // wait does not nag the user.
  const [followMicWaitElapsed, setFollowMicWaitElapsed] = useState(0);
  useEffect(() => {
    if (!followMicWaiting || followMicWaitStartedAt === null) { setFollowMicWaitElapsed(0); return; }
    const tick = () => setFollowMicWaitElapsed(Math.max(0, Math.floor((Date.now() - followMicWaitStartedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [followMicWaiting, followMicWaitStartedAt]);
  const followPosRef = useRef<TrackedPosition | null>(null);
  // MERGED auto-lock: there is NO confirmation card, NO pending lock,
  // and NO tracking after a lock. The single lock callback is
  // handleFollowAutoLock (below, next to onFollowFinal): both engines
  // report a lock only through it, and it stops the engines, sets
  // followPos + 'locked' (which hides the lobby), and jumps to the
  // ayah's page fullscreen with searchHighlight. followAutoLockedRef
  // is the latch: once set, the lock can never re-fire and every later
  // transcript is dropped. enterFollowMode resets it for a fresh
  // session; stopFollow resets it on exit. (followMiss tracking is
  // deleted with tracking itself: misses after a lock cannot happen,
  // because listening has stopped.)
  const followAutoLockedRef = useRef(false);
  // D4 (follow latency) pre-warm state — see warmFollowCandidate below.
  // followWarmPageRef: last page whose image + word-box JSON were
  // warmed during listening, so each distinct candidate page is warmed
  // at most once per app lifetime (a warmed page stays in the browser
  // cache, so re-warming it across sessions would buy nothing).
  // followWarmInterimLenRef: interim length at the last interim warm,
  // so the engine's repeated revisions of the same interim text do not
  // rescan on every delivery; reset on every fresh follow entry.
  const followWarmPageRef = useRef<number | null>(null);
  const followWarmInterimLenRef = useRef(0);
  // Live-engine restart budget state (see LIVE_RESTART_MAX above).
  const liveRestartCountRef = useRef(0);
  const liveRestartWindowRef = useRef(0);
  // S4: transient safety timer for the live engine — if onend never
  // follows a transient error, this restarts directly after ~3s
  // instead of hanging on "retrying" forever (same shape as the
  // self-test timer; cleared by onend and by every engine stop).
  const followTransientSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Jump generation: jumpToTracked awaits the network, so a slow jump
  // can resolve AFTER the user rejected, stopped, or resynced. Each of
  // those actions bumps this counter, and a jump whose generation is
  // stale drops itself instead of yanking the page from under him.
  const followJumpGenRef = useRef(0);
  const followStatusRef = useRef<'listening' | 'locked'>('listening');
  const recognitionRef = useRef<any>(null);
  const followStreamRef = useRef<MediaStream | null>(null);
  const followWakeLockRef = useRef<any>(null);
  const followActiveRef = useRef(false);
  const followVisListenerRef = useRef(false);
  // MERGED single declarations (entry + device-honesty + exit roles all
  // fixed these same base bugs — exactly ONE declaration each, here,
  // above every user, so no TDZ and no duplicate):
  // - wakeLockPendingRef: base used it in acquireWakeLock but never
  //   declared it, so every wake-lock request threw and the screen
  //   lock was silently never held. Declared here.
  // - followRecorderRef / followTranscribeAbortRef (auto-stop role):
  //   handles for the in-flight Whisper chunk recorder and transcribe
  //   fetch, so teardown / auto-lock can stop/abort them mid-flight.
  const wakeLockPendingRef = useRef(false);
  const followRecorderRef = useRef<MediaRecorder | null>(null);
  const followTranscribeAbortRef = useRef<AbortController | null>(null);
  // Guards a wake-lock request already in flight: without it, two
  // concurrent requests (visibility return + release-handler timer, or
  // two start paths) each create their own sentinel, the ref keeps only
  // the last, and the earlier sentinel stays held with no handle left
  // to release it.

  // The screen must NEVER sleep during a prayer. Browsers release wake
  // locks when the tab hides and sometimes when the system intervenes,
  // so a single request is not enough: re-acquire on visibility return
  // and on release while still following. A denied request just throws
  // and is swallowed, so the release handler cannot spin.
  const acquireWakeLock = useCallback(async () => {
    if (!followActiveRef.current) return;
    if (wakeLockPendingRef.current) return;
    const nav = navigator as any;
    if (!nav.wakeLock?.request) return;
    wakeLockPendingRef.current = true;
    try {
      const wl = await nav.wakeLock.request('screen');
      // The session may have stopped while the request was in flight
      // (stopFollow already ran): never store a lock nobody will
      // release — hand it straight back instead.
      if (!followActiveRef.current) {
        try { await wl.release(); } catch {}
        return;
      }
      followWakeLockRef.current = wl;
      wl.addEventListener('release', () => {
        followWakeLockRef.current = null;
        if (followActiveRef.current && document.visibilityState === 'visible') {
          setTimeout(() => { void acquireWakeLock(); }, 1000);
        }
      });
    } catch {
      // Swallowed on purpose: a denied request must not spin. The next
      // visibility return or release event retries; no retry loop here,
      // because a persistent denial would otherwise re-request forever.
    } finally {
      wakeLockPendingRef.current = false;
    }
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

  // Engine-only stop, shared by auto-lock and full teardown (merged
  // auto-stop + exit roles). Stops live recognition (handlers nulled
  // BEFORE stopping, abort preferred over stop so no pending final
  // transcript is delivered and Chrome's onend auto-restart cannot
  // fire), the in-flight Whisper chunk recorder, the in-flight
  // transcribe fetch, and the mic stream. Deliberately does NOT touch
  // the wake lock, the visibility listener, or followActiveRef: the
  // auto-lock path keeps all three (user still in prayer, screen must
  // stay on), while full teardown releases them. It DOES clear the
  // permission-wait state (single setter, P0-2): the old ref-only
  // clear stranded the display on stops that never ran stopFollow.
  const stopFollowEngines = useCallback(() => {
    followListeningRef.current = false;
    followStartingRef.current = false;
    // P0-2 (Claude): SINGLE source of truth for the permission wait.
    // This used to clear only the ref, leaving the state half to be
    // cleared by stopFollow / stopLiveWithPrompt — two paths that do
    // not run on every engine stop (auto-lock, unmount cleanup), so
    // the waiting display could strand. The stable setter updates
    // ref + state together; calling setState from the unmount cleanup
    // is a React no-op, so this is safe there too. stopFollow's own
    // setFollowMicWaitingState(false) below is now redundant but
    // harmless. The audio-started flag resets here as well: a dead
    // engine's grant must not authorize restarts in a later session.
    setFollowMicWaitingState(false);
    followAudioStartedRef.current = false;
    // S4: a pending safety restart must not fire after the engines
    // are dead (it would resurrect listening on a stopped session).
    if (followTransientSafetyRef.current) { clearTimeout(followTransientSafetyRef.current); followTransientSafetyRef.current = null; }
    const rec = recognitionRef.current;
    if (rec) {
      try { rec.onresult = null; rec.onerror = null; rec.onend = null; } catch {}
      try { if (rec.abort) rec.abort(); else rec.stop(); } catch {}
    }
    recognitionRef.current = null;
    const chunkRec = followRecorderRef.current;
    if (chunkRec) {
      try { chunkRec.stop(); } catch {}
      followRecorderRef.current = null;
    }
    try { followTranscribeAbortRef.current?.abort(); } catch {}
    followTranscribeAbortRef.current = null;
    followStreamRef.current?.getTracks().forEach((t) => t.stop());
    followStreamRef.current = null;
  }, [setFollowMicWaitingState]);

  // B1 (Bolt CONDITION, required before any device test): a WORKING
  // Cancel button while waiting for mic permission, Whisper
  // permission wait only (the live wait is exited via stopFollow).
  // Today the start buttons are disabled during the wait and
  // the ready branch has no stop button at all, so if Safari never
  // shows the prompt the user is stuck with no exit except reload.
  // The button stays ENABLED during waiting (no disabled prop) and
  // calls this handler. stopFollowEngines alone is NOT enough: a
  // pending getUserMedia grant (Whisper) or index load (live) would
  // still resolve under the same startGen and resurrect listening
  // behind the user's back — so the generation is bumped FIRST
  // (every in-flight grant / load / chunk checks startGen and aborts
  // on mismatch), then stopFollowEngines clears the wait (ref + state
  // through the single setter) and stops the engines. followOn and
  // followReady are deliberately NOT touched — unlike stopFollow,
  // cancel must NOT exit follow mode: the lobby stays in its ready
  // branch with the start buttons enabled, so a fresh tap works
  // immediately. Not touching followReady is safe ONLY because this
  // button renders in the ready branch; moving this handler to the
  // listening branch would require resetting followReady and related
  // state, or the UI would strand on a dead "listening" display.
  // User-initiated cancel does not violate the no-timer
  // rule (no timer is involved — this is a tap). The wake lock and
  // followActiveRef are left alone for the same reason: the user is
  // still in the lobby, not leaving follow mode; the next tap
  // re-arms everything.
  const cancelFollowMicWait = useCallback(() => {
    followStartGenRef.current += 1;
    stopFollowEngines();
  }, [stopFollowEngines]);

  // Shared FULL teardown for a follow session (mic, stream, recorder,
  // wake lock, visibility listener). No setState here, so it is safe
  // to run from the unmount cleanup, where state updates would be
  // no-ops. stopFollow calls this, then resets the UI state.
  // Idempotent: every step guards or nulls, so double-teardown is safe.
  // Generation bumps come FIRST (exit role): they invalidate in-flight
  // mic grants, index loads, jumps and Whisper chunks, so post-exit
  // work can never re-open or re-lock anything.
  const teardownFollowResources = useCallback(() => {
    followStartGenRef.current += 1;
    followJumpGenRef.current += 1;
    followBufferRef.current = [];
    stopFollowEngines();
    // N4: belt-and-braces — the setter inside stopFollowEngines
    // already stops the heartbeat; this makes the guarantee
    // independent of that path.
    followHeartbeatStop();
    followActiveRef.current = false;
    if (followVisListenerRef.current) {
      document.removeEventListener('visibilitychange', handleFollowVisibility);
      followVisListenerRef.current = false;
    }
    try { followWakeLockRef.current?.release(); } catch {}
    followWakeLockRef.current = null;
    try { sessionStorage.removeItem(FOLLOW_STORAGE_KEY); } catch {}
  }, [handleFollowVisibility, stopFollowEngines]);

  // --- Follow-the-imam mode ---
  const enterFollowMode = useCallback(() => {
    // D4: a Ratel intro left open (manual fullscreen button, 3s timer)
    // would cover the follow lobby — the lobby renders only while
    // !showRatelIntro — for up to 3s after entering follow. Dismiss it
    // at entry; the pending timer's later setShowRatelIntro(false) is
    // then a harmless no-op. The follow path itself never sets the
    // intro (verified: only openFullscreen() sets it, and neither
    // enterFollowMode nor jumpToTracked calls openFullscreen).
    setShowRatelIntro(false);
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
    followAutoLockedRef.current = false;
    liveRestartCountRef.current = 0;
    liveRestartWindowRef.current = 0;
    followJumpGenRef.current += 1;
    setFollowHeard('');
    setFollowError(null);
    // E3: a fresh lobby never inherits a stale permission-wait display.
    setFollowMicWaitingState(false);
    setFollowIndexLoading(false);
    setFollowChunkPhase('idle');
    setFollowChunkCount(0);
    setFollowChunkFails(0);
    followBufferRef.current = [];
    followWarmInterimLenRef.current = 0;
    setCleanMode(false);
    // Word-level highlighting needs the Madinah word boxes, so follow
    // mode always uses the Madinah edition (harmless if already selected).
    const madinahIdx = EDITIONS.findIndex((e) => e.id === 'madinah');
    if (madinahIdx >= 0) setSelectedEdition(madinahIdx);
    // The wake lock belongs to the session, not just to listening: a
    // user waiting in the lobby (imam hasn't started) must not have
    // the screen sleep on them. WakeLock.request needs no user gesture
    // (unlike getUserMedia), so this is safe from the route effect.
    ensureWakeLockTracking();
  }, [ensureWakeLockTracking, setFollowMicWaitingState]);

  const stopFollow = useCallback(() => {
    // Full teardown already bumps both generations (stale-start
    // backstop: a start whose mic grant or index load is still pending
    // must abort instead of resurrecting listening after this stop),
    // clears the heard buffer, and releases the wake lock.
    teardownFollowResources();
    // E3: إيقاف is the user's escape from a stuck permission wait.
    setFollowMicWaitingState(false);
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
    followAutoLockedRef.current = false;
    liveRestartCountRef.current = 0;
    liveRestartWindowRef.current = 0;
    setFollowHeard('');
    followBufferRef.current = [];
    followWarmInterimLenRef.current = 0;
    // A stop must not leave a stale 'locked' status behind: the next
    // session starts from 'listening', and no post-stop transcript
    // (guarded in onFollowFinal) can ever read a dead status again.
    // searchHighlight is deliberately NOT cleared here (highlight
    // role): a locked ayah keeps its manual-style amber highlight
    // until a page turn or fullscreen exit, exactly like a لوحتي jump.
    setFollowStatus('listening');
    followStatusRef.current = 'listening';
    setFollowEngine(null);
  }, [teardownFollowResources, setFollowMicWaitingState]);

  // MERGED auto-fullscreen + highlight: this is the ONLY page-open used
  // by a follow lock, and it is the SAME fullscreen branch a manual open
  // uses (goToPage + setShowFullscreen + best-effort native request) —
  // no second fullscreen implementation exists, so the auto-opened page
  // has the normal page controls, swipe/page-turn, edition/frame, clean
  // mode and word taps exactly as a manual fullscreen open.
  // opts.highlight (highlight role): when true, searchHighlight — the
  // manual search-jump mechanism, stable and non-tracking — is set
  // AFTER goToPage, because goToPage clears any search highlight, so a
  // highlight set before the jump would be wiped before it renders.
  // Callers that omit the flag behave exactly as before.
  const jumpToTracked = useCallback(async (pos: TrackedPosition, opts?: { highlight?: boolean }) => {
    const gen = followJumpGenRef.current;
    try {
      const list = await loadSurahPageList(pos.surah);
      // Superseded while the network was in flight (stop / a newer
      // lock): do NOT yank the page to a stale ayah.
      if (gen !== followJumpGenRef.current) return;
      const entry = list.find((a) => a.number === pos.ayah);
      const page = entry ? entry.page_number : getSurahStartPage(pos.surah);
      // D4: the lock turn's connection belongs to the target image
      // (neighbour preloads are skipped for this one turn — see
      // followLockPreloadSkipRef), and the Ratel intro must never
      // cover the locked page even if it was somehow opened mid-listen.
      followLockPreloadSkipRef.current = true;
      goToPage(page);
      setSelectedVerse(null);
      setShowRatelIntro(false);
      setShowFullscreen(true);
      requestNativeFullscreen();
      if (opts?.highlight) setSearchHighlight({ surah: pos.surah, ayah: pos.ayah });
    } catch {
      if (gen !== followJumpGenRef.current) return;
      // MERGED auto-fullscreen fallback (REVERTIBLE — see integration
      // report): if the page list fails (offline / network error), do
      // NOT strand the user on the lobby with an error — open the
      // surah's first page fullscreen, the same fallback the لوحتي
      // search-jump uses. Trade-off, stated plainly: the follow bar
      // still names the locked surah/ayah, but the word highlight shows
      // only if that ayah happens to be on the surah's first page, and
      // the user may need to turn pages manually to reach it. To revert:
      // replace this catch body with the old setFollowError line.
      followLockPreloadSkipRef.current = true;
      goToPage(getSurahStartPage(pos.surah));
      setSelectedVerse(null);
      setShowRatelIntro(false);
      setShowFullscreen(true);
      requestNativeFullscreen();
      if (opts?.highlight) setSearchHighlight({ surah: pos.surah, ayah: pos.ayah });
    }
    // goToPage / setters are stable enough here; loadSurahPageList is memoized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSurahPageList]);

  // D4 (follow latency) — pre-warm the likely page DURING listening.
  // Why this exists: on the old path, nothing about the target page was
  // fetched until AFTER the lock, so the lock paid, serially, a
  // Quranpedia page-list fetch (if uncached) + the Madinah image
  // download + the word-box JSON fetch, all while the user stared at
  // the old page. Warming moves all three onto the listening window —
  // the imam is still reciting, the mic/recognition path is untouched
  // (no awaits, no state updates, no engine calls here) — so a lock
  // that lands on an already-warmed page pays ~0ms of network instead
  // of seconds. Warming NEVER locks and NEVER changes lock semantics:
  // the candidate is found with a WEAKER 3-word run purely to choose
  // what to fetch; a wrong candidate only wastes one cached image +
  // one small JSON (deduplicated per page), and the lock path still
  // resolves the true page from the page list and highlights the true
  // ayah. The word-box URL mirrors the loader's FIRST url
  // (raw.githubusercontent.com); if that loader ever changes, the warm merely
  // stops helping — it cannot break the highlight, which still loads
  // normally on the page change.
  const warmFollowCandidate = useCallback((words: string[], ordered: OrderedVerse[]) => {
    if (followAutoLockedRef.current || words.length < 3) return;
    const cand = findLock(words, ordered, 3);
    if (!cand) return;
    void loadSurahPageList(cand.surah).then((list) => {
      if (followAutoLockedRef.current) return;
      const entry = list.find((a) => a.number === cand.ayah);
      const page = entry ? entry.page_number : getSurahStartPage(cand.surah);
      if (page < 1 || page > TOTAL_PAGES) return;
      if (followWarmPageRef.current === page) return;
      followWarmPageRef.current = page;
      try {
        // Follow always uses the Madinah edition (enterFollowMode
        // forces it), so warm that edition's image regardless of the
        // edition state at warm time.
        const madinah = EDITIONS.find((e) => e.id === 'madinah');
        if (madinah) {
          const img = new Image();
          img.src = madinah.imageUrl(page);
        }
        const file = String(page).padStart(3, '0');
        void fetch(`https://raw.githubusercontent.com/bodoorzahera/Quran-coordinate/master/src/qurancoor/data/page-${file}.json`).catch(() => {});
      } catch { /* best-effort warm: a failure just means the lock path loads normally */ }
    }).catch(() => { /* page-list warm failure: the lock path retries on its own */ });
  }, [loadSurahPageList]);

  // THE single lock callback (merged live + whisper + auto-stop +
  // auto-fullscreen roles; their names were onFollowAutoLock /
  // handleFollowAutoLock / autoStopFollowOnLock — this one function is
  // all three). EVERY lock — live engine, Whisper fallback, and manual
  // ابحث — reports ONLY through here; nothing else in this file may
  // lock. In order, synchronously (no await between killing the engines
  // and setting the highlight, so no transcript can slip in mid-teardown):
  // (1) latch, so this can never fire twice; (2) generation bumps, so a
  // pending mic grant / index load / older jump aborts instead of
  // resurrecting listening or yanking the page; (3) engine-only stop —
  // live recognizer, Whisper recorder, transcribe fetch, mic stream —
  // via stopFollowEngines, which deliberately does NOT release the wake
  // lock (MERGE OVERRIDE of auto-stop's release choice, parent-
  // confirmable: the user is still in prayer following the page, and
  // the screen must not sleep mid-prayer; the wake lock is released by
  // stopFollow / route-exit / unmount only. One-line change to flip:
  // call teardownFollowResources() here instead — but that also clears
  // followActiveRef, which the wake re-acquire and route-exit gates
  // need, so flip it only together with those gates); (4) buffer
  // cleared, so nothing can re-lock the same ayah; (5) followPos +
  // 'locked' + followOn=false: the lobby hides (it renders only while
  // !followPos), the follow bar hides (it needs followOn), and the
  // searchHighlight render gate opens (it needs !followOn), so exactly
  // ONE highlight renders — the stable searchHighlight, never the
  // live-tracking word highlight on top of it; (6) jump with
  // { highlight: true }, which opens the page fullscreen.
  // followActiveRef deliberately STAYS true: the wake lock must keep
  // re-acquiring on visibility return, and the route-exit effect must
  // still see an active session to stop on leave.
  const handleFollowAutoLock = useCallback((lock: TrackedPosition) => {
    if (followAutoLockedRef.current) return;
    followAutoLockedRef.current = true;
    followStartGenRef.current += 1;
    followJumpGenRef.current += 1;
    stopFollowEngines();
    followBufferRef.current = [];
    liveRestartCountRef.current = 0;
    liveRestartWindowRef.current = 0;
    followPosRef.current = lock;
    setFollowPos(lock);
    followStatusRef.current = 'locked';
    setFollowStatus('locked');
    setFollowOn(false);
    setFollowReady(false);
    setFollowEngine(null);
    setFollowChunkPhase('idle');
    void jumpToTracked(lock, { highlight: true });
  }, [jumpToTracked, stopFollowEngines]);

  const onFollowFinal = useCallback((text: string) => {
    // Transcripts delivered after a stop, an X, a route leave, an
    // unmount, or an auto-lock (a Whisper chunk mid-transcribe when the
    // user stopped, a live engine's trailing final) must not lock,
    // advance, or jump anything on a dead or already-locked session —
    // and must never re-open the Mushaf. The latch + listening flag +
    // active flag together enforce that.
    if (!followListeningRef.current || followAutoLockedRef.current || !followActiveRef.current) return;
    const words = heardWords(text);
    if (words.length === 0) return;
    // DISPLAY FIX (2026-10-29): finals are the ONLY writing iOS ever
    // produces — it sends no interim text — so show every final here,
    // in the existing "سمعت:" line. Before this, the live iOS path
    // fed finals to the matcher invisibly and the lobby showed
    // nothing for the whole session, so "listening but not writing"
    // was indistinguishable from a dead mic. Now any heard sentence
    // appears on screen at once; if the line stays empty, the mic is
    // genuinely not delivering transcripts (distance / acoustics),
    // and if sentences appear but no lock follows, the matcher —
    // not the mic — is the next fix, with the misheard words as
    // evidence. Placed before the index guard on purpose: finals
    // display even while the ayah index is still loading.
    setFollowHeard(text);
    const ordered = followOrderedRef.current;
    if (!ordered) return;
    // Cumulative buffer (trigger role): words are HELD here, never
    // discarded below threshold — a 2-word final followed by a 3-word
    // final still reaches the gate, on either engine. Counting uses
    // normalized words (heardWords → normalizeWords), so rasm variants
    // count the same way on live and Whisper. Capped at the last 80.
    const buffer = [...followBufferRef.current, ...words].slice(-80);
    followBufferRef.current = buffer;
    // Tracking after a lock does not exist in the merged spec: once
    // followPos is set, the lock callback has already stopped
    // listening, so this branch is a guard, not a tracker.
    if (followPosRef.current) return;
    // D4: warm the likely page from the finals buffer as soon as a
    // 3-word run names a candidate — usually whole ayahs before the
    // 4-word lock fires. Warm-only: the trigger gate and lock below
    // are untouched.
    if (buffer.length >= 3) warmFollowCandidate(buffer, ordered);
    // TRIGGER GATE (shared constant, both engines): search runs only
    // once the cumulative buffer reaches FOLLOW_TRIGGER_WORDS (5).
    // The tracking branch that used to follow this gate is deleted:
    // after a lock there is no advanceTracking, no miss count, no
    // 'lost', no re-lock.
    if (buffer.length < FOLLOW_TRIGGER_WORDS) return;
    const lock = findLock(buffer, ordered, FOLLOW_LOCK_MIN_WORDS);
    if (!lock) return;
    handleFollowAutoLock(lock);
  }, [handleFollowAutoLock, warmFollowCandidate]);

  // Engine callbacks are registered once at start; they always call the
  // latest onFollowFinal through this ref so they never go stale.
  const followFinalRef = useRef(onFollowFinal);
  useEffect(() => { followFinalRef.current = onFollowFinal; });

  // INTERIM LOCK (2026-10-28): the live engine's interim text arrives
  // DURING the ayah, so it can lock mid-ayah without waiting for the
  // ayah end or a stop tap. Same latch/listening/active guards as
  // finals; interim words never touch the finals buffer (no
  // double-counting). Identical interim text redelivered by the engine
  // is skipped so one utterance is attempted once per new word.
  const lastInterimRef = useRef('');
  const onFollowInterim = useCallback((text: string) => {
    if (!followListeningRef.current || followAutoLockedRef.current || !followActiveRef.current) return;
    if (followPosRef.current) return;
    const trimmed = text.trim();
    if (!trimmed || trimmed === lastInterimRef.current) return;
    lastInterimRef.current = trimmed;
    const ordered = followOrderedRef.current;
    if (!ordered) return;
    const words = heardWords(trimmed);
    if (words.length < FOLLOW_INTERIM_MIN_WORDS) return;
    const lock = findInterimLock(words, ordered);
    if (!lock) {
      // D4: warm the likely page mid-ayah from the last 20 interim
      // words (the same window findInterimLock scans), but only when
      // the interim GREW since the last warm — the engine redelivers
      // revised copies of the same text, and rescanning those warms
      // nothing new. Warm-only; the interim lock rule is untouched.
      if (words.length > followWarmInterimLenRef.current) {
        followWarmInterimLenRef.current = words.length;
        warmFollowCandidate(words.slice(-20), ordered);
      }
      return;
    }
    handleFollowAutoLock(lock);
  }, [handleFollowAutoLock, warmFollowCandidate]);
  const followInterimRef = useRef(onFollowInterim);
  useEffect(() => { followInterimRef.current = onFollowInterim; });

  const recordChunk = (ms: number): Promise<Blob> => new Promise((resolve, reject) => {
    const stream = followStreamRef.current;
    if (!stream) { reject(new Error('no stream')); return; }
    const mime = MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    followRecorderRef.current = rec;
    rec.onstop = () => { if (followRecorderRef.current === rec) followRecorderRef.current = null; resolve(new Blob(chunks, { type: mime || 'audio/webm' })); };
    rec.onerror = () => { if (followRecorderRef.current === rec) followRecorderRef.current = null; reject(new Error('record failed')); };
    rec.start();
    setTimeout(() => { try { rec.stop(); } catch {} }, ms);
  });

  // Whisper chunk loop only. The mic stream and the login check are done
  // by startFollowListening BEFORE the verse-index await (inside the tap
  // gesture) — see below — so by the time this runs, the stream exists
  // and the loop just records, uploads, transcribes, and reports its
  // phase, so the lobby never looks frozen while chunks are in flight.
  // Whisper chunk loop only (merged whisper + auto-stop roles). The mic
  // stream and the login check are done by startFollowListening BEFORE
  // the verse-index await (inside the tap gesture), so by the time this
  // runs, the stream exists and the loop just records, uploads,
  // transcribes, and reports its phase, so the lobby never looks frozen
  // while chunks are in flight.
  // MERGED gate decision: this loop does NOT count words itself. Every
  // chunk transcript is forwarded whole to onFollowFinal, whose
  // cumulative buffer + FOLLOW_TRIGGER_WORDS (5) gate governs both
  // engines alike — the whisper role's local 4-word held-words gate was
  // a duplicate of that shared gate and is deleted; holding
  // sub-threshold words is already what followBufferRef does (it is
  // cumulative and only cleared on lock/stop/entry). The loop's own
  // guards are: a generation capture (stop-then-restart can no longer
  // resurrect an old loop beside the new session's loop), the
  // listening flag, and the auto-lock latch — a chunk still recording
  // when a lock/stop lands is dropped BEFORE upload/transcribe, and an
  // in-flight transcribe fetch is aborted via followTranscribeAbortRef.
  const runWhisperLoop = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid || !followStreamRef.current) return;
    const loopGen = followStartGenRef.current;
    let consecutiveFails = 0;
    while (followListeningRef.current && !followAutoLockedRef.current && loopGen === followStartGenRef.current) {
      let chunkPath = '';
      let aborter: AbortController | null = null;
      try {
        setFollowChunkCount((c) => c + 1);
        setFollowChunkPhase('recording');
        const blob = await recordChunk(8000);
        if (!followListeningRef.current || followAutoLockedRef.current || loopGen !== followStartGenRef.current) break;
        // The chunk file's extension matches its real bytes (iOS records
        // mp4, desktop webm) so stored chunks are honestly named.
        const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
        chunkPath = `follow/${uid}/${Date.now()}.${ext}`;
        setFollowChunkPhase('uploading');
        const { error: upErr } = await supabase.storage.from('rana-audio').upload(chunkPath, blob);
        if (upErr) throw upErr;
        if (!followListeningRef.current || followAutoLockedRef.current || loopGen !== followStartGenRef.current) break;
        const { data: urlData } = supabase.storage.from('rana-audio').getPublicUrl(chunkPath);
        setFollowChunkPhase('transcribing');
        aborter = new AbortController();
        followTranscribeAbortRef.current = aborter;
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ audioUrl: urlData.publicUrl }),
          signal: aborter.signal,
        });
        if (!res.ok) throw new Error('transcribe failed');
        const data = await res.json();
        // Pre-forward guard (third drop point, after the loop condition
        // and onFollowFinal's own guard): a transcript that lands after
        // a lock/stop must never be delivered to the matcher.
        if (data.transcript && followListeningRef.current && !followAutoLockedRef.current && loopGen === followStartGenRef.current) {
          setFollowHeard(data.transcript);
          followFinalRef.current(data.transcript);
        }
        consecutiveFails = 0;
        setFollowChunkFails(0);
        setFollowError(null);
      } catch {
        // A lock/stop abort must break silently: no "mic disconnected"
        // prompt, no failure count, no retry sleep over a locked page.
        if (!followListeningRef.current || followAutoLockedRef.current || loopGen !== followStartGenRef.current) break;
        // A gone mic stream (revoked, device lost) can never record
        // again — stop cleanly with a restart prompt instead of
        // retrying forever with no mic. (A stop-pressed exit takes
        // the same break without an error: the flag is already false.)
        if (!followStreamRef.current) {
          if (followListeningRef.current) {
            followListeningRef.current = false;
            setFollowReady(true);
            setFollowError('انقطع الميكروفون — اضغط بدء الاستماع من جديد');
          }
          break;
        }
        // One failed chunk must not kill the session — but after several
        // in a row, say so instead of looking frozen.
        consecutiveFails += 1;
        setFollowChunkFails(consecutiveFails);
        if (consecutiveFails >= 3) {
          setFollowError('تعذر الاستماع عبر الخادم — تأكد من الاتصال، أو اكتب الكلمات يدوياً بالأسفل');
        }
        await new Promise((r) => setTimeout(r, 1500));
      } finally {
        if (aborter && followTranscribeAbortRef.current === aborter) followTranscribeAbortRef.current = null;
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
  // GESTURE RULE (device-honesty): the start button handler calls
  // enterFollowMode(); startFollowListening(); synchronously in one
  // tap handler, and NOTHING is awaited before either engine start
  // below (live: rec.start() with no await before it; Whisper:
  // getUserMedia invoked synchronously before its first await). The
  // #/follow route effect must NEVER call this function — entering the
  // route only shows the lobby; the tap is the only start.
  // forceWhisper (2026-10-27): when the live engine fails fatally
  // (async onerror, outside the tap gesture), it cannot fall through
  // to Whisper by itself — so the lobby offers an explicit tap-gated
  // Whisper start, which skips SpeechRecognition entirely.
  const startFollowListening = useCallback(async (forceWhisper = false) => {
    // Double-tap guard, covering the permission-prompt window too:
    // followListeningRef is set only AFTER rec.start()/getUserMedia,
    // so followStartingRef (set synchronously here, cleared on every
    // early return and once listening starts) is what blocks a second
    // tap during a non-modal prompt from starting a second stream/loop.
    if (followListeningRef.current || followStartingRef.current) return;
    setFollowError(null);
    // MERGED single startGen fix (entry + live + whisper + device-
    // honesty roles all found it): the base referenced startGen on the
    // Whisper path but never declared it, so on Safari the function
    // threw a ReferenceError right after a successful mic grant, before
    // listening was ever set — stream left open, no error shown, lobby
    // unchanged. Captured here, at the top, before any await, so the
    // stale-start checks below work on both paths.
    const startGen = followStartGenRef.current;
    followStartingRef.current = true;
    // E3: ONE serialized permission attempt. This is set synchronously
    // in the tap, before either engine starts, so the lobby shows
    // "waiting for permission" (not "listening") from the first instant.
    // A second tap while it is set is still blocked by the guards above
    // — and now the start buttons are also disabled in the lobby, so
    // the block is visible instead of a silent no-op.
    setFollowMicWaitingState(true, Date.now());
    // P0-2: a fresh session starts with no audio grant — a previous
    // session's audiostart must never authorize restarts here.
    followAudioStartedRef.current = false;
    // R3: a fresh tap gets a fresh pre-audiostart retry budget.
    followPreAudioRetryRef.current = 0;
    // Locale captured at tap time from the same source the language
    // provider uses (localStorage 'app-lang'): ar-EG -> ar-EG, anything
    // else -> ar-SA. A language change mid-session does NOT retune a
    // running recognizer — the user must stop and tap again. The
    // Whisper path has no client-side locale: the transcribe-audio edge
    // function hardcodes language='ar'.
    // S4 DOCUMENTED INCONSISTENCY (deliberately NOT flipped here):
    // self-test pins ar-SA (SelfTestPage TEST_SPEECH_LOCALE) while
    // follow keeps ar-EG here. The V3 per-device A/B counts decide
    // one locale for both — flipping follow silently would change
    // prayer behaviour on unmeasured evidence.
    const speechLocaleNow = currentSpeechLocale();
    // Honest mic-error wording (device-honesty): the old code showed
    // the same "allow the mic" line for every failure, including a
    // missing mic, a mic busy in another app, and a dismissed prompt —
    // three different causes with three different fixes. Map by error
    // name, never by guess.
    const micErrorMessage = (err: any): string => {
      const name = err?.name as string | undefined;
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        return 'مفيش ميكروفون متاح على الجهاز ده — اكتب الكلمات يدوياً بالأسفل';
      }
      if (name === 'NotReadableError' || name === 'AbortError') {
        return 'الميكروفون مشغول بتطبيق تاني — اقفله ثم اضغط «ابدأ الاستماع» من جديد';
      }
      if (name === 'SecurityError') {
        return 'الصفحة دي مش مسموح لها تستخدم الميكروفون هنا — افتح الرابط في المتصفح نفسه مش داخل تطبيق تاني';
      }
      return 'تم رفض إذن الميكروفون — اسمح به من إعدادات المتصفح ثم اضغط «ابدأ الاستماع» من جديد';
    };
    const SR = forceWhisper ? null : ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    if (SR) {
      setFollowEngine('live');
      const rec = new SR();
      rec.lang = speechLocaleNow;
      rec.continuous = true;
      rec.interimResults = true;
      // P0-2 (Claude): the mic-grant signal. onaudiostart fires when
      // the engine begins capturing audio — possible only after Safari
      // granted the mic — and it fires much earlier than the first
      // result (which needs speech). onstart is the fallback for
      // engines that do not fire onaudiostart: on WebKit/Chromium it
      // fires only once the service starts, i.e. post-grant, never
      // while the prompt is pending, so neither handler can clear the
      // wait early. Both arm followAudioStartedRef, which is what lets
      // a later silence auto-end restart (budgeted) instead of
      // stopping honestly. Residual uncertainty (documented, not
      // hidden): Safari's exact onstart timing is not provable from
      // code — if a device test ever shows the wait clearing BEFORE
      // the prompt appears, drop the onstart line and keep
      // onaudiostart only; the onend decision below stays correct
      // either way, because it keys on the same flag.
      const markFollowAudioStarted = () => {
        followAudioStartedRef.current = true;
        // R3: a grant resets the pre-audiostart retry budget (the
        // session is alive; a later silent end takes the budgeted
        // restart path, not this branch, but the reset keeps the
        // budget accounting exact if the flag is ever re-armed).
        followPreAudioRetryRef.current = 0;
        if (followMicWaitingRef.current) setFollowMicWaitingState(false);
      };
      // N4: distinct milestones — the push precedes the handler,
      // because the handler itself clears the wait (which stops
      // the loop); pushing after it would record nothing.
      rec.onaudiostart = () => { followHeartbeatPush('onaudiostart'); markFollowAudioStarted(); };
      rec.onstart = () => { followHeartbeatPush('onstart'); markFollowAudioStarted(); };
      // Stops the live session with an honest prompt and returns the
      // user to the start branch (never a silent dead "listening").
      const stopLiveWithPrompt = (message: string) => {
        // E3: every terminal live stop also ends the permission wait —
        // a denied prompt, a dead engine, and the pre-decision onend
        // below all land here, so no terminal state can strand the
        // waiting display. Retry is by explicit re-tap only.
        // P0-2 (Claude): RE-ENTRANCY order — the listening/starting/
        // audio flags go FALSE *before* rec.stop(), because some
        // engines fire onend synchronously from stop(): with the flags
        // still true, that onend would fall through to the budgeted
        // restart below and re-start the engine being stopped.
        // With the flags already false, a synchronous onend returns
        // early at its guard instead.
        followListeningRef.current = false;
        followStartingRef.current = false;
        followAudioStartedRef.current = false;
        setFollowMicWaitingState(false);
        if (followTransientSafetyRef.current) { clearTimeout(followTransientSafetyRef.current); followTransientSafetyRef.current = null; }
        try { rec.stop(); } catch {}
        recognitionRef.current = null;
        liveRestartCountRef.current = 0;
        liveRestartWindowRef.current = 0;
        setFollowReady(true);
        setFollowError(message);
      };
      // S4: transient safety net (see followTransientSafetyRef).
      // onend clears it (the normal restart path); this fires only
      // when onend never comes. InvalidStateError means the engine
      // is still running after all — not a dead end.
      const armFollowTransientSafety = () => {
        if (followTransientSafetyRef.current) clearTimeout(followTransientSafetyRef.current);
        followTransientSafetyRef.current = setTimeout(() => {
          followTransientSafetyRef.current = null;
          if (!followListeningRef.current || followAutoLockedRef.current) return;
          if (recognitionRef.current !== rec) return;
          // E3 refined by P0-2: NEVER restart while permission is
          // undecided AND audio never started. R3: while the wait
          // is up the timer returns early here by design (the wait
          // path relies on onend + إيقاف, not on this timer), so
          // this guard is what guarantees "exactly one start
          // attempt while pending" even if an error path changes.
          // Once audio started, a missing onend IS a dead
          // engine (silence auto-end without the event), so the
          // restart below is the only recovery and must fire.
          if (followMicWaitingRef.current && !followAudioStartedRef.current) return;
          try { rec.start(); } catch (err: any) {
            if (err && err.name === 'InvalidStateError') return;
            stopLiveWithPrompt('توقف الاستماع المباشر — اضغط «ابدأ الاستماع» من جديد');
          }
        }, 3000);
      };
      rec.onresult = (e: any) => {
        // Post-lock/post-stop queued results neither deliver finals
        // (also guarded in onFollowFinal) nor update interim UI.
        if (!followListeningRef.current || followAutoLockedRef.current) return;
        // N4: first result (interim or final) — recorded once per
        // wait. If the wait already cleared (grant), the loop has
        // stopped, so ticks show the count at clear time while the
        // timestamp stays exact.
        if (!followHeartbeatFirstResultRef.current) {
          followHeartbeatFirstResultRef.current = true;
          followHeartbeatPush('first-result');
        }
        // E3: the first result — interim or final — proves Safari
        // granted the mic, so the permission wait ends here. From now
        // on the normal listening display (and the budgeted onend
        // restart) apply.
        if (followMicWaitingRef.current) setFollowMicWaitingState(false);
        // R3: a result resets the pre-audiostart retry budget (the
        // session is demonstrably alive; the branch below is
        // unreachable after this anyway, since the wait is cleared).
        followPreAudioRetryRef.current = 0;
        // Any result resets the dead-mic restart budget (speech heard
        // = mic alive).
        liveRestartCountRef.current = 0;
        liveRestartWindowRef.current = Date.now();
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          // isFinal lives on the RESULT (e.results[i]), NOT on its
          // first alternative (e.results[i][0]) — the old check read
          // it off the alternative, so it was always undefined and
          // every final was treated as interim: the lobby showed the
          // transcript growing forever while the matcher never got a
          // single word, so follow could never lock. Check both so a
          // quirk engine that sets it on the alternative still works.
          const res = e.results[i];
          const r = res[0];
          // MERGED interim decision (trigger role wins over live
          // role's interim-feeding): ONLY finals are fed to the
          // matcher. Interim text is display-only (followHeard):
          // interim transcripts are unstable — the engine revises
          // them and re-delivers the same words as a final — so
          // counting them would double-count words, and with no
          // confirmation step left, an interim guess could yank the
          // page to a wrong ayah with no veto.
          if (res.isFinal || r.isFinal) followFinalRef.current(r.transcript);
          else interim += r.transcript + ' ';
        }
        if (interim.trim()) {
          setFollowHeard(interim.trim());
          // Interim-lock attempt (2026-10-28): mid-ayah auto-open —
          // the matcher decides (6+ unique words); display unchanged.
          followInterimRef.current(interim);
        }
      };
      rec.onerror = (e: any) => {
        if (!followListeningRef.current || followAutoLockedRef.current) return;
        // N2 (Claude reply 6, item 7; corrected by reply 8):
        // error taxonomy for the permission wait. The old code
        // cleared the wait for ANY error, claiming every error
        // is a permission decision — wrong for aborted and
        // network, which can fire BEFORE the decision while the
        // prompt is still pending. The wait is now cleared only
        // where the error itself proves a decision or a grant:
        // not-allowed (denied, via the terminal stop below) and
        // no-speech (the engine ran, so the mic was granted).
        // Transient errors keep the wait: aborted and network
        // keep the session (onend restarts it). service-not-
        // allowed is TERMINAL, not pre-decision (reply 8: most
        // likely a service refusal — dictation/Siri disabled, or
        // speech permission refused) — it stops honestly with
        // the specific message below, no wait exception; the
        // honest stop returns to the ready branch, where the
        // manual input the message points to IS visible.
        // Terminal branches (audio-capture, language-not-
        // supported, service-not-allowed, unknown) still stop
        // honestly, and that teardown clears the wait. No path
        // leaves a waiting
        // display on a stopped engine: every stop goes through
        // stopLiveWithPrompt or stopFollowEngines, both of which
        // clear the wait, and the live wait's exit (إيقاف) is
        // always visible in the listening branch.
        // S4 taxonomy port (self-test P3 shape, lock semantics
        // untouched): transient errors are named, not swallowed.
        // 'no-speech' (imam silent) and 'aborted' are transient: the
        // onend restart below retries them silently, and showing an
        // error for silence would be a false alarm — but the 3s
        // safety timer backstops a missing onend only once the wait
        // is cleared (during waiting it returns early; the waiting
        // path relies on onend + إيقاف). Previously
        // every other error was silently swallowed while the lobby
        // kept saying "listening" on a dead engine; unknown errors
        // now stop honestly with a re-tap prompt instead.
        if (e.error === 'no-speech' || e.error === 'aborted') {
          // N2: no-speech means the engine ran (granted) — the wait
          // ends. An aborted error before any audio start means the
          // decision is still pending — the wait stands (the session
          // continues via onend; a post-grant abort finds the wait
          // already cleared by onaudiostart, so this is a no-op there).
          if (e.error === 'no-speech' && followMicWaitingRef.current) setFollowMicWaitingState(false);
          armFollowTransientSafety();
        } else if (e.error === 'not-allowed') {
          stopLiveWithPrompt(micErrorMessage({ name: 'NotAllowedError' }));
        } else if (e.error === 'audio-capture') {
          stopLiveWithPrompt('الميكروفون مشغول بتطبيق تاني أو مش موجود — اقفله ثم اضغط «ابدأ الاستماع» من جديد');
        } else if (e.error === 'service-not-allowed') {
          // R3 (Claude reply 8): terminal service refusal, not a
          // pre-decision error — no wait exception, no retries.
          // The honest stop returns to the ready branch, where
          // the manual input this message points to IS visible.
          stopLiveWithPrompt('المتصفح منع خدمة الاستماع المباشر على الجهاز ده — جرّب الإدخال اليدوي بالأسفل، أو متصفح تاني');
        } else if (e.error === 'language-not-supported') {
          stopLiveWithPrompt('الاستماع المباشر مش بيدعم لغة الواجهة الحالية على الجهاز ده — جرّب الإدخال اليدوي بالأسفل');
        } else if (e.error === 'network') {
          // Transient: the engine auto-restarts from onend, so this
          // message must NOT tell the user to re-tap or to go back
          // to the start branch — it clears on the next good result.
          // R3: the safety timer does NOT cover a missing onend
          // while the wait is up (it returns early on the waiting
          // guard) — during waiting, a missing onend is covered
          // only by onend arriving (it usually does) plus the
          // always-visible إيقاف stop.
          // N2: the wait stands — a network error can fire before
          // the permission decision, and the session continues.
          setFollowError('الاستماع المباشر يحتاج اتصالاً بالإنترنت — بيحاول تاني لوحده');
          armFollowTransientSafety();
        } else {
          stopLiveWithPrompt('توقف الاستماع المباشر — اضغط «ابدأ الاستماع» من جديد');
        }
      };
      rec.onend = () => {
        // Programmatic restart (no gesture needed for recognition once
        // the mic is granted — unlike getUserMedia). Budgeted: past
        // LIVE_RESTART_MAX restarts in LIVE_RESTART_WINDOW_MS with no
        // speech, the mic is dead — stop honestly instead of looping.
        // A failed restart used to be swallowed by an empty catch
        // while the lobby still said "listening".
        // S4: a normal onend cancels the transient safety timer —
        // this IS the restart path the timer backstops.
        if (followTransientSafetyRef.current) { clearTimeout(followTransientSafetyRef.current); followTransientSafetyRef.current = null; }
        if (!followListeningRef.current || followAutoLockedRef.current) return;
        // E3 refined by P0-2 (Claude): the engine ended before ANY
        // result while the permission wait is still set. Two cases,
        // and only one may stop honestly:
        // - audiostart NEVER fired: the engine never ran (prompt
        //   undecided or a bare engine-side early end before capture).
        //   Do NOT auto-restart: a restart while permission is
        //   undecided would re-prompt (or re-queue a prompt) behind
        //   the user's back. Stop honestly; retry is one explicit tap.
        // - audiostart fired: the mic WAS granted and the engine ran,
        //   then ended with no result yet — the classic Safari
        //   silence auto-end while the imam is quiet. Killing the
        //   session here was a REGRESSION (follow would die in the
        //   middle of a prayer before the first word). Fall through
        //   to the budgeted restart below. (The wait itself was
        //   already cleared by onaudiostart when capture began, so
        //   the lobby shows normal listening through the restart —
        //   the wait is about permission, and permission is proven.)
        // Wording stays deliberately cause-neutral ("before any
        // result") rather than claiming a permission cause.
        if (followMicWaitingRef.current && !followAudioStartedRef.current) {
          // R3 (Claude-2): a SILENT pre-audiostart onend — Safari
          // sometimes ends the engine on its own before capture
          // (imam silent, engine blip). The old code honest-stopped
          // on the first such end, which could kill a session before
          // the first word. Allow at most 2 retries per tap; the
          // budget resets only on onaudiostart/onstart, first result,
          // or a fresh tap (see followPreAudioRetryRef) — never on a
          // retry itself — so a loop that never gets audiostart
          // exhausts and stops honestly instead of looping forever.
          // Tension documented, not hidden: E3's original rationale
          // for an immediate honest stop was that a restart while
          // permission is undecided could re-prompt behind the
          // user's back. The cap is the compromise: a restart on the
          // same engine attaches to a pending decision rather than
          // stacking prompts, and 2 retries bound any loop. Denials
          // never reach this branch: onerror stops honestly first
          // (listening false), so onend early-returns above.
          if (followPreAudioRetryRef.current < 2) {
            followPreAudioRetryRef.current += 1;
            // B4: the retry is VISIBLE in the lobby waiting line
            // (count + reason), so a device test can report whether
            // Safari silently ends sessions. The wait itself stays
            // set — only the note changes — and the setter clears
            // the note on the next wait-state change (grant, result,
            // stop, cancel), so it cannot strand.
            setFollowWaitRetryNote(`محاولة ${followPreAudioRetryRef.current}/2 بعد إنهاء صامت قبل الإذن`);
            try {
              rec.start();
            } catch {
              stopLiveWithPrompt('توقف الاستماع المباشر فجأة — اضغط «ابدأ الاستماع» من جديد');
            }
            return;
          }
          stopLiveWithPrompt('انتهى الاستماع قبل وصول أي نتيجة — اضغط «ابدأ الاستماع» من جديد');
          return;
        }
        const now = Date.now();
        if (now - liveRestartWindowRef.current > LIVE_RESTART_WINDOW_MS) {
          liveRestartWindowRef.current = now;
          liveRestartCountRef.current = 0;
        }
        liveRestartCountRef.current += 1;
        if (liveRestartCountRef.current > LIVE_RESTART_MAX) {
          stopLiveWithPrompt('توقف الاستماع المباشر — اضغط «ابدأ الاستماع» من جديد');
          return;
        }
        try {
          rec.start();
        } catch {
          stopLiveWithPrompt('توقف الاستماع المباشر فجأة — اضغط «ابدأ الاستماع» من جديد');
        }
      };
      recognitionRef.current = rec;
      let liveStarted = false;
      try {
        rec.start();
        liveStarted = true;
      } catch {
        // MERGED live→Whisper fallback, SYNCHRONOUS-throw branch ONLY:
        // rec.start() throwing happens inside the tap, so falling
        // through to the Whisper path below (whose getUserMedia is
        // still invoked in this same tap's synchronous prefix... in
        // practice the Whisper branch awaits nothing before its
        // getUserMedia call) keeps the gesture. Async live failures
        // (onerror, after the tap) do NOT fall through — an async
        // callback is outside the gesture, so a naive fallback risks
        // the same silent mic refusal iOS shows — they keep their
        // honest error above, and that gap is listed plainly in the
        // integration report as a known remaining gap.
        recognitionRef.current = null;
      }
      if (liveStarted) {
        // N4: rec.start() returned (the prompt may still be pending —
        // that gap is exactly what the heartbeat measures).
        followHeartbeatPush('rec.start-return');
        followListeningRef.current = true;
        followStartingRef.current = false;
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
          // R3-addendum (reviewer 2, hardening): this catch runs after an
          // await, so a stop + re-tap during a first-load index fetch
          // followed by the OLD load failing would otherwise clear the
          // NEW session's shared refs (recognitionRef, listening) and
          // leave it silently dead until the next re-tap. Guard every
          // session mutation with startGen (same pattern as the wait
          // clear below). Deliberate extension of the brief's 3-statement
          // scope (rec.stop/recognitionRef/listening): reviewer 1's
          // version also guards the ready/error sets, which are the same
          // clobber class — a stale catch must not flip a live session
          // to "ready" or paint a stale error on it. The guard cannot
          // change owning-session behavior (it passes exactly then).
          // The finally's index-loading reset is shared UI state and runs
          // regardless — cosmetic only, noted, not restructured.
          if (startGen === followStartGenRef.current) {
            try { rec.stop(); } catch {}
            recognitionRef.current = null;
            followListeningRef.current = false;
            followStartingRef.current = false;
            setFollowReady(true);
            setFollowError('تعذر تحميل فهرس الآيات — تأكد من الاتصال بالإنترنت');
          }
          // E3: an index failure after a granted-but-silent start is
          // terminal too — it must not strand the waiting display.
          // P0-2: generation-guarded — this catch runs after an await,
          // so a stop + re-tap during the load would otherwise clear
          // the NEW session's wait (the newer session owns it now).
          if (startGen === followStartGenRef.current) setFollowMicWaitingState(false);
        } finally {
          setFollowIndexLoading(false);
        }
        return;
      }
      // Live start threw synchronously: fall through to Whisper below
      // (same tap). The engine label is overwritten by the Whisper
      // branch; the starting guard stays set until Whisper resolves.
      // E3: the permission wait stays set across this fallthrough —
      // the Whisper getUserMedia prompt is now the pending decision,
      // and the lobby must keep saying "waiting", not flip to a ready
      // state that invites a second tap.
    }
    // Whisper path (Safari, and any browser without SpeechRecognition):
    // mic FIRST, inside the tap gesture.
    setFollowEngine('whisper');
    if (!window.MediaRecorder) {
      // E3 (UI state only): no prompt will ever appear — end the wait.
      setFollowMicWaitingState(false);
      followStartingRef.current = false;
      setFollowError('هذا المتصفح لا يدعم التسجيل — اكتب الكلمات يدوياً بالأسفل');
      setFollowReady(true);
      return;
    }
    // No mediaDevices at all (old browser, or the page opened inside
    // an app webview that withholds the mic): getUserMedia would throw
    // a TypeError, which the old generic catch misreported as a
    // permission refusal. Say what is actually missing instead.
    if (!navigator.mediaDevices?.getUserMedia) {
      // E3 (UI state only): no prompt will ever appear — end the wait.
      setFollowMicWaitingState(false);
      followStartingRef.current = false;
      setFollowError('الجهاز/المتصفح ده مش بيسمح بالوصول للميكروفون من هنا — افتح الرابط في المتصفح نفسه، أو اكتب الكلمات يدوياً بالأسفل');
      setFollowReady(true);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      // E3 (UI state only): getUserMedia denied — decision made, the
      // existing honest denied wording below is the terminal state.
      // P0-2: generation-guarded — a stop + re-tap during the prompt
      // must not let this stale denial clear the new session's wait.
      // Next-patch: the starting/error/ready assignments are the same
      // clobber class as the wait clear, so they share its guard — a
      // stale denial must not paint a false "denied" message on a
      // fresh session or flip it back to ready.
      if (startGen === followStartGenRef.current) {
        setFollowMicWaitingState(false);
        followStartingRef.current = false;
        setFollowError(micErrorMessage(err));
        setFollowReady(true);
      }
      return;
    }
    followStreamRef.current = stream;
    if (!followActiveRef.current || startGen !== followStartGenRef.current) {
      // Stopped (or superseded by a newer start) while the permission
      // prompt was up: never resurrect listening from this stale
      // grant. Only null the ref if it still points at this stream,
      // so a newer session's stream is never touched.
      stream.getTracks().forEach((t) => t.stop());
      if (followStreamRef.current === stream) followStreamRef.current = null;
      // E3 (UI state only): stale grant — never resurrects listening.
      // P0-2: the wait is NOT cleared here on purpose — the guard is
      // false by construction on this branch (a newer session exists
      // or the session ended), and the newer session owns the wait
      // display now; clearing it would strand the new prompt unlabeled.
      // Next-patch: the starting guard shares that guard for the same
      // reason — a stale grant must not clear a fresh session's
      // starting guard.
      if (startGen === followStartGenRef.current) {
        setFollowMicWaitingState(false);
        followStartingRef.current = false;
      }
      return;
    }
    // R3: Whisper resolution milestone (the live path has
    // rec.start-return) — owning path only: the stale branch
    // above already returned.
    followHeartbeatPush('gum-resolved');
    const uid = session?.user?.id;
    if (!uid) {
      stream.getTracks().forEach((t) => t.stop());
      followStreamRef.current = null;
      // E3 (UI state only): terminal without listening — end the wait.
      setFollowMicWaitingState(false);
      followStartingRef.current = false;
      setFollowError('الاستماع عبر الخادم يحتاج تسجيل دخول — أو اكتب الكلمات يدوياً بالأسفل');
      return;
    }
    // E3 (UI state only): getUserMedia resolved — the mic decision is
    // made (granted). Listening starts below; the wait is over even
    // though the verse index still has to load.
    setFollowMicWaitingState(false);
    followListeningRef.current = true;
    followStartingRef.current = false;
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
      // R3-addendum (reviewer 2, hardening): same stale-catch shape
      // as the live branch — a stop + re-tap during the index fetch
      // followed by the OLD load failing must not clear the NEW
      // session's listening/stream/ready/error state. Guard every
      // session mutation with startGen; a stale failure is silent
      // (the new session owns the display now). Same deliberate
      // extension as the live catch (ready/error/index-loading are
      // the same clobber class; the guard cannot change
      // owning-session behavior).
      if (startGen === followStartGenRef.current) {
        followListeningRef.current = false;
        stream.getTracks().forEach((t) => t.stop());
        followStreamRef.current = null;
        setFollowReady(true);
        setFollowError('تعذر تحميل فهرس الآيات — تأكد من الاتصال بالإنترنت');
      }
      // N5 (Claude reply 7): the loading line is shared UI state
      // (same reasoning as the live branch's unguarded finally) —
      // cleared unconditionally, outside the guard, so a stale
      // failure cannot strand "جارٍ تحميل فهرس الآيات…" until the
      // next tap. Session state above stays guarded; only the line
      // clears here, so a new session's mid-load line may vanish
      // early (transient, cosmetic — same accepted tradeoff as
      // the live branch). Previously this call was duplicated in
      // both branches; hoisting it is behavior-identical.
      setFollowIndexLoading(false);
      // E3 (UI state only): terminal index failure — end the wait.
      // P0-2: generation-guarded (post-await catch; see live branch).
      if (startGen === followStartGenRef.current) setFollowMicWaitingState(false);
      return;
    }
    setFollowIndexLoading(false);
    if (!followListeningRef.current || startGen !== followStartGenRef.current) {
      // Stopped (or superseded by a newer start) while the index was
      // loading: never start a stale loop next to the new session.
      // Only null the ref if it still points at this stream.
      stream.getTracks().forEach((t) => t.stop());
      if (followStreamRef.current === stream) followStreamRef.current = null;
      return;
    }
    void runWhisperLoop();
  }, [runWhisperLoop, ensureWakeLockTracking, session, setFollowMicWaitingState]);

  // Manual ابحث (merged decision 5): typed input is NOT governed by
  // the 5-word trigger gate (it is not an engine transcript), and it
  // keeps its own match rule (min(4, words.length)). But it locks
  // through the SAME single callback as auto locks — no separate
  // tracked-lock path: the manual lock also opens fullscreen
  // highlighted via handleFollowAutoLock, stops any listening, and
  // keeps the wake lock held. The button already calls enterFollowMode
  // first (fresh latch, wake lock acquired), so the callback's latch
  // check passes and its jump generation is fresh.
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
    handleFollowAutoLock(lock);
  }, [followManual, handleFollowAutoLock]);

  // S4 wrong-lock escape ("wrong page? keep listening"): the merged
  // spec deleted the pre-lock confirmation card, so a misfire's only
  // exits were إيقاف / X + a fresh start. This post-lock button is
  // NOT a confirmation step — the lock already happened, with the
  // same trigger/lock/interim constants untouched — it just makes
  // the fresh start one tap: release the latch + highlight, then
  // re-enter listening from this tap (gesture intact for mic +
  // wake lock). A uniqueness gate on finals locks was considered
  // and rejected: repeated ayahs (identical text) could never lock
  // under it, which would be a worse prayer failure than a
  // one-tap escape from a rare misfire.
  const resumeFollowAfterWrongLock = useCallback(() => {
    setSearchHighlight(null);
    enterFollowMode();
    void startFollowListening();
  }, [enterFollowMode, startFollowListening]);

  // MERGED deletions (exit + auto-stop roles): resyncFollow (the old
  // "re-lock after lost" control), confirmFollowLock and
  // rejectFollowLock (the old "لقيتها!" OK / "مش دي" card) are DELETED,
  // not kept. In the merged spec there is no confirmation to confirm
  // or reject, and no 'lost' state to resync out of: tracking stops on
  // lock. A wrong lock is escaped via the post-lock "مش دي؟
  // كمّل الاستماع" button (one-tap fresh start) or via إيقاف / X +
  // a fresh ابدأ الاستماع tap — those are the ways out, by design.
  // (confirmFollowLock / rejectFollowLock deleted — see note above.)

  // Dedicated follow route (#/follow): opening it starts follow mode
  // at once, and re-opens fullscreen if a live session is already
  // running (so returning mid-prayer never loses the lock and never
  // strands a live mic with no UI). No flag, no event, no stale state
  // from older sessions — the route itself is the entry point. A fresh
  // entry ALWAYS goes through enterFollowMode (clean lobby; listening
  // only after a fresh ابدأ الاستماع tap) — it never resumes a dead
  // lock, because every exit below stops the session first.
  useEffect(() => {
    if (!startInFollow) return;
    if (!followActiveRef.current) enterFollowMode();
    // Re-entry is not a gesture, so a native request here may be
    // refused silently (fire-and-forget) — the app overlay still opens.
    else { setShowFullscreen(true); requestNativeFullscreen(); }
    // Only when the route switches to follow; enterFollowMode is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startInFollow]);

  // Route-exit effect (exit role — the core fix for the no-unmount
  // leave): switching between #/mushaf and #/follow does NOT unmount
  // this page (one App branch), so the unmount cleanup below cannot
  // catch it — and before this effect, leaving #/follow for #/mushaf
  // mid-listening left the session alive as a hidden mic + wake lock,
  // and re-entering #/follow then resumed the dead session's
  // fullscreen instead of a clean lobby. Now leaving #/follow ends the
  // session outright (mid-listening or post-lock alike). The gate
  // covers both states: a still-active session (followActiveRef) and a
  // locked-highlight session (followOn with followPos — though the
  // merged lock callback sets followOn false, the gate stays as a
  // safety net). What persists is ordinary Mushaf memory (last page /
  // edition storage), not follow state.
  const prevStartInFollowRef = useRef(startInFollow);
  useEffect(() => {
    const wasFollow = prevStartInFollowRef.current;
    prevStartInFollowRef.current = startInFollow;
    if (wasFollow && !startInFollow && (followActiveRef.current || followOn)) {
      stopFollow();
    }
  }, [startInFollow, followOn, stopFollow]);

  // Leaving the Mushaf/Follow routes unmounts this page, and a live
  // follow session must die with it: without this, leaving via the
  // bottom nav (not the X button, which stops cleanly) left the mic
  // listening, the Whisper loop recording, and the wake lock held —
  // and the leaked visibility listener re-acquired the lock on every
  // tab-show. The cleanup also exits native fullscreen (an SPA
  // navigation alone does NOT drop it — the element is
  // documentElement, which survives the route change), so leaving for
  // another tab cannot strand لوحتي / الرئيسية in native fullscreen.
  useEffect(() => () => {
    teardownFollowResources();
    // S4: a playing link voice must die with the page, not orphan.
    stopLinkAudio();
    try {
      const d = document as any;
      if (d.fullscreenElement || d.webkitFullscreenElement) {
        const p = d.exitFullscreen?.() || d.webkitExitFullscreen?.();
        (p as any)?.catch?.(() => {});
      }
    } catch {}
  }, [teardownFollowResources]);

  // S6: Escape closes the topmost overlay only — never follow state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectedVerse) { setSelectedVerse(null); return; }
      if (showEditionPickerInFullscreen) { setShowEditionPickerInFullscreen(false); return; }
      if (showEditionPicker) { setShowEditionPicker(false); return; }
      if (showIndex) { setShowIndex(false); return; }
      if (showRatelIntro) { setShowRatelIntro(false); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedVerse, showEditionPickerInFullscreen, showEditionPicker, showIndex, showRatelIntro]);

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
  // Edge-to-edge cover (2026-10-27 audit, revised after the user's
  // iPad video): on portrait screens the Madinah page uses the
  // adaptive cover norm with a full-viewport wrapper, so the paper
  // fills the screen with no visible margin at any aspect — the old
  // 0.75 gate disabled cover exactly in Safari-with-chrome states
  // (aspect 0.78-0.85), which is the black bar in the video. The
  // adaptive norm caps image height per page so the frame band
  // never crops (paper narrows at high aspects instead). On wider
  // screens (true landscape, aspect > 0.90) the fit+center norm stays.
  const useMadinahCover = edition.id === 'madinah' && !!madinahPaperBox && viewportAspect <= MADINAH_COVER_MAX_ASPECT;
  const madinahNorm = useMadinahCover
    ? coverNormForPaperBox(madinahPaperBox, viewportAspect, madinahFrameBand(currentPage))
    : normForPaperBox(madinahPaperBox);
  // Fullscreen render norm (SHAKE FIX 2026-10-28): when the displayed
  // image lags the requested page, the image AND its geometry must
  // follow the displayed page together — otherwise the old image would
  // sit at the new page's (parity-flipped) position during the lag.
  const fullscreenNorm = useMadinahCover && displayedPage !== currentPage
    ? coverNormForPaperBox(MADINAH_PAPER_BOXES[displayedPage - 1], viewportAspect, madinahFrameBand(displayedPage))
    : madinahNorm;
  // Book-slide animation for the fullscreen flip (RTL: next page
  // slides in from the left, previous from the right). The image
  // remounts per displayedPage, so the animation runs fresh on every
  // turn; taps during the 300ms still map correctly because
  // getBoundingClientRect follows the transform.
  const slideAnim = turnDir === 1 ? 'mushaf-slide-next 300ms ease-out' : 'mushaf-slide-prev 300ms ease-out';
  // Main paper's top edge in viewport-height % (cover mode only), used
  // to vertically align the facing sliver with the main page.
  const coverMainPaperTop = useMadinahCover && madinahNorm
    ? madinahNorm.imgT + (madinahNorm.pt * madinahNorm.imgH) / 100 : 0;
  // Same normalization for the FACING page (the peek sliver): the old
  // sliver rendered the facing image unnormalized at 115vh, so its
  // paper jumped against the pinned main page on every turn. The
  // sliver below pins the facing page's SPINE edge (its paper edge,
  // not the raw image edge) at the window's edge, at the main page's
  // scale and vertical alignment, so the peek stays stable too.
  const facingNorm = edition.id === 'madinah' && hasFacingPage
    ? (useMadinahCover
      ? coverNormForPaperBox(MADINAH_PAPER_BOXES[facingPage - 1], viewportAspect, madinahFrameBand(facingPage))
      : normForPaperBox(MADINAH_PAPER_BOXES[facingPage - 1]))
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
  // HIGHLIGHT CLAMP (2026-10-27, user screenshot p.42): the qurancoor
  // dataset's edge word boxes overshoot the paper by up to ~6 image-%
  // (rightmost words of a line), so an unclamped highlight spilled
  // into the white scan margin past the green frame. Clamping to the
  // measured paper box trims only that overshoot — it never moves a
  // box, never changes tap calibration, and never hides an interior
  // word (interior boxes are already inside the paper).
  const clampBoxToPaper = (b: WordBox): WordBox => {
    if (!madinahPaperBox) return b;
    const [pl, pt, pr, pb] = madinahPaperBox;
    const left = Math.max(b.left, pl);
    const top = Math.max(b.top, pt);
    const right = Math.min(b.left + b.width, pr);
    const bottom = Math.min(b.top + b.height, pb);
    if (right <= left || bottom <= top) return { ...b, width: 0, height: 0 };
    return { ...b, left, top, width: right - left, height: bottom - top };
  };

  // STREAM S2 slide-consistent tap math: during the 300ms slide the
  // image is translated (mushaf-slide-next/prev on the IMG), but the
  // wrapper rect never moves — so the old code mapped taps through
  // the FINAL geometry while the image was still mid-slide, opening
  // the wrong ayah. The visual image left edge during the slide is
  // imgL - dir*(1-progress)*imgW (next slides in from the left, prev
  // from the right), so the tap's wrapper-% is shifted back by that
  // offset before the normal container->image mapping. After 300ms
  // the offset is exactly 0 and the math is unchanged. No paper-box
  // value is touched: this only corrects for the animation.
  const slideOffsetPercent = (): number => {
    const s = slideStartRef.current;
    if (!s) return 0;
    const elapsed = Date.now() - s.at;
    if (elapsed >= 300) return 0;
    const imgW = fullscreenNorm ? fullscreenNorm.imgW : 100;
    return -s.dir * (1 - elapsed / 300) * imgW;
  };
  // Client coords -> full-image % through the geometry actually shown
  // (slide-adjusted, then the normal normalization mapping).
  const toImagePercent = (clientX: number, clientY: number, rect: DOMRect): [number, number] => {
    const fx = ((clientX - rect.left) / rect.width) * 100 - slideOffsetPercent();
    const fy = ((clientY - rect.top) / rect.height) * 100;
    return containerToImagePercent(fx, fy);
  };

  const handleWordTap = async (clientX: number, clientY: number) => {
    const wrap = pageWrapRef.current;
    const boxes = pageWordBoxes;
    if (!wrap || !boxes) return;
    const rect = wrap.getBoundingClientRect();
    const [px, py] = toImagePercent(clientX, clientY, rect);
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

  // S4: orphan link audio is gone — playLinkAudio (recitation block
  // above) owns the single element and stops it on popup close,
  // ayah change, and recitation start. This alias is kept only so
  // the two link buttons below read the same.

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-100 via-amber-50/30 to-white pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-gradient-to-r from-amber-50 to-stone-50/95 backdrop-blur-md border-b border-amber-200 shadow-sm">
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-amber-700 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-accent-800">المصحف الشريف</h1>
              <p className="text-xs text-accent-600">اقرأ واحفظ وراجع — اضغط على أي آية لمعرفة الرابط</p>
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

      <div className="max-w-6xl xl:max-w-7xl mx-auto px-4 py-6">
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
              <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} aria-label="الصفحة السابقة"
                className="icon-action p-2 text-accent-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 transition-smooth">
                <ChevronRight className="w-6 h-6" />
              </button>
              <div className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-200">
                <input type="number" value={pageInput || currentPage}
                  onChange={(e) => setPageInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { const n = parseInt(pageInput); if (!isNaN(n)) goToPage(n); setPageInput(''); } }}
                  className="w-16 text-center text-base font-semibold text-accent-700 bg-transparent focus:outline-none"
                  placeholder={formatAr(currentPage)} />
                <span className="text-sm text-accent-600">/ {formatAr(TOTAL_PAGES)}</span>
              </div>
              <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= TOTAL_PAGES} aria-label="الصفحة التالية"
                className="icon-action p-2 text-accent-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 transition-smooth">
                <ChevronLeft className="w-6 h-6" />
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} title="تصغير الصفحة" aria-label="تصغير الصفحة"
                className="icon-action p-2 text-accent-600 hover:bg-gray-100 rounded-lg transition-smooth"><ZoomOut className="w-5 h-5" /></button>
              <span className="text-sm text-accent-600 w-14 text-center font-semibold">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))} title="تكبير الصفحة" aria-label="تكبير الصفحة"
                className="icon-action p-2 text-accent-600 hover:bg-gray-100 rounded-lg transition-smooth"><ZoomIn className="w-5 h-5" /></button>
              <button onClick={openFullscreen} title="ملء الشاشة" aria-label="ملء الشاشة"
                className="icon-action p-2 text-accent-600 hover:bg-amber-100 rounded-lg transition-smooth"><Maximize2 className="w-5 h-5" /></button>
              <button onClick={toggleGoldFrame} title="إطار ذهبي حول الصفحة"
                className={`px-2.5 py-2 text-sm font-bold rounded-lg transition-smooth ${goldFrame ? 'bg-amber-200 text-amber-800 ring-1 ring-amber-400' : 'text-accent-600 hover:bg-amber-100'}`}>
                إطار ذهبي
              </button>
              {!showFullscreen && <WorshipTimer />}
            </div>
          </div>
        </div>

        {followOn && !showFullscreen && (
          <div className="flex items-center justify-center gap-3 flex-wrap bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2.5 mb-6">
            <span className="flex items-center gap-2 text-sm font-bold text-emerald-800">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              الحق الإمام شغال
            </span>
            <button onClick={() => { setShowFullscreen(true); requestNativeFullscreen(); }}
              className="px-3 py-1.5 text-sm font-bold text-emerald-700 bg-white border border-emerald-300 rounded-lg">
              العودة للمتابعة
            </button>
            <button onClick={stopFollow}
              className="px-3 py-1.5 text-sm font-bold text-white bg-emerald-700 rounded-lg">
              إيقاف
            </button>
          </div>
        )}

        {/* Non-Madinah warning: word taps, ayah highlights inside the
            page image, and Madinah paper geometry are built on the
            Madinah word-box dataset — on any other edition they
            silently do nothing today. Warn here (and in fullscreen
            below, and in the edition picker) instead of silence. */}
        {edition.id !== 'madinah' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-4 text-sm font-bold text-amber-800 leading-relaxed">
            تنبيه: في {edition.name}، الضغط على كلمات الصفحة والتمييز الدقيق داخل الصورة غير متاح — المزايا دي مبنية على صفحات مصحف المدينة فقط. القراءة وآيات السورة والروابط تحت شغالة عادي.
          </div>
        )}

        <div className="grid grid-cols-1 gap-6">
          {/* Mushaf page image — full width: the page is the reading
              surface, so it must fill the screen instead of sitting
              beside the list (the list now follows below the page). */}
          <div className="flex flex-col items-center">
            {/* STREAM S2 zoom-with-pan: at zoom > 1 the image is sized
                by layout width (not a cropped transform) inside a
                scrollable card, so every edge stays reachable by
                scrolling; at zoom <= 1 the old transform path is
                untouched. goToPage also resets zoom (above). */}
            <div className={`relative bg-gradient-to-br from-stone-50 to-white rounded-2xl shadow-xl border-2 border-amber-200 p-3 sm:p-6 max-w-full ${zoom > 1 ? 'overflow-auto max-h-[85dvh]' : 'overflow-hidden'}`}>
              {imageLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-amber-50/80 z-10">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
                    <p className="text-sm text-accent-600">جارٍ تحميل الصفحة...</p>
                  </div>
                </div>
              )}
              {imageError ? (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                  <BookOpen className="w-14 h-14 text-amber-300 mb-3" />
                  <p className="text-base font-semibold text-accent-600 mb-1">تعذر تحميل الصفحة</p>
                  {edition.id === 'hafs' && currentPage === HAFS_UNAVAILABLE_PAGE ? (
                    <p className="text-sm text-amber-700 mb-3 leading-relaxed">صفحة {HAFS_UNAVAILABLE_PAGE} من مصحف حفص غير متاحة حاليًا — الخادم يرفضها (خطأ ٤٠٣) ولا بديل لها حتى الآن. جرّب مصحف المدينة لقراءة الصفحة دي.</p>
                  ) : (
                    <p className="text-sm text-accent-600 mb-3">قد يكون الخادم غير متاح حالياً</p>
                  )}
                  <button onClick={() => { setImageError(false); setImageLoading(true); }}
                    className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white text-sm font-semibold rounded-lg transition-smooth">
                    إعادة المحاولة
                  </button>
                </div>
              ) : (
                <RetryPageImg key={`${edition.id}-${currentPage}`} src={edition.imageUrl(currentPage)}
                  alt={`صفحة ${currentPage} — ${edition.name}`}
                  onLoad={() => setImageLoading(false)}
                  onFinalError={() => { setImageError(true); setImageLoading(false); }}
                  className="max-w-full h-auto rounded-lg shadow-md transition-transform duration-300 origin-top [-webkit-touch-callout:none]"
                  style={zoom > 1
                    ? { width: `${zoom * 100}%`, maxWidth: 'none', height: 'auto' }
                    : { transform: `scale(${zoom})` }} loading="eager" />
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

          {/* Verses list with tap-to-show-links — below the page now,
              so the page itself fills the screen width. */}
          <div>
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden sticky top-24">
              <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-emerald-50 to-teal-50">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-emerald-700" />
                  </div>
                  <div>
                    <h3 className="font-bold text-accent-800 text-base">آيات سورة {currentSurahName}</h3>
                    <p className="text-sm text-accent-600">اضغط على أي آية لمعرفة الرابط</p>
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
                      className="px-3 py-2 text-sm font-semibold text-accent-600 hover:bg-white rounded-lg">
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
                          <span className="text-sm text-accent-600">آية {verse.ayah_no}</span>
                          {hasLinks && (
                            <span className="flex items-center gap-1 text-sm text-emerald-700 font-semibold bg-emerald-100 px-2 py-0.5 rounded-full">
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
                                    {/* One voice button, resolved by the
                                        2026-10-28 policy: male users always
                                        hear the generated male voice,
                                        female users hear the original or
                                        the generated female voice. */}
                                    {(() => {
                                      const ra = resolveLinkAudio(link, linkGender);
                                      if (!ra) return null;
                                      return (
                                        <div className="flex gap-2 mt-2">
                                          <button onClick={(e) => { e.stopPropagation(); playLinkAudio(ra.url); }}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-lg">
                                            <Volume2 className="w-4 h-4" /> {ra.label}
                                          </button>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center py-4 bg-gray-50 rounded-lg">
                                <p className="text-base text-accent-400">لا توجد روابط لهذه الآية بعد</p>
                              </div>
                            )}
                            {linkAudioError && <p className="text-sm text-red-600 font-semibold mt-2">{linkAudioError}</p>}
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
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto"
          onClick={() => setShowIndex(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col animate-slide-up"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-accent-800">فهرس المصحف</h3>
              <button onClick={() => setShowIndex(false)} aria-label="إغلاق" className="icon-action p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
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
                      <span className="text-xs text-accent-600">{s.no}.</span>{s.name}
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
                      <span className="text-xs text-accent-600">صفحة {j.startPage}</span>
                    </button>
                  ))}
                </div>
              )}
              {indexTab === 'hizb' && (
                <div className="grid grid-cols-2 gap-2">
                  {HIZB_START_PAGES.map((h) => (
                    <button key={h.number} onClick={() => { goToPage(h.startPage); setShowIndex(false); }}
                      className={`flex items-center gap-2 p-2.5 rounded-lg text-sm font-semibold transition-smooth ${currentHizb.number === h.number ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'hover:bg-gray-50 text-accent-600 border border-transparent'}`}>
                      <span className="text-xs text-accent-600">الحزب {h.number}</span>
                      <span className="text-xs text-accent-600">جزء {h.juz}</span>
                      <span className="text-xs text-accent-600 mr-auto">ص {h.startPage}</span>
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
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto"
          onClick={() => setShowEditionPicker(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slide-up"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-accent-800">اختر طبعة المصحف</h3>
              <button onClick={() => setShowEditionPicker(false)} aria-label="إغلاق" className="icon-action p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-2">
              {EDITIONS.map((ed, idx) => (
                <button key={ed.id} onClick={() => { setSelectedEdition(idx); setShowEditionPicker(false); setImageLoading(true); setImageError(false); }}
                  className={`w-full text-right p-3 rounded-xl border-2 transition-smooth ${selectedEdition === idx ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-200 hover:bg-amber-50/30'}`}>
                  <p className="font-bold text-accent-800 text-base">{ed.name}</p>
                  <p className="text-sm text-accent-600 mt-0.5">{ed.description}</p>
                  {ed.id !== 'madinah' && (
                    <p className="text-xs text-amber-700 mt-1">تنبيه: الضغط على الكلمات والتمييز داخل الصورة غير متاح في هذه الطبعة (مصحف المدينة فقط).</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen viewer with intro */}
      {showFullscreen && (
        <div className={`fixed inset-0 z-[100] ${useMadinahCover ? 'bg-white' : 'bg-[#f8f1de]'} flex ${useMadinahCover ? 'items-start' : 'items-center'} justify-center select-none overflow-hidden overscroll-contain`}
          onClick={() => {
            // In clean mode, taps on the black bands restore controls.
            if (cleanMode) { setCleanMode(false); return; }
            // While following the imam, a band tap must not drop the
            // fullscreen view (the phone is held through a long prayer);
            // the X button and the follow bar's stop button still exit.
            if (!showRatelIntro && !showEditionPickerInFullscreen && !selectedVerse && !followOn) exitFullscreenView();
          }}>

          {showRatelIntro && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-br from-emerald-900 via-teal-900 to-emerald-950 transition-opacity duration-1000 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); setShowRatelIntro(false); }}>
              <div className="absolute inset-0 opacity-10">
                <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-emerald-400 rounded-full blur-3xl animate-pulse-soft" />
                <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-teal-400 rounded-full blur-3xl animate-pulse-soft" />
              </div>
              <div className="relative flex flex-col items-center animate-slide-up">
                <img src="/icon-512.png" alt="روابط الذكر الحكيم" className="w-40 h-40 sm:w-48 sm:h-48 object-contain rounded-3xl shadow-2xl mb-8" />
                <h2 className="text-4xl sm:text-5xl font-bold text-white mb-3 leading-relaxed text-center max-w-3xl px-6" style={{ fontFamily: '"Noto Naskh Arabic", "Amiri", serif' }}>
                  اقرأ وارتق، ورتل
                </h2>
                <p className="text-xl sm:text-2xl text-white/90 leading-relaxed text-center max-w-3xl px-6" style={{ fontFamily: '"Noto Naskh Arabic", "Amiri", serif' }}>
                  كما كنت ترتل في الدنيا، فإن منزلتك عند آخر آية تقرؤها
                </p>
                <p className="text-sm text-white/70 mt-8 font-semibold">اضغط للتخطي ⏭</p>

              </div>
            </div>
          )}

          {/* Follow lobby (merged entry role): follow mode's own
              fullscreen page, ONE required tap. Entering #/follow shows
              only this lobby; the mic never starts on route entry (iOS
              Safari requires the tap gesture). The start button and the
              manual fallback live here (not on the normal Mushaf page).
              Hides once the imam locks onto an ayah (followPos set). On
              the dedicated follow route it also shows after a stop, so
              the user can always start again from here. Stop returns to
              this lobby; one tap restarts. */}
          {(followOn || startInFollow) && !followPos && !showRatelIntro && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6" onClick={(e) => e.stopPropagation()}>
              <div className="w-full max-w-md bg-emerald-900 rounded-2xl p-5 shadow-2xl text-white">
                <p className="font-bold flex items-center gap-2 text-lg"><Mic className="w-6 h-6 text-amber-300" /> الحق الإمام</p>
                <p className="text-sm text-emerald-100 leading-relaxed mt-2">
                  اضغط بدء الاستماع، وقرّب الجهاز منك. أول ما يلقط الإمام ٥ كلمات، المصحف هيفتح لوحده على الصفحة ويظلّل الآية — من غير ما تدوس حاجة تانية. هيطلب إذن الميكروفون أول مرة — اسمح له عشان يشتغل.
                </p>
                {followReady ? (
                  <>
                    {/* The start button also (re-)enters follow mode:
                        after a stop, followOn is false, and the engine
                        alone would track without showing any highlight
                        or status bar. Entering first is harmless on a
                        fresh entry (it only resets an empty state). */}
                    <button onClick={() => { enterFollowMode(); startFollowListening(); }}
                      disabled={followIndexLoading || followMicWaiting}
                      className="mt-4 w-full py-3.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white text-base font-bold rounded-xl transition-smooth flex items-center justify-center gap-2">
                      <Mic className="w-5 h-5" /> ابدأ الاستماع للإمام
                    </button>
                    <button onClick={() => { enterFollowMode(); startFollowListening(true); }}
                      disabled={followIndexLoading || followMicWaiting}
                      className="mt-2 w-full py-2.5 bg-white/15 hover:bg-white/25 disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-smooth flex items-center justify-center gap-2">
                      <Mic className="w-4 h-4" /> التسجيل عبر الخادم (Whisper) — لو الاستماع المباشر مش شغال
                    </button>
                    {followIndexLoading && <p className="text-xs text-amber-200 mt-2">جارٍ تحميل فهرس الآيات…</p>}
                    {/* B1: the cancel button lives here, in the ready
                        branch, because the Whisper permission wait
                        renders here (followReady stays true until
                        getUserMedia returns). The live wait does NOT
                        render here: startFollowListening sets
                        followReady=false as soon as rec.start()
                        succeeds, so the live wait shows in the
                        listening branch, whose exit is the
                        pre-existing إيقاف button (stopFollow, full
                        cleanup). This button covers the Whisper wait
                        only. The
                        button stays ENABLED during waiting (no
                        disabled prop): tapping it stops the engines,
                        clears the wait (ref + state) and returns the
                        lobby to idle, so a fresh tap works. The start
                        buttons above stay disabled meanwhile so a tap
                        cannot silently stack a second attempt. */}
                    {followMicWaiting && <p className="text-xs text-amber-200 mt-2">بانتظار إذن الميكروفون من المتصفح… (مرّ {followMicWaitElapsed} ثانية){followMicWaitElapsed >= 8 ? ' — لو اتأخرت، اضغط إلغاء الانتظار وجرّب من جديد' : ''}</p>}
                    {followMicWaiting && (
                      <button onClick={cancelFollowMicWait}
                        className="mt-2 w-full py-2.5 bg-white/15 hover:bg-white/25 text-white text-sm font-bold rounded-xl transition-smooth flex items-center justify-center gap-2">
                        إلغاء الانتظار — رجوع للبداية من غير إعادة تحميل
                      </button>
                    )}
                    <p className="text-xs text-emerald-200 mt-4">لو الميكروفون مش شغال — بديل يدوي (اختياري):</p>
                    <div className="flex gap-2 mt-2">
                      <input value={followManual} onChange={(e) => setFollowManual(e.target.value)}
                        placeholder="اكتب كلمات سمعتها من الإمام..."
                        className="flex-1 px-3 py-2.5 rounded-xl text-sm text-accent-800 bg-white/95 border border-emerald-200 focus:outline-none" />
                      <button onClick={() => { enterFollowMode(); manualFollowLock(); }}
                        disabled={followIndexLoading}
                        className="px-4 py-2.5 bg-white/15 hover:bg-white/25 disabled:opacity-60 text-white text-sm font-bold rounded-xl">ابحث</button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* E3: while permission is undecided the header must
                        NOT claim "listening" — that mislabel is what made
                        a queued Safari prompt look like a frozen app. */}
                    <p className="text-sm font-bold mt-4">{followMicWaiting ? 'بانتظار إذن الميكروفون…' : 'جارٍ الاستماع للإمام...'}</p>
                    {followMicWaiting && <p className="text-xs text-amber-200 mt-2">لسه الالتقاط ما بدأش (مرّ {followMicWaitElapsed} ثانية){followWaitRetryNote ? ` • ${followWaitRetryNote}` : ''}{followMicWaitElapsed >= 8 ? ' — لو اتأخرت، اضغط إيقاف ثم ابدأ الاستماع من جديد' : ''}</p>}
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
                      <button onClick={stopFollow}
                        className="flex-1 py-2.5 bg-white/10 hover:bg-white/20 text-sm font-bold rounded-xl transition-smooth flex items-center justify-center gap-1.5">
                        <Square className="w-4 h-4" /> إيقاف
                      </button>
                    </div>
                  </>
                )}
                {/* N4 heartbeat diagnostic (R3): while waiting it
                    refreshes every second via the existing ticker
                    re-render; after the wait ends the summary
                    persists until the next tap (which resets it).
                    If the main thread blocks, the tick count
                    freezes — that frozen number IS the evidence
                    (alive = advancing). rAF stops in background,
                    so visibilityState disambiguates a background
                    freeze from a blocked thread. */}
                {(followMicWaiting || followHeartbeatEventsRef.current.length > 0) && (
                  <p className="text-xs text-emerald-200/70 mt-2">
                    تشخيص النبض: {followHeartbeatTicksRef.current} إطار · {document.visibilityState}
                    {followHeartbeatEventsRef.current.length > 0 ? ` — ${followHeartbeatEventsRef.current.map((ev) => ev.event + ' +' + (ev.at - followHeartbeatEventsRef.current[0].at) + 'ms').join(' → ')}` : ''}
                  </p>
                )}
                {followError && <p className="text-xs text-red-300 mt-2">{followError}</p>}
              </div>
            </div>
          )}

          {/* MERGED: the old "لقيتها!" confirmation card (OK / "مش دي")
              is DELETED and must not be re-added. A lock now opens the
              page fullscreen with the ayah highlighted by itself, with
              no tap after ابدأ الاستماع. The post-lock "مش دي؟
              كمّل الاستماع" pill is not a confirmation card — it only
              escapes an already-made lock with a one-tap restart. */}

          {!showRatelIntro && !cleanMode && (
            <button onClick={(e) => { e.stopPropagation(); if (startInFollow) { stopFollow(); exitFullscreenView(); onNavigate('app'); } else { exitFullscreenView(); } }}
              title="إغلاق" aria-label="إغلاق"
              className="absolute top-[calc(1rem_+_env(safe-area-inset-top))] right-4 p-2.5 bg-black/60 hover:bg-black/75 text-white rounded-lg z-30 transition-smooth ring-1 ring-white/40 shadow-lg">
              <X className="w-7 h-7" />
            </button>
          )}

          {/* MERGED top bar (STREAM S2): the worship timer and the
              Juz/Hizb/Surah chips used to share one absolute
              top-center anchor in TWO separate divs and pile up on
              narrow phones. They are now ONE wrapping row, centred,
              with side padding kept clear of the corner buttons, so
              on a narrow phone they wrap to a second line instead of
              overlapping. The page number joins the same row. Labels
              follow displayedPage during lag (see labelPage). In
              clean mode only the timer shows (no chips to pile up);
              the page pill below stays visible there. The bar never
              blocks taps (pointer-events-none). Hidden only during
              the intro splash. Safe-area top (S6) so the notch never
              covers it. */}
          {!showRatelIntro && cleanMode && (
            <div className="absolute top-[calc(1rem_+_env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-30 pointer-events-none">
              <WorshipTimer dark />
            </div>
          )}
          {!showRatelIntro && !cleanMode && (
            <div className="absolute top-[calc(1rem_+_env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-30 pointer-events-none flex flex-wrap items-center justify-center gap-2 max-w-[calc(100vw-8.5rem)]">
              <WorshipTimer dark />
              <span className="px-2.5 py-1 bg-black/60 backdrop-blur text-white text-[11px] font-bold rounded-lg ring-1 ring-white/30 shadow whitespace-nowrap">صفحة {labelPage}</span>
              {/* Juz/Hizb collapse below 420px: on a 320-360px phone the
                  timer + page + surah already fill one line, and a
                  second wrapped line would cover the page's top
                  ornament — the full set still shows on wider screens
                  and in normal view. */}
              <span className="hidden min-[420px]:inline-block px-2.5 py-1 bg-black/60 backdrop-blur text-white text-[11px] font-bold rounded-lg ring-1 ring-white/30 shadow whitespace-nowrap">{labelJuz.name}</span>
              <span className="hidden min-[420px]:inline-block px-2.5 py-1 bg-black/60 backdrop-blur text-white text-[11px] font-bold rounded-lg ring-1 ring-white/30 shadow whitespace-nowrap">الحزب {labelHizb.number}</span>
              <span className="px-2.5 py-1 bg-black/60 backdrop-blur text-white text-[11px] font-bold rounded-lg ring-1 ring-white/30 shadow whitespace-nowrap">سورة {labelSurahName}</span>
            </div>
          )}
          {/* Slow page-load indicator (STREAM S2): appears only once a
              turn has stalled past ~5s (pageLoadSlow). It sits above
              the verse strip — never over the top bar, whose wrapped
              height varies on narrow phones — and its retry button
              re-runs the load gate at once (gateNonce). The wrapper
              stops propagation so a tap here never exits fullscreen. */}
          {!showRatelIntro && showFullscreen && pageLoadPending && pageLoadSlow && (
            <div className="absolute bottom-32 left-1/2 -translate-x-1/2 z-30 pointer-events-none"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 px-3 py-2 bg-black/70 backdrop-blur text-white text-xs font-bold rounded-full ring-1 ring-white/30 shadow whitespace-nowrap">
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                جارٍ تحميل الصفحة…
                <button onClick={(e) => { e.stopPropagation(); setGateNonce((n) => n + 1); }}
                  className="pointer-events-auto px-2.5 py-1 bg-amber-500 hover:bg-amber-400 rounded-full text-white">
                  إعادة المحاولة
                </button>
              </div>
            </div>
          )}

          {/* Non-Madinah warning, fullscreen flavour: same warning as
              the normal view (word taps / highlights / paper geometry
              are Madinah-only). Bottom-center, pointer-events-none so
              it never eats a tap; hidden in clean reading + intro. */}
          {edition.id !== 'madinah' && !showRatelIntro && !cleanMode && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-black/70 text-white text-xs font-bold rounded-full pointer-events-none whitespace-nowrap">
              {edition.name}: الضغط على الكلمات والتمييز داخل الصورة متاح في مصحف المدينة فقط
            </div>
          )}

          {/* Clean reading: hide every control, keep only the page. */}
          {!showRatelIntro && !showEditionPickerInFullscreen && !cleanMode && (
            <button onClick={(e) => { e.stopPropagation(); setShowEditionPickerInFullscreen(false); setCleanMode(true); requestNativeFullscreen(); }}
              title="قراءة نظيفة — إخفاء كل الأدوات"
              className="absolute top-[calc(1rem_+_env(safe-area-inset-top))] right-20 p-2.5 bg-black/60 hover:bg-black/75 text-white rounded-lg z-30 transition-smooth ring-1 ring-white/40 shadow-lg">
              <Maximize2 className="w-7 h-7" />
            </button>
          )}

          {cleanMode && showCleanHint && !selectedVerse && (
            <div className="absolute top-[calc(1.5rem_+_env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-black/70 text-white text-sm font-semibold rounded-full pointer-events-none whitespace-nowrap">
              اضغط على هامش الصفحة لإظهار الأدوات
            </div>
          )}

          {!showRatelIntro && !cleanMode && (
            <button onClick={(e) => { e.stopPropagation(); setShowEditionPickerInFullscreen(true); }}
              className="absolute top-[calc(1rem_+_env(safe-area-inset-top))] left-4 flex items-center gap-2 px-4 py-2.5 bg-black/60 hover:bg-black/75 text-white rounded-lg z-30 transition-smooth text-sm font-semibold ring-1 ring-white/40 shadow-lg">
              <Layers className="w-5 h-5" /> {edition.name}
            </button>
          )}

          {!showRatelIntro && !cleanMode && (
            <button onClick={(e) => { e.stopPropagation(); toggleGoldFrame(); }}
              className={`absolute top-[calc(68px_+_env(safe-area-inset-top))] left-4 flex items-center gap-2 px-4 py-2.5 rounded-lg z-30 transition-smooth text-sm font-semibold ring-1 shadow-lg ${goldFrame ? 'bg-amber-700/90 text-white ring-amber-300' : 'bg-black/60 hover:bg-black/75 text-white ring-white/40'}`}>
              إطار ذهبي
            </button>
          )}

          {/* وضع الحفظ toggle: hides the popup ayah text until revealed. */}
          {!showRatelIntro && !cleanMode && (
            <button onClick={(e) => { e.stopPropagation(); toggleHifzMode(); }}
              title={hifzMode ? 'وضع الحفظ شغال — اضغط لإيقافه' : 'وضع الحفظ — إخفاء نص الآية وإظهار روابطها أولًا'}
              className={`absolute top-[calc(124px_+_env(safe-area-inset-top))] left-4 flex items-center gap-2 px-4 py-2.5 rounded-lg z-30 transition-smooth text-sm font-semibold ring-1 shadow-lg ${hifzMode ? 'bg-amber-700/90 text-white ring-amber-300' : 'bg-black/60 hover:bg-black/75 text-white ring-white/40'}`}>
              وضع الحفظ {hifzMode ? '✓' : ''}
            </button>
          )}

          {/* (Juz / Hizb / Surah chips now live in the merged top bar
              above — this second top-center div was the pile-up.) */}

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
                    ? (useMadinahCover
                      ? { width: '100vw', height: '100dvh', background: '#f8f1de' }
                      : { aspectRatio: String(MADINAH_NORMALIZED_ASPECT), width: `min(100vw, ${100 * MADINAH_NORMALIZED_ASPECT}dvh)`, background: '#f8f1de' })
                    : { aspectRatio: String(imgAspect), background: '#f8f1de' }}
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
                      const [px, py] = toImagePercent(e.clientX, e.clientY, rect);
                      // Margins are judged against the parity-aware
                      // text block (odd [6,83], even [17,94], y [14,88]).
                      const tbL = currentPage % 2 === 1 ? 6 : 17;
                      if (px < tbL || px > tbL + 77 || py < 14 || py > 88) { setCleanMode(false); return; }
                    }
                    if (Date.now() - lastSwipeAt.current < 500) return;
                    // During an image lag (displayed page behind the
                    // requested page) a tap would map through the new
                    // page's norm onto the old image — ignore it rather
                    // than open the wrong ayah; the tap works the moment
                    // the new image lands.
                    if (displayedPage !== currentPage) return;
                    void handleWordTap(e.clientX, e.clientY);
                  }}
                  onTouchStart={handlePageTouchStart}
                  onTouchEnd={handlePageTouchEnd}>
                  {/* Displayed-page image (SHAKE FIX 2026-10-28): the key
                      follows displayedPage, so the previous page stays
                      mounted — at its own norm — until the new image
                      has loaded. The old key-remount-on-currentPage
                      showed a white gap on every fast turn. */}
                  {/* Automatic retries before giving up: a transient
                      failure while flipping fast no longer flips the
                      page straight into the error block (see
                      RetryPageImg above). Key remounts per page, so
                      attempts reset on every turn. */}
                  <RetryPageImg key={`${edition.id}-${displayedPage}`} src={edition.imageUrl(displayedPage)} alt={`صفحة ${displayedPage}`}
                    className={`${fullscreenNorm ? 'absolute touch-none max-w-none' : 'h-full w-full'} object-contain [-webkit-touch-callout:none]`}
                    style={fullscreenNorm ? { left: `${fullscreenNorm.imgL}%`, top: `${fullscreenNorm.imgT}%`, width: `${fullscreenNorm.imgW}%`, height: `${fullscreenNorm.imgH}%`, animation: slideAnim } : { animation: slideAnim }}
                    onLoad={(e) => {
                      const im = e.currentTarget;
                      if (im.naturalWidth > 0 && im.naturalHeight > 0) setImgAspect(im.naturalWidth / im.naturalHeight);
                    }}
                    onFinalError={() => setImageError(true)} />
                  {goldFrame && (
                    <div className={`absolute z-10 pointer-events-none shadow-[inset_0_0_0_3px_#b48214,inset_0_0_0_8px_#f0c85a] ${fullscreenNorm && useMadinahCover ? '' : 'inset-0'}`}
                      style={fullscreenNorm && useMadinahCover ? {
                        left: `${fullscreenNorm.imgL + (fullscreenNorm.pl * fullscreenNorm.imgW) / 100}%`,
                        top: `${fullscreenNorm.imgT + (fullscreenNorm.pt * fullscreenNorm.imgH) / 100}%`,
                        width: `${(fullscreenNorm.pw * fullscreenNorm.imgW) / 100}%`,
                        height: `${(fullscreenNorm.ph * fullscreenNorm.imgH) / 100}%`,
                      } : undefined} />
                  )}
                  {/* STREAM S2: highlights follow displayedPage — while
                      the image lags, the word boxes belong to the
                      REQUESTED page, so follow/search/tap highlights
                      are suppressed until the displayed image lands
                      rather than marking the wrong page's words. */}
                  {tapFlash && displayedPage === currentPage && (() => {
                    const f = imageBoxToContainer(clampBoxToPaper(tapFlash));
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
                  {followOn && followPos && pageWordBoxes && displayedPage === currentPage && (() => {
                    const boxes = pageWordBoxes
                      .filter((b) => b.surah === followPos.surah && b.ayah === followPos.ayah)
                      .map((b) => ({ ...b, wordNo: Number(b.key.split(':')[2]) || 0 }))
                      .sort((a, b) => a.wordNo - b.wordNo);
                    if (boxes.length === 0) return null;
                    return (<>
                      <style>{`
                        @keyframes mushaf-follow-pulse {
                          0%, 100% { box-shadow: 0 0 10px 2px rgba(251,191,36,0.35); }
                          50% { box-shadow: 0 0 20px 5px rgba(251,191,36,0.55); }
                        }
                        .mushaf-follow-pulse { animation: mushaf-follow-pulse 2s ease-in-out 3; }
                        @media (prefers-reduced-motion: reduce) {
                          .mushaf-follow-pulse { animation: none; }
                        }
                      `}</style>
                      {boxes.map((b) => {
                        const f = imageBoxToContainer(clampBoxToPaper(b));
                        const isCurrent = b.wordNo - 1 === followPos.word;
                        const isPassed = b.wordNo - 1 < followPos.word;
                        return (
                          <div key={b.key} className={`absolute rounded-md pointer-events-none ${isCurrent ? 'bg-amber-400/30 shadow-[0_0_14px_3px_rgba(251,191,36,0.45)] mushaf-follow-pulse' : isPassed ? 'bg-amber-400/40' : 'bg-amber-300/25'}`}
                            style={{ left: `${f.left}%`, top: `${f.top}%`, width: `${f.width}%`, height: `${f.height}%` }} />
                        );
                      })}
                    </>);
                  })()}
                  {/* Search-jump highlight: the ayah tapped in لوحتي,
                      marked amber exactly on its words until the page
                      turns or fullscreen exits. */}
                  {searchHighlight && (!followOn || !followPos) && pageWordBoxes && displayedPage === currentPage && (() => {
                    const boxes = pageWordBoxes.filter((b) => b.surah === searchHighlight.surah && b.ayah === searchHighlight.ayah);
                    if (boxes.length === 0) return null;
                    return (<>
                      {boxes.map((b) => {
                        const f = imageBoxToContainer(clampBoxToPaper(b));
                        return (
                          <div key={b.key} className="absolute rounded-md pointer-events-none bg-amber-400/30 shadow-[0_0_14px_3px_rgba(251,191,36,0.45)]"
                            style={{ left: `${f.left}%`, top: `${f.top}%`, width: `${f.width}%`, height: `${f.height}%` }} />
                        );
                      })}
                    </>);
                  })()}
                  {/* Fullscreen ayah tap zones: one transparent zone per
                      ayah from the bounding rect of its word boxes —
                      no new geometry, same clamp+norm pipeline as the
                      highlights. Rendered only in fullscreen, never
                      while following, while a popup is open, or while
                      the fullscreen edition picker is open. A zone tap
                      opens the ayah popup without exiting fullscreen
                      (stopPropagation); in clean mode it also restores
                      the controls, like any other page tap. */}
                  {showFullscreen && !followOn && !selectedVerse && !showEditionPickerInFullscreen && pageWordBoxes && displayedPage === currentPage && (() => {
                    const byAyah: Record<string, { surah: number; ayah: number; left: number; top: number; right: number; bottom: number }> = {};
                    for (const b of pageWordBoxes) {
                      const key = `${b.surah}:${b.ayah}`;
                      const cur = byAyah[key];
                      if (!cur) {
                        byAyah[key] = { surah: b.surah, ayah: b.ayah, left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height };
                      } else {
                        cur.left = Math.min(cur.left, b.left);
                        cur.top = Math.min(cur.top, b.top);
                        cur.right = Math.max(cur.right, b.left + b.width);
                        cur.bottom = Math.max(cur.bottom, b.top + b.height);
                      }
                    }
                    const zones: { verse: QuranVerse; left: number; top: number; width: number; height: number }[] = [];
                    for (const key of Object.keys(byAyah)) {
                      const z = byAyah[key];
                      const verse = stripVerses.find((v) => v.surah_no === z.surah && v.ayah_no === z.ayah);
                      if (!verse) continue;
                      const f = imageBoxToContainer(clampBoxToPaper({ key: `${z.surah}:${z.ayah}`, surah: z.surah, ayah: z.ayah, left: z.left, top: z.top, width: z.right - z.left, height: z.bottom - z.top }));
                      if (f.width <= 0 || f.height <= 0) continue;
                      zones.push({ verse, left: f.left, top: f.top, width: f.width, height: f.height });
                    }
                    if (zones.length === 0) return null;
                    return (<>
                      {zones.map((z) => (
                        <button key={`tap-${z.verse.id}`} aria-label={`فتح آية ${z.verse.ayah_no}`}
                          className="absolute bg-transparent border-0 p-0 cursor-pointer"
                          style={{ left: `${z.left}%`, top: `${z.top}%`, width: `${z.width}%`, height: `${z.height}%` }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (Date.now() - lastSwipeAt.current < 500) return;
                            if (cleanMode) setCleanMode(false);
                            handleVerseClick(z.verse);
                          }} />
                      ))}
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
                    className="mt-3 px-4 py-2 bg-amber-700 text-white text-sm rounded-lg">إعادة المحاولة</button>
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
              {/* STREAM S2 turn zones: w-24 swallowed 96px of each edge
                  (53% of a 360px phone, nearly the whole width in
                  landscape) and even DISABLED zones at pp.1/604 still
                  blocked word taps. Now viewport-proportional
                  (w-12 -> w-16 -> w-24) and disabled zones are
                  pointer-events-none, so edge words stay tappable and
                  a boundary page's dead zone vanishes entirely. */}
              <button onClick={(e) => { e.stopPropagation(); goToPage(currentPage - 1); }} disabled={currentPage <= 1}
                aria-label="الصفحة السابقة"
                className="absolute top-0 bottom-0 right-0 w-12 sm:w-16 lg:w-24 z-20 flex flex-col items-center justify-center gap-1 bg-gradient-to-l from-black/40 to-transparent disabled:opacity-20 disabled:pointer-events-none group">
                <div className="relative z-10 flex flex-col items-center gap-1">
                  <div className="p-2.5 sm:p-4 bg-black/60 group-hover:bg-black/75 text-white rounded-full shadow-xl ring-1 ring-white/50 transition-smooth group-disabled:opacity-20">
                    <ChevronRight className="w-8 h-8 sm:w-10 sm:h-10" />
                  </div>
                  <span className="text-xs font-bold text-white bg-black/60 px-2.5 py-1 rounded-full ring-1 ring-white/30 shadow">السابق</span>
                </div>
              </button>
              <button onClick={(e) => { e.stopPropagation(); goToPage(currentPage + 1); }} disabled={currentPage >= TOTAL_PAGES}
                aria-label="الصفحة التالية"
                className="absolute top-0 bottom-0 left-0 w-12 sm:w-16 lg:w-24 z-20 flex flex-col items-center justify-center gap-1 bg-gradient-to-r from-black/40 to-transparent disabled:opacity-20 disabled:pointer-events-none group">
                {/* FACING STRIP REMOVED 2026-10-27 per user ("الغي الهوامش"):
                    no side sliver in fullscreen — the main page only, so
                    no second page's text ever overlaps its left edge. */}
                {false && hasFacingPage && (
                  <div className="absolute top-1/2 -translate-y-1/2 right-0 overflow-hidden pointer-events-none border-r border-black/30 shadow-[0_0_24px_rgba(0,0,0,0.45)]" style={{ width: FACING_STRIP_W, height: facingNorm ? (useMadinahCover ? '100svh' : `calc(min(100vw, ${100 * MADINAH_NORMALIZED_ASPECT}svh) / ${MADINAH_NORMALIZED_ASPECT})`) : '100%' }} title="الصفحة المقابلة">
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
                      style={facingNorm ? (useMadinahCover ? {
                        width: `${facingNorm.imgW}vw`,
                        height: `${facingNorm.imgH}svh`,
                        left: facingOnLeft
                          ? `calc(${FACING_STRIP_W} - ${((facingNorm.pr * facingNorm.imgW) / 100).toFixed(4)}vw)`
                          : `calc(0px - ${((facingNorm.pl * facingNorm.imgW) / 100).toFixed(4)}vw)`,
                        top: `calc(${coverMainPaperTop.toFixed(4)}svh - ${((facingNorm.pt * facingNorm.imgH) / 100).toFixed(4)}svh)`,
                      } : {
                        width: `calc(${(facingNorm.imgW / 100).toFixed(4)} * min(100vw, ${100 * MADINAH_NORMALIZED_ASPECT}svh))`,
                        height: `calc(${(facingNorm.imgH / 100).toFixed(4)} * min(100vw, ${100 * MADINAH_NORMALIZED_ASPECT}svh) / ${MADINAH_NORMALIZED_ASPECT})`,
                        left: facingOnLeft
                          ? `calc(${FACING_STRIP_W} - ${((facingNorm.pr) / 100).toFixed(4)} * ${(facingNorm.imgW / 100).toFixed(4)} * min(100vw, ${100 * MADINAH_NORMALIZED_ASPECT}svh))`
                          : `calc(0px - ${((facingNorm.pl) / 100).toFixed(4)} * ${(facingNorm.imgW / 100).toFixed(4)} * min(100vw, ${100 * MADINAH_NORMALIZED_ASPECT}svh))`,
                        top: `calc(0px - ${(facingNorm.pt / 100).toFixed(4)} * min(100vw, ${100 * MADINAH_NORMALIZED_ASPECT}svh) / ${MADINAH_NORMALIZED_ASPECT})`,
                      }) : undefined} />
                    <div className="absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-black/30 to-transparent pointer-events-none" />
                  </div>
                )}
                <div className="relative z-10 flex flex-col items-center gap-1">
                  <div className="p-2.5 sm:p-4 bg-black/60 group-hover:bg-black/75 text-white rounded-full shadow-xl ring-1 ring-white/50 transition-smooth group-disabled:opacity-20">
                    <ChevronLeft className="w-8 h-8 sm:w-10 sm:h-10" />
                  </div>
                  <span className="text-xs font-bold text-white bg-black/60 px-2.5 py-1 rounded-full ring-1 ring-white/30 shadow">التالي</span>
                </div>
              </button>

              {/* Verse selector — only the ayahs printed on this page */}
              <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center pb-[calc(1rem_+_env(safe-area-inset-bottom))] pointer-events-auto px-4"
                onClick={(e) => e.stopPropagation()}>
                {followStatus === 'locked' && followPos && !followOn && (
                  <div className="mb-2 flex items-center gap-2 bg-amber-500 text-white pl-2 pr-4 py-2 rounded-full shadow-xl font-bold text-sm max-w-[95vw]">
                    <span className="truncate">
                      الإمام الآن: سورة {SURAHS.find((s) => s.no === followPos.surah)?.name || ''} — آية {followPos.ayah}
                    </span>
                    <button onClick={resumeFollowAfterWrongLock}
                      className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-full flex-shrink-0">
                      مش دي؟ كمّل الاستماع
                    </button>
                    <button onClick={stopFollow} title="إيقاف المتابعة"
                      className="p-1.5 bg-white/20 hover:bg-white/30 rounded-full flex-shrink-0"><Square className="w-4 h-4" /></button>
                  </div>
                )}
                {followOn && (
                  <div className="mb-2 flex items-center gap-2 bg-amber-700 text-white pl-2 pr-4 py-2 rounded-full shadow-xl font-bold text-sm max-w-[95vw]">
                    <Mic className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">
                      {followStatus === 'locked' && followPos
                        ? `الإمام الآن: سورة ${SURAHS.find((s) => s.no === followPos.surah)?.name || ''} — آية ${followPos.ayah}`
                        : followMicWaiting ? 'بانتظار إذن الميكروفون…' : 'جارٍ الاستماع للإمام…'}
                    </span>
                    <button onClick={stopFollow} title="إيقاف المتابعة"
                      className="p-1.5 bg-white/20 hover:bg-white/30 rounded-full flex-shrink-0"><Square className="w-4 h-4" /></button>
                  </div>
                )}
                <p className="text-white/90 text-xs font-semibold mb-1.5 bg-black/60 px-3 py-1 rounded-full">آيات هذه الصفحة — اضغط رقم الآية لفتح روابطها • النقطة الذهبية تعني أن للآية تربيطات</p>
                <div className="bg-black/85 backdrop-blur rounded-xl p-2.5 max-w-[95vw] overflow-x-auto">
                  <div className="flex gap-2">
                    {stripVerses.map((v) => (
                      <button key={v.id} onClick={() => handleVerseClick(v)}
                        disabled={displayedPage !== currentPage}
                        title={displayedPage !== currentPage ? 'جارٍ تحميل الصفحة…' : undefined}
                        className={`relative flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold transition-smooth flex-shrink-0 disabled:opacity-40 ${
                          followPos && followPos.surah === v.surah_no && followPos.ayah === v.ayah_no ? 'bg-amber-500 text-white ring-2 ring-amber-300' :
                          searchHighlight && searchHighlight.surah === v.surah_no && searchHighlight.ayah === v.ayah_no ? 'bg-amber-500 text-white ring-2 ring-amber-300' :
                          selectedVerse?.id === v.id ? 'bg-emerald-600 text-white' :
                          v.has_links ? 'bg-emerald-500/30 text-emerald-300 hover:bg-emerald-500/50' : 'bg-white/20 text-white hover:bg-white/30'
                        }`}>
                        {v.ayah_no}
                        {v.has_links && <span className="absolute top-1 left-1 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-white/70" title="للآية تربيطات" />}
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
                          <p className="text-sm text-accent-600">{selectedVerse.surah_name} — آية {selectedVerse.ayah_no}</p>
                        </div>
                      </div>
                      <button onClick={() => setSelectedVerse(null)} aria-label="إغلاق"
                        className="icon-action p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="p-4 overflow-y-auto min-h-0 flex-1">
                      {hifzMode && !hifzRevealed ? (
                        <div className="mb-3 text-center bg-amber-50 border border-amber-200 rounded-xl p-4">
                          <p className="text-sm font-bold text-amber-800">الآية مخفية في وضع الحفظ — سمّعها من حفظك الأول</p>
                          <p className="text-xs text-accent-600 mt-1">روابطها ظاهرة تحت، والنص يظهر لما تضغط الزر</p>
                          <button onClick={() => setHifzRevealed(true)}
                            className="mt-3 px-5 py-2 bg-amber-700 hover:bg-amber-800 text-white text-sm font-bold rounded-xl">
                            أظهر الآية
                          </button>
                        </div>
                      ) : (
                        <p className="font-arabic text-xl text-accent-800 leading-loose mb-3 text-center">{selectedVerse.ayah_text}</p>
                      )}
                      {/* الروابط first and above everything: the app is
                          about the links, so it gets its own full-width
                          green button on top, not just a tab. Tapping it
                          always shows the links; the ring marks it active. */}
                      <button onClick={() => setPopupTab('links')}
                        className={`w-full mb-3 py-3 rounded-xl transition-smooth flex flex-col items-center justify-center gap-0.5 ${popupTab === 'links' ? 'bg-amber-600 text-white ring-2 ring-amber-300' : 'bg-amber-600 text-white hover:bg-amber-700'}`}>
                        <span className="text-base font-bold flex items-center gap-2"><Link className="w-5 h-5" /> روابط الحفظ</span>
                        <span className="text-xs text-white/85 font-semibold">تربيطات تثبّت الآية دي في ذهنك</span>
                      </button>
                      {/* Suggest + share, with the ayah-tap options
                          (2026-10-28): propose a link for admin review,
                          and share the ayah (panel header: شاركنا في الأجر). */}
                      <div className="flex gap-2 mb-3">
                        <button onClick={() => setSuggestOpen(!suggestOpen)}
                          className="flex-1 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-sm hover:bg-emerald-100 transition-smooth flex items-center justify-center gap-1.5">
                          <Link className="w-4 h-4" /> {suggestGender === 'female' ? 'اقترحي تربيط' : 'اقترح تربيط'}
                        </button>
                        <ShareButton verseText={selectedVerse.ayah_text} surahName={selectedVerse.surah_name} ayahNo={selectedVerse.ayah_no} surahNo={selectedVerse.surah_no} />
                      </div>
                      {suggestOpen && (
                        <div className="mb-3 bg-emerald-50/60 border border-emerald-200 rounded-xl p-3">
                          {suggestSent ? (
                            <p className="text-sm font-bold text-emerald-700">تم إرسال اقتراحك — هيتراجع من الإدارة قبل النشر. جزاك الله خيرًا، ونتشارك الأجر كلنا.</p>
                          ) : session ? (
                            <>
                              <p className="text-sm font-semibold text-accent-700 mb-2">اقترح تربيطًا لهذه الآية — يظهر للإدارة للمراجعة قبل النشر.</p>
                              <textarea value={suggestText} onChange={(e) => setSuggestText(e.target.value)} rows={3} placeholder="اكتب التربيط هنا…" className="w-full border border-gray-200 rounded-lg p-2 text-sm mb-2 bg-white" />
                              <input value={suggestTitle} onChange={(e) => setSuggestTitle(e.target.value)} placeholder="عنوان مختصر (اختياري)" className="w-full border border-gray-200 rounded-lg p-2 text-sm mb-2 bg-white" />
                              <label className="block text-xs font-semibold text-accent-600 mb-1">نوع التربيط</label>
                              <select value={suggestType} onChange={(e) => setSuggestType(e.target.value)} className="w-full border border-gray-200 rounded-lg p-2 text-sm mb-2 bg-white">
                                {LINK_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                              </select>
                              {suggestError && <p className="text-xs font-bold text-red-600 mb-2">{suggestError}</p>}
                              <button onClick={submitSuggestion} disabled={suggestSending} className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold rounded-xl text-sm">
                                {suggestSending ? 'جارٍ الإرسال…' : 'إرسال الاقتراح'}
                              </button>
                            </>
                          ) : (
                            <>
                              <p className="text-sm font-semibold text-accent-700 mb-2">سجّل دخولك الأول عشان نقدر نراجع اقتراحك.</p>
                              <button onClick={() => onNavigate('auth')} className="w-full py-2.5 bg-emerald-700 text-white font-bold rounded-xl text-sm">تسجيل الدخول</button>
                            </>
                          )}
                        </div>
                      )}
                      <div className="flex gap-2 mb-4">
                        <button onClick={() => setPopupTab('mutashabihat')}
                          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-smooth ${popupTab === 'mutashabihat' ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-accent-600 hover:bg-gray-200'}`}>
                          المتشابهات
                        </button>
                        <button onClick={() => setPopupTab('irab')}
                          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-smooth ${popupTab === 'irab' ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-accent-600 hover:bg-gray-200'}`}>
                          الإعراب
                        </button>
                        <button onClick={() => setPopupTab('tafsir')}
                          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-smooth ${popupTab === 'tafsir' ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-accent-600 hover:bg-gray-200'}`}>
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
                            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-lg">
                            إعادة المحاولة
                          </button>
                        </div>
                      ) : qulPhrases && qulPhrases.length > 0 ? (
                        <div className="space-y-2">
                          {qulPhrases.map((e) => (
                            <div key={e.id} className="bg-gray-50 rounded-lg p-3 border border-emerald-100">
                              <p className="font-arabic text-lg font-bold text-accent-800 leading-loose"><mark className="bg-amber-200 rounded px-0.5">{e.text}</mark></p>
                              <p className="text-sm text-accent-600 mb-2">تتكرر في {e.ayahs} آية في {e.surahs} سورة</p>
                              <div className="space-y-2">
                                {e.others.slice(0, 12).map((o) => (
                                  <button key={o.key} onClick={() => handleSimilarClick(o.row)}
                                    className="block w-full text-right bg-white hover:bg-emerald-50 rounded-lg p-3 border border-emerald-200">
                                    <p className="text-sm font-bold text-accent-700 mb-1">{o.surah_name} — آية {o.ayah_no}</p>
                                    <p className="font-arabic text-lg text-accent-800 leading-loose">{renderWithRanges(o.row.ayah_text, o.ranges)}</p>
                                  </button>
                                ))}
                                {e.others.length > 12 && <span className="text-sm text-accent-600 self-center">و{e.others.length - 12} آية أخرى</span>}
                              </div>
                            </div>
                          ))}
                          <p className="text-xs text-accent-600 leading-relaxed text-center">المصدر: بيانات «المتشابهات» من مكتبة القرآن العالمية (QUL) — مشروع Tarteel.</p>
                        </div>
                      ) : mutashabihat && mutashabihat.length > 0 ? (
                        <div className="space-y-2">
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
                              {/* One voice button, resolved by the
                                  2026-10-28 policy (see the normal-view
                                  block above). */}
                              {(() => {
                                const ra = resolveLinkAudio(link, linkGender);
                                if (!ra) return null;
                                return (
                                  <div className="flex gap-2 mt-2">
                                    <button onClick={() => playLinkAudio(ra.url)}
                                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-lg">
                                      <Volume2 className="w-4 h-4" /> {ra.label}
                                    </button>
                                  </div>
                                );
                              })()}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-6 bg-gray-50 rounded-lg">
                          <Bookmark className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                          <p className="text-base text-accent-400">لا توجد روابط لهذه الآية بعد</p>
                        </div>
                      ))}
                      {popupTab === 'links' && linkAudioError && <p className="text-sm text-red-600 font-semibold mt-2">{linkAudioError}</p>}
                      {popupTab === 'irab' && (
                        <div className="space-y-3">
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
                          <p className="text-xs text-accent-600 leading-relaxed text-center">المصدر: «المجتبى من مشكل إعراب القرآن الكريم» لأحمد بن محمد الخراط، عبر الموسوعة القرآنية (Quranpedia). إن لم يظهر إعراب موجز لهذه الآية، فالإعراب التفصيلي كلمة كلمة (بالإنجليزية) متاح هنا: <a href={`https://corpus.quran.com/wordbyword.jsp?chapter=${selectedVerse.surah_no}&verse=${selectedVerse.ayah_no}`} target="_blank" rel="noreferrer" className="text-emerald-700 underline">Quranic Arabic Corpus</a>.</p>
                        </div>
                      )}
                      {popupTab === 'tafsir' && (
                        <div className="space-y-3">
                          <div className="flex gap-2">
                            {TAFSIR_EDITIONS.map((ed) => (
                              <button key={ed.id} onClick={() => setTafsirEdition(ed.id)}
                                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-smooth ${tafsirEdition === ed.id ? 'bg-amber-700 text-white' : 'bg-amber-50 text-accent-600 hover:bg-amber-100'}`}>
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
                                className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white text-sm font-semibold rounded-lg">
                                إعادة المحاولة
                              </button>
                            </div>
                          ) : tafsirText ? (
                            <p className="text-base text-accent-700 leading-loose whitespace-pre-line">{tafsirText}</p>
                          ) : null}
                          <p className="text-xs text-accent-600 text-center">المصدر: نصوص تفاسير منشورة عبر AlQuranCloud</p>
                        </div>
                      )}
                    </div>
                      {/* التلاوة تحت: recitation controls live at the bottom of the popup,
                          below the tab content, so الروابط and the tabs stay on top. */}
                      <div className="flex items-center gap-2 mt-2 mb-3">
                        <button onClick={() => selectedVerse && handleListenButton(selectedVerse)}
                          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-smooth ${reciting ? 'bg-amber-700 text-white' : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'}`}>
                          {reciting ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                          {reciting ? `إيقاف التلاوة — ${reciter.name}` : 'استمع للآية'}
                        </button>
                        <button onClick={() => {
                          const next = !reciteLoop;
                          setReciteLoop(next);
                          if (reciteRef.current) reciteRef.current.loop = next;
                        }}
                          title="تكرار الآية للحفظ"
                          className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-bold transition-smooth ${reciteLoop ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-accent-600 hover:bg-gray-200'}`}>
                          <Repeat className="w-4 h-4" /> تكرار
                        </button>
                      </div>
                      {showReciters && (
                        <div className="mb-4">
                          <p className="text-xs text-accent-600 text-center mb-2">اختر القارئ</p>
                          <div className="flex flex-wrap gap-1.5">
                            {RECITERS.map((r) => (
                              <button key={r.id} onClick={() => selectedVerse && startRecitation(selectedVerse, r)}
                                className={`px-3 py-1.5 rounded-full text-sm font-bold transition-smooth ${r.id === reciterId ? 'bg-amber-700 text-white' : 'bg-gray-100 text-accent-600 hover:bg-gray-200'}`}>
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

              {/* Page number in clean mode only (STREAM S2): outside
                  clean mode the number is part of the merged top bar
                  above, so a second pill here would duplicate it. It
                  follows displayedPage during lag (labelPage) and
                  never blocks taps. */}
              {cleanMode && (
                <div className="absolute top-[68px] left-1/2 -translate-x-1/2 z-30 pointer-events-none">
                  <span className="px-3 py-1.5 bg-black/60 backdrop-blur text-white text-xs font-bold rounded-lg ring-1 ring-white/30 shadow">صفحة {labelPage}</span>
                </div>
              )}
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
                      <p className="text-sm text-accent-600 mt-0.5">{ed.description}</p>
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
