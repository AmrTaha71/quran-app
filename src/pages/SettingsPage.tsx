import { useState, useEffect, useRef } from 'react';
import DrumSelect from '../components/DrumSelect';
import { resetHints } from '../lib/hints';
import Hint from '../components/Hint';
import { Settings, BookOpen, Volume2, Globe, RotateCcw, Check, Sparkles, CalendarDays, Shield, Lock, Eye, EyeOff, Download, Smartphone, Bell, Activity, Headphones, Compass, Share2, Info, BatteryCharging } from 'lucide-react';
import ShareSheet from '../components/ShareSheet';
import ContactForm from '../components/ContactForm';
import { supabase } from '../lib/supabase';
import { MUSHAF_EDITIONS as EDITIONS } from '../lib/mushafEditions';
import { MUSHAF_THEMES, THEME_HIGHLIGHTS, loadThemeId, saveThemeId, loadHl, saveHl, type MushafThemeId } from '../lib/mushafThemes';
import { RECITERS, DEFAULT_RECITER_ID } from '../lib/reciters';
import { LANGUAGES } from '../lib/translations';
import { loadWird, saveWird, WIRD_TYPE_LABEL, wirdTotal, formatPages, type WirdState, type WirdType } from '../lib/wird';
import { pageDownloadSupported, countCachedPages, clearCachedPages, downloadAllPages, checkDownloadSpace, requestPersistentStorage, estimateDownloadStorage, EDITION_DOWNLOADS } from '../lib/pageDownload';
import { SURAHS } from '../lib/surahs';
import { tafsirConfigured } from '../lib/threeModeListen';
import {
  AUDIO_DOWNLOAD_FAILED_MESSAGE, AUDIO_QUOTA_MESSAGE,
  audioDownloadSupported, audioDownloadsHaveUnknownSize, audioDownloadsTotalBytes,
  checkAudioDownloadSpace, deleteAudioDownload, downloadJuhaniSurah, downloadTafsirSurah,
  estimateJuhaniSurah, estimateTafsirSurah, formatAudioSize, isAudioDownloaded,
  listAudioDownloads,
  type AudioDownloadKind, type AudioDownloadMeta, type AudioSizeEstimate,
} from '../lib/audioDownload';
import {
  deleteDownloadedSurah, formatApproxSize, listDownloadedSurahs,
  type DownloadedSurah,
} from '../lib/listenOffline';
import { useLang } from '../lib/LanguageContext';
import { readRecoveryLog, type RecoveryLogEntry } from '../lib/listenRecovery';
import BottomNav from '../components/BottomNav';
import AdhanSettingsSection from '../components/AdhanSettingsSection';
import Collapsible from '../components/Collapsible';
import PageHeader from '../components/PageHeader';
import InstallGuide from '../components/InstallGuide';
import { loadDeviceChoice } from '../lib/deviceModel';
import CorrRecitersPanel from '../components/CorrRecitersPanel';
import SrsReviewSettings from '../components/SrsReviewSettings';
import DeleteAccountButton from '../components/DeleteAccountButton';
import BatterySaverSection from '../components/BatterySaverSection';
import { DailyReportSettings } from '../components/DailyReport';
import { pressFeedback, TAP_SOUND_KEY } from '../lib/pressFeedback';
import { clearOnboardingDone, ONBOARDING_REOPEN_EVENT } from '../components/Onboarding';
import { isMushafNight, setMushafNight } from '../lib/mushafNight';
import { isElderlyMode, setElderlyMode } from '../lib/elderlyMode';
import { setBackTarget } from '../lib/backTarget';
import { useAdminView, getAdminView } from '../lib/adminPreview';
import type { Route } from '../lib/routes';


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

// Today's date, Hijri (Umm al-Qura) + Gregorian. Offline: no network call.
function TodayDatesCard() {
  const now = new Date();
  let hijri = '';
  let greg = '';
  try {
    hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-arab', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  } catch {
    try { hijri = new Intl.DateTimeFormat('ar-SA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now); } catch { hijri = ''; }
  }
  try { greg = new Intl.DateTimeFormat('ar-EG-u-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric' }).format(now); } catch { greg = ''; }
  if (!hijri && !greg) return null;
  return (
    <section className="glass-card rounded-2xl p-4 md:p-5 flex items-center gap-3">
      <CalendarDays className="w-6 h-6 text-amber-600 shrink-0" />
      <div className="min-w-0">
        {hijri && <p className="text-base md:text-lg font-bold text-accent-800">{hijri}</p>}
        {greg && <p className="text-sm text-accent-600">{greg} م • التقويم الهجري (أم القرى)</p>}
      </div>
    </section>
  );
}

export default function SettingsPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const { lang, setLang } = useLang();
  // Settings hub (2026-11-04): null = hub grid of doors; otherwise
  // the id of the open door. All section state lives in this
  // component, so switching hub<->detail never loses a control.
  const [openDoor, setOpenDoor] = useState<string | null>(() => {
    try { const d = sessionStorage.getItem('quran-settings-door'); sessionStorage.removeItem('quran-settings-door'); return d; } catch { return null; }
  });
  const [hintsBack, setHintsBack] = useState(false);
  // W3-S4: the tour starts only once the device is set up (the device decides
  // layout and sizes). No device chosen yet -> open the device picker first and
  // say so; the tour starts from the next tap. Same reopen event as before.
  const [tourNote, setTourNote] = useState('');
  const startTour = () => {
    if (!loadDeviceChoice()) {
      setTourNote('اختار جهازك الأول، وبعدها اضغط على الجولة.');
      window.dispatchEvent(new Event('quran-open-device-picker'));
      return;
    }
    setTourNote('');
    clearOnboardingDone();
    window.dispatchEvent(new Event(ONBOARDING_REOPEN_EVENT));
    onNavigate('home');
  };
  // Shared back button (2026-11-06): while a Settings door is open,
  // the shell BackButton goes back to the hub instead of الرئيسية.
  // Cleanup on close/unmount clears it, so no stale target survives.
  useEffect(() => {
    if (openDoor === null) {
      setBackTarget(null);
      return;
    }
    setBackTarget({ label: 'عودة إلى الإعدادات', onBack: () => setOpenDoor(null) });
    return () => setBackTarget(null);
  }, [openDoor]);
  useEffect(() => { try { window.scrollTo(0, 0); } catch { /* ignore */ } }, [openDoor]);
  // "Digital Mushaf" (colour-changeable text page) is a choice here, not only a button inside the Mushaf.
  const [digitalOn, setDigitalOn] = useState(() => { try { return localStorage.getItem('quran-mushaf-digital') === '1'; } catch { return false; } });
  const [themeId, setThemeIdState] = useState<MushafThemeId>(loadThemeId);
  const [hlRgb, setHlRgb] = useState<string>(() => loadHl(loadThemeId()));
  const pickDigital = () => {
    setDigitalOn(true); setEditionIdx(0); setPreviewFailed(false);
    try { localStorage.setItem('quran-mushaf-digital', '1'); localStorage.setItem('quran-mushaf-edition', '0'); } catch { /* ignore */ }
    saved();
  };
  const [editionIdx, setEditionIdx] = useState(() =>
    readStored('quran-mushaf-edition', 0, (raw) => {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 0 && n < EDITIONS.length ? n : null;
    })
  );
  const [goldFrame, setGoldFrame] = useState(() => {
    try { return localStorage.getItem('quran-gold-frame') === '1'; } catch { return false; }
  });
  const [mushafNight, setMushafNightState] = useState(isMushafNight);
  const [elderlyMode, setElderlyModeState] = useState(isElderlyMode);
  // Tap sound (visual batch 2026-11-04): soft click on nav + Home
  // presses, default ON. pressFeedback reads this key live, so the
  // toggle takes effect immediately with no cross-page state.
  const [tapSound, setTapSound] = useState(() => {
    try { return localStorage.getItem(TAP_SOUND_KEY) !== '0'; } catch { return true; }
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
  // Audio downloads manager (2026-11-05): tafsir clips + Juhani
  // surah files, per surah, Cache API (src/lib/audioDownload.ts)
  // — plus the khatma surah downloads (IndexedDB, downloaded
  // from ListenPage) listed here with their sizes, so everything
  // downloaded lives in one place. One job at a time: every start
  // goes through a size estimate + space preflight first (confirm
  // flag) — nothing here ever downloads without the user choosing
  // that surah. 'low' refuses with the quota message instead of
  // opening the confirm box.
  const audioSurahName = (n: number) => SURAHS.find((s) => s.no === n)?.name ?? String(n);
  const [audioSupported] = useState(audioDownloadSupported);
  const [audioList, setAudioList] = useState<AudioDownloadMeta[]>(() => listAudioDownloads());
  const [khatmaList, setKhatmaList] = useState<DownloadedSurah[]>(() => listDownloadedSurahs());
  const [audioStorage, setAudioStorage] = useState<{ freeMB: number | null; persisted: boolean | null } | null>(null);
  const [tafsirPick, setTafsirPick] = useState(1);
  const [juhaniPick, setJuhaniPick] = useState(114);
  type AudioJob = {
    kind: AudioDownloadKind; surah: number;
    phase: 'estimating' | 'confirm' | 'running' | 'done';
    estimate: AudioSizeEstimate | null;
    space: { neededMB: number; freeMB: number | null } | null;
    progress: { done: number; total: number } | null;
    error: string; quota: boolean;
  };
  const [audioJob, setAudioJob] = useState<AudioJob | null>(null);
  const audioAbortRef = useRef<AbortController | null>(null);
  const refreshAudioLists = () => {
    setAudioList(listAudioDownloads());
    setKhatmaList(listDownloadedSurahs());
  };
  useEffect(() => {
    if (openDoor !== 'audio') return;
    refreshAudioLists();
    void estimateDownloadStorage().then((est) => setAudioStorage({ freeMB: est.freeMB, persisted: est.persisted }));
  }, [openDoor]);
  const askAudioDownload = async (kind: AudioDownloadKind, surah: number) => {
    if (audioJob?.phase === 'running' || audioJob?.phase === 'estimating') return;
    setAudioJob({ kind, surah, phase: 'estimating', estimate: null, space: null, progress: null, error: '', quota: false });
    try {
      const est = kind === 'tafsir' ? await estimateTafsirSurah(surah) : await estimateJuhaniSurah(surah);
      const space = await checkAudioDownloadSpace(est.bytes);
      const persisted = await requestPersistentStorage();
      setAudioStorage({ freeMB: space.freeMB, persisted: persisted ?? space.persisted });
      if (space.status === 'low') {
        setAudioJob({ kind, surah, phase: 'done', estimate: est, space: { neededMB: space.neededMB, freeMB: space.freeMB }, progress: null, error: `مساحة جهازك لا تكفي — التحميل يحتاج حوالي ${space.neededMB.toLocaleString('ar-EG')} ميجابايت (بهامش أمان) والمتاح حوالي ${(space.freeMB ?? 0).toFixed(0)} ميجابايت. فضّي مساحة وحاول تاني.`, quota: true });
        return;
      }
      setAudioJob({ kind, surah, phase: 'confirm', estimate: est, space: { neededMB: space.neededMB, freeMB: space.freeMB }, progress: null, error: '', quota: false });
    } catch {
      setAudioJob({ kind, surah, phase: 'done', estimate: null, space: null, progress: null, error: AUDIO_DOWNLOAD_FAILED_MESSAGE, quota: false });
    }
  };
  const startAudioDownload = async () => {
    const job = audioJob;
    if (!job || job.phase !== 'confirm') return;
    audioAbortRef.current = new AbortController();
    setAudioJob({ ...job, phase: 'running', progress: { done: 0, total: job.estimate?.count ?? 1 }, error: '', quota: false });
    try {
      if (job.kind === 'tafsir') {
        await downloadTafsirSurah(job.surah, (p) => setAudioJob((prev) => prev ? { ...prev, progress: p } : prev), { signal: audioAbortRef.current.signal });
      } else {
        await downloadJuhaniSurah(job.surah, (p) => setAudioJob((prev) => prev ? { ...prev, progress: p } : prev), { signal: audioAbortRef.current.signal });
      }
      refreshAudioLists();
      setAudioJob({ ...job, phase: 'done', progress: null, error: '' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : AUDIO_DOWNLOAD_FAILED_MESSAGE;
      setAudioJob({ ...job, phase: 'done', progress: null, error: msg, quota: msg === AUDIO_QUOTA_MESSAGE });
    } finally {
      audioAbortRef.current = null;
    }
  };
  const stopAudioDownload = () => {
    audioAbortRef.current?.abort();
  };
  const clearAudioDownload = async (kind: AudioDownloadKind, surah: number) => {
    await deleteAudioDownload(kind, surah);
    refreshAudioLists();
  };
  const clearKhatmaDownload = async (reciter: string, surah: number) => {
    await deleteDownloadedSurah(reciter, surah);
    refreshAudioLists();
  };
  // W3-S3: bulk delete (per reciter / per kind / all). Two taps: the first
  // arms the button («تأكيد المسح»), the second deletes. The same delete
  // functions as the per-surah buttons, just looped.
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const tafsirItems = audioList.filter((e) => e.kind === 'tafsir');
  const juhaniItems = audioList.filter((e) => e.kind === 'juhani');
  const khatmaByReciter = Object.values(khatmaList.reduce<Record<string, { reciter: string; items: DownloadedSurah[]; bytes: number }>>((acc, e) => {
    const g = acc[e.reciter] ?? (acc[e.reciter] = { reciter: e.reciter, items: [], bytes: 0 });
    g.items.push(e);
    g.bytes += e.bytes;
    return acc;
  }, {}));
  const clearKhatmaReciter = async (reciter: string) => {
    for (const e of khatmaList.filter((x) => x.reciter === reciter)) await deleteDownloadedSurah(e.reciter, e.surah);
    refreshAudioLists();
  };
  const clearAudioKind = async (kind: AudioDownloadKind) => {
    for (const e of audioList.filter((x) => x.kind === kind)) await deleteAudioDownload(kind, e.surah);
    refreshAudioLists();
  };
  const clearAllAudio = async () => {
    for (const e of khatmaList) await deleteDownloadedSurah(e.reciter, e.surah);
    for (const e of audioList) await deleteAudioDownload(e.kind, e.surah);
    refreshAudioLists();
  };
  const clearButton = (id: string, label: string, action: () => Promise<void>, wide = false) =>
    confirmClear === id ? (
      <span className={`flex gap-2 ${wide ? 'w-full' : ''}`}>
        <button
          onClick={() => { setConfirmClear(null); void action(); }}
          className={`px-4 py-2 min-h-[44px] bg-red-600 text-white font-bold rounded-xl polish-press ${wide ? 'flex-1' : ''}`}
        >
          تأكيد المسح
        </button>
        <button
          onClick={() => setConfirmClear(null)}
          className="px-4 py-2 min-h-[44px] bg-cream border border-hairline text-accent-700 font-semibold rounded-xl polish-press"
        >
          إلغاء
        </button>
      </span>
    ) : (
      <button
        onClick={() => setConfirmClear(id)}
        className={`px-4 py-2 min-h-[44px] bg-cream border border-red-300 text-red-700 font-semibold rounded-xl polish-press whitespace-nowrap ${wide ? 'w-full' : ''}`}
      >
        {label}
      </button>
    );
  // ADMIN ENTRY (2026-10-27): shown ONLY to users in admin_users.
  // Normal users never see this section — and BottomNav stays at
  // its final 5 items, so الإدارة lives here, not as a tab.
  const [isAdmin, setIsAdmin] = useState(false);
  // Admin preview (W2-4): «شوف كمستخدم» hides the admin door and the
  // diagnostics without touching the real isAdmin check above.
  const { viewAsUser } = useAdminView();
  const showAdminUi = isAdmin && !viewAsUser;
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
          // Diagnostics (stamp lines, diag door) are admin-only; the flag
          // lets SelfTest hide its debug lines for normal users.
          try { localStorage.setItem('quran-show-diag', row && !getAdminView().viewAsUser ? '1' : '0'); } catch { /* storage off */ }
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
    setDigitalOn(false);
    setPreviewFailed(false);
    try { localStorage.setItem('quran-mushaf-edition', String(i)); localStorage.setItem('quran-mushaf-digital', '0'); } catch {}
    saved();
  };
  const toggleGold = () => {
    const next = !goldFrame;
    setGoldFrame(next);
    try { localStorage.setItem('quran-gold-frame', next ? '1' : '0'); } catch {}
    saved();
  };
  const toggleNight = () => {
    const next = !mushafNight;
    setMushafNightState(next);
    setMushafNight(next);
    saved();
  };
  const toggleElderly = () => {
    const next = !elderlyMode;
    setElderlyModeState(next);
    setElderlyMode(next);
    saved();
  };
  const toggleTapSound = () => {
    const next = !tapSound;
    setTapSound(next);
    try { localStorage.setItem(TAP_SOUND_KEY, next ? '1' : '0'); } catch {}
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
      'سيُعاد: المصحف المختار، القارئ الافتراضي، الجنس، لغة التطبيق، وأجزاء الورد اليومي.\n' +
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
    setTapSound(true);
    setMushafNightState(false);
    setMushafNight(false);
    try {
      localStorage.setItem('quran-mushaf-edition', '0');
      localStorage.setItem('quran-gold-frame', '0');
      localStorage.setItem('quran-reciter', DEFAULT_RECITER_ID);
      localStorage.setItem(TAP_SOUND_KEY, '1');
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

  // Settings hub doors (2026-11-04): one door per setting category.
  // Titles/subtitles are labels only — every control lives in its
  // detail view, unchanged. The admin door renders only when its
  // section would (admin error or admin user), exactly as before.
  const doors = [
    { id: 'onboarding', icon: Compass, title: 'جولة تعريفية', sub: 'شوف شرح التطبيق من الأول', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'wird', icon: CalendarDays, title: 'وردك اليومي', sub: '', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'srs', icon: BookOpen, title: 'مراجعة الآيات الضعيفة', sub: 'كل قد إيه ترجعلك الكلمة', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'look', icon: Sparkles, title: 'اختر مصحفك', sub: 'مصحف رقمي بألوانك أو مصحف مصوّر', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'adhan', icon: Bell, title: 'مواعيد الأذان', sub: '', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'battery', icon: BatteryCharging, title: 'توفير البطارية', sub: 'خيارات تقلل الاستهلاك', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'device', icon: Smartphone, title: 'جهازك', sub: 'نوعه وحجمه وطريقة مسكه', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'pwa', icon: Smartphone, title: 'تثبيت التطبيق', sub: 'أضفه إلى الشاشة الرئيسية', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'download', icon: Download, title: 'تحميل المصحف', sub: '', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'reciters', icon: Headphones, title: 'عايز مين يسمّعلك؟', sub: 'قارئ التصحيح والتسميع', box: 'bg-amber-50 border-hairline-amber', fg: 'text-amber-700' },
    { id: 'audio', icon: Headphones, title: 'التنزيلات الصوتية', sub: 'الختمة والتفسير دون نت', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'voice', icon: Volume2, title: 'التلاوة والصوت', sub: '', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'lang', icon: Globe, title: 'لغة التطبيق', sub: '', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'pass', icon: Lock, title: 'كلمة السر', sub: 'تغيير كلمة السر مباشرة', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'admin', icon: Shield, title: 'لوحة الإدارة', sub: 'للأدمن فقط', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'reset', icon: RotateCcw, title: 'استعادة الافتراضي', sub: 'إعادة الضبط مع حفظ الإنجاز', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'diag', icon: Activity, title: 'سجل تشخيص الاستماع', sub: 'آخر ٣٠ حدثًا (مؤقت)', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'share', icon: Share2, title: 'شارك التطبيق', sub: 'شاركنا الأجر', box: 'bg-amber-50 border-hairline-amber', fg: 'text-amber-700' },
    { id: 'about', icon: Info, title: 'تواصل معنا', sub: 'وعن التطبيق', box: 'bg-emerald-50 border-hairline-emerald', fg: 'text-emerald-700' },
    { id: 'account-delete', icon: Shield, title: 'حسابي', sub: 'مسح الحساب والبيانات', box: 'bg-red-50 border-red-200', fg: 'text-red-700' },
  ];

  // One download card per audio kind (tafsir / Juhani): surah
  // picker + estimate → confirm → progress, then the list of
  // downloaded surahs of that kind with delete. Pure render
  // helper (no hooks) — state lives in the component above.
  const audioKindCard = (kind: AudioDownloadKind) => {
    const isTafsir = kind === 'tafsir';
    const pick = isTafsir ? tafsirPick : juhaniPick;
    const setPick = isTafsir ? setTafsirPick : setJuhaniPick;
    const downloaded = audioList.filter((e) => e.kind === kind);
    const job = audioJob?.kind === kind ? audioJob : null;
    const pickDownloaded = isAudioDownloaded(kind, pick);
    return (
      <div>
        <p className="sr-only">{isTafsir ? 'تفسير الآيات (صوت)' : 'ملفات الجهني (حدر)'}</p>
        <Hint id="set-audio-kind"><p className="text-sm text-accent-600 mb-3">
          {isTafsir
            ? 'تفسير الميسر بصوت مجمع الملك فهد، مقطع لكل آية. الفاتحة حوالي ٢ ميجا، والبقرة حوالي ٧٠ ميجا.'
            : 'السورة كاملة بصوت الجهني للحدر، وتخلّي تصحيح التسميع أسرع (سور جزء عم ٧٨–١١٤). البقرة حوالي ٩٦ ميجا.'}
        </p></Hint>
        {isTafsir && !tafsirConfigured() ? (
          <p className="text-sm text-amber-link bg-amber-50 border border-hairline-amber rounded-xl px-3 py-2">
            مقاطع التفسير لم تُرفع بعد — سيُتاح التحميل هنا بعد رفع المقاطع.
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <DrumSelect
                  label="السورة"
                  value={pick}
                  disabled={job?.phase === 'running' || job?.phase === 'estimating'}
                  onChange={(n) => setPick(n)}
                  options={SURAHS.map((x) => ({ value: x.no, label: `${x.no} — ${x.name}` }))}
                />
              </div>
              {pickDownloaded ? (
                <span className="px-4 py-3 bg-emerald-100 text-emerald-800 font-semibold rounded-xl whitespace-nowrap">
                  محملة ✓
                </span>
              ) : job?.phase === 'estimating' ? (
                <span className="px-4 py-3 bg-gray-100 text-accent-700 font-semibold rounded-xl whitespace-nowrap">
                  جارٍ تقدير الحجم…
                </span>
              ) : job?.phase === 'running' ? (
                <button
                  onClick={stopAudioDownload}
                  className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-accent-700 font-semibold rounded-xl whitespace-nowrap polish-press"
                >
                  إيقاف التحميل
                </button>
              ) : (
                <button
                  onClick={() => void askAudioDownload(kind, pick)}
                  className="px-4 py-3 grad-emerald-door text-white font-bold rounded-xl whitespace-nowrap polish-press polish-focus"
                >
                  حمّل السورة
                </button>
              )}
            </div>
            {job?.phase === 'running' && job.progress && (
              <div className="mt-3">
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(job.progress.done / Math.max(1, job.progress.total)) * 100}%` }} />
                </div>
                <p className="text-sm text-accent-600 mt-1">
                  جارٍ التحميل… {job.progress.done.toLocaleString('ar-EG')} من {job.progress.total.toLocaleString('ar-EG')}
                  {isTafsir ? ' مقطع' : ''}
                </p>
              </div>
            )}
            {job?.phase === 'running' && !job.progress && (
              <p className="text-sm text-accent-600 mt-3">جارٍ التحميل…</p>
            )}
            {job?.phase === 'confirm' && job.estimate && (
              <div className="mt-3 rounded-xl bg-amber-50 border border-hairline-amber p-3">
                <p className="text-sm font-medium text-amber-800">
                  سورة {audioSurahName(job.surah)} حجمها {formatAudioSize(job.estimate.bytes)}
                  {job.estimate.count > 1 ? ` — ${job.estimate.count.toLocaleString('ar-EG')} مقطع` : ''}
                  {job.space && job.space.freeMB !== null && ` — المتاح على جهازك حوالي ${job.space.freeMB.toFixed(0)} ميجابايت.`}
                  {' '}متأكد عايز تحمّلها على جهازك؟
                </p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => void startAudioDownload()}
                    className="flex-1 py-2 grad-amber-door text-white font-bold rounded-xl polish-press polish-focus">
                    أيوه، حمّل
                  </button>
                  <button onClick={() => setAudioJob(null)}
                    className="px-5 py-2 bg-cream border border-hairline text-accent-700 font-semibold rounded-xl polish-press">
                    إلغاء
                  </button>
                </div>
              </div>
            )}
            {job?.phase === 'done' && job.error && (
              <p className={`text-sm mt-3 ${job.quota ? 'text-red-600 font-medium' : 'text-red-600'}`}>{job.error}</p>
            )}
            {job?.phase === 'done' && !job.error && (
              <p className="text-sm font-semibold text-emerald-700 mt-3">تم التحميل ✓ — سورة {audioSurahName(job.surah)} متاحة دون اتصال.</p>
            )}
          </>
        )}
        {downloaded.length > 0 && (
          <div className="grid gap-2 mt-3">
            {downloaded.map((e) => (
              <div key={`${e.kind}-${e.surah}`} className="flex items-center justify-between gap-3 rounded-xl border border-hairline p-3">
                <div>
                  <p className="font-semibold text-accent-800">سورة {audioSurahName(e.surah)}</p>
                  <p className="text-sm text-accent-600">
                    {formatAudioSize(e.bytes)}{e.count > 1 ? ` • ${e.count.toLocaleString('ar-EG')} مقطع` : ''}
                  </p>
                </div>
                <button
                  onClick={() => void clearAudioDownload(e.kind, e.surah)}
                  className="px-4 py-2 bg-cream border border-hairline text-accent-700 font-semibold rounded-xl polish-press"
                >
                  مسح
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen page-bg pb-24 route-in">
      {/* W3-S4: thin shared header; the tour icon sits first, at the very top. */}
      <PageHeader
        sticky
        title="الإعدادات"
        icon={Settings}
        actions={(
          <>
            {savedTick && (
              <span className="flex items-center gap-1 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-hairline-emerald rounded-full px-3 py-1">
                <Check className="w-4 h-4" /> تم الحفظ
              </span>
            )}
            <button
              type="button"
              onPointerDown={pressFeedback}
              onClick={startTour}
              aria-label="الجولة التعريفية"
              title="الجولة التعريفية"
              className="grad-emerald-door polish-press w-11 h-11 rounded-xl flex items-center justify-center text-white"
            >
              <Compass className="w-6 h-6" />
            </button>
          </>
        )}
      />
      {tourNote && (
        <div className="max-w-5xl mx-auto px-4 sm:px-5 md:px-6 lg:px-8 pt-3">
          <p className="text-sm font-semibold text-amber-800 bg-amber-50 border border-hairline-amber rounded-xl px-3 py-2" role="status">{tourNote}</p>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 sm:px-5 md:px-6 lg:px-8 py-6 md:py-8 space-y-6 md:space-y-8">
        {openDoor === null && <TodayDatesCard />}
        {openDoor === null ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
            {doors.filter((d) => (d.id !== 'admin' || adminGateError || showAdminUi) && (d.id !== 'diag' || showAdminUi)).map((d, i) => (
              <button key={d.id} onPointerDown={pressFeedback} onClick={() => setOpenDoor(d.id)}
                style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
                className="text-right p-4 sm:p-5 md:p-6 lg:p-7 glass-card rounded-2xl door-enter polish-press">
                <span className="w-11 h-11 sm:w-12 sm:h-12 md:w-16 md:h-16 lg:w-20 lg:h-20 rounded-xl md:rounded-2xl border border-[rgba(134,101,26,0.40)] bg-gradient-to-br from-emerald-50 to-emerald-100 flex items-center justify-center mb-3 md:mb-4">
                  <d.icon className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 lg:w-9 lg:h-9 text-emerald-800" />
                </span>
                <span className="block text-sm sm:text-base md:text-lg lg:text-xl font-semibold text-ink">{d.title}</span>
                {d.sub && <span className="block text-xs sm:text-sm lg:text-base text-ink-2 mt-1 md:mt-2">{d.sub}</span>}
              </button>
            ))}
          </div>
        ) : (
          <div key={openDoor} className="polish-fade-up space-y-6 md:space-y-8">
            {openDoor === 'wird' && (<>
        {/* Daily wird — FIRST section by request: the user sets all
            THREE parts in this one window (pages per part, 0 = skip
            that part today), presses حفظ once, and the saved wird
            shows in a line right under the button. The لوحتي card
            reads the saved value, so it only changes on save. */}
        <section id="sec-wird" className="glass-card rounded-2xl scroll-mt-36 p-5 md:p-6 lg:p-7">
          <h2 className="text-base md:text-lg font-semibold text-accent-800 flex items-center gap-2 mb-1">
            <CalendarDays className="w-5 h-5 text-amber-600" /> وردك اليومي
          </h2>
          <Hint id="set-wird"><p className="text-sm text-accent-600 mb-4">حدّد أجزاء ورد اليوم الثلاثة هنا — عدد الصفحات لكل جزء (0 يعني لا ورد من هذا النوع اليوم) — وبعدين اضغط حفظ مرة واحدة.</p></Hint>
          {(Object.keys(WIRD_TYPE_LABEL) as WirdType[]).map((k) => (
            <div key={k} className="flex items-center justify-between gap-3 mb-3">
              <p className="text-sm font-semibold text-accent-700">{WIRD_TYPE_LABEL[k]}</p>
              <div className="flex items-center gap-3">
                <button onClick={() => updateDraftWird({ parts: { ...draftWird.parts, [k]: Math.max(0, draftWird.parts[k] - 1) } })}
                  className="w-9 h-9 text-lg font-bold bg-gray-100 hover:bg-gray-200 rounded-full polish-press">−</button>
                <span className="text-lg font-bold text-accent-800 w-8 text-center">{draftWird.parts[k].toLocaleString('ar-EG')}</span>
                <button onClick={() => updateDraftWird({ parts: { ...draftWird.parts, [k]: Math.min(10, draftWird.parts[k] + 1) } })}
                  className="w-9 h-9 text-lg font-bold bg-gray-100 hover:bg-gray-200 rounded-full polish-press">+</button>
              </div>
            </div>
          ))}
          <p className="text-sm font-semibold text-accent-700 mb-5">
            المجموع: {formatPages(wirdTotal(draftWird.parts))} يوميًا
          </p>
          <button onClick={saveWirdChoice} disabled={wirdTotal(draftWird.parts) === 0}
            className="w-full py-3 grad-emerald-door disabled:opacity-50 text-white text-base font-bold rounded-xl transition-smooth polish-press polish-focus">
            حفظ
          </button>
          {wirdTotal(draftWird.parts) === 0 && (
            <p className="mt-2 text-sm font-semibold text-amber-link">اختر صفحة واحدة على الأقل في جزء واحد قبل الحفظ.</p>
          )}
          {justSavedWird && (
            <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
              <Check className="w-4 h-4" /> تم الحفظ
            </p>
          )}
          <p className="mt-2 text-sm font-semibold text-accent-700 bg-amber-50 border border-hairline-amber rounded-xl px-3 py-2">
            وردك اليومي المسجل: {wirdTotal(wird.parts) === 0
              ? 'لم يتم تحديد ورد بعد'
              : (Object.keys(WIRD_TYPE_LABEL) as WirdType[]).filter((k) => wird.parts[k] > 0).map((k) => `${WIRD_TYPE_LABEL[k]} — ${formatPages(wird.parts[k])}`).join('، ')} يوميًا
          </p>
        </section>
            </>)}
            {openDoor === 'srs' && <SrsReviewSettings />}
            {openDoor === 'look' && (<>
        {/* Page look — the section the user asked for by name */}
        <section id="sec-look" className="glass-card rounded-2xl scroll-mt-36 p-5 md:p-6 lg:p-7">
          <h2 className="text-base md:text-lg font-semibold text-accent-800 flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-amber-link" /> اختر مصحفك
          </h2>
          <Hint id="set-edition"><p className="text-sm text-accent-600 mb-4">شكل صفحة المصحف اللي بتحبها وإطارها — ده اللي هيتفتح بيه المصحف كل مرة.</p></Hint>
          <div className="grid gap-3 sm:grid-cols-2">
            <button onClick={pickDigital}
              className={`text-right p-4 rounded-xl border-2 transition-smooth sm:col-span-2 ${digitalOn ? 'border-emerald-500 bg-emerald-50' : 'border-hairline hover:border-hairline-emerald hover:bg-emerald-50/50'}`}>
              <p className="font-semibold text-accent-800 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-link" /> المصحف الرقمي بألوانك
                {digitalOn && <Check className="w-5 h-5 text-emerald-600 mr-auto" />}
              </p>
              <p className="text-sm text-accent-600 mt-1">صفحة مصحف المدينة بنص رقمي هادي — بتختار لون الصفحة والتظليل اللي يريّح عينك، وأحكام التجويد ملوّنة</p>
            </button>
            {digitalOn && (
              <div className="sm:col-span-2 grid grid-cols-5 gap-2">
                {MUSHAF_THEMES.map((t) => (
                  <button key={t.id} onClick={() => { setThemeIdState(t.id); saveThemeId(t.id); setHlRgb(loadHl(t.id)); saved(); }}
                    className={`flex flex-col items-center gap-1 rounded-xl p-1.5 ${themeId === t.id ? 'ring-2 ring-emerald-600' : 'ring-1 ring-black/10'}`}>
                    <span className="w-full h-10 rounded-lg flex items-center justify-center text-base font-bold" style={{ background: t.bg, color: t.ink, boxShadow: `inset 0 0 0 1.5px ${t.frame}` }}>
                      <span style={{ background: `rgba(${t.hl}, 0.85)`, padding: '0 4px', borderRadius: 4 }}>أ</span>
                    </span>
                    <span className="text-[11px] text-accent-800 leading-tight text-center">{t.name}</span>
                  </button>
                ))}
                <p className="col-span-5 text-xs font-bold text-accent-700 mt-1">لون التظليل المناسب</p>
                {THEME_HIGHLIGHTS[themeId].map((h) => {
                  const t = MUSHAF_THEMES.find((x) => x.id === themeId)!;
                  return (
                    <button key={h.id} onClick={() => { setHlRgb(h.rgb); saveHl(themeId, h.rgb); saved(); }}
                      className={`flex flex-col items-center gap-1 rounded-xl p-1.5 ${hlRgb === h.rgb ? 'ring-2 ring-emerald-600' : 'ring-1 ring-black/10'}`}>
                      <span className="w-full h-8 rounded-lg flex items-center justify-center text-base font-bold" style={{ background: t.bg, color: t.ink, boxShadow: `inset 0 0 0 1.5px ${t.frame}` }}>
                        <span style={{ background: `rgba(${h.rgb}, 0.9)`, padding: '0 6px', borderRadius: 4 }}>بِسْمِ</span>
                      </span>
                      <span className="text-[11px] text-accent-800 leading-tight text-center">{h.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {EDITIONS.map((ed, i) => (
              <button key={ed.id} onClick={() => pickEdition(i)}
                className={`text-right p-4 rounded-xl border-2 transition-smooth ${editionIdx === i && !digitalOn ? 'border-emerald-500 bg-emerald-50' : 'border-hairline hover:border-hairline-emerald hover:bg-emerald-50/30'}`}>
                <p className="font-semibold text-accent-800 flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-emerald-600" /> {ed.name}
                  {editionIdx === i && !digitalOn && <Check className="w-5 h-5 text-emerald-600 mr-auto" />}
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
            <p className="text-sm font-semibold text-accent-700 mb-2">معاينة: {digitalOn ? 'المصحف الرقمي' : EDITIONS[editionIdx].name}</p>
            <div className="relative mx-auto w-full max-w-[300px] rounded-2xl overflow-hidden shadow-lg bg-amber-50">
              {previewFailed ? (
                <p className="text-sm text-accent-600 text-center py-16 px-4">تعذر تحميل المعاينة — افتح المصحف لرؤية الصفحة</p>
              ) : (
                <>
                  <img key={EDITIONS[editionIdx].id} src={EDITIONS[editionIdx].imageUrl(EDITIONS[editionIdx].id === 'madinah' ? 3 : 2)} alt="معاينة صفحة المصحف"
                    onError={() => setPreviewFailed(true)}
                    className="w-full block" style={{ aspectRatio: '0.707' }} />
                  {goldFrame && (
                    <div className="absolute inset-0 pointer-events-none"
                      style={{ boxShadow: 'inset 0 0 0 3px #b48214, inset 0 0 0 8px #f0c85a' }} />
                  )}
                </>
              )}
            </div>
            <p className="text-xs text-accent-600 text-center mt-2">نفس الشكل اللي هيتفتح بيه المصحف</p>
          </div>
          <button onClick={toggleNight}
            className={`mt-3 w-full flex items-center justify-between p-4 rounded-xl border-2 transition-smooth ${mushafNight ? 'border-amber-400 bg-amber-50' : 'border-hairline hover:border-hairline-amber'}`}>
            <span className="text-right">
              <span className="block font-medium text-accent-800">خلفية القراءة الليلية</span>
              <span className="block text-sm text-accent-600">تعتيم هادئ لهوامش صفحة المصحف — صورة الصفحة نفسها لا تتغير</span>
            </span>
            <span className={`w-12 h-7 rounded-full p-1 transition-smooth flex-shrink-0 ${mushafNight ? 'bg-amber-500' : 'bg-gray-300'}`}>
              <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${mushafNight ? 'ltr:translate-x-5 rtl:-translate-x-5' : ''}`} />
            </span>
          </button>
          <button onClick={toggleElderly}
            className={`mt-3 w-full flex items-center justify-between p-4 rounded-xl border-2 transition-smooth ${elderlyMode ? 'border-amber-400 bg-amber-50' : 'border-hairline hover:border-hairline-amber'}`}>
            <span className="text-right">
              <span className="block font-medium text-accent-800">وضع كبار السن</span>
              <span className="block text-sm text-accent-600">خط أكبر وتباين أعلى وصفحة رئيسية مبسطة</span>
            </span>
            <span className={`w-12 h-7 rounded-full p-1 transition-smooth flex-shrink-0 ${elderlyMode ? 'bg-amber-500' : 'bg-gray-300'}`}>
              <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${elderlyMode ? 'ltr:translate-x-5 rtl:-translate-x-5' : ''}`} />
            </span>
          </button>
        </section>
            </>)}
            {openDoor === 'battery' && (<>
        <BatterySaverSection />
            </>)}
            {openDoor === 'device' && (<>
        <section className="bg-white rounded-2xl border border-hairline shadow-sm p-5 space-y-3">
          <p className="text-sm text-ink-2">{(() => { const c = loadDeviceChoice(); return c ? `${c.brand} — ${c.model} — ${c.variant}` : 'لسه ما اخترتش جهازك'; })()}</p>
          <button type="button" onClick={() => window.dispatchEvent(new Event('quran-open-device-picker'))} className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold">غيّر جهازك</button>
        </section>
            </>)}
            {openDoor === 'adhan' && (<>
        {/* Adhan prayer times — location (GPS or country-then-city),
            today's times, alert type and sound. */}
        <AdhanSettingsSection />
            </>)}
            {openDoor === 'pwa' && (<>
        <InstallGuide />
            </>)}
            {openDoor === 'download' && (<>
        {/* Mushaf pages on the device — one-tap full download (Hafidz
            pattern): after this, every flip is a local read, instant
            on any connection, even offline. Madinah edition only. */}
        <section id="sec-download" className="glass-card rounded-2xl scroll-mt-36 p-5 md:p-6 lg:p-7">
          <h2 className="text-base md:text-lg font-semibold text-accent-800 flex items-center gap-2 mb-1">
            <Download className="w-5 h-5 text-emerald-600" /> تحميل المصحف
          </h2>
          <Hint id="set-pages"><p className="text-sm text-accent-600 mb-4">
            مصحف المدينة هو الافتراضي: حمّل صفحاته الـ ٦٠٤ مرة واحدة على جهازك — بعدها تقليب الصفحات بيبقى فوري ومن غير نت، حتى لو الاتصال ضعيف. الحجم الكلي حوالي ٢٤٠ ميجابايت، ويفضل واي فاي. مفيش حاجة تانية بتتحمل لوحدها.
          </p></Hint>
          {!dlSupported ? (
            <p className="text-sm text-amber-link bg-amber-50 border border-hairline-amber rounded-xl px-3 py-2">
              جهازك مش بيدعم تحميل الصفحات على الجهاز — الصفحات هتفضل تتحمل من النت زي قبل كده.
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold text-accent-700 mb-2">
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
                <p className="text-sm text-amber-link mb-3">تعذر تحميل {dlFailed.length.toLocaleString('ar-EG')} صفحة — دوس تحميل تاني عشان يكمل الناقص.</p>
              )}
              {dlUnverified.length > 0 && !dlRunning && (
                <p className="text-sm text-amber-link mb-3">عدد {dlUnverified.length.toLocaleString('ar-EG')} صفحة اتحفظت من غير تأكيد (الشبكة منعت التأكد من سلامتها) — هي بتتفتح من غير نت، لكنها مش محسوبة في العداد، والتحميل الجاي هيأكدها ويحسبها.</p>
              )}
              {dlStopped && !dlRunning && (
                <p className="text-sm text-accent-600 mb-3">وقفت التحميل — اللي اتحمّل محفوظ، ودوس تاني عشان تكمل.</p>
              )}
              {dlError && !dlRunning && (
                <p className={`text-sm mb-3 ${dlQuotaFull ? 'text-red-600 font-medium' : 'text-red-600'}`}>{dlError}</p>
              )}
              {dlConfirm && !dlRunning ? (
                <div className="rounded-xl bg-amber-50 border border-hairline-amber p-3 mb-3">
                  <p className="text-sm font-medium text-amber-800">
                    مصحف المدينة حجمه حوالي ٢٤٠ ميجابايت — يفضل واي فاي.
                    {dlSpace && dlSpace.freeMB !== null && ` المتاح على جهازك حوالي ${dlSpace.freeMB.toFixed(0)} ميجابايت، والتحميل محتاج حوالي ${dlSpace.neededMB.toLocaleString('ar-EG')} ميجابايت.`}
                    {' '}متأكد عايز تحمله على جهازك؟
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={startDownload}
                      className="flex-1 py-2 grad-amber-door text-white font-bold rounded-xl polish-press polish-focus">
                      أيوه، حمّل
                    </button>
                    <button onClick={() => setDlConfirm(false)}
                      className="px-5 py-2 bg-cream border border-hairline text-accent-700 font-semibold rounded-xl polish-press">
                      إلغاء
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  {!dlRunning ? (
                    <button onClick={askDownload} disabled={dlCached !== null && dlCached >= 604}
                      className="flex-1 py-2.5 grad-emerald-door disabled:opacity-50 text-white font-bold rounded-xl polish-press polish-focus">
                      {dlCached !== null && dlCached > 0 && dlCached < 604 ? 'كمّل تحميل الناقص' : 'حمّل كل الصفحات'}
                    </button>
                  ) : (
                    <button onClick={stopDownload} disabled={dlStopping}
                      className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-accent-700 font-semibold rounded-xl polish-press">
                      {dlStopping ? 'جارٍ الإيقاف…' : 'إيقاف التحميل'}
                    </button>
                  )}
                  {dlCached !== null && dlCached > 0 && !dlRunning && (
                    <button onClick={clearDownload}
                      className="px-5 py-2.5 bg-cream border border-hairline text-accent-700 font-semibold rounded-xl polish-press">
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
                <p className="font-semibold text-accent-800 mb-1">مصاحف إضافية — اختياري</p>
                <Hint id="set-extra-editions"><p className="text-sm text-accent-600 mb-3">مفيش مصحف بيتحمل لوحده — كل واحد بيتحمل بس لو اخترته من هنا، وبحجمه قبل ما تدوس تحميل.</p></Hint>
                <div className="grid gap-3">
                  {EDITION_DOWNLOADS.filter((e) => e.id !== 'madinah').map((ed) => {
                    const st = optDl[ed.id] ?? emptyOpt();
                    const full = st.cached !== null && st.cached >= ed.pages;
                    return (
                      <div key={ed.id} className="rounded-xl border border-hairline p-4">
                        <p className="font-semibold text-accent-800">{ed.name}</p>
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
                          <p className="text-sm text-amber-link mt-2">تعذر تحميل {st.failed.length.toLocaleString('ar-EG')} صفحة — دوس تحميل تاني عشان يكمل الناقص.</p>
                        )}
                        {st.unverified.length > 0 && !st.running && (
                          <p className="text-sm text-amber-link mt-2">عدد {st.unverified.length.toLocaleString('ar-EG')} صفحة اتحفظت من غير تأكيد (الشبكة منعت التأكد من سلامتها) — هي بتتفتح من غير نت، لكنها مش محسوبة في العداد، والتحميل الجاي هيأكدها ويحسبها.</p>
                        )}
                        {st.stopped && !st.running && (
                          <p className="text-sm text-accent-600 mt-2">وقفت التحميل — اللي اتحمّل محفوظ، ودوس تاني عشان تكمل.</p>
                        )}
                        {st.error && !st.running && (
                          <p className={`text-sm mt-2 ${st.quota ? 'text-red-600 font-medium' : 'text-red-600'}`}>{st.error}</p>
                        )}
                        {st.confirm && !st.running ? (
                          <div className="mt-3 rounded-xl bg-amber-50 border border-hairline-amber p-3">
                            <p className="text-sm font-medium text-amber-800">
                              {ed.name} حجمه حوالي {ed.approxMB.toLocaleString('ar-EG')} ميجابايت — يفضل واي فاي.
                              {st.space && st.space.freeMB !== null && ` المتاح على جهازك حوالي ${st.space.freeMB.toFixed(0)} ميجابايت.`}
                              {' '}متأكد عايز تحمله على جهازك؟
                            </p>
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => startOptDownload(ed.id)}
                                className="flex-1 py-2 grad-amber-door text-white font-bold rounded-xl polish-press polish-focus">
                                أيوه، حمّل
                              </button>
                              <button onClick={() => patchOpt(ed.id, { confirm: false })}
                                className="px-5 py-2 bg-cream border border-hairline text-accent-700 font-semibold rounded-xl polish-press">
                                إلغاء
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2 mt-3">
                            {!st.running ? (
                              <button onClick={() => askOptDownload(ed.id)} disabled={full}
                                className="flex-1 py-2.5 grad-emerald-door disabled:opacity-50 text-white font-bold rounded-xl polish-press polish-focus">
                                {full ? 'محمل بالكامل ✓' : st.cached !== null && st.cached > 0 ? 'كمّل تحميل الناقص' : 'حمّل المصحف'}
                              </button>
                            ) : (
                              <button onClick={() => stopOptDownload(ed.id)} disabled={st.stopping}
                                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-accent-700 font-semibold rounded-xl polish-press">
                                {st.stopping ? 'جارٍ الإيقاف…' : 'إيقاف التحميل'}
                              </button>
                            )}
                            {st.cached !== null && st.cached > 0 && !st.running && (
                              <button onClick={() => clearOptDownload(ed.id)}
                                className="px-5 py-2.5 bg-cream border border-hairline text-accent-700 font-semibold rounded-xl polish-press">
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
            </>)}
            {openDoor === 'account-delete' && (<>
              <DeleteAccountButton />
            </>)}
            {openDoor === 'reciters' && (<>
              <CorrRecitersPanel />
            </>)}
            {openDoor === 'audio' && (<>
        {/* Audio downloads manager (W3-S3). Top: what is on the device now,
            with clear delete buttons per reciter / tafsir / Juhani / all.
            Below: per-kind download cards and the per-surah list, each in a
            Collapsible. Nothing downloads on its own: every start is a user
            tap on a surah, after a size estimate + space preflight. Offline
            playback needs no code change: the SW serves these URLs
            cache-first. */}
        <section id="sec-audio" className="space-y-3 scroll-mt-36">
          {!audioSupported ? (
            <p className="text-sm text-amber-link bg-amber-50 border border-hairline-amber rounded-xl px-3 py-2">
              جهازك مش بيدعم التحميل على الجهاز — الصوت هيفضل يشتغل من النت.
            </p>
          ) : (
            <>
              <div className="glass-card rounded-2xl p-4">
                <p className="text-sm text-accent-700 leading-relaxed">
                  نزّل سورة تسمعها من غير نت. مفيش حاجة بتتنزّل لوحدها.
                </p>
                <p className="text-sm font-semibold text-accent-700 mt-2">
                  {audioStorage === null
                    ? 'جارٍ فحص المساحة…'
                    : audioStorage.freeMB !== null
                      ? `المتاح حوالي ${audioStorage.freeMB.toFixed(0)} ميجا`
                      : 'المساحة المتاحة غير معروفة'}
                  {' • '}المنزّل: {formatAudioSize(audioDownloadsTotalBytes() + khatmaList.reduce((a, e) => a + (e.bytes ?? 0), 0))}
                  {audioDownloadsHaveUnknownSize() ? ' (تقريبي)' : ''}
                </p>
              </div>

              <div className="glass-card rounded-2xl p-4">
                <p className="font-bold text-accent-800 mb-3">المنزّل على جهازك — امسح من هنا</p>
                {khatmaByReciter.length === 0 && !tafsirItems.length && !juhaniItems.length ? (
                  <p className="text-sm text-accent-600">مفيش صوت منزّل.</p>
                ) : (
                  <div className="grid gap-2">
                    {khatmaByReciter.map((g) => (
                      <div key={g.reciter} className="flex items-center justify-between gap-3 rounded-xl border border-hairline p-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-accent-800 truncate">قارئ: {RECITERS.find((r) => r.id === g.reciter)?.name ?? g.reciter}</p>
                          <p className="text-sm text-accent-600">{g.items.length.toLocaleString('ar-EG')} سورة • {formatApproxSize(g.bytes)}</p>
                        </div>
                        {clearButton(`reciter:${g.reciter}`, 'امسح القارئ', () => clearKhatmaReciter(g.reciter))}
                      </div>
                    ))}
                    {tafsirItems.length > 0 && (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline p-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-accent-800">تفسير الآيات</p>
                          <p className="text-sm text-accent-600">{tafsirItems.length.toLocaleString('ar-EG')} سورة • {formatAudioSize(tafsirItems.reduce((a, e) => a + (e.bytes ?? 0), 0))}</p>
                        </div>
                        {clearButton('kind:tafsir', 'امسح التفسير', () => clearAudioKind('tafsir'))}
                      </div>
                    )}
                    {juhaniItems.length > 0 && (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline p-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-accent-800">ملفات الجهني</p>
                          <p className="text-sm text-accent-600">{juhaniItems.length.toLocaleString('ar-EG')} سورة • {formatAudioSize(juhaniItems.reduce((a, e) => a + (e.bytes ?? 0), 0))}</p>
                        </div>
                        {clearButton('kind:juhani', 'امسح الجهني', () => clearAudioKind('juhani'))}
                      </div>
                    )}
                    <div className="pt-1">
                      {clearButton('all', 'امسح كل الصوت المنزّل', clearAllAudio, true)}
                    </div>
                  </div>
                )}
              </div>

              <Collapsible title="تنزيل تفسير الآيات (صوت)" summary={tafsirItems.length ? `${tafsirItems.length.toLocaleString('ar-EG')} سورة` : undefined} storageKey="audio-tafsir">
                {audioKindCard('tafsir')}
              </Collapsible>
              <Collapsible title="تنزيل ملفات الجهني (حدر)" summary={juhaniItems.length ? `${juhaniItems.length.toLocaleString('ar-EG')} سورة` : undefined} storageKey="audio-juhani">
                {audioKindCard('juhani')}
              </Collapsible>
              <Collapsible title="سور الختمة (مسح بالسورة)" summary={khatmaList.length ? `${khatmaList.length.toLocaleString('ar-EG')} سورة` : undefined} storageKey="audio-khatma">
                <p className="text-sm text-accent-600 mb-3">التنزيل نفسه من صفحة «استمع للقرآن».</p>
                {khatmaList.length === 0 ? (
                  <p className="text-sm text-accent-600">مفيش سور ختمة منزّلة.</p>
                ) : (
                  <div className="grid gap-2">
                    {khatmaList.map((e) => (
                      <div key={`${e.reciter}-${e.surah}`} className="flex items-center justify-between gap-3 rounded-xl border border-hairline p-3">
                        <div>
                          <p className="font-semibold text-accent-800">سورة {audioSurahName(e.surah)} — {RECITERS.find((r) => r.id === e.reciter)?.name ?? e.reciter}</p>
                          <p className="text-sm text-accent-600">{formatApproxSize(e.bytes)} • {e.count.toLocaleString('ar-EG')} مقطع</p>
                        </div>
                        <button
                          onClick={() => void clearKhatmaDownload(e.reciter, e.surah)}
                          className="px-4 py-2 min-h-[44px] bg-cream border border-hairline text-accent-700 font-semibold rounded-xl polish-press"
                        >
                          مسح
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Collapsible>
              <p className="text-xs text-accent-600 leading-relaxed px-1">
                التسميع بالميكروفون نفسه محتاج نت. {audioStorage?.persisted === true
                  ? 'التخزين محمي من المسح التلقائي ✓'
                  : 'المتصفح ممكن يمسح الصوت لو مساحة الجهاز ضاقت، ارجع هنا وحمّل الناقص.'}
              </p>
            </>
          )}
        </section>
            </>)}
            {openDoor === 'voice' && (<>
        {/* Recitation + voice defaults */}
        <section id="sec-voice" className="glass-card rounded-2xl scroll-mt-36 p-5 md:p-6 lg:p-7">
          <h2 className="text-base md:text-lg font-semibold text-accent-800 flex items-center gap-2 mb-1">
            <Volume2 className="w-5 h-5 text-emerald-600" /> التلاوة والصوت
          </h2>
          <p className="text-sm text-accent-600 mb-4">القارئ الافتراضي لتلاوة الآيات.</p>
          <p className="text-sm font-semibold text-accent-700 mb-2">القارئ الافتراضي</p>
          <div className="flex flex-wrap gap-2 mb-5">
            {RECITERS.map((r) => (
              <button key={r.id} onClick={() => pickReciter(r.id)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-smooth ${reciterId === r.id ? 'grad-emerald-door text-white border-emerald-600 polish-press' : 'bg-gray-50 text-accent-600 border-hairline hover:bg-gray-100 polish-press'}`}>
                {r.name}
              </button>
            ))}
          </div>
          <p className="text-sm font-semibold text-accent-700 mb-2">الجنس — يحدد صوت تربيطات الآيات</p>
          <p className="text-xs text-accent-600 mb-3">للرجال: الصوت الرجالي المولّد دائماً. للنساء: الصوت النسائي.</p>
          <div className="flex gap-2">
            <button onClick={() => pickGender('female')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-smooth ${linkGender === 'female' ? 'grad-emerald-door text-white border-emerald-600 polish-press' : 'bg-gray-50 text-accent-600 border-hairline hover:bg-gray-100 polish-press'}`}>
              امرأة
            </button>
            <button onClick={() => pickGender('male')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-smooth ${linkGender === 'male' ? 'grad-emerald-door text-white border-emerald-600 polish-press' : 'bg-gray-50 text-accent-600 border-hairline hover:bg-gray-100 polish-press'}`}>
              رجل
            </button>
          </div>
          {!linkGender && <p className="text-xs text-accent-600 mt-2">لم تختر بعد — التطبيق يستخدم الصوت النسائي حتى تختار.</p>}
          <button type="button" onPointerDown={pressFeedback} onClick={() => setOpenDoor('battery')}
            className="mt-5 w-full flex items-center justify-between gap-3 p-3 rounded-xl border-2 border-hairline bg-white polish-press">
            <span className="flex items-center gap-2 font-bold text-accent-800"><BatteryCharging className="w-5 h-5 text-emerald-600" /> توفير البطارية</span>
            <span className="text-sm font-semibold text-emerald-700">افتح ←</span>
          </button>
          <DailyReportSettings />
          <button
            onPointerDown={pressFeedback}
            onClick={toggleTapSound}
            className={`relative mt-5 w-full flex items-center justify-between p-4 rounded-xl border-2 transition-smooth ${tapSound ? 'border-amber-400 bg-amber-50' : 'border-hairline hover:border-hairline-amber'}`}>
            <span className="text-right">
              <span className="block font-medium text-accent-800">صوت اللمس</span>
              <span className="block text-sm text-accent-600">صوت خفيف عند الضغط على الأزرار والتنقل — لا يعمل أبداً أثناء التلاوة أو التسميع</span>
            </span>
            <span className={`w-12 h-7 rounded-full p-1 transition-smooth flex-shrink-0 ${tapSound ? 'bg-amber-500' : 'bg-gray-300'}`}>
              <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${tapSound ? 'ltr:translate-x-5 rtl:-translate-x-5' : ''}`} />
            </span>
          </button>
        </section>
            </>)}
            {openDoor === 'lang' && (<>
        {/* Language */}
        <section id="sec-lang" className="glass-card rounded-2xl scroll-mt-36 p-5 md:p-6 lg:p-7">
          <h2 className="text-base md:text-lg font-semibold text-accent-800 flex items-center gap-2 mb-4">
            <Globe className="w-5 h-5 text-emerald-600" /> لغة التطبيق
          </h2>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((l) => (
              <button key={l.code} onClick={() => { setLang(l.code); saved(); }}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-smooth ${lang === l.code ? 'grad-emerald-door text-white border-emerald-600 polish-press' : 'bg-gray-50 text-accent-600 border-hairline hover:bg-gray-100 polish-press'}`}>
                {l.flag} {l.nativeName}
              </button>
            ))}
          </div>
        </section>
            </>)}
            {openDoor === 'share' && (
              <ShareSheet title="شارك التطبيق" text="تربيطات آيات القرآن — تطبيق مجاني لحفظ القرآن بالتربيطات والتسميع" url={window.location.origin} onClose={() => setOpenDoor(null)} />
            )}
            {openDoor === 'about' && (
        <section id="sec-about" className="glass-card rounded-2xl scroll-mt-36 p-5 md:p-6 lg:p-7">
          <h2 className="text-base md:text-lg font-semibold text-accent-800 flex items-center gap-2 mb-2">
            <Info className="w-5 h-5 text-emerald-600" /> عن التطبيق
          </h2>
          <p className="text-base text-accent-800 leading-relaxed">تربيطات آيات القرآن: تطبيق مجاني لحفظ القرآن بالتربيطات والتسميع. من غير إعلانات ولا اشتراكات.</p>
          <p className="text-sm text-accent-700 leading-relaxed mt-3">تنبيه: تصحيح التسميع بيتم آليًا وممكن يغلط، وهو مش بديل عن شيخ أو معلّم متقن.</p>
          <ContactForm />
        </section>
            )}
            {openDoor === 'onboarding' && (<>
        {/* Re-play the first-run onboarding (2026-11-06, feature #7):
            clears the done flag, tells App to open the overlay, and
            navigates home where the overlay mounts. */}
        <section id="sec-onboarding" className="glass-card rounded-2xl scroll-mt-36 p-5 md:p-6 lg:p-7">
          <h2 className="text-base md:text-lg font-semibold text-accent-800 flex items-center gap-2 mb-1">
            <Compass className="w-5 h-5 text-emerald-600" /> جولة تعريفية
          </h2>
          <Hint id="set-tour"><p className="text-sm text-accent-600 mb-4 leading-relaxed">
            جولة قصيرة من ٣ شاشات: احفظ بالتربيطات، وسـمّع لي، واستمع — وبعدها تجهيز سريع (القارئ ومستواك). تقدر تتخطاها في أي وقت.
          </p></Hint>
          <button
            onClick={startTour}
            onPointerDown={pressFeedback}
            className="w-full py-3 grad-emerald-door text-white text-base font-bold rounded-xl transition-smooth polish-press polish-focus">
            إعادة الجولة التعريفية
          </button>
          {/* Explanations retire after three views (lib/hints.ts); this
              brings them all back. */}
          <button
            onClick={() => { resetHints(); setHintsBack(true); }}
            onPointerDown={pressFeedback}
            className="w-full mt-3 py-3 bg-white border-2 border-emerald-700 text-emerald-800 text-base font-bold rounded-xl polish-press polish-focus">
            {hintsBack ? 'رجّعنا الشرح ✓' : 'رجّع الشرح المختصر في كل الصفحات'}
          </button>
        </section>
            </>)}
            {openDoor === 'pass' && (<>
        {/* Password — logged-in change, no email link needed */}
        <section id="sec-pass" className="glass-card rounded-2xl scroll-mt-36 p-5 md:p-6 lg:p-7">
          <h2 className="text-base md:text-lg font-semibold text-accent-800 flex items-center gap-2 mb-1">
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
            className="mt-3 w-full py-2.5 grad-emerald-door text-white text-sm font-bold rounded-xl transition-smooth polish-press polish-focus">
            حفظ كلمة السر الجديدة
          </button>
        </section>
            </>)}
            {openDoor === 'admin' && (<>
        {adminGateError && (
          <section id="sec-admin" className="bg-cream rounded-2xl border border-hairline-amber shadow-sm scroll-mt-36 p-5 md:p-6 lg:p-7">
            <h2 className="text-base md:text-lg font-semibold text-accent-800 flex items-center gap-2 mb-1">
              <Shield className="w-5 h-5 text-amber-600" /> لوحة الإدارة
            </h2>
            <p className="text-sm text-accent-500 mb-4">تعذّر التأكد من صلاحية الإدارة — ده مش معناه إن حسابك مش أدمن. حاول تاني.</p>
            <button onClick={() => setAdminGateAttempt((a) => a + 1)}
              className="w-full py-2.5 grad-emerald-door text-white text-sm font-bold rounded-xl transition-smooth polish-press polish-focus">
              إعادة المحاولة
            </button>
          </section>
        )}

        {showAdminUi && (
          <section id="sec-admin" className="bg-cream rounded-2xl border border-hairline-emerald shadow-sm scroll-mt-36 p-5 md:p-6 lg:p-7">
            <h2 className="text-base md:text-lg font-semibold text-accent-800 flex items-center gap-2 mb-1">
              <Shield className="w-5 h-5 text-emerald-600" /> لوحة الإدارة
            </h2>
            <p className="text-sm text-accent-600 mb-4">القسم ده بيظهر للأدمن بس — المستخدم العادي مش بيشوفه.</p>
            <button onClick={() => onNavigate('admin')}
              className="w-full py-2.5 grad-emerald-door text-white text-sm font-bold rounded-xl transition-smooth polish-press polish-focus">
              افتح لوحة الإدارة
            </button>
          </section>
        )}
              {!adminGateError && !showAdminUi && (
                <p className="text-sm text-accent-600">لا توجد صلاحية إدارة على هذا الحساب — ارجع للأبواب.</p>
              )}
            </>)}
            {openDoor === 'reset' && (<>
        <button onClick={resetDefaults} disabled={resetting}
          className="w-full flex items-center justify-center gap-2 py-3 bg-cream hover:bg-cream-deep text-accent-600 text-sm font-semibold rounded-xl border border-hairline transition-smooth disabled:opacity-50 polish-press">
          <RotateCcw className="w-5 h-5" /> {resetting ? 'جارٍ الاستعادة…' : 'استعادة الإعدادات الافتراضية'}
        </button>
        <p className="text-xs text-accent-400 leading-relaxed -mt-2">
          يعيد: المصحف المختار، القارئ الافتراضي، الجنس (على الحساب كمان)، لغة التطبيق، وأجزاء الورد اليومي — مع الاحتفاظ بسجل إنجاز الورد. لا يمسّ موضعك في المصحف ولا إعدادات التسميع.
        </p>
        {resetMsg && <p className="text-sm font-semibold text-accent-700 -mt-2">{resetMsg}</p>}
            </>)}
            {openDoor === 'diag' && (<>
        <details open className="glass-card rounded-2xl p-5 md:p-6 lg:p-7">
          <summary className="text-base md:text-lg font-semibold text-accent-800 cursor-pointer">سجل تشخيص الاستماع (مؤقت)</summary>
          <p className="text-xs text-accent-400 leading-relaxed mt-2 mb-3">
            آخر ٣٠ حدثًا لتشخيص مشكلة الرجوع للرئيسية بعد قفل الشاشة — بعد ما تحصل المشكلة، افتح القسم ده وخد لقطة شاشة وأرسلها. لا يحتوي على أي رموز أو بيانات حساب.
          </p>
          <button onClick={() => setRecoveryLog(readRecoveryLog())}
            className="mb-3 px-4 py-2 grad-emerald-door text-white text-sm font-bold rounded-xl transition-smooth polish-press">
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
            </>)}
          </div>
        )}
      </div>
      <BottomNav current="settings" onNavigate={onNavigate} />
    </div>
  );
}
