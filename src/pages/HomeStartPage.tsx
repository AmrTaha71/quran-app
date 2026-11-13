import StudioMic from '../components/StudioMic';
import { roomLabel } from '../lib/roomLabel';
import Sama3 from '../components/Sama3';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import ComprehensiveTestModal from '../components/ComprehensiveTestModal';
import GrandpaIcon from '../components/GrandpaIcon';
import TarteelQuizModal from '../components/TarteelQuizModal';
import { useEscapeClose } from '../lib/useEscape';
import { supabase } from '../lib/supabase';
import { BookOpen, BookMarked, Mic, MicVocal, AudioLines, Award, Headphones, Settings, Link, SunMoon, ChevronDown, Play, MapPin, Map, Glasses, Users, Cast, Compass, Landmark, Clock, Radio } from 'lucide-react';
import NextPrayerTile from '../components/NextPrayerTile';
import QiblaSheet from '../components/QiblaSheet';
import DrumSelect from '../components/DrumSelect';
import { nearestMosqueUrl } from '../lib/qibla';
import { useHint } from '../lib/hints';
import BigScreenSheet from '../components/BigScreenSheet';
import BottomNav from '../components/BottomNav';
import QRCodeSection from '../components/QRCodeSection';
import MemorizationMap from '../components/MemorizationMap';
import MutashabihatGame from '../components/MutashabihatGame';
import { useUserLists } from '../components/UserLists';
import { memorizedFromStart } from '../lib/homeFeatures';
import { pressFeedback } from '../lib/pressFeedback';
import { dailyDua, ISLAMIC_GREETING } from '../lib/personalTouch';
import { SURAHS, SURAH_AYAH_COUNTS, surahPlace } from '../lib/surahs';
import { readListeningWird } from '../lib/listenPlayback';
import { SURAH_START_PAGES, TOTAL_MUSHAF_PAGES } from '../lib/mushafEditions';
import { getJuzFromPage } from '../lib/quranIndex';
import { JUZ_STARTS } from '../lib/quranBoundaries';
import { normalizeDigits, toArabicIndic } from '../lib/numerals';
import { useElderlyMode, setElderlyMode } from '../lib/elderlyMode';
import ElderlyHome from '../components/ElderlyHome';
import OrderMeButton from '../components/OrderMeButton';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test' | 'listen' | 'adhkar' | 'room';

// Light start page (الرئيسية) for logged-in users: NOT a second
// dashboard. One resume card (last Mushaf page, from the same
// quran-mushaf-page key QuranMushafPage itself reads on open, so
// "continue" lands exactly where the user left off), and quick
// buttons only. Lists, search and filters
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

// Jump the Mushaf to a specific ayah: QuranMushafPage consumes the stored
// target on mount (goes to the ayah's actual page, opens fullscreen at
// once, highlights the ayah). Same mechanism as the تربيط اليوم card.
function jumpToAyah(surah: number, ayah: number, onNavigate: (r: Route) => void): void {
  try {
    localStorage.setItem('quran-mushaf-target', JSON.stringify({ surah, ayah }));
  } catch { /* ignore */ }
  onNavigate('mushaf');
}

// Resume from the saved page (the 'quran-mushaf-page' key QuranMushafPage
// itself reads on open): open fullscreen at once. Same as the old
// resume button on the الحفظ card.
function resumeHifz(onNavigate: (r: Route) => void): void {
  try {
    sessionStorage.setItem('quran-open-fullscreen', '1');
  } catch { /* ignore */ }
  onNavigate('mushaf');
}

// Self-test range choice: SelfTestPage consumes the stored choice on
// mount (opens that range door's small detail page). Same mechanism as
// the Mushaf target / fullscreen flags above.
function openTestRange(choice: 'surah' | 'juz' | 'page' | 'passage', onNavigate: (r: Route) => void): void {
  try {
    sessionStorage.setItem('quran-test-range-choice', choice);
  } catch { /* ignore */ }
  onNavigate('test');
}

type LinkOfDay = { surah: number; surahName: string; ayah: number; title: string | null; text: string };
const LOD_KEY = 'quran-link-of-day-v1';
function lodDate(): string {
  return new Date().toLocaleDateString('en-CA');
}
function readLinkOfDayCache(): LinkOfDay | null {
  try {
    const raw = sessionStorage.getItem(LOD_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { date: string; data: LinkOfDay };
    return j.date === lodDate() ? j.data : null;
  } catch {
    return null;
  }
}
function writeLinkOfDayCache(data: LinkOfDay): void {
  try {
    sessionStorage.setItem(LOD_KEY, JSON.stringify({ date: lodDate(), data }));
  } catch {
    // ignore
  }
}

// One Home tile: a raised 3D medallion with the icon, the door's name,
// and (first visits only) a three-or-four-word caption.
function HomeTile({ icon, glaze, title, hint, small, expanded, onClick }: {
  icon: ReactNode;
  glaze: 'emerald' | 'gold' | 'night' | 'plain';
  title: ReactNode;
  hint?: string;
  small?: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onPointerDown={pressFeedback}
      onClick={onClick}
      aria-expanded={expanded}
      className={`home-tile ${small ? 'home-tile-small' : ''} polish-focus`}
    >
      <span className={`tile-medal tile-medal-${glaze}`} aria-hidden="true">{icon}</span>
      <span className="home-tile-title">{title}</span>
      {hint && <span className="home-tile-hint">{hint}</span>}
    </button>
  );
}

export default function HomeStartPage({ session, onNavigate }: {
  session: import('@supabase/supabase-js').Session | null;
  onNavigate: (r: Route) => void;
}) {
  const nameKey = `quran-pref-name:${session?.user?.id ?? ''}`;
  // Elderly mode: a simplified Home (3 big buttons + a way back).
  // When on, the component returns the simplified view below instead
  // of the normal Home — the normal return is untouched.
  const elderly = useElderlyMode();
  const [preferredName, setPreferredName] = useState<string | null>(() => {
    try { return sessionStorage.getItem(nameKey); } catch { return null; }
  });
  // تربيط اليوم: one approved link, picked deterministically by
  // day-of-year (offset = (dayOfYear - 1) % approvedCount, ordered by
  // id). Any failure or empty result hides the card entirely — link
  // content is never invented.
  const [linkOfDay, setLinkOfDay] = useState<LinkOfDay | null>(readLinkOfDayCache);
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
  const juz = getJuzFromPage(lastPage.page);
  // Memorized state — the SAME source Lawhati reads (user_lists
  // 'memorized' via useUserLists), reduced to the contiguous
  // from-start run by the shared helper. The map and the review
  // card below both read this run; nothing here is hardcoded.
  const { lists } = useUserLists();
  const memorizedRun = memorizedFromStart(lists.memorized);
  // خريطة حفظي door: expands to the 30-Juz map below it; collapsed
  // by default — same pattern as the الحفظ / سمّع لنفسك doors.
  const [mapOpen, setMapOpen] = useState(false);
  const [mutOpen, setMutOpen] = useState(false);
  const [bigOpen, setBigOpen] = useState(false);
  const [qiblaOpen, setQiblaOpen] = useState(false);
  // Opens synchronously (no await) so iOS does not block it; Maps uses the device location itself.
  const openNearestMosque = () => { window.open(nearestMosqueUrl(), '_blank', 'noopener'); };
  const [tarteelOpen, setTarteelOpen] = useState(false);
  const [comprehensiveOpen, setComprehensiveOpen] = useState(false);
  // Home doors with choices (الحفظ / سـمّع لي / اختبر نفسك): one panel
  // open at a time, shown right under the tile grid and scrolled into
  // view so the choices are never hidden below the fold.
  const [panel, setPanel] = useState<null | 'hifz' | 'test' | 'quiz'>(null);
  const hifzOpen = panel === 'hifz';
  const testOpen = panel === 'test';
  const quizOpen = panel === 'quiz';
  const panelRef = useRef<HTMLDivElement | null>(null);
  function togglePanel(which: 'hifz' | 'test' | 'quiz'): void {
    setPanel((p) => (p === which ? null : which));
  }
  useEffect(() => {
    if (!panel) return;
    const t = window.setTimeout(() => {
      try { panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch { /* ignore */ }
    }, 60);
    return () => window.clearTimeout(t);
  }, [panel]);
  // Tile captions: shown the first three visits, then icon + title only.
  const showHints = useHint('home-tiles');
  const [showPicker, setShowPicker] = useState(false);
  // "ابدأ من مكان معين" picker: chosen surah + ayah. The surah number
  // input and the name dropdown stay in sync through this state.
  const [pickerSurah, setPickerSurah] = useState(1);
  const [pickerSurahText, setPickerSurahText] = useState('١');
  const [pickerAyah, setPickerAyah] = useState(1);
  const [pickerAyahText, setPickerAyahText] = useState('١');
  const pickerMaxAyah = SURAH_AYAH_COUNTS[pickerSurah - 1] ?? 1;
  function onSurahNoChange(text: string): void {
    setPickerSurahText(text);
    const n = Number(normalizeDigits(text));
    if (Number.isInteger(n) && n >= 1 && n <= 114) {
      setPickerSurah(n);
      const max = SURAH_AYAH_COUNTS[n - 1] ?? 1;
      if (pickerAyah > max) { setPickerAyah(max); setPickerAyahText(toArabicIndic(max)); }
    }
  }
  function onSurahSelect(no: number): void {
    setPickerSurah(no);
    setPickerSurahText(toArabicIndic(no));
    const max = SURAH_AYAH_COUNTS[no - 1] ?? 1;
    if (pickerAyah > max) { setPickerAyah(max); setPickerAyahText(toArabicIndic(max)); }
  }
  function onAyahNoChange(text: string): void {
    setPickerAyahText(text);
    const n = Number(normalizeDigits(text));
    if (Number.isInteger(n) && n >= 1 && n <= pickerMaxAyah) setPickerAyah(n);
  }
  function startFromPicker(): void {
    const s = Number(normalizeDigits(pickerSurahText));
    const surah = Number.isInteger(s) && s >= 1 && s <= 114 ? s : pickerSurah;
    const a = Number(normalizeDigits(pickerAyahText));
    const max = SURAH_AYAH_COUNTS[surah - 1] ?? 1;
    const ayah = Number.isInteger(a) && a >= 1 ? Math.min(a, max) : pickerAyah;
    jumpToAyah(surah, ayah, onNavigate);
  }

  useEffect(() => {
    const loadLinkOfDay = async () => {
      if (readLinkOfDayCache()) return;
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
        const lod: LinkOfDay = { surah: verse.surah_no, surahName: verse.surah_name, ayah: verse.ayah_no, title: link.link_title, text: link.link_content };
        setLinkOfDay(lod);
        writeLinkOfDayCache(lod);
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
        if (data?.preferred_name) {
          setPreferredName(data.preferred_name);
          try { sessionStorage.setItem(nameKey, data.preferred_name); } catch { /* ignore */ }
        }
      } catch {}
    };
    loadName();
  }, [session]);

  // Elderly mode — SIMPLIFIED HOME: only 3 big doors + a large,
  // obvious way back to normal mode. No header, greeting, Hifz door,
  // Adhkar, QR card, تربيط اليوم, Settings door, footer or BottomNav.
  // The 3 doors navigate exactly like the normal Home doors.
  if (elderly) {
    return (
      <div className="min-h-screen page-bg pb-24 route-in">
        <main className="max-w-5xl mx-auto px-4 py-8">
          <div className="mb-6">
            <OrderMeButton onNavigate={onNavigate}
              onMutashabihat={() => { setElderlyMode(false); setMutOpen(true); }}
              onElderly={() => {}} />
          </div>
          <ElderlyHome onNavigate={onNavigate} onResume={() => resumeHifz(onNavigate)} />
          <div className="flex flex-col gap-6 mt-6">
            <button
              onPointerDown={pressFeedback}
              onClick={() => onNavigate('listen')}
              className="w-full min-h-[80px] py-5 grad-emerald-door glass-door-highlight text-white font-bold rounded-2xl flex items-center justify-center gap-3 text-2xl polish-press polish-press-depth polish-focus"
            >
              <span className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20">
                <Headphones className="w-7 h-7 text-white" />
              </span>
              استمع
            </button>
            <button
              onPointerDown={pressFeedback}
              onClick={() => onNavigate('mushaf')}
              className="w-full min-h-[80px] py-5 grad-emerald-door glass-door-highlight text-white font-bold rounded-2xl flex items-center justify-center gap-3 text-2xl polish-press polish-press-depth polish-focus"
            >
              <span className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20">
                <BookOpen className="w-7 h-7 text-white" />
              </span>
              المصحف
            </button>
            <button
              onPointerDown={pressFeedback}
              onClick={() => onNavigate('test')}
              className="w-full min-h-[80px] py-5 grad-emerald-door glass-door-highlight text-white font-bold rounded-2xl flex items-center justify-center gap-3 text-2xl polish-press polish-press-depth polish-focus"
            >
              <span className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20">
                <StudioMic className="w-7 h-7 text-white" />
              </span>
              <Sama3 /> لي
            </button>
            <button
              onPointerDown={pressFeedback}
              onClick={() => setElderlyMode(false)}
              className="w-full min-h-[80px] py-5 bg-white text-ink font-bold rounded-2xl border-2 border-emerald-800 flex items-center justify-center gap-3 text-2xl polish-press polish-press-depth polish-focus"
            >
              الوضع العادي
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen page-bg pb-24 route-in">
      <header className="sticky top-0 z-40 app-header">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <img src="/brand/icon-192.png" alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold font-display-ar text-ink">تربيطات آيات القرآن</h1>
            <p className="text-sm text-ink-2">للحفظ بالتربيطات</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4">
        {/* Hero: the mark beside the greeting, compact, so the doors are
            on screen at once (2026-11-10: was a 224px mark that pushed
            every door below the fold). */}
        {/* 2026-11-12 (agreed): «صفحة جدو» on the right of the logo and the
            «الشاشة الكبيرة» on the left, one matching pair around the mark. */}
        <div className="rounded-2xl glass-card polish-card polish-fade-up p-3 mb-4 flex items-center gap-3 justify-center">
          <img src="/brand/tarbitat-logo.webp" alt="تربيطات آيات القرآن" className="w-20 h-20 object-contain drop-shadow-md polish-hero-medal shrink-0" />
          <div className="min-w-0">
            <p className="text-lg md:text-xl font-bold text-ink leading-snug">{ISLAMIC_GREETING}{preferredName ? ` يا ${preferredName}` : ''}</p>
            <p className="text-sm text-ink-2 mt-0.5 leading-relaxed">{dailyDua()}</p>
          </div>
        </div>

        {/* 2026-11-13: «الشاشة» and «جدو» as big doors on both sides of «اؤمرني». */}
        <div className="mb-4 grid grid-cols-[1fr_2.4fr_1fr] gap-3 items-stretch">
          <button type="button" onPointerDown={pressFeedback} onClick={() => setElderlyMode(true)} aria-label="صفحة جدو"
            className="home-tile polish-focus !min-h-0">
            <GrandpaIcon className="w-[4.5rem] h-[4.5rem] drop-shadow-md" />
            <span className="home-tile-title">صفحة جدو</span>
          </button>
          <OrderMeButton onNavigate={onNavigate}
            onMutashabihat={() => setMutOpen(true)}
            onElderly={() => setElderlyMode(true)} />
          <button type="button" onPointerDown={pressFeedback} onClick={() => setBigOpen(true)} aria-label="الشاشة الكبيرة"
            className="home-tile polish-focus !min-h-0">
            <span className="tile-medal tile-medal-night" aria-hidden="true"><Cast /></span>
            <span className="home-tile-title">الشاشة الكبيرة</span>
          </button>
        </div>

        {/* The four main doors. A tile with choices opens its panel right
            under the grid; only one panel is open at a time. */}
        <div className="home-tiles mb-3">
          <HomeTile icon={<BookMarked />} glaze="emerald" title="الحفظ" hint={showHints ? 'المصحف والتربيطات' : undefined}
            expanded={hifzOpen} onClick={() => { togglePanel('hifz'); setShowPicker(false); }} />
          <HomeTile icon={<MicVocal />} glaze="gold" title={<><Sama3 /> لي</>} hint={showHints ? 'اقرأ وأنا أصحّح لك' : undefined}
            expanded={testOpen} onClick={() => togglePanel('test')} />
          <HomeTile icon={<Award />} glaze="gold" title="اختبر نفسك" hint={showHints ? 'ترتيل ومتشابهات واختبار' : undefined}
            expanded={quizOpen} onClick={() => togglePanel('quiz')} />
          <HomeTile icon={<AudioLines />} glaze="emerald" title="الحق الإمام" hint={showHints ? 'المصحف يمشي مع القارئ' : undefined}
            onClick={() => onNavigate('follow')} />
        </div>

        {hifzOpen && (
          <div ref={panelRef} className="home-panel mb-4 alive-subdoors">
            <p className="home-panel-title">الحفظ</p>
            {/* (a) resume from the saved position — hidden when the user
                never opened the Mushaf (nothing to resume from). */}
            {lastPage.visited && (
              <button
                onPointerDown={pressFeedback}
                onClick={() => resumeHifz(onNavigate)}
                className="w-full py-3 mb-3 grad-amber-door glass-door-highlight text-white rounded-xl flex flex-col items-center justify-center polish-press polish-press-depth polish-focus"
              >
                <span className="font-semibold text-base flex items-center gap-2">
                  <Play className="w-5 h-5 text-white" />
                  أكمل من حيث توقفت
                </span>
                <span className="text-xs text-amber-100 mt-0.5">
                  صفحة {lastPage.page.toLocaleString('ar-EG')} — سورة {pageSurah(lastPage.page)} — جزء {juz.number.toLocaleString('ar-EG')}
                </span>
              </button>
            )}
            {/* (b) pick a place: Juz grid, or surah (number + name) + ayah. */}
            <button
              onPointerDown={pressFeedback}
              onClick={() => setShowPicker(!showPicker)}
              aria-expanded={showPicker}
              className="w-full py-3 mb-3 grad-amber-door glass-door-highlight text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-base polish-press polish-press-depth polish-focus"
            >
              <MapPin className="w-5 h-5 text-white" />
              ابدأ من مكان معين
              <ChevronDown className={`w-4 h-4 text-white alive-chevron ${showPicker ? 'rotate-180' : ''}`} />
            </button>
            {showPicker && (
              <div className="rounded-2xl glass-card polish-card p-4 mb-3">
                <p className="font-bold text-ink text-base mb-2">اختر الجزء</p>
                <div className="grid grid-cols-5 sm:grid-cols-6 gap-2 mb-4">
                  {JUZ_STARTS.map((j) => (
                    <button
                      key={j.juz}
                      onPointerDown={pressFeedback}
                      onClick={() => jumpToAyah(j.surah, j.ayah, onNavigate)}
                      className="py-2.5 rounded-lg bg-emerald-50 text-emerald-800 font-bold text-lg polish-press polish-focus"
                    >
                      {toArabicIndic(j.juz)}
                    </button>
                  ))}
                </div>
                <p className="font-bold text-ink text-base mb-2">أو اختر السورة والآية</p>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={pickerSurahText}
                    onChange={(e) => onSurahNoChange(e.target.value)}
                    placeholder="رقم السورة"
                    aria-label="رقم السورة"
                    className="w-24 py-3 px-3 rounded-xl border border-emerald-200 bg-white text-ink text-center text-lg font-bold polish-focus"
                  />
                  <div className="flex-1 min-w-0">
                    <DrumSelect label="اسم السورة" value={pickerSurah} onChange={onSurahSelect}
                      options={SURAHS.map((s) => ({ value: s.no, label: `${toArabicIndic(s.no)} — ${s.name} (${surahPlace(s.no)})` }))} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={pickerAyahText}
                    onChange={(e) => onAyahNoChange(e.target.value)}
                    placeholder="رقم الآية"
                    aria-label="رقم الآية"
                    className="w-24 py-3 px-3 rounded-xl border border-emerald-200 bg-white text-ink text-center text-lg font-bold polish-focus"
                  />
                  <button
                    onPointerDown={pressFeedback}
                    onClick={startFromPicker}
                    className="flex-1 py-3 grad-amber-door glass-door-highlight text-white font-semibold rounded-xl polish-press polish-press-depth polish-focus"
                  >
                    ابدأ من هنا
                  </button>
                </div>
                <p className="text-xs text-ink-2 mt-2">
                  سورة {SURAHS[pickerSurah - 1]?.name} فيها {toArabicIndic(pickerMaxAyah)} آية
                </p>
              </div>
            )}
            {/* خريطة حفظي (feature #1): the 30-Juz map (gold = memorized,
                amber tint = in progress, grey = not yet); tapping a Juz
                jumps to it in the Mushaf. */}
            <button
              onPointerDown={pressFeedback}
              onClick={() => setMapOpen(!mapOpen)}
              aria-expanded={mapOpen}
              className="w-full py-3 grad-amber-door glass-door-highlight text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-base polish-press polish-press-depth polish-focus"
            >
              <Map className="w-5 h-5 text-white" />
              خريطة حفظي
              <ChevronDown className={`w-4 h-4 text-white alive-chevron ${mapOpen ? 'rotate-180' : ''}`} />
            </button>
            {mapOpen && (
              <div className="mt-3">
                <MemorizationMap
                  run={memorizedRun}
                  onJumpToAyah={(s, a) => jumpToAyah(s, a, onNavigate)}
                />
              </div>
            )}
          </div>
        )}

        {/* سـمّع لي: 4 range choices. Only a choice tap navigates (to
            'test', with the chosen range stored for SelfTestPage). */}
        {testOpen && (
          <div ref={panelRef} className="home-panel mb-4">
            <p className="home-panel-title"><Sama3 /> لي — اختار النطاق</p>
            <div className="grid grid-cols-2 gap-3 alive-subdoors">
              {([['surah', 'بالسورة'], ['juz', 'بالجزء'], ['page', 'بالصفحة'], ['passage', 'فقرة معينة']] as const).map(([id, label]) => (
                <button
                  key={id}
                  onPointerDown={pressFeedback}
                  onClick={() => openTestRange(id, onNavigate)}
                  className="py-3 grad-amber-door glass-door-highlight text-white font-semibold rounded-xl text-base polish-press polish-press-depth polish-focus"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* اختبر نفسك: ترتيل, المتشابهات, and the comprehensive test. */}
        {quizOpen && (
          <div ref={panelRef} className="home-panel mb-4">
            <p className="home-panel-title">اختبر نفسك</p>
            <div className="grid grid-cols-2 gap-3 alive-subdoors">
              <button
                onPointerDown={pressFeedback}
                onClick={() => setTarteelOpen(true)}
                className="py-3 grad-amber-door glass-door-highlight text-white font-semibold rounded-xl text-base polish-press polish-press-depth polish-focus"
              >
                ترتيل
              </button>
              <button
                onPointerDown={pressFeedback}
                onClick={() => setMutOpen(true)}
                className="py-3 grad-amber-door glass-door-highlight text-white font-semibold rounded-xl text-base polish-press polish-press-depth polish-focus"
              >
                المتشابهات
              </button>
              <button
                onPointerDown={pressFeedback}
                onClick={() => setComprehensiveOpen(true)}
                className="col-span-2 py-3 grad-amber-door glass-door-highlight text-white font-semibold rounded-xl text-base polish-press polish-press-depth polish-focus"
              >
                اختبار شامل (١٠٠ درجة)
              </button>
            </div>
          </div>
        )}

        {/* Listening + modes: smaller tiles, one glance. */}
        <div className="home-tiles mb-4">
          <HomeTile icon={<Users />} glaze="emerald" title={roomLabel()} hint={showHints ? 'راجعوا مع بعض' : undefined}
            onClick={() => onNavigate('room')} />
          <HomeTile icon={<Headphones />} glaze="night" title="استمع للقرآن" hint={showHints ? 'والشاشة مقفولة' : undefined}
            onClick={() => onNavigate('listen')} />
          <HomeTile icon={<SunMoon />} glaze="night" title="الأذكار" hint={showHints ? 'صباح ومساء' : undefined}
            onClick={() => onNavigate('adhkar')} />
          <HomeTile icon={<Settings />} glaze="plain" title="الإعدادات"
            onClick={() => onNavigate('settings')} />
        </div>
        {/* 2026-11-13 (agreed): third row — next prayer (name, «بعد», digital countdown),
            the Quran radio, the nearest mosque, and the Qibla on the left edge. */}
        <div className="mb-4 grid grid-cols-4 gap-2 items-stretch">
          <NextPrayerTile icon={<Clock />} onNoLocation={() => onNavigate('settings')} />
          <button type="button" onPointerDown={pressFeedback} onClick={() => { try { window.open('https://makkahlive.net/en/radio/quran-cairo', '_blank', 'noopener,noreferrer'); } catch { /* ignore */ } }} aria-label="إذاعة القرآن الكريم"
            className="home-tile polish-focus !min-h-0">
            <span className="tile-medal tile-medal-emerald" aria-hidden="true"><Radio /></span>
            <span className="home-tile-title !text-[0.8rem] !leading-tight">إذاعة القرآن الكريم</span>
          </button>
          <button type="button" onPointerDown={pressFeedback} onClick={openNearestMosque} aria-label="أقرب مسجد"
            className="home-tile polish-focus !min-h-0">
            <span className="tile-medal tile-medal-gold" aria-hidden="true"><Landmark /></span>
            <span className="home-tile-title !text-[0.8rem] !leading-tight">أقرب مسجد</span>
          </button>
          <button type="button" onPointerDown={pressFeedback} onClick={() => setQiblaOpen(true)} aria-label="اتجاه القبلة"
            className="home-tile polish-focus !min-h-0">
            <span className="tile-medal tile-medal-emerald" aria-hidden="true"><Compass /></span>
            <span className="home-tile-title !text-[0.8rem] !leading-tight">اتجاه القبلة</span>
          </button>
        </div>
        {qiblaOpen && <QiblaSheet onClose={() => setQiblaOpen(false)} />}
        {bigOpen && <BigScreenSheet onClose={() => setBigOpen(false)} onRemote={() => { setBigOpen(false); onNavigate('room'); }} />}

        {listeningWird && (
          <button
            onPointerDown={pressFeedback}
            onClick={() => onNavigate('listen')}
            className="w-full text-sm text-emerald-800 font-semibold text-center mb-4 py-2 rounded-xl bg-emerald-50/80 border border-emerald-200 polish-press polish-focus"
          >
            ورد الاستماع: سورة {SURAHS.find((s) => s.no === listeningWird.surah)?.name || listeningWird.surah} — آية {toArabicIndic(listeningWird.ayah)}
          </button>
        )}

        {/* تربيط اليوم: real approved link only; hidden on any failure */}
        {linkOfDay && (
          <div className="rounded-2xl glass-card polish-card p-4 mb-4">
            <p className="font-semibold text-ink flex items-center gap-2">
              <Link className="w-5 h-5 text-emerald-700" /> تربيط اليوم
            </p>
            <p className="text-sm text-ink-2 mt-1">
              سورة {linkOfDay.surahName} — آية {linkOfDay.ayah.toLocaleString('ar-EG')}
              {linkOfDay.title ? ` — ${linkOfDay.title}` : ''}
            </p>
            <p className="text-base text-ink-2 leading-relaxed mt-2">
              {linkOfDay.text.length > 140 ? `${linkOfDay.text.slice(0, 140)}…` : linkOfDay.text}
            </p>
            <button
              onPointerDown={pressFeedback}
              onClick={() => {
                try { localStorage.setItem('quran-mushaf-target', JSON.stringify({ surah: linkOfDay.surah, ayah: linkOfDay.ayah })); } catch { /* ignore */ }
                onNavigate('mushaf');
              }}
              className="mt-3 w-full py-2.5 grad-emerald-door glass-door-highlight text-white font-semibold rounded-xl flex items-center justify-center gap-2 polish-press polish-press-depth polish-focus"
            >
              <BookOpen className="w-5 h-5" />
              افتح الآية وسمّعها
            </button>
          </div>
        )}

        {/* Share app: last, out of the way of the daily doors. */}
        <div className="mb-4 qr-home">
          <QRCodeSection />
        </div>

        <p className="text-center text-sm text-emerald-800 font-semibold mt-6">
          معك في كل آية، حتى نُتمّ حفظ كتاب الله
        </p>
      </main>

      {/* First-run screen (home only, once per device): 3 steps, dismissible */}
      {showIntro && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/50 polish-scrim-enter" onClick={dismissIntro}>
          <div className="bg-cream rounded-3xl shadow-2xl w-full max-w-sm p-6 text-center polish-modal-enter" onClick={(e) => e.stopPropagation()}>
            <p className="text-lg font-bold text-ink mb-1">احفظ القرآن بالتربيطات</p>
            <p className="text-sm text-ink-2 mb-4">٣ خطوات، وكل آية تثبت في ذهنك:</p>
            <ol className="text-right space-y-3 text-base text-ink-2">
              <li><span className="font-medium text-emerald-700">١.</span> افتح الآية — اضغط أي آية في المصحف</li>
              <li><span className="font-medium text-emerald-700">٢.</span> شوف رابطها — التربيط يثبّتها في ذهنك</li>
              <li><span className="font-medium text-emerald-700">٣.</span> سمّعها — من حفظك في «سمّع لنفسك»</li>
            </ol>
            <button onPointerDown={pressFeedback} onClick={dismissIntro}
              className="mt-5 w-full py-3 grad-emerald-door glass-door-highlight text-white font-semibold rounded-xl polish-press polish-press-depth polish-focus">
              ابدأ
            </button>
          </div>
        </div>
      )}

      {mutOpen && <MutashabihatGame onClose={() => setMutOpen(false)} />}
      {tarteelOpen && <TarteelQuizModal onClose={() => setTarteelOpen(false)} />}
      {comprehensiveOpen && <ComprehensiveTestModal onClose={() => setComprehensiveOpen(false)} />}
      <BottomNav current="home" onNavigate={onNavigate} />
    </div>
  );
}
