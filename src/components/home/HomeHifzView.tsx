// الحفظ as its own screen (W3-H1). Used to be a panel inside the Home
// page (three levels of tabs). Now Home swaps to this view; the
// bottom-left back control returns to Home. Same actions as before:
// resume, start from a place (Juz grid / surah + ayah) and the
// memorization map. Same storage keys / flags as the old panel.
import { useState } from 'react';
import { BookMarked, ChevronDown, Map, MapPin, Play } from 'lucide-react';
import PageHeader from '../PageHeader';
import BottomBackBar from '../BottomBackBar';
import BottomNav from '../BottomNav';
import DrumSelect from '../DrumSelect';
import MemorizationMap from '../MemorizationMap';
import { useUserLists } from '../UserLists';
import { memorizedFromStart } from '../../lib/homeFeatures';
import { pressFeedback } from '../../lib/pressFeedback';
import { SURAHS, SURAH_AYAH_COUNTS, surahPlace } from '../../lib/surahs';
import { SURAH_START_PAGES, TOTAL_MUSHAF_PAGES } from '../../lib/mushafEditions';
import { getJuzFromPage } from '../../lib/quranIndex';
import { JUZ_STARTS } from '../../lib/quranBoundaries';
import { normalizeDigits, toArabicIndic } from '../../lib/numerals';
import type { Route } from '../../lib/routes';

function readLastPage(): { page: number; visited: boolean } {
  try {
    const raw = localStorage.getItem('quran-mushaf-page');
    const n = Number(raw);
    if (raw !== null && Number.isInteger(n) && n >= 1 && n <= TOTAL_MUSHAF_PAGES) return { page: n, visited: true };
  } catch { /* ignore */ }
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

// QuranMushafPage consumes this target on mount (goes to the ayah's
// page, opens fullscreen, highlights it).
function jumpToAyah(surah: number, ayah: number, onNavigate: (r: Route) => void): void {
  try { localStorage.setItem('quran-mushaf-target', JSON.stringify({ surah, ayah })); } catch { /* ignore */ }
  onNavigate('mushaf');
}

function resumeHifz(onNavigate: (r: Route) => void): void {
  try { sessionStorage.setItem('quran-open-fullscreen', '1'); } catch { /* ignore */ }
  onNavigate('mushaf');
}

export default function HomeHifzView({ onNavigate, onClose }: { onNavigate: (r: Route) => void; onClose: () => void }) {
  const [lastPage] = useState(readLastPage);
  const juz = getJuzFromPage(lastPage.page);
  const { lists } = useUserLists();
  const memorizedRun = memorizedFromStart(lists.memorized);
  const [mapOpen, setMapOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSurah, setPickerSurah] = useState(1);
  const [pickerSurahText, setPickerSurahText] = useState('١');
  const [pickerAyah, setPickerAyah] = useState(1);
  const [pickerAyahText, setPickerAyahText] = useState('١');
  const pickerMaxAyah = SURAH_AYAH_COUNTS[pickerSurah - 1] ?? 1;

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

  return (
    <div className="min-h-screen page-bg pb-32 route-in">
      <PageHeader title="الحفظ" icon={BookMarked} subtitle="المصحف والتربيطات" />
      <main className="max-w-5xl mx-auto px-4 py-4 space-y-3">
        {lastPage.visited && (
          <button
            onPointerDown={pressFeedback}
            onClick={() => resumeHifz(onNavigate)}
            className="w-full py-3 grad-amber-door glass-door-highlight text-white rounded-xl flex flex-col items-center justify-center polish-press polish-press-depth polish-focus"
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
        <button
          onPointerDown={pressFeedback}
          onClick={() => setShowPicker(!showPicker)}
          aria-expanded={showPicker}
          className="w-full py-3 grad-amber-door glass-door-highlight text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-base polish-press polish-press-depth polish-focus"
        >
          <MapPin className="w-5 h-5 text-white" />
          ابدأ من مكان معين
          <ChevronDown className={`w-4 h-4 text-white alive-chevron ${showPicker ? 'rotate-180' : ''}`} />
        </button>
        {showPicker && (
          <div className="rounded-2xl glass-card polish-card p-4">
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
              <div className="flex-1 min-w-0">
                <DrumSelect label="اسم السورة" value={pickerSurah} onChange={onSurahSelect}
                  options={SURAHS.map((s) => ({ value: s.no, label: `${toArabicIndic(s.no)} — ${s.name} (${surahPlace(s.no)})` }))} />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="w-32 shrink-0">
                <DrumSelect label="رقم الآية" value={pickerAyah} onChange={(n) => onAyahNoChange(toArabicIndic(n))}
                  options={Array.from({ length: pickerMaxAyah }, (_, k) => ({ value: k + 1, label: `آية ${toArabicIndic(k + 1)}` }))} />
              </div>
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
        {mapOpen && <MemorizationMap run={memorizedRun} memorized={lists.memorized} onJumpToAyah={(s, a) => jumpToAyah(s, a, onNavigate)} />}
      </main>
      <BottomBackBar hasBottomNav onHome={onClose} />
      <BottomNav current="home" onNavigate={onNavigate} />
    </div>
  );
}
