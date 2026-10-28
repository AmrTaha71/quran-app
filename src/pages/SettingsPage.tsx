import { useState, useEffect, useRef } from 'react';
import { Settings, BookOpen, Volume2, Globe, RotateCcw, Check, Sparkles, CalendarDays, Shield, Lock, Eye, EyeOff, Download, Smartphone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { MUSHAF_EDITIONS as EDITIONS } from '../lib/mushafEditions';
import { RECITERS, DEFAULT_RECITER_ID } from '../lib/reciters';
import { LANGUAGES } from '../lib/translations';
import { loadWird, saveWird, WIRD_TYPE_LABEL, wirdTotal, formatPages, type WirdState, type WirdType } from '../lib/wird';
import { pageDownloadSupported, countCachedPages, clearCachedPages, downloadAllPages, EDITION_DOWNLOADS } from '../lib/pageDownload';
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
  // Link-voice gender (2026-10-28 policy): the user's gender decides
  // which link voice plays — male users always hear the generated
  // male voice, female users hear the original or the generated
  // female voice. Saved to the profile (so it follows the account)
  // and mirrored in localStorage for fast reads elsewhere.
  const [linkGender, setLinkGender] = useState<'male' | 'female' | null>(() => {
    try {
      const saved = localStorage.getItem('quran-user-gender');
      return saved === 'male' || saved === 'female' ? saved : null;
    } catch { return null; }
  });
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      supabase.from('user_profiles').select('gender').eq('user_id', uid).maybeSingle()
        .then(({ data: row }) => {
          if (row?.gender === 'male' || row?.gender === 'female') {
            setLinkGender(row.gender);
            try { localStorage.setItem('quran-user-gender', row.gender); } catch {}
          }
        });
    });
  }, []);
  const [savedTick, setSavedTick] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  // Mushaf pages on the device (one-tap full download, Hafidz
  // pattern): state + handlers live here, the work in pageDownload.
  const [dlSupported] = useState(pageDownloadSupported);
  const [dlCached, setDlCached] = useState<number | null>(null);
  const [dlRunning, setDlRunning] = useState(false);
  const [dlDone, setDlDone] = useState(0);
  const [dlFailed, setDlFailed] = useState<number[]>([]);
  const [dlStopped, setDlStopped] = useState(false);
  const [dlError, setDlError] = useState('');
  const dlStopRef = useRef(false);
  useEffect(() => {
    if (dlSupported) void countCachedPages('madinah').then(setDlCached);
  }, [dlSupported]);
  const startDownload = async () => {
    if (dlRunning) return;
    dlStopRef.current = false;
    setDlStopped(false);
    setDlError('');
    setDlRunning(true);
    setDlFailed([]);
    try {
      try { await (navigator.storage as any)?.persist?.(); } catch {}
      const { downloaded, failed } = await downloadAllPages('madinah',
        (p) => { setDlDone(p.done); setDlFailed(p.failed); },
        () => dlStopRef.current,
      );
      setDlCached(downloaded);
      setDlFailed(failed);
      setDlStopped(dlStopRef.current);
    } catch {
      setDlError('تعذر التحميل — تأكد من الاتصال بالإنترنت وحاول تاني');
    } finally {
      setDlRunning(false);
    }
  };
  const stopDownload = () => { dlStopRef.current = true; };
  const clearDownload = async () => {
    await clearCachedPages('madinah');
    setDlCached(0);
    setDlDone(0);
    setDlFailed([]);
  };
  // Optional-edition downloads (tajweed / warsh / hafs): same
  // mechanics as Madinah, one state record per edition, and every
  // start goes through a size warning first (confirm flag) — nothing
  // here ever downloads without the user choosing that edition.
  type OptDl = { cached: number | null; running: boolean; done: number; failed: number[]; stopped: boolean; error: string; confirm: boolean };
  const emptyOpt = (): OptDl => ({ cached: null, running: false, done: 0, failed: [], stopped: false, error: '', confirm: false });
  const [optDl, setOptDl] = useState<Record<string, OptDl>>({});
  const optStopRefs = useRef<Record<string, boolean>>({});
  const patchOpt = (id: string, patch: Partial<OptDl>) =>
    setOptDl((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyOpt()), ...patch } }));
  useEffect(() => {
    if (!dlSupported) return;
    for (const ed of EDITION_DOWNLOADS.filter((e) => e.id !== 'madinah')) {
      void countCachedPages(ed.id).then((n) => patchOpt(ed.id, { cached: n }));
    }
  }, [dlSupported]);
  const startOptDownload = async (id: string) => {
    const st = optDl[id];
    if (st?.running) return;
    optStopRefs.current[id] = false;
    patchOpt(id, { confirm: false, stopped: false, error: '', running: true, failed: [] });
    try {
      try { await (navigator.storage as any)?.persist?.(); } catch {}
      const { downloaded, failed } = await downloadAllPages(id,
        (p) => { patchOpt(id, { done: p.done, failed: p.failed }); },
        () => !!optStopRefs.current[id],
      );
      patchOpt(id, { cached: downloaded, failed, stopped: !!optStopRefs.current[id] });
    } catch {
      patchOpt(id, { error: 'تعذر التحميل — تأكد من الاتصال بالإنترنت وحاول تاني' });
    } finally {
      patchOpt(id, { running: false });
    }
  };
  const stopOptDownload = (id: string) => { optStopRefs.current[id] = true; };
  const clearOptDownload = async (id: string) => {
    await clearCachedPages(id);
    patchOpt(id, { cached: 0, done: 0, failed: [] });
  };
  // Installed-app (PWA standalone) detection for the install card:
  // standalone means no Safari chrome, no link bar, no fullscreen
  // banner — the app already opens like a native app.
  const [isStandalone] = useState(() => {
    try {
      return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    } catch { return false; }
  });
  // ADMIN ENTRY (2026-10-27): shown ONLY to users in admin_users.
  // Normal users never see this section — and BottomNav stays at
  // its final 5 items, so الإدارة lives here, not as a tab.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      supabase.from('admin_users').select('user_id').eq('user_id', uid).single()
        .then(({ data: row }) => { if (row) setIsAdmin(true); });
    });
  }, []);
  // EASY PASSWORD CHANGE while logged in (2026-10-27): no email
  // link needed — the logged-in user sets a new password directly.
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState('');
  const changePassword = async () => {
    if (newPassword.length < 6) { setPasswordMsg('كلمة المرور لازم تكون ٦ أحرف على الأقل.'); return; }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { setPasswordMsg(error.message); return; }
    setPasswordMsg('تم تغيير كلمة المرور.'); setNewPassword('');
  };

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
  const pickGender = async (v: 'male' | 'female') => {
    setLinkGender(v);
    try { localStorage.setItem('quran-user-gender', v); } catch {}
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (uid) await supabase.from('user_profiles').update({ gender: v }).eq('user_id', uid);
    } catch {}
    saved();
  };
  // Daily wird configuration: the FIRST section in Settings. The
  // controls edit a draft only; nothing reaches the لوحتي card
  // until the user presses حفظ. Streak and done days are untouched
  // — this only changes type + pages per day.
  const [wird, setWird] = useState(loadWird);
  const [draftWird, setDraftWird] = useState(wird);
  const [justSavedWird, setJustSavedWird] = useState(false);
  const updateDraftWird = (patch: Partial<WirdState>) => {
    setDraftWird((d) => ({ ...d, ...patch }));
    setJustSavedWird(false);
  };
  const saveWirdChoice = () => {
    saveWird(draftWird);
    setWird(draftWird);
    setJustSavedWird(true);
    saved();
  };
  const resetDefaults = () => {
    setEditionIdx(0);
    setGoldFrame(false);
    setReciterId(DEFAULT_RECITER_ID);
    setLinkGender(null);
    try {
      localStorage.setItem('quran-mushaf-edition', '0');
      localStorage.setItem('quran-gold-frame', '0');
      localStorage.setItem('quran-reciter', DEFAULT_RECITER_ID);
      localStorage.removeItem('quran-link-voice');
      localStorage.removeItem('quran-user-gender');
    } catch {}
    setLang('ar-EG');
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
        {/* Daily wird — FIRST section by request: the user sets all
            THREE parts in this one window (pages per part, 0 = skip
            that part today), presses حفظ once, and the saved wird
            shows in a line right under the button. The لوحتي card
            reads the saved value, so it only changes on save. */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
            <CalendarDays className="w-5 h-5 text-amber-600" /> وردك اليومي
          </h2>
          <p className="text-sm text-accent-500 mb-4">حدّد أجزاء ورد اليوم الثلاثة هنا — عدد الصفحات لكل جزء (0 يعني لا ورد من هذا النوع اليوم) — وبعدين اضغط حفظ مرة واحدة.</p>
          {(Object.keys(WIRD_TYPE_LABEL) as WirdType[]).map((k) => (
            <div key={k} className="flex items-center justify-between gap-3 mb-3">
              <p className="text-sm font-semibold text-accent-700">{WIRD_TYPE_LABEL[k]}</p>
              <div className="flex items-center gap-3">
                <button onClick={() => updateDraftWird({ parts: { ...draftWird.parts, [k]: Math.max(0, draftWird.parts[k] - 1) } })}
                  className="w-9 h-9 text-lg font-bold bg-gray-100 hover:bg-gray-200 rounded-full">−</button>
                <span className="text-lg font-bold text-accent-800 w-8 text-center">{draftWird.parts[k].toLocaleString('ar-EG')}</span>
                <button onClick={() => updateDraftWird({ parts: { ...draftWird.parts, [k]: Math.min(10, draftWird.parts[k] + 1) } })}
                  className="w-9 h-9 text-lg font-bold bg-gray-100 hover:bg-gray-200 rounded-full">+</button>
              </div>
            </div>
          ))}
          <p className="text-sm font-semibold text-accent-700 mb-5">
            المجموع: {formatPages(wirdTotal(draftWird.parts))} يوميًا
          </p>
          <button onClick={saveWirdChoice} disabled={wirdTotal(draftWird.parts) === 0}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-base font-bold rounded-xl transition-smooth">
            حفظ
          </button>
          {wirdTotal(draftWird.parts) === 0 && (
            <p className="mt-2 text-sm font-semibold text-amber-700">اختر صفحة واحدة على الأقل في جزء واحد قبل الحفظ.</p>
          )}
          {justSavedWird && (
            <p className="mt-3 flex items-center gap-1.5 text-sm font-bold text-emerald-700">
              <Check className="w-4 h-4" /> تم الحفظ
            </p>
          )}
          <p className="mt-2 text-sm font-semibold text-accent-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            وردك اليومي المسجل: {wirdTotal(wird.parts) === 0
              ? 'لم يتم تحديد ورد بعد'
              : (Object.keys(WIRD_TYPE_LABEL) as WirdType[]).filter((k) => wird.parts[k] > 0).map((k) => `${WIRD_TYPE_LABEL[k]} — ${formatPages(wird.parts[k])}`).join('، ')} يوميًا
          </p>
        </section>

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
          <p className="text-xs text-accent-400 mt-3">ملحوظة: المصاحف غير المدينة بتتفتح من النت — لو عايز واحد منها على جهازك حمّله من قسم صفحات المصحف على جهازك تحت.</p>
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

        {/* Part 1 — install the app itself (PWA): no Safari, no link
            bar, no fullscreen banner. Part 2 (the pages download
            below) is separate, so the app itself stays light. */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
            <Smartphone className="w-5 h-5 text-emerald-600" /> ثبّت التطبيق على جهازك
          </h2>
          {isStandalone ? (
            <p className="text-sm text-emerald-700 font-bold">
              التطبيق مثبّت على جهازك ✓ — بيفتح من أيقونة الشاشة الرئيسية من غير سفاري ولا لينك فوق ولا شريط ملء الشاشة.
            </p>
          ) : (
            <>
              <p className="text-sm text-accent-500 mb-3">
                الخطوة الأولى قبل تحميل الصفحات: ثبّت التطبيق على الشاشة الرئيسية — كده بيشتغل زي تطبيقات الموبايل، من غير سفاري ولا لينك فوق ولا شريط ملء الشاشة.
              </p>
              <p className="text-sm font-bold text-accent-700 leading-relaxed" dir="ltr">
                Steps: 1. In Safari, tap Share. 2. Tap Add to Home Screen. 3. Open the app from the home screen icon.
              </p>
            </>
          )}
        </section>

        {/* Mushaf pages on the device — one-tap full download (Hafidz
            pattern): after this, every flip is a local read, instant
            on any connection, even offline. Madinah edition only. */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
            <Download className="w-5 h-5 text-emerald-600" /> صفحات المصحف على جهازك
          </h2>
          <p className="text-sm text-accent-500 mb-4">
            مصحف المدينة هو الافتراضي: حمّل صفحاته الـ ٦٠٤ مرة واحدة على جهازك — بعدها تقليب الصفحات بيبقى فوري ومن غير نت، حتى لو الاتصال ضعيف. الحجم الكلي حوالي ٢٤٠ ميجابايت، ويفضل واي فاي. مفيش حاجة تانية بتتحمل لوحدها.
          </p>
          {!dlSupported ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              جهازك مش بيدعم تحميل الصفحات على الجهاز — الصفحات هتفضل تتحمل من النت زي قبل كده.
            </p>
          ) : (
            <>
              <p className="text-sm font-bold text-accent-700 mb-2">
                {dlCached === null ? 'جارٍ فحص الصفحات المحملة…' : dlCached >= 604 ? 'كل الصفحات محملة على جهازك ✓' : `محمل منها ${dlCached.toLocaleString('ar-EG')} من ٦٠٤ صفحة`}
              </p>
              {dlRunning && (
                <div className="mb-3">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(dlDone / 604) * 100}%` }} />
                  </div>
                  <p className="text-sm text-accent-500 mt-1">جارٍ التحميل… {dlDone.toLocaleString('ar-EG')} من ٦٠٤</p>
                </div>
              )}
              {dlFailed.length > 0 && !dlRunning && (
                <p className="text-sm text-amber-700 mb-3">تعذر تحميل {dlFailed.length.toLocaleString('ar-EG')} صفحة — دوس تحميل تاني عشان يكمل الناقص.</p>
              )}
              {dlStopped && !dlRunning && (
                <p className="text-sm text-accent-500 mb-3">وقفت التحميل — اللي اتحمّل محفوظ، ودوس تاني عشان تكمل.</p>
              )}
              {dlError && !dlRunning && (
                <p className="text-sm text-red-600 mb-3">{dlError}</p>
              )}
              <div className="flex gap-3">
                {!dlRunning ? (
                  <button onClick={startDownload} disabled={dlCached !== null && dlCached >= 604}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl">
                    {dlCached !== null && dlCached > 0 && dlCached < 604 ? 'كمّل تحميل الناقص' : 'حمّل كل الصفحات'}
                  </button>
                ) : (
                  <button onClick={stopDownload}
                    className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-accent-700 font-bold rounded-xl">
                    إيقاف التحميل
                  </button>
                )}
                {dlCached !== null && dlCached > 0 && !dlRunning && (
                  <button onClick={clearDownload}
                    className="px-5 py-2.5 bg-white border border-gray-200 text-accent-700 font-bold rounded-xl">
                    مسح المحمل
                  </button>
                )}
              </div>
              <p className="text-xs text-accent-400 mt-3 leading-relaxed">
                ملحوظة: المتصفح ممكن يمسح الصفحات لو مساحة الجهاز ضاقت — العداد هنا هيبين الناقص، ودوسة واحدة ترجّعه.
              </p>
              {/* Optional editions: nothing here downloads unless the
                  user picks that edition, and every start shows the
                  edition's size first (confirm box). */}
              <div className="border-t border-gray-100 mt-5 pt-4">
                <p className="font-bold text-accent-800 mb-1">مصاحف إضافية — اختياري</p>
                <p className="text-sm text-accent-500 mb-3">مفيش مصحف بيتحمل لوحده — كل واحد بيتحمل بس لو اخترته من هنا، وبحجمه قبل ما تدوس تحميل.</p>
                <div className="grid gap-3">
                  {EDITION_DOWNLOADS.filter((e) => e.id !== 'madinah').map((ed) => {
                    const st = optDl[ed.id] ?? emptyOpt();
                    const full = st.cached !== null && st.cached >= ed.pages;
                    return (
                      <div key={ed.id} className="rounded-xl border border-gray-200 p-4">
                        <p className="font-bold text-accent-800">{ed.name}</p>
                        <p className="text-sm text-accent-500">
                          حوالي {ed.approxMB.toLocaleString('ar-EG')} ميجابايت • {ed.pages.toLocaleString('ar-EG')} صفحة
                          {st.cached === null ? '' : full ? ' • كل الصفحات محملة ✓' : ` • محمل منها ${st.cached.toLocaleString('ar-EG')} من ${ed.pages.toLocaleString('ar-EG')}`}
                        </p>
                        {st.running && (
                          <div className="mt-3">
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(st.done / ed.pages) * 100}%` }} />
                            </div>
                            <p className="text-sm text-accent-500 mt-1">جارٍ التحميل… {st.done.toLocaleString('ar-EG')} من {ed.pages.toLocaleString('ar-EG')}</p>
                          </div>
                        )}
                        {st.failed.length > 0 && !st.running && (
                          <p className="text-sm text-amber-700 mt-2">تعذر تحميل {st.failed.length.toLocaleString('ar-EG')} صفحة — دوس تحميل تاني عشان يكمل الناقص.</p>
                        )}
                        {st.stopped && !st.running && (
                          <p className="text-sm text-accent-500 mt-2">وقفت التحميل — اللي اتحمّل محفوظ، ودوس تاني عشان تكمل.</p>
                        )}
                        {st.error && !st.running && (
                          <p className="text-sm text-red-600 mt-2">{st.error}</p>
                        )}
                        {st.confirm && !st.running ? (
                          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3">
                            <p className="text-sm font-bold text-amber-800">
                              {ed.name} حجمه حوالي {ed.approxMB.toLocaleString('ar-EG')} ميجابايت — يفضل واي فاي. متأكد عايز تحمله على جهازك؟
                            </p>
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => startOptDownload(ed.id)}
                                className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl">
                                أيوه، حمّل
                              </button>
                              <button onClick={() => patchOpt(ed.id, { confirm: false })}
                                className="px-5 py-2 bg-white border border-gray-200 text-accent-700 font-bold rounded-xl">
                                إلغاء
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2 mt-3">
                            {!st.running ? (
                              <button onClick={() => patchOpt(ed.id, { confirm: true })} disabled={full}
                                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl">
                                {full ? 'محمل بالكامل ✓' : st.cached !== null && st.cached > 0 ? 'كمّل تحميل الناقص' : 'حمّل المصحف'}
                              </button>
                            ) : (
                              <button onClick={() => stopOptDownload(ed.id)}
                                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-accent-700 font-bold rounded-xl">
                                إيقاف التحميل
                              </button>
                            )}
                            {st.cached !== null && st.cached > 0 && !st.running && (
                              <button onClick={() => clearOptDownload(ed.id)}
                                className="px-5 py-2.5 bg-white border border-gray-200 text-accent-700 font-bold rounded-xl">
                                مسح المحمل
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </section>

        {/* Recitation + voice defaults */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
            <Volume2 className="w-5 h-5 text-emerald-600" /> التلاوة والصوت
          </h2>
          <p className="text-sm text-accent-500 mb-4">القارئ الافتراضي لتلاوة الآيات.</p>
          <p className="text-sm font-semibold text-accent-700 mb-2">القارئ الافتراضي</p>
          <div className="flex flex-wrap gap-2 mb-5">
            {RECITERS.map((r) => (
              <button key={r.id} onClick={() => pickReciter(r.id)}
                className={`px-4 py-2 rounded-lg text-sm font-bold border transition-smooth ${reciterId === r.id ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-gray-50 text-accent-600 border-gray-200 hover:bg-gray-100'}`}>
                {r.name}
              </button>
            ))}
          </div>
          <p className="text-sm font-semibold text-accent-700 mb-2">الجنس — يحدد صوت روابط الآيات</p>
          <p className="text-xs text-accent-400 mb-3">للرجال: الصوت الرجالي المولّد دائماً. للنساء: الصوت النسائي.</p>
          <div className="flex gap-2">
            <button onClick={() => pickGender('female')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-smooth ${linkGender === 'female' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-gray-50 text-accent-600 border-gray-200 hover:bg-gray-100'}`}>
              امرأة
            </button>
            <button onClick={() => pickGender('male')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-smooth ${linkGender === 'male' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-gray-50 text-accent-600 border-gray-200 hover:bg-gray-100'}`}>
              رجل
            </button>
          </div>
          {!linkGender && <p className="text-xs text-accent-400 mt-2">لم تختر بعد — التطبيق يستخدم الصوت النسائي حتى تختار.</p>}
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

        {/* Password — logged-in change, no email link needed */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
            <Lock className="w-5 h-5 text-emerald-600" /> كلمة السر
          </h2>
          <p className="text-sm text-accent-500 mb-4">غيّر كلمة السر من هنا على طول، من غير ما تستنى رابط إيميل.</p>
          <div className="relative">
            <input type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              placeholder="كلمة سر جديدة (٦ أحرف على الأقل)"
              className="w-full pr-4 pl-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
            <button type="button" onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-accent-400 hover:text-accent-600">
              {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {passwordMsg && <p className="text-xs text-accent-500 mt-2">{passwordMsg}</p>}
          <button onClick={changePassword}
            className="mt-3 w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-smooth">
            حفظ كلمة السر الجديدة
          </button>
        </section>

        {isAdmin && (
          <section className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-5">
            <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
              <Shield className="w-5 h-5 text-emerald-600" /> لوحة الإدارة
            </h2>
            <p className="text-sm text-accent-500 mb-4">القسم ده بيظهر للأدمن بس — المستخدم العادي مش بيشوفه.</p>
            <button onClick={() => onNavigate('admin')}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-smooth">
              افتح لوحة الإدارة
            </button>
          </section>
        )}

        <button onClick={resetDefaults}
          className="w-full flex items-center justify-center gap-2 py-3 bg-white hover:bg-gray-50 text-accent-600 text-sm font-bold rounded-xl border border-gray-200 transition-smooth">
          <RotateCcw className="w-5 h-5" /> استعادة الإعدادات الافتراضية
        </button>
      </div>

      <BottomNav current="settings" onNavigate={onNavigate} />
    </div>
  );
}
