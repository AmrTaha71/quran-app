import { useState, useEffect, useRef } from 'react';
import { Settings, BookOpen, Volume2, Globe, RotateCcw, Check, Sparkles, CalendarDays, Shield, Lock, Eye, EyeOff, Download, Smartphone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { MUSHAF_EDITIONS as EDITIONS } from '../lib/mushafEditions';
import { RECITERS, DEFAULT_RECITER_ID } from '../lib/reciters';
import { LANGUAGES } from '../lib/translations';
import { loadWird, saveWird, WIRD_TYPE_LABEL, wirdTotal, formatPages, type WirdState, type WirdType } from '../lib/wird';
import { pageDownloadSupported, countCachedPages, clearCachedPages, downloadAllPages, checkDownloadSpace, requestPersistentStorage, EDITION_DOWNLOADS } from '../lib/pageDownload';
import { useLang } from '../lib/LanguageContext';
import { readRecoveryLog, type RecoveryLogEntry } from '../lib/listenRecovery';
import BottomNav from '../components/BottomNav';
import AdhanSettingsSection from '../components/AdhanSettingsSection';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow';

const EDITION_NOTES: Record<string, string> = {
  madinah: 'الصفحات المصورة الكاملة بالخط العثماني والإطار المزخرف',
  tajweed: 'نفس الصفحات ملوّنة بأحكام التجويد',
  warsh: 'برواية ورش عن نافع',
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
  // [LISTEN_RECOVERY] temporary diagnostics (2026-10-30): last 30
  // recovery events, so the user can screenshot them after a lock.
  const [recoveryLog, setRecoveryLog] = useState<RecoveryLogEntry[]>(() => readRecoveryLog());
  const [dlRunning, setDlRunning] = useState(false);
  const [dlDone, setDlDone] = useState(0);
  const [dlFailed, setDlFailed] = useState<number[]>([]);
  const [dlUnverified, setDlUnverified] = useState<number[]>([]);
  const [dlStopped, setDlStopped] = useState(false);
  const [dlStopping, setDlStopping] = useState(false);
  const [dlError, setDlError] = useState('');
  const [dlQuotaFull, setDlQuotaFull] = useState(false);
  // Madinah size-confirm gate (like the optional editions already
  // have): the first tap runs a storage preflight and shows the size
  // + free space; only the confirm button starts the ~240 MB run.
  const [dlConfirm, setDlConfirm] = useState(false);
  const [dlSpace, setDlSpace] = useState<{ neededMB: number; freeMB: number | null; persisted: boolean | null } | null>(null);
  const dlStopRef = useRef(false);
  const dlAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (dlSupported) void countCachedPages('madinah').then(setDlCached);
  }, [dlSupported]);
  // First tap: preflight (quota estimate + persist request) and show
  // the confirm gate. A 'low' result REFUSES the run instead of
  // starting a 240 MB download that is guaranteed to die midway.
  const askDownload = async () => {
    if (dlRunning) return;
    setDlError('');
    setDlQuotaFull(false);
    const space = await checkDownloadSpace('madinah', dlCached ?? 0);
    const persisted = await requestPersistentStorage();
    setDlSpace({ neededMB: space.neededMB, freeMB: space.freeMB, persisted: persisted ?? space.persisted });
    if (space.status === 'low') {
      setDlError(`مساحة جهازك لا تكفي — التحميل يحتاج حوالي ${space.neededMB.toLocaleString('ar-EG')} ميجابايت (بهامش أمان) والمتاح حوالي ${(space.freeMB ?? 0).toFixed(0)} ميجابايت. فضّي مساحة وحاول تاني.`);
      setDlConfirm(false);
      return;
    }
    setDlConfirm(true);
  };
  const startDownload = async () => {
    if (dlRunning) return;
    dlStopRef.current = false;
    dlAbortRef.current = new AbortController();
    setDlConfirm(false);
    setDlStopped(false);
    setDlStopping(false);
    setDlError('');
    setDlQuotaFull(false);
    setDlRunning(true);
    setDlFailed([]);
    setDlUnverified([]);
    try {
      const result = await downloadAllPages('madinah',
        (p) => { setDlDone(p.done); setDlFailed(p.failed); setDlUnverified(p.unverified); },
        () => dlStopRef.current,
        { signal: dlAbortRef.current.signal },
      );
      setDlCached(result.downloaded);
      setDlFailed(result.failed);
      setDlUnverified(result.unverified);
      setDlStopped(result.aborted && !result.quotaExceeded);
      setDlQuotaFull(result.quotaExceeded);
      if (result.quotaExceeded) {
        setDlError('مساحة جهازك ممتلئة — وقف التحميل لأن التخزين خلص. اللي اتحمّل محفوظ، فضّي مساحة ودوس كمّل تحميل الناقص.');
      }
    } catch {
      setDlError('تعذر التحميل — تأكد من الاتصال بالإنترنت وحاول تاني');
    } finally {
      setDlRunning(false);
      setDlStopping(false);
      dlAbortRef.current = null;
    }
  };
  // Stop is IMMEDIATE: the abort signal kills in-flight fetches at
  // once (they have per-fetch timeouts too) and the button flips to
  // "جارٍ الإيقاف…" right away instead of waiting for 4 fetches.
  const stopDownload = () => {
    dlStopRef.current = true;
    dlAbortRef.current?.abort();
    setDlStopping(true);
  };
  const clearDownload = async () => {
    await clearCachedPages('madinah');
    setDlCached(0);
    setDlDone(0);
    setDlFailed([]);
    setDlUnverified([]);
  };
  // Optional-edition downloads (tajweed / warsh / hafs): same
  // mechanics as Madinah, one state record per edition, and every
  // start goes through a size warning first (confirm flag) — nothing
  // here ever downloads without the user choosing that edition.
  // The confirm tap also runs the storage preflight; 'low' refuses
  // with the quota message instead of opening the confirm box.
  type OptDl = { cached: number | null; running: boolean; done: number; failed: number[]; unverified: number[]; stopped: boolean; stopping: boolean; quota: boolean; error: string; confirm: boolean; space: { neededMB: number; freeMB: number | null } | null };
  const emptyOpt = (): OptDl => ({ cached: null, running: false, done: 0, failed: [], unverified: [], stopped: false, stopping: false, quota: false, error: '', confirm: false, space: null });
  const [optDl, setOptDl] = useState<Record<string, OptDl>>({});
  const optStopRefs = useRef<Record<string, boolean>>({});
  const optAbortRefs = useRef<Record<string, AbortController | null>>({});
  const patchOpt = (id: string, patch: Partial<OptDl>) =>
    setOptDl((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyOpt()), ...patch } }));
  useEffect(() => {
    if (!dlSupported) return;
    for (const ed of EDITION_DOWNLOADS.filter((e) => e.id !== 'madinah')) {
      void countCachedPages(ed.id).then((n) => patchOpt(ed.id, { cached: n }));
    }
  }, [dlSupported]);
  const askOptDownload = async (id: string) => {
    const st = optDl[id];
    if (st?.running) return;
    const space = await checkDownloadSpace(id, st?.cached ?? 0);
    if (space.status === 'low') {
      patchOpt(id, { error: `مساحة جهازك لا تكفي — التحميل يحتاج حوالي ${space.neededMB.toLocaleString('ar-EG')} ميجابايت (بهامش أمان) والمتاح حوالي ${(space.freeMB ?? 0).toFixed(0)} ميجابايت. فضّي مساحة وحاول تاني.`, confirm: false });
      return;
    }
    patchOpt(id, { error: '', space: { neededMB: space.neededMB, freeMB: space.freeMB }, confirm: true });
  };
  const startOptDownload = async (id: string) => {
    const st = optDl[id];
    if (st?.running) return;
    optStopRefs.current[id] = false;
    optAbortRefs.current[id] = new AbortController();
    patchOpt(id, { confirm: false, stopped: false, stopping: false, quota: false, error: '', running: true, failed: [], unverified: [] });
    try {
      const result = await downloadAllPages(id,
        (p) => { patchOpt(id, { done: p.done, failed: p.failed, unverified: p.unverified }); },
        () => !!optStopRefs.current[id],
        { signal: optAbortRefs.current[id]!.signal },
      );
      patchOpt(id, {
        cached: result.downloaded, failed: result.failed, unverified: result.unverified,
        stopped: result.aborted && !result.quotaExceeded, quota: result.quotaExceeded,
        error: result.quotaExceeded ? 'مساحة جهازك ممتلئة — وقف التحميل لأن التخزين خلص. اللي اتحمّل محفوظ، فضّي مساحة ودوس كمّل تحميل الناقص.' : '',
      });
    } catch {
      patchOpt(id, { error: 'تعذر التحميل — تأكد من الاتصال بالإنترنت وحاول تاني' });
    } finally {
      patchOpt(id, { running: false, stopping: false });
      optAbortRefs.current[id] = null;
    }
  };
  const stopOptDownload = (id: string) => {
    optStopRefs.current[id] = true;
    optAbortRefs.current[id]?.abort();
    patchOpt(id, { stopping: true });
  };
  const clearOptDownload = async (id: string) => {
    await clearCachedPages(id);
    patchOpt(id, { cached: 0, done: 0, failed: [], unverified: [] });
  };
  // Installed-app (PWA standalone) detection for the install card:
  // standalone means no Safari chrome, no link bar, no fullscreen
  // banner — the app already opens like a native app.
  const [isStandalone] = useState(() => {
    try {
      return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    } catch { return false; }
  });
  // Install prompt + platform branching (2026-10-28): the old card
  // gave Safari Share steps to EVERY non-standalone browser, which
  // is unusable on Android. Now: capture beforeinstallprompt and
  // offer a real install button where the browser provides one;
  // otherwise branch the manual steps by platform (Android menu vs
  // iOS Safari Share). iOS detection covers iPadOS 13+ (which reports
  // MacIntel + touch) as well as iPhone/iPod.
  const [installPrompt, setInstallPrompt] = useState<{ prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null>(null);
  const installPromptRef = useRef<typeof installPrompt>(null);
  const [installOutcome, setInstallOutcome] = useState('');
  const [installPlatform] = useState<'ios' | 'android' | 'other'>(() => {
    try {
      const ua = window.navigator.userAgent || '';
      const isIOS = /iPad|iPhone|iPod/.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
      if (isIOS) return 'ios';
      if (/Android/.test(ua)) return 'android';
      return 'other';
    } catch { return 'other'; }
  });
  useEffect(() => {
    const handler = (e: Event) => {
      // Prevent the browser's automatic mini-infobar so our own
      // install button is the one the user taps.
      e.preventDefault();
      const ev = e as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      installPromptRef.current = ev;
      setInstallPrompt(ev);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  const runInstallPrompt = async () => {
    const ev = installPromptRef.current;
    if (!ev) return;
    try {
      await ev.prompt();
      const choice = await ev.userChoice;
      setInstallOutcome(choice.outcome === 'accepted'
        ? 'تم قبول التثبيت — افتح التطبيق من أيقونة الشاشة الرئيسية.'
        : 'تم إلغاء التثبيت — تقدر تحاول تاني في أي وقت من هنا.');
    } catch {
      setInstallOutcome('تعذر فتح نافذة التثبيت — جرّب الخطوات اليدوية تحت.');
    } finally {
      installPromptRef.current = null;
      setInstallPrompt(null);
    }
  };
  // ADMIN ENTRY (2026-10-27): shown ONLY to users in admin_users.
  // Normal users never see this section — and BottomNav stays at
  // its final 5 items, so الإدارة lives here, not as a tab.
  const [isAdmin, setIsAdmin] = useState(false);
  // S5: same gate-retry rule as AdminPage — a transient failure must
  // surface a retry, never silently hide the admin section (which
  // looked exactly like "not an admin"). maybeSingle(): a non-admin
  // yields row=null with NO error, so any error is a real failure.
  const [adminGateError, setAdminGateError] = useState(false);
  const [adminGateAttempt, setAdminGateAttempt] = useState(0);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      setAdminGateError(false);
      supabase.from('admin_users').select('user_id').eq('user_id', uid).maybeSingle()
        .then(({ data: row, error }) => {
          if (error) { setAdminGateError(true); return; }
          if (row) setIsAdmin(true);
        });
    });
  }, [adminGateAttempt]);
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
  // S5 — truthful reset (was: local-only, so the gender mount effect
  // re-read the profile and self-undid the gender reset on next
  // visit, and the wird form's values were untouched). The reset now:
  // (1) asks for confirmation and states exactly what it resets;
  // (2) writes gender=null to user_profiles FIRST, so no stale gender
  // can be re-read back; (3) resets the wird PARTS to the app default
  // (جديد: صفحتين) while preserving streak/lastDone/doneDays, which
  // are progress history, not a setting; (4) updates the wird form
  // state on this page at once. Deliberately NOT touched, and said so
  // in the confirm + the note under the button: your place in the
  // Mushaf (quran-mushaf-page) and your self-test settings
  // (quran-test-settings) — wiping those would destroy progress, and
  // the button never claimed to reset them by name.
  const [resetMsg, setResetMsg] = useState('');
  const [resetting, setResetting] = useState(false);
  const resetDefaults = async () => {
    if (!window.confirm(
      'استعادة الإعدادات الافتراضية؟\n\n' +
      'سيُعاد: شكل الصفحة، القارئ الافتراضي، الجنس، لغة التطبيق، وأجزاء الورد اليومي.\n' +
      'سجل إنجاز الورد (الأيام والاستمرارية) محفوظ ولن يتغير.\n' +
      'لن يتغير: موضعك في المصحف ولا إعدادات التسميع.'
    )) return;
    setResetting(true);
    setResetMsg('');
    let serverFailed = false;
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (uid) {
        const { error } = await supabase.from('user_profiles').update({ gender: null }).eq('user_id', uid);
        if (error) serverFailed = true;
      }
    } catch {
      serverFailed = true;
    }
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
    const currentWird = loadWird();
    const resetWird: WirdState = { ...currentWird, parts: { sabaq: 2, murajaa: 0, manzil: 0 }, target: 2, type: 'sabaq' };
    saveWird(resetWird);
    setWird(resetWird);
    setDraftWird(resetWird);
    setJustSavedWird(false);
    setLang('ar-EG');
    setResetting(false);
    if (serverFailed) {
      setResetMsg('تمت استعادة الإعدادات المحلية والورد، لكن تعذّر حفظ الجنس على الحساب — الجنس القديم قد يعود عند فتح الإعدادات تاني. حاول تاني.');
    } else {
      setResetMsg('تمت استعادة الإعدادات الافتراضية ✓');
      saved();
    }
  };

  return (
    <div className="min-h-screen page-bg pb-24 route-in">
      <header className="sticky top-0 z-40 app-header">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-lg">
            <Settings className="w-7 h-7 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-accent-800">الإعدادات</h1>
            <p className="text-sm text-accent-600">اختياراتك بتتحفظ لوحدها وتبقى الافتراضي بتاعك في كل مرة تفتح التطبيق</p>
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
        <section className="bg-white rounded-2xl border border-hairline shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
            <CalendarDays className="w-5 h-5 text-amber-600" /> وردك اليومي
          </h2>
          <p className="text-sm text-accent-600 mb-4">حدّد أجزاء ورد اليوم الثلاثة هنا — عدد الصفحات لكل جزء (0 يعني لا ورد من هذا النوع اليوم) — وبعدين اضغط حفظ مرة واحدة.</p>
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
        <section className="bg-white rounded-2xl border border-hairline shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-amber-500" /> اختر شكل الصفحة بنفسك
          </h2>
          <p className="text-sm text-accent-600 mb-4">شكل صفحة المصحف اللي بتحبها وإطارها — ده اللي هيتفتح بيه المصحف كل مرة.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {EDITIONS.map((ed, i) => (
              <button key={ed.id} onClick={() => pickEdition(i)}
                className={`text-right p-4 rounded-xl border-2 transition-smooth ${editionIdx === i ? 'border-emerald-500 bg-emerald-50' : 'border-hairline hover:border-emerald-200 hover:bg-emerald-50/30'}`}>
                <p className="font-bold text-accent-800 flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-emerald-600" /> {ed.name}
                  {editionIdx === i && <Check className="w-5 h-5 text-emerald-600 mr-auto" />}
                </p>
                <p className="text-sm text-accent-600 mt-1">{EDITION_NOTES[ed.id] || ''}</p>
              </button>
            ))}
          </div>
          <p className="text-xs text-accent-600 mt-3">ملحوظة: المصاحف غير المدينة بتتفتح من النت — لو عايز واحد منها على جهازك حمّله من قسم صفحات المصحف على جهازك تحت. وتنبيه: الضغط على كلمات الصفحة والتمييز الدقيق داخل الصورة شغال في مصحف المدينة بس — في غيره الصفحة بتتفتح للقراءة، لكن من غير ضغط كلمات ولا تمييز.</p>
          {/* Live preview: the chosen page itself, right here — it
              updates on every choice (edition card or gold toggle),
              so the user sees exactly what the Mushaf will open with. */}
          <div className="mt-4">
            <p className="text-sm font-semibold text-accent-700 mb-2">معاينة: {EDITIONS[editionIdx].name}</p>
            <div className="relative mx-auto w-full max-w-[300px] rounded-lg overflow-hidden shadow-lg bg-amber-50">
              {previewFailed ? (
                <p className="text-sm text-accent-600 text-center py-16 px-4">تعذر تحميل المعاينة — افتح المصحف لرؤية الصفحة</p>
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
            <p className="text-xs text-accent-600 text-center mt-2">صفحة الفاتحة — نفس الشكل اللي هيتفتح بيه المصحف</p>
          </div>
          <button onClick={toggleGold}
            className={`mt-4 w-full flex items-center justify-between p-4 rounded-xl border-2 transition-smooth ${goldFrame ? 'border-amber-400 bg-amber-50' : 'border-hairline hover:border-amber-200'}`}>
            <span className="text-right">
              <span className="block font-bold text-accent-800">إطار ذهبي حول الصفحة</span>
              <span className="block text-sm text-accent-600">إطار ذهبي أنيق فوق صورة الصفحة في المصحف</span>
            </span>
            <span className={`w-12 h-7 rounded-full p-1 transition-smooth flex-shrink-0 ${goldFrame ? 'bg-amber-500' : 'bg-gray-300'}`}>
              <span className={`block w-5 h-5 bg-white rounded-full shadow transition-smooth ${goldFrame ? 'mr-auto' : ''}`} />
            </span>
          </button>
        </section>

        {/* Adhan prayer times — location (GPS or country-then-city),
            today's times, alert type and sound. */}
        <AdhanSettingsSection />

        {/* Part 1 — install the app itself (PWA): no Safari, no link
            bar, no fullscreen banner. Part 2 (the pages download
            below) is separate, so the app itself stays light. */}
        <section className="bg-white rounded-2xl border border-hairline shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
            <Smartphone className="w-5 h-5 text-emerald-600" /> ثبّت التطبيق على جهازك
          </h2>
          {isStandalone ? (
            <p className="text-sm text-emerald-700 font-bold">
              التطبيق مثبّت على جهازك ✓ — بيفتح من أيقونة الشاشة الرئيسية من غير سفاري ولا لينك فوق ولا شريط ملء الشاشة.
            </p>
          ) : (
            <>
              <p className="text-sm text-accent-600 mb-3">
                الخطوة الأولى قبل تحميل الصفحات: ثبّت التطبيق على الشاشة الرئيسية — كده بيشتغل زي تطبيقات الموبايل، من غير سفاري ولا لينك فوق ولا شريط ملء الشاشة.
              </p>
              {/* iOS PWA-orphan warning: the installed app has SEPARATE
                  storage from Safari (fresh login, counters at 0, and
                  any pages downloaded in Safari are NOT in the
                  installed app). Say so before the user installs, and
                  recommend install-first-then-download ordering. */}
              {installPlatform === 'ios' && (
                <p className="text-sm font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3 leading-relaxed">
                  تنبيه مهم قبل التثبيت على آيفون/آيباد: النسخة المثبتة لها مساحة تخزين منفصلة عن سفاري — بعد التثبيت هتحتاج تسجيل دخول من جديد، وأي صفحات حمّلتها من سفاري مش هتكون موجودة في النسخة المثبتة وهتحتاج تحميلها تاني. عشان كده: ثبّت الأول، وبعدين حمّل الصفحات من داخل التطبيق المثبت.
                </p>
              )}
              {installPrompt ? (
                <>
                  <button onClick={runInstallPrompt}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold rounded-xl transition-smooth">
                    ثبّت التطبيق الآن
                  </button>
                  {installOutcome && <p className="text-sm text-accent-500 mt-2">{installOutcome}</p>}
                </>
              ) : installPlatform === 'android' ? (
                <p className="text-sm font-bold text-accent-700 leading-relaxed">
                  من متصفح كروم على جهازك: افتح قائمة المتصفح (⋮) ثم اختر «إضافة إلى الشاشة الرئيسية» أو «تثبيت التطبيق»، وبعدين افتح التطبيق من الأيقونة الجديدة.
                </p>
              ) : installPlatform === 'ios' ? (
                <p className="text-sm font-bold text-accent-700 leading-relaxed">
                  من سفاري: اضغط زر المشاركة (Share) ثم «إضافة إلى الشاشة الرئيسية» (Add to Home Screen)، وبعدين افتح التطبيق من أيقونة الشاشة الرئيسية.
                </p>
              ) : (
                <p className="text-sm font-bold text-accent-700 leading-relaxed">
                  من قائمة المتصفح اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»، وبعدين افتح التطبيق من الأيقونة الجديدة.
                </p>
              )}
            </>
          )}
        </section>

        {/* Mushaf pages on the device — one-tap full download (Hafidz
            pattern): after this, every flip is a local read, instant
            on any connection, even offline. Madinah edition only. */}
        <section className="bg-white rounded-2xl border border-hairline shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
            <Download className="w-5 h-5 text-emerald-600" /> صفحات المصحف على جهازك
          </h2>
          <p className="text-sm text-accent-600 mb-4">
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
                  <p className="text-sm text-accent-600 mt-1">جارٍ التحميل… {dlDone.toLocaleString('ar-EG')} من ٦٠٤</p>
                </div>
              )}
              {dlFailed.length > 0 && !dlRunning && (
                <p className="text-sm text-amber-700 mb-3">تعذر تحميل {dlFailed.length.toLocaleString('ar-EG')} صفحة — دوس تحميل تاني عشان يكمل الناقص.</p>
              )}
              {dlUnverified.length > 0 && !dlRunning && (
                <p className="text-sm text-amber-700 mb-3">عدد {dlUnverified.length.toLocaleString('ar-EG')} صفحة اتحفظت من غير تأكيد (الشبكة منعت التأكد من سلامتها) — هي بتتفتح من غير نت، لكنها مش محسوبة في العداد، والتحميل الجاي هيأكدها ويحسبها.</p>
              )}
              {dlStopped && !dlRunning && (
                <p className="text-sm text-accent-600 mb-3">وقفت التحميل — اللي اتحمّل محفوظ، ودوس تاني عشان تكمل.</p>
              )}
              {dlError && !dlRunning && (
                <p className={`text-sm mb-3 ${dlQuotaFull ? 'text-red-600 font-bold' : 'text-red-600'}`}>{dlError}</p>
              )}
              {dlConfirm && !dlRunning ? (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 mb-3">
                  <p className="text-sm font-bold text-amber-800">
                    مصحف المدينة حجمه حوالي ٢٤٠ ميجابايت — يفضل واي فاي.
                    {dlSpace && dlSpace.freeMB !== null && ` المتاح على جهازك حوالي ${dlSpace.freeMB.toFixed(0)} ميجابايت، والتحميل محتاج حوالي ${dlSpace.neededMB.toLocaleString('ar-EG')} ميجابايت.`}
                    {' '}متأكد عايز تحمله على جهازك؟
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={startDownload}
                      className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl">
                      أيوه، حمّل
                    </button>
                    <button onClick={() => setDlConfirm(false)}
                      className="px-5 py-2 bg-white border border-hairline text-accent-700 font-bold rounded-xl">
                      إلغاء
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  {!dlRunning ? (
                    <button onClick={askDownload} disabled={dlCached !== null && dlCached >= 604}
                      className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl">
                      {dlCached !== null && dlCached > 0 && dlCached < 604 ? 'كمّل تحميل الناقص' : 'حمّل كل الصفحات'}
                    </button>
                  ) : (
                    <button onClick={stopDownload} disabled={dlStopping}
                      className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-accent-700 font-bold rounded-xl">
                      {dlStopping ? 'جارٍ الإيقاف…' : 'إيقاف التحميل'}
                    </button>
                  )}
                  {dlCached !== null && dlCached > 0 && !dlRunning && (
                    <button onClick={clearDownload}
                      className="px-5 py-2.5 bg-white border border-hairline text-accent-700 font-bold rounded-xl">
                      مسح المحمل
                    </button>
                  )}
                </div>
              )}
              <p className="text-xs text-accent-600 mt-3 leading-relaxed">
                {dlSpace?.persisted === true
                  ? 'التخزين محمي من المسح التلقائي على جهازك ✓ — والعداد هنا هيبين الناقص لو حصل أي مسح، ودوسة واحدة ترجّعه.'
                  : 'ملحوظة: المتصفح ممكن يمسح الصفحات لو مساحة الجهاز ضاقت — العداد هنا هيبين الناقص، ودوسة واحدة ترجّعه.'}
              </p>
              {/* Optional editions: nothing here downloads unless the
                  user picks that edition, and every start shows the
                  edition's size first (confirm box). */}
              <div className="border-t border-hairline mt-5 pt-4">
                <p className="font-bold text-accent-800 mb-1">مصاحف إضافية — اختياري</p>
                <p className="text-sm text-accent-600 mb-3">مفيش مصحف بيتحمل لوحده — كل واحد بيتحمل بس لو اخترته من هنا، وبحجمه قبل ما تدوس تحميل.</p>
                <div className="grid gap-3">
                  {EDITION_DOWNLOADS.filter((e) => e.id !== 'madinah').map((ed) => {
                    const st = optDl[ed.id] ?? emptyOpt();
                    const full = st.cached !== null && st.cached >= ed.pages;
                    return (
                      <div key={ed.id} className="rounded-xl border border-hairline p-4">
                        <p className="font-bold text-accent-800">{ed.name}</p>
                        <p className="text-sm text-accent-600">
                          حوالي {ed.approxMB.toLocaleString('ar-EG')} ميجابايت • {ed.pages.toLocaleString('ar-EG')} صفحة
                          {st.cached === null ? '' : full ? ' • كل الصفحات محملة ✓' : ` • محمل منها ${st.cached.toLocaleString('ar-EG')} من ${ed.pages.toLocaleString('ar-EG')}`}
                        </p>
                        {st.running && (
                          <div className="mt-3">
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(st.done / ed.pages) * 100}%` }} />
                            </div>
                            <p className="text-sm text-accent-600 mt-1">جارٍ التحميل… {st.done.toLocaleString('ar-EG')} من {ed.pages.toLocaleString('ar-EG')}</p>
                          </div>
                        )}
                        {st.failed.length > 0 && !st.running && (
                          <p className="text-sm text-amber-700 mt-2">تعذر تحميل {st.failed.length.toLocaleString('ar-EG')} صفحة — دوس تحميل تاني عشان يكمل الناقص.</p>
                        )}
                        {st.unverified.length > 0 && !st.running && (
                          <p className="text-sm text-amber-700 mt-2">عدد {st.unverified.length.toLocaleString('ar-EG')} صفحة اتحفظت من غير تأكيد (الشبكة منعت التأكد من سلامتها) — هي بتتفتح من غير نت، لكنها مش محسوبة في العداد، والتحميل الجاي هيأكدها ويحسبها.</p>
                        )}
                        {st.stopped && !st.running && (
                          <p className="text-sm text-accent-600 mt-2">وقفت التحميل — اللي اتحمّل محفوظ، ودوس تاني عشان تكمل.</p>
                        )}
                        {st.error && !st.running && (
                          <p className={`text-sm mt-2 ${st.quota ? 'text-red-600 font-bold' : 'text-red-600'}`}>{st.error}</p>
                        )}
                        {st.confirm && !st.running ? (
                          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3">
                            <p className="text-sm font-bold text-amber-800">
                              {ed.name} حجمه حوالي {ed.approxMB.toLocaleString('ar-EG')} ميجابايت — يفضل واي فاي.
                              {st.space && st.space.freeMB !== null && ` المتاح على جهازك حوالي ${st.space.freeMB.toFixed(0)} ميجابايت.`}
                              {' '}متأكد عايز تحمله على جهازك؟
                            </p>
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => startOptDownload(ed.id)}
                                className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl">
                                أيوه، حمّل
                              </button>
                              <button onClick={() => patchOpt(ed.id, { confirm: false })}
                                className="px-5 py-2 bg-white border border-hairline text-accent-700 font-bold rounded-xl">
                                إلغاء
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2 mt-3">
                            {!st.running ? (
                              <button onClick={() => askOptDownload(ed.id)} disabled={full}
                                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl">
                                {full ? 'محمل بالكامل ✓' : st.cached !== null && st.cached > 0 ? 'كمّل تحميل الناقص' : 'حمّل المصحف'}
                              </button>
                            ) : (
                              <button onClick={() => stopOptDownload(ed.id)} disabled={st.stopping}
                                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-accent-700 font-bold rounded-xl">
                                {st.stopping ? 'جارٍ الإيقاف…' : 'إيقاف التحميل'}
                              </button>
                            )}
                            {st.cached !== null && st.cached > 0 && !st.running && (
                              <button onClick={() => clearOptDownload(ed.id)}
                                className="px-5 py-2.5 bg-white border border-hairline text-accent-700 font-bold rounded-xl">
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
        <section className="bg-white rounded-2xl border border-hairline shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
            <Volume2 className="w-5 h-5 text-emerald-600" /> التلاوة والصوت
          </h2>
          <p className="text-sm text-accent-600 mb-4">القارئ الافتراضي لتلاوة الآيات.</p>
          <p className="text-sm font-semibold text-accent-700 mb-2">القارئ الافتراضي</p>
          <div className="flex flex-wrap gap-2 mb-5">
            {RECITERS.map((r) => (
              <button key={r.id} onClick={() => pickReciter(r.id)}
                className={`px-4 py-2 rounded-lg text-sm font-bold border transition-smooth ${reciterId === r.id ? 'bg-emerald-700 text-white border-emerald-600' : 'bg-gray-50 text-accent-600 border-hairline hover:bg-gray-100'}`}>
                {r.name}
              </button>
            ))}
          </div>
          <p className="text-sm font-semibold text-accent-700 mb-2">الجنس — يحدد صوت روابط الآيات</p>
          <p className="text-xs text-accent-600 mb-3">للرجال: الصوت الرجالي المولّد دائماً. للنساء: الصوت النسائي.</p>
          <div className="flex gap-2">
            <button onClick={() => pickGender('female')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-smooth ${linkGender === 'female' ? 'bg-emerald-700 text-white border-emerald-600' : 'bg-gray-50 text-accent-600 border-hairline hover:bg-gray-100'}`}>
              امرأة
            </button>
            <button onClick={() => pickGender('male')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-smooth ${linkGender === 'male' ? 'bg-emerald-700 text-white border-emerald-600' : 'bg-gray-50 text-accent-600 border-hairline hover:bg-gray-100'}`}>
              رجل
            </button>
          </div>
          {!linkGender && <p className="text-xs text-accent-600 mt-2">لم تختر بعد — التطبيق يستخدم الصوت النسائي حتى تختار.</p>}
        </section>

        {/* Language */}
        <section className="bg-white rounded-2xl border border-hairline shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-4">
            <Globe className="w-5 h-5 text-emerald-600" /> لغة التطبيق
          </h2>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((l) => (
              <button key={l.code} onClick={() => { setLang(l.code); saved(); }}
                className={`px-4 py-2 rounded-lg text-sm font-bold border transition-smooth ${lang === l.code ? 'bg-emerald-700 text-white border-emerald-600' : 'bg-gray-50 text-accent-600 border-hairline hover:bg-gray-100'}`}>
                {l.flag} {l.nativeName}
              </button>
            ))}
          </div>
        </section>

        {/* Password — logged-in change, no email link needed */}
        <section className="bg-white rounded-2xl border border-hairline shadow-sm p-5">
          <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
            <Lock className="w-5 h-5 text-emerald-600" /> كلمة السر
          </h2>
          <p className="text-sm text-accent-600 mb-4">غيّر كلمة السر من هنا على طول، من غير ما تستنى رابط إيميل.</p>
          <div className="relative">
            <input type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              placeholder="كلمة سر جديدة (٦ أحرف على الأقل)"
              className="w-full pr-4 pl-10 py-2.5 bg-gray-50 border border-hairline rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
            <button type="button" onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-accent-400 hover:text-accent-600">
              {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {passwordMsg && <p className="text-xs text-accent-600 mt-2">{passwordMsg}</p>}
          <button onClick={changePassword}
            className="mt-3 w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold rounded-xl transition-smooth">
            حفظ كلمة السر الجديدة
          </button>
        </section>

        {adminGateError && (
          <section className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5">
            <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
              <Shield className="w-5 h-5 text-amber-600" /> لوحة الإدارة
            </h2>
            <p className="text-sm text-accent-500 mb-4">تعذّر التأكد من صلاحية الإدارة — ده مش معناه إن حسابك مش أدمن. حاول تاني.</p>
            <button onClick={() => setAdminGateAttempt((a) => a + 1)}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-smooth">
              إعادة المحاولة
            </button>
          </section>
        )}

        {isAdmin && (
          <section className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-5">
            <h2 className="text-base font-bold text-accent-800 flex items-center gap-2 mb-1">
              <Shield className="w-5 h-5 text-emerald-600" /> لوحة الإدارة
            </h2>
            <p className="text-sm text-accent-600 mb-4">القسم ده بيظهر للأدمن بس — المستخدم العادي مش بيشوفه.</p>
            <button onClick={() => onNavigate('admin')}
              className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold rounded-xl transition-smooth">
              افتح لوحة الإدارة
            </button>
          </section>
        )}

        <button onClick={resetDefaults} disabled={resetting}
          className="w-full flex items-center justify-center gap-2 py-3 bg-white hover:bg-gray-50 text-accent-600 text-sm font-bold rounded-xl border border-hairline transition-smooth disabled:opacity-50">
          <RotateCcw className="w-5 h-5" /> {resetting ? 'جارٍ الاستعادة…' : 'استعادة الإعدادات الافتراضية'}
        </button>
        <p className="text-xs text-accent-400 leading-relaxed -mt-2">
          يعيد: شكل الصفحة، القارئ الافتراضي، الجنس (على الحساب كمان)، لغة التطبيق، وأجزاء الورد اليومي — مع الاحتفاظ بسجل إنجاز الورد. لا يمسّ موضعك في المصحف ولا إعدادات التسميع.
        </p>
        {resetMsg && <p className="text-sm font-semibold text-accent-700 -mt-2">{resetMsg}</p>}

        <details className="bg-white rounded-2xl border border-hairline shadow-sm p-5">
          <summary className="text-base font-bold text-accent-800 cursor-pointer">سجل تشخيص الاستماع (مؤقت)</summary>
          <p className="text-xs text-accent-400 leading-relaxed mt-2 mb-3">
            آخر ٣٠ حدثًا لتشخيص مشكلة الرجوع للرئيسية بعد قفل الشاشة — بعد ما تحصل المشكلة، افتح القسم ده وخد لقطة شاشة وأرسلها. لا يحتوي على أي رموز أو بيانات حساب.
          </p>
          <button onClick={() => setRecoveryLog(readRecoveryLog())}
            className="mb-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-smooth">
            تحديث السجل
          </button>
          {recoveryLog.length === 0 ? (
            <p className="text-sm text-accent-500">لا توجد أحداث بعد — اسمع شيئًا ثم اقفل الشاشة وارجع، وستظهر الأحداث هنا.</p>
          ) : (
            <pre dir="ltr" className="text-left text-xs leading-relaxed text-accent-700 bg-gray-50 rounded-xl p-3 overflow-auto max-h-96 whitespace-pre-wrap break-words">
              {[...recoveryLog].reverse().map((e) => {
                const { t, event, ...rest } = e;
                const time = new Date(t).toLocaleTimeString('en-GB');
                return `${time} ${event} ${JSON.stringify(rest)}`;
              }).join('\n')}
            </pre>
          )}
        </details>
      </div>

      <BottomNav current="settings" onNavigate={onNavigate} />
    </div>
  );
}
