import { useState } from 'react';
import { Settings, BookOpen, Volume2, Globe, RotateCcw, Check, Sparkles } from 'lucide-react';
import { MUSHAF_EDITIONS as EDITIONS } from '../lib/mushafEditions';
import { RECITERS, DEFAULT_RECITER_ID } from '../lib/reciters';
import { LANGUAGES } from '../lib/translations';
import { useLang } from '../lib/LanguageContext';
import BottomNav from '../components/BottomNav';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow';

const EDITION_NOTES: Record<string, string> = {
  madinah: 'الصفحات المصورة الكاملة بالخط العثماني والإطار المزخرف',
  tajweed: 'نفس الصفحات ملوّنة بأحكام التجويد',
  warsh: 'برواية ورش عن نافع',
  hafs: 'برواية حفص بالخط الواسط',
};

function readStored<T>(key: string, fallback: T, parse: (raw: string) => T | null): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

export default function SettingsPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const { lang, setLang } = useLang();
  const [editionIdx, setEditionIdx] = useState(() =>
    readStored('quran-mushaf-edition', 0, (raw) => {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 0 && n < EDITIONS.length ? n : null;
    })
  );
  const [goldFrame, setGoldFrame] = useState(() => {
    try { return localStorage.getItem('quran-gold-frame') === '1'; } catch { return false; }
  });
  const [reciterId, setReciterId] = useState(() =>
    readStored('quran-reciter', DEFAULT_RECITER_ID, (raw) =>
      RECITERS.some((r) => r.id === raw) ? raw : null)
  );
  const [voicePref, setVoicePref] = useState<'male' | 'female' | null>(() => {
    try {
      const saved = localStorage.getItem('quran-link-voice');
      return saved === 'male' || saved === 'female' ? saved : null;
    } catch { return null; }
  });
  const [savedTick, setSavedTick] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  const saved = () => {
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 2000);
  };

  const pickEdition = (i: number) => {
    setEditionIdx(i);
    setPreviewFailed(false);
    try { localStorage.setItem('quran-mushaf-edition', String(i)); } catch {}
    saved();
  };
  const toggleGold = () => {
    const next = !goldFrame;
    setGoldFrame(next);
    try { localStorage.setItem('quran-gold-frame', next ? '1' : '0'); } catch {}
    saved();
  };
  const pickReciter = (id: string) => {
    setReciterId(id);
    try { localStorage.setItem('quran-reciter', id); } catch {}
    saved();
  };
  const pickVoice = (v: 'male' | 'female') => {
    setVoicePref(v);
    try { localStorage.setItem('quran-link-voice', v); } catch {}
    saved();
  };
  const resetDefaults = () => {
    setEditionIdx(0);
    setGoldFrame(false);
    setReciterId(DEFAULT_RECITER_ID);
    setVoicePref(null);
    try {
      localStorage.setItem('quran-mushaf-edition', '0');
      localStorage.setItem('quran-gold-frame', '0');
      localStorage.setItem('quran-reciter', DEFAULT_RECITER_ID);
      localStorage.removeItem('quran-link-voice');
    } catch {}
    setLang('ar');
    saved();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-100 via-amber-50/30 to-white pb-24">
      <header className="sticky top-0 z-40 bg-gradient-to-r from-amber-50 to-stone-50/95 backdrop-blur-md border-b border-amber-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-lg">
            <Settings className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-accent-800">الإعدادات</h1>
            <p className="text-sm text-accent-500">اختياراتك بتتحفظ لوحدها وتبقى الافتراضي بتاعك في كل مرة تفتح التطبيق</p>
          </div>
          {savedTick && (
            <span className="mr-auto flex items-center gap-1 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
              <Check className="w-4 h-4" /> تم الحفظ
            </span>
          )}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Page look — the section the user asked for by name */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-amber-500" /> اختر شكل الصفحة بنفسك
          </h2>
          <p className="text-sm text-accent-500 mb-4">شكل صفحة المصحف اللي بتحبها وإطارها — ده اللي هيتفتح بيه المصحف كل مرة.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {EDITIONS.map((ed, i) => (
              <button key={ed.id} onClick={() => pickEdition(i)}
                className={`text-right p-4 rounded-xl border-2 transition-smooth ${editionIdx === i ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-emerald-200 hover:bg-emerald-50/30'}`}>
                <p className="font-bold text-accent-800 flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-emerald-600" /> {ed.name}
                  {editionIdx === i && <Check className="w-5 h-5 text-emerald-600 mr-auto" />}
                </p>
                <p className="text-sm text-accent-500 mt-1">{EDITION_NOTES[ed.id] || ''}</p>
              </button>
            ))}
          </div>
          {/* Live preview: the chosen page itself, right here — it
              updates on every choice (edition card or gold toggle),
              so the user sees exactly what the Mushaf will open with. */}
          <div className="mt-4">
            <p className="text-sm font-semibold text-accent-700 mb-2">معاينة: {EDITIONS[editionIdx].name}</p>
            <div className="relative mx-auto w-full max-w-[300px] rounded-lg overflow-hidden shadow-lg bg-amber-50">
              {previewFailed ? (
                <p className="text-sm text-accent-500 text-center py-16 px-4">تعذر تحميل المعاينة — افتح المصحف لرؤية الصفحة</p>
              ) : (
                <>
                  <img key={EDITIONS[editionIdx].id} src={EDITIONS[editionIdx].imageUrl(2)} alt="معاينة صفحة المصحف"
                    onError={() => setPreviewFailed(true)}
                    className="w-full block" style={{ aspectRatio: '0.707' }} />
                  {goldFrame && (
                    <div className="absolute inset-0 pointer-events-none"
                      style={{ boxShadow: 'inset 0 0 0 3px #b48214, inset 0 0 0 8px #f0c85a' }} />
                  )}
                </>
              )}
            </div>
            <p className="text-xs text-accent-400 text-center mt-2">صفحة الفاتحة — نفس الشكل اللي هيتفتح بيه المصحف</p>
          </div>
          <button onClick={toggleGold}
            className={`mt-4 w-full flex items-center justify-between p-4 rounded-xl border-2 transition-smooth ${goldFrame ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:border-amber-200'}`}>
            <span className="text-right">
              <span className="block font-bold text-accent-800">إطار ذهبي حول الصفحة</span>
              <span className="block text-sm text-accent-500">إطار ذهبي أنيق فوق صورة الصفحة في المصحف</span>
            </span>
            <span className={`w-12 h-7 rounded-full p-1 transition-smooth flex-shrink-0 ${goldFrame ? 'bg-amber-500' : 'bg-gray-300'}`}>
              <span className={`block w-5 h-5 bg-white rounded-full shadow transition-smooth ${goldFrame ? 'mr-auto' : ''}`} />
            </span>
          </button>
        </section>

        {/* Recitation + voice defaults */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
            <Volume2 className="w-5 h-5 text-emerald-600" /> التلاوة والصوت
          </h2>
          <p className="text-sm text-accent-500 mb-4">القارئ الافتراضي لتلاوة الآيات، وصوت روابط الآيات.</p>
          <p className="text-sm font-semibold text-accent-700 mb-2">القارئ الافتراضي</p>
          <div className="flex flex-wrap gap-2 mb-5">
            {RECITERS.map((r) => (
              <button key={r.id} onClick={() => pickReciter(r.id)}
                className={`px-4 py-2 rounded-lg text-sm font-bold border transition-smooth ${reciterId === r.id ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-gray-50 text-accent-600 border-gray-200 hover:bg-gray-100'}`}>
                {r.name}
              </button>
            ))}
          </div>
          <p className="text-sm font-semibold text-accent-700 mb-2">صوت الروابط الافتراضي</p>
          <div className="flex gap-2">
            <button onClick={() => pickVoice('female')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-smooth ${voicePref === 'female' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-gray-50 text-accent-600 border-gray-200 hover:bg-gray-100'}`}>
              صوت نسائي
            </button>
            <button onClick={() => pickVoice('male')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-smooth ${voicePref === 'male' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-gray-50 text-accent-600 border-gray-200 hover:bg-gray-100'}`}>
              صوت رجالي
            </button>
          </div>
          {!voicePref && <p className="text-xs text-accent-400 mt-2">لم تختر بعد — التطبيق يستخدم الصوت الافتراضي حسب الجنس المسجل.</p>}
        </section>

        {/* Language */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-4">
            <Globe className="w-5 h-5 text-emerald-600" /> لغة التطبيق
          </h2>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((l) => (
              <button key={l.code} onClick={() => { setLang(l.code); saved(); }}
                className={`px-4 py-2 rounded-lg text-sm font-bold border transition-smooth ${lang === l.code ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-gray-50 text-accent-600 border-gray-200 hover:bg-gray-100'}`}>
                {l.flag} {l.nativeName}
              </button>
            ))}
          </div>
        </section>

        <button onClick={resetDefaults}
          className="w-full flex items-center justify-center gap-2 py-3 bg-white hover:bg-gray-50 text-accent-600 text-sm font-bold rounded-xl border border-gray-200 transition-smooth">
          <RotateCcw className="w-5 h-5" /> استعادة الإعدادات الافتراضية
        </button>
      </div>

      <BottomNav current="settings" onNavigate={onNavigate} />
    </div>
  );
}
