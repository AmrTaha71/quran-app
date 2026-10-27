import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { SURAHS, SURAH_AYAH_COUNTS } from '../lib/surahs';
import BottomNav from '../components/BottomNav';
import {
  BookOpen, Eye, Check, X, ChevronLeft, ChevronRight, RotateCcw,
  GraduationCap, Award, Home,
} from 'lucide-react';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test';

interface TestAyah {
  id: number;
  surah_no: number;
  ayah_no: number;
  ayah_text: string;
}

interface TestRecord {
  date: string;
  surah: number;
  surahName: string;
  from: number;
  to: number;
  total: number;
  correct: number;
}

const HISTORY_KEY = 'quran-test-history';
const TARGET_KEY = 'quran-mushaf-target';

function loadHistory(): TestRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Self-test (تسميع ذاتي) v1 — deliberately simple and honest: the ayah
// text is NOT rendered until the user asks to reveal it, then they grade
// themselves. No microphone grading in v1 (unreliable on mobile).
export default function SelfTestPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const [phase, setPhase] = useState<'setup' | 'testing' | 'done'>('setup');
  const [surah, setSurah] = useState(2);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(5);
  const [ayahs, setAyahs] = useState<TestAyah[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grades, setGrades] = useState<boolean[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<TestRecord[]>(loadHistory);

  const surahCount = SURAH_AYAH_COUNTS[surah - 1] || 1;
  const surahName = SURAHS.find((s) => s.no === surah)?.name || '';

  const startTest = async () => {
    const lo = Math.max(1, Math.min(from, surahCount));
    const hi = Math.max(lo, Math.min(to, surahCount));
    setError('');
    setLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from('quran_verses')
        .select('id, surah_no, ayah_no, ayah_text')
        .eq('surah_no', surah)
        .gte('ayah_no', lo)
        .lte('ayah_no', hi)
        .order('ayah_no', { ascending: true });
      if (qErr) throw qErr;
      if (!data || data.length === 0) {
        setError('لم أجد آيات في هذا النطاق — جرّب نطاقًا آخر');
        setLoading(false);
        return;
      }
      setFrom(lo);
      setTo(hi);
      setAyahs(data as TestAyah[]);
      setGrades(new Array(data.length).fill(false));
      setIndex(0);
      setRevealed(false);
      setPhase('testing');
    } catch {
      setError('تعذر تحميل الآيات — تأكد من الاتصال بالإنترنت');
    } finally {
      setLoading(false);
    }
  };

  const grade = (ok: boolean) => {
    const next = [...grades];
    next[index] = ok;
    setGrades(next);
    if (index + 1 < ayahs.length) {
      setIndex(index + 1);
      setRevealed(false);
    } else {
      finishTest(next);
    }
  };

  const finishTest = (finalGrades: boolean[]) => {
    const correct = finalGrades.filter(Boolean).length;
    const rec: TestRecord = {
      date: new Date().toISOString().slice(0, 10),
      surah,
      surahName,
      from,
      to,
      total: ayahs.length,
      correct,
    };
    const nextHistory = [rec, ...history].slice(0, 20);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory)); } catch {}
    setHistory(nextHistory);
    setPhase('done');
  };

  const correct = grades.filter(Boolean).length;
  const missed = ayahs.filter((_, i) => !grades[i]);
  const pct = ayahs.length > 0 ? Math.round((correct / ayahs.length) * 100) : 0;

  const openInMushaf = (ayahNo: number) => {
    try { localStorage.setItem(TARGET_KEY, JSON.stringify({ surah, ayah: ayahNo })); } catch {}
    onNavigate('mushaf');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-stone-50/30 pb-24">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-emerald-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-lg">
            <GraduationCap className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-accent-800">وضع التسميع الذاتي</h1>
            <p className="text-sm text-accent-500">سمّع من حفظك، ثم أظهر الآية وقيّم نفسك بصدق</p>
          </div>
          <button onClick={() => onNavigate('app')}
            className="mr-auto flex items-center gap-1.5 px-3 py-2 text-sm text-accent-600 hover:bg-gray-100 rounded-lg">
            <Home className="w-5 h-5" /> لوحتي
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {phase === 'setup' && (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 space-y-4">
              <label className="block">
                <span className="text-sm font-bold text-accent-700">السورة</span>
                <select value={surah}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setSurah(n);
                    setFrom(1);
                    setTo(Math.min(5, SURAH_AYAH_COUNTS[n - 1] || 1));
                  }}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300">
                  {SURAHS.map((s) => (
                    <option key={s.no} value={s.no}>{s.no} — سورة {s.name}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-bold text-accent-700">من آية</span>
                  <input type="number" min={1} max={surahCount} value={from}
                    onChange={(e) => setFrom(Number(e.target.value) || 1)}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-accent-700">إلى آية</span>
                  <input type="number" min={1} max={surahCount} value={to}
                    onChange={(e) => setTo(Number(e.target.value) || 1)}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                </label>
              </div>
              <p className="text-sm text-accent-500">
                سورة {surahName} فيها {surahCount.toLocaleString('ar-EG')} آية — النطاق المختار: {Math.max(1, Math.min(from, to, surahCount)).toLocaleString('ar-EG')} إلى {Math.min(Math.max(from, to), surahCount).toLocaleString('ar-EG')}
              </p>
              {error && <p className="text-sm text-red-600 font-semibold">{error}</p>}
              <button onClick={startTest} disabled={loading}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-lg font-bold rounded-xl shadow">
                {loading ? 'جارٍ تحميل الآيات…' : 'ابدأ التسميع'}
              </button>
              <p className="text-xs text-accent-400 leading-relaxed">
                نص الآية لا يظهر إلا بعد أن تسمّعها وتضغط "أظهر الآية" — ثم تقيّم نفسك: صح أو خطأ. لا يوجد تقييم بالميكروفون في هذه النسخة.
              </p>
            </div>

            {history.length > 0 && (
              <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5">
                <h2 className="font-bold text-accent-800 mb-3">نتائجك السابقة</h2>
                <ul className="space-y-2">
                  {history.slice(0, 5).map((h, i) => (
                    <li key={i} className="flex items-center justify-between text-sm gap-2">
                      <span className="text-accent-700">سورة {h.surahName} — آيات {h.from} إلى {h.to}</span>
                      <span className="font-bold text-emerald-700 whitespace-nowrap">{h.correct}/{h.total} ({Math.round((h.correct / h.total) * 100)}٪)</span>
                      <span className="text-accent-400 whitespace-nowrap">{h.date}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {phase === 'testing' && ayahs[index] && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm font-bold">
              <span className="text-accent-700">سورة {surahName} — آية {ayahs[index].ayah_no}</span>
              <span className="text-emerald-700">آية {index + 1} من {ayahs.length}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${((index + (revealed ? 1 : 0)) / ayahs.length) * 100}%` }} />
            </div>

            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-6 text-center">
              {!revealed ? (
                <>
                  <Eye className="w-10 h-10 text-emerald-300 mx-auto mb-3" />
                  <p className="text-lg font-bold text-accent-700 leading-relaxed">
                    سمّع الآية {ayahs[index].ayah_no} من حفظك الآن
                  </p>
                  <p className="text-sm text-accent-400 mt-1">النص مخفي عمدًا — عندما تنتهي اضغط الزر</p>
                  <button onClick={() => setRevealed(true)}
                    className="mt-5 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white text-lg font-bold rounded-xl shadow">
                    أظهر الآية
                  </button>
                </>
              ) : (
                <>
                  <p className="text-2xl leading-[2.2] font-bold text-accent-800" dir="rtl">{ayahs[index].ayah_text}</p>
                  <p className="text-sm text-accent-500 mt-4">طابق ما سمّعته بالنص — ثم قيّم نفسك بصدق:</p>
                  <div className="flex gap-3 mt-4">
                    <button onClick={() => grade(true)}
                      className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-bold rounded-xl flex items-center justify-center gap-2">
                      <Check className="w-6 h-6" /> صح
                    </button>
                    <button onClick={() => grade(false)}
                      className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white text-lg font-bold rounded-xl flex items-center justify-center gap-2">
                      <X className="w-6 h-6" /> خطأ
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-between">
              <button onClick={() => { if (index > 0) { setIndex(index - 1); setRevealed(false); } }}
                disabled={index === 0}
                className="flex items-center gap-1 px-4 py-2 text-sm font-bold text-accent-600 hover:bg-gray-100 rounded-lg disabled:opacity-30">
                <ChevronRight className="w-5 h-5" /> الآية السابقة
              </button>
              <button onClick={() => { if (index + 1 < ayahs.length) { setIndex(index + 1); setRevealed(false); } else { finishTest(grades); } }}
                className="flex items-center gap-1 px-4 py-2 text-sm font-bold text-accent-600 hover:bg-gray-100 rounded-lg">
                {index + 1 < ayahs.length ? (<>تخطي الآية <ChevronLeft className="w-5 h-5" /></>) : 'إنهاء التسميع'}
              </button>
            </div>
            <p className="text-center text-sm text-accent-400">النتيجة حتى الآن: {correct} صح من {index + (revealed ? 1 : 0)} آية</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-5">
            <div className="bg-gradient-to-l from-emerald-600 to-teal-700 rounded-2xl p-6 shadow-lg text-white text-center">
              <Award className="w-12 h-12 mx-auto mb-2 text-amber-200" />
              <p className="text-2xl font-bold">نتيجتك: {correct} من {ayahs.length} ({pct}٪)</p>
              <p className="text-emerald-50 mt-2 leading-relaxed">
                {pct >= 90 ? 'ما شاء الله — حفظ متقن، ثبّت الله ما حفظت' : pct >= 60 ? 'تقدّم طيب — راجع الآيات التي أخطأت فيها ثم أعد التسميع' : 'لا بأس — التعثر أول طريق الإتقان، راجع الآيات ثم أعد المحاولة'}
              </p>
            </div>

            {missed.length > 0 && (
              <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-5">
                <h2 className="font-bold text-accent-800 mb-3">آيات تحتاج مراجعة ({missed.length})</h2>
                <ul className="space-y-2">
                  {missed.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-accent-700">سورة {surahName} — آية {a.ayah_no}</span>
                      <button onClick={() => openInMushaf(a.ayah_no)}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm font-bold text-emerald-700 bg-emerald-50 rounded-lg">
                        <BookOpen className="w-4 h-4" /> افتح في المصحف
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setPhase('setup')}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2">
                <RotateCcw className="w-5 h-5" /> تسميع جديد
              </button>
              <button onClick={() => onNavigate('app')}
                className="flex-1 py-3 bg-white border border-gray-200 text-accent-700 font-bold rounded-xl">
                العودة إلى لوحتي
              </button>
            </div>
          </div>
        )}
      </div>

      <BottomNav current="test" onNavigate={onNavigate} />
    </div>
  );
}
