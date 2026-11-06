import { useEffect, useState } from 'react';
import { useEscapeClose } from '../lib/useEscape';
import { supabase } from '../lib/supabase';
import { BookOpen, Mic, Headphones, Settings, Link, SunMoon, ChevronDown, Play, MapPin } from 'lucide-react';
import BottomNav from '../components/BottomNav';
import QRCodeSection from '../components/QRCodeSection';
import { pressFeedback } from '../lib/pressFeedback';
import { dailyDua, ISLAMIC_GREETING } from '../lib/personalTouch';
import { SURAHS, SURAH_AYAH_COUNTS } from '../lib/surahs';
import { readListeningWird } from '../lib/listenPlayback';
import { SURAH_START_PAGES, TOTAL_MUSHAF_PAGES } from '../lib/mushafEditions';
import { getJuzFromPage } from '../lib/quranIndex';
import { JUZ_STARTS } from '../lib/quranBoundaries';
import { normalizeDigits, toArabicIndic } from '../lib/numerals';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test' | 'listen' | 'adhkar';

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

export default function HomeStartPage({ session, onNavigate }: {
  session: import('@supabase/supabase-js').Session | null;
  onNavigate: (r: Route) => void;
}) {
  const nameKey = `quran-pref-name:${session?.user?.id ?? ''}`;
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
  // الحفظ door: expands to 3 start choices (resume / pick a place / from
  // the beginning). Collapsed by default — the door looks exactly like
  // the other Home doors.
  const [hifzOpen, setHifzOpen] = useState(false);
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

  return (
    <div className="min-h-screen page-bg pb-24 route-in">
      <header className="sticky top-0 z-40 app-header">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <img src="https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/app-icons/icon-192.png" alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold font-display-ar text-ink">روابط الذكر الحكيم</h1>
            <p className="text-sm text-ink-2">للحفظ بالتربيطات</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5">
        {/* App mark: the artwork itself, sized so the greeting and
            the resume action stay visible without scrolling. */}
        <div className="flex justify-center mb-5">
          <img src="https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/app-icons/icon-512.png" alt="روابط الذكر الحكيم" className="w-56 h-56 object-contain drop-shadow-md polish-hero-medal" />
        </div>

        <div className="rounded-2xl glass-card polish-card polish-fade-up p-5 mb-4 text-center">
          <p className="text-xl md:text-2xl font-bold text-ink">{ISLAMIC_GREETING}</p>
          <p className="text-sm md:text-base text-ink-2 mt-1">
            {preferredName ? `${dailyDua()} يا ${preferredName}` : dailyDua()}
          </p>
        </div>

        {/* الحفظ: a uniform door like the others (سمّع لنفسك / الحق الإمام /
            استمع للقرآن). Tap to expand 3 start choices below it; tap
            again to collapse. */}
        <button
          onPointerDown={pressFeedback}
          onClick={() => { setHifzOpen(!hifzOpen); setShowPicker(false); }}
          aria-expanded={hifzOpen}
          className="w-full py-4 mb-4 grad-emerald-door glass-door-highlight text-white font-bold rounded-xl flex items-center justify-center gap-2 text-lg polish-press polish-press-depth polish-focus door-enter"
          style={{ animationDelay: '60ms' }}
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white/20">
            <BookOpen className="w-5 h-5 text-white" />
          </span>
          الحفظ
          <ChevronDown className={`w-5 h-5 text-white transition-transform ${hifzOpen ? 'rotate-180' : ''}`} />
        </button>

        {hifzOpen && (
          <div className="px-4 mb-4">
            {/* (a) resume from the saved position — hidden when the user
                never opened the Mushaf (nothing to resume from). */}
            {lastPage.visited && (
              <button
                onPointerDown={pressFeedback}
                onClick={() => resumeHifz(onNavigate)}
                className="w-full py-3 mb-3 grad-emerald-door glass-door-highlight text-white rounded-xl flex flex-col items-center justify-center polish-press polish-press-depth polish-focus"
              >
                <span className="font-semibold text-base flex items-center gap-2">
                  <Play className="w-5 h-5 text-white" />
                  أكمل من حيث توقفت
                </span>
                <span className="text-xs text-emerald-100 mt-0.5">
                  صفحة {lastPage.page.toLocaleString('ar-EG')} — سورة {pageSurah(lastPage.page)} — جزء {juz.number.toLocaleString('ar-EG')}
                </span>
              </button>
            )}
            {/* (b) pick a place: Juz grid, or surah (number + name) + ayah. */}
            <button
              onPointerDown={pressFeedback}
              onClick={() => setShowPicker(!showPicker)}
              aria-expanded={showPicker}
              className="w-full py-3 mb-3 grad-emerald-door glass-door-highlight text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-base polish-press polish-press-depth polish-focus"
            >
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/20">
                <MapPin className="w-4 h-4 text-white" />
              </span>
              ابدأ من مكان معين
              <ChevronDown className={`w-4 h-4 text-white transition-transform ${showPicker ? 'rotate-180' : ''}`} />
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
                  <select
                    value={pickerSurah}
                    onChange={(e) => onSurahSelect(Number(e.target.value))}
                    aria-label="اسم السورة"
                    className="flex-1 py-3 px-3 rounded-xl border border-emerald-200 bg-white text-ink text-base font-semibold polish-focus"
                  >
                    {SURAHS.map((s) => (
                      <option key={s.no} value={s.no}>
                        {toArabicIndic(s.no)} — {s.name}
                      </option>
                    ))}
                  </select>
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
                    className="flex-1 py-3 grad-emerald-door glass-door-highlight text-white font-semibold rounded-xl polish-press polish-press-depth polish-focus"
                  >
                    ابدأ من هنا
                  </button>
                </div>
                <p className="text-xs text-ink-2 mt-2">
                  سورة {SURAHS[pickerSurah - 1]?.name} فيها {toArabicIndic(pickerMaxAyah)} آية
                </p>
              </div>
            )}
            {/* (c) from the very beginning: الفاتحة آية ١. */}
            <button
              onPointerDown={pressFeedback}
              onClick={() => jumpToAyah(1, 1, onNavigate)}
              className="w-full py-3 grad-emerald-door glass-door-highlight text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-base polish-press polish-press-depth polish-focus"
            >
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/20">
                <BookOpen className="w-4 h-4 text-white" />
              </span>
              ابدأ من أول المصحف
            </button>
          </div>
        )}

        {/* سمّع لنفسك: directly after the resume card, above استمع للقرآن. */}
        <button
          onPointerDown={pressFeedback}
          onClick={() => onNavigate('test')}
          className="w-full py-4 mb-4 grad-emerald-door glass-door-highlight text-white font-bold rounded-xl flex items-center justify-center gap-2 text-lg polish-press polish-press-depth polish-focus door-enter"
          style={{ animationDelay: '120ms' }}
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white/20">
            <Headphones className="w-5 h-5 text-white" />
          </span>
          سمّع لنفسك
        </button>

        {/* الحق الإمام: directly under سمّع لنفسك (user order 2026-11-04). */}
        <button
          onPointerDown={pressFeedback}
          onClick={() => onNavigate('follow')}
          className="w-full py-4 mb-4 grad-emerald-door glass-door-highlight text-white font-bold rounded-xl flex items-center justify-center gap-2 text-lg polish-press polish-press-depth polish-focus door-enter"
          style={{ animationDelay: '180ms' }}
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white/20">
            <Mic className="w-5 h-5 text-white" />
          </span>
          الحق الإمام
        </button>

        {/* استمع للقرآن: full door, same size as الحق الإمام. */}
        {listeningWird && (
          <p className="text-sm text-emerald-800 font-semibold text-center mb-2">
            لديك ورد استماع محفوظ: سورة {SURAHS.find((s) => s.no === listeningWird.surah)?.name || listeningWird.surah} — آية {listeningWird.ayah}
          </p>
        )}
        <button
          onPointerDown={pressFeedback}
          onClick={() => onNavigate('listen')}
          className="w-full py-4 mb-4 grad-emerald-door glass-door-highlight text-white font-bold rounded-xl flex items-center justify-center gap-2 text-lg polish-press polish-press-depth polish-focus door-enter"
          style={{ animationDelay: '240ms' }}
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white/20">
            <Headphones className="w-5 h-5 text-white" />
          </span>
          استمع للقرآن
          <span className="text-xs font-semibold text-emerald-900 bg-amber-100/95 rounded-full px-2 py-0.5">اقفل الشاشة لو عايز</span>
        </button>

        {/* أذكار الصباح والمساء: LIVE — generated-voice clips
            (46 clips, male/female toggle in the player). Placed
            directly after the listen card: the audio hub. */}
        {/* استمع للأذكار: full door, same size as الحق الإمام. */}
        <button
          onPointerDown={pressFeedback}
          onClick={() => onNavigate('adhkar')}
          className="w-full py-4 mb-4 grad-emerald-door glass-door-highlight text-white font-bold rounded-xl flex items-center justify-center gap-2 text-lg polish-press polish-press-depth polish-focus door-enter"
          style={{ animationDelay: '300ms' }}
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white/20">
            <SunMoon className="w-5 h-5 text-white" />
          </span>
          استمع للأذكار
          <span className="text-xs font-semibold text-emerald-900 bg-amber-100/95 rounded-full px-2 py-0.5">(اقفل الشاشة لو عايز)</span>
        </button>

        {/* Share app (moved from لوحتي, 2026-11-04): after the adhkar card. */}
        <div className="mb-4 qr-home">
          <QRCodeSection />
        </div>

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

        {/* الإعدادات: standalone button, kept on Home (user decision
            2026-11-04); الحق الإمام moved to directly under سمّع لنفسك. */}
        <button
          onPointerDown={pressFeedback}
          onClick={() => onNavigate('settings')}
          className="w-full py-3.5 mb-4 grad-emerald-door glass-door-highlight text-white font-semibold rounded-xl flex items-center justify-center gap-2 polish-press polish-press-depth polish-focus door-enter"
          style={{ animationDelay: '360ms' }}
        >
          <Settings className="w-5 h-5 text-white" /> الإعدادات
        </button>

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

      <BottomNav current="home" onNavigate={onNavigate} />
    </div>
  );
}
