import { useEffect, useRef, useState } from 'react';
import { UserRound as HubUser, Shuffle as HubShuffle, Lightbulb as HubLight, ListMusic as HubList, Radio as HubRadio, ExternalLink as HubExternal } from 'lucide-react';
import Hint from '../components/Hint';
import TimerWheel from '../components/TimerWheel';
import DrumSelect from '../components/DrumSelect';
import ClockWheel from '../components/ClockWheel';
import {
  Check,
  Download,
  Headphones,
  Moon,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  Timer,
  Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  clearInterruptionMarker,
  handleInterruptionHidden,
  recLog,
} from '../lib/listenRecovery';
import { SURAHS, SURAH_AYAH_COUNTS, getGlobalAyahNumber, surahLabel } from '../lib/surahs';
import { JUZ_STARTS, HIZB_STARTS } from '../lib/quranBoundaries';
import { RECITERS, DEFAULT_RECITER_ID } from '../lib/reciters';
import { RIWAYAT, readRiwayaResume, writeRiwayaResume, clearRiwayaResume } from '../lib/riwayat';
import type { RiwayaPosition } from '../lib/riwayat';
import {
  HADR_EDITION,
  HADR_FULL_LABEL,
  HADR_NAME,
  clearHadrResume,
  readHadrResume,
  readHadrSelected,
  setHadrSelected,
  writeHadrResume,
} from '../lib/hadr';
import type { HadrPosition } from '../lib/hadr';
import { RiwayaEngine as RiwayaEngineClass } from '../lib/riwayatPlayback';
import type { RiwayaEngine } from '../lib/riwayatPlayback';
import {
  THREE_MODES,
  TAFSIR_ATTRIBUTION,
  JUHANI_RECITER_ID,
  JUHANI_RECITER_NAME,
  clearThreeModeResume,
  readAllThreeModeResumes,
  readTadabburTafsirOrder,
  tafsirConfigured,
  threeModeName,
  writeTadabburTafsirOrder,
} from '../lib/threeModeListen';
import type { TadabburTafsirOrder, ThreeMode, ThreeModePosition, VariedPlan } from '../lib/threeModeListen';
import { readVariedPlan, writeVariedPlan } from '../lib/threeModeListen';
import { JourneyEngine as JourneyEngineClass } from '../lib/threeModePlayback';
import type { JourneyEngine, JourneyPlayable } from '../lib/threeModePlayback';
// Tafsir voice variety (Feature 1, 2026-11-05): natural King Fahd
// recording (default), generated voice, or alternation by quarter.
import {
  TAFSIR_VOICES,
  readTafsirVoice,
  resolveDialogueAudio,
  resolveTafsirAudio,
  tafsirVoiceLabelForAyah,
  warmDialogueAudio,
  warmTafsirAudio,
  writeTafsirVoice,
} from '../lib/tafsirVoice';
import type { TafsirVoice } from '../lib/tafsirVoice';
import { getQuranTextCache } from '../lib/quranTextCache';
import type { CachedTextRow } from '../lib/quranTextCache';
import {
  clearListeningWird,
  readListeningWird,
  writeListeningWird,
} from '../lib/listenPlayback';
import {
  SLEEP_TIMER_OPTIONS,
  clearSleepTimer,
  getSleepTimerRemainingMs,
  registerSleepStopHandler,
  setSleepTimer,
  subscribeSleepTimer,
  unregisterSleepStopHandler,
} from '../lib/sleepTimer';
import type { SleepTimerMinutes } from '../lib/sleepTimer';
import { clearNowPlaying, setNowPlaying } from '../lib/nowPlaying';
import { setBackTarget } from '../lib/backTarget';
import type { ListenEngine, ListenMode, ListenPosition } from '../lib/listenPlayback';
import { ListenEngine as ListenEngineClass } from '../lib/listenPlayback';
import {
  deleteDownloadedSurah,
  downloadSurah,
  estimateSurahSize,
  formatApproxSize,
  isSurahDownloaded,
  resolveListenUrl,
} from '../lib/listenOffline';
import {
  AUDIO_DOWNLOAD_FAILED_MESSAGE,
  AUDIO_QUOTA_MESSAGE,
  checkAudioDownloadSpace,
  deleteAudioDownload,
  downloadJuhaniSurah,
  downloadTafsirSurah,
  estimateJuhaniSurah,
  estimateTafsirSurah,
  formatAudioSize,
  isAudioDownloaded,
  type AudioDownloadKind,
  type AudioSizeEstimate,
} from '../lib/audioDownload';
import { getSharedAudio, registerResume, unregisterResume, clearResumeStack, currentAudioOwner, hasWaitingResumes, releaseAudio } from '../lib/sharedAudio';

type Route =
  | 'home'
  | 'admin'
  | 'app'
  | 'auth'
  | 'mushaf'
  | 'settings'
  | 'follow'
  | 'test'
  | 'listen';

function readPersistedReciter(): string {
  try {
    const saved = localStorage.getItem('quran-reciter') || '';
    if (RECITERS.some((r) => r.id === saved)) return saved;
  } catch {}
  return DEFAULT_RECITER_ID;
}

// Riwaya mode (v1, listening-only): null = Hafs (the existing
// behaviour, unchanged). A persisted riwaya id that is not one of
// the five verified editions is ignored, never trusted blindly.
// A set hadr flag wins over a persisted riwaya (hadr is its own
// pace mode; the persisted riwaya id itself is left alone).
function readPersistedRiwaya(): string | null {
  try {
    if (readHadrSelected()) return null;
    const saved = localStorage.getItem('quran-riwaya') || '';
    if (RIWAYAT.some((r) => r.id === saved)) return saved;
  } catch {}
  return null;
}

// Continuity (user request 2026-10-29): leaving Listen
// mid-playback pauses instead of stopping, and returning
// resumes by itself — no tap. The unmount effect records a
// ONE-TIME intent in sessionStorage (per-tab: a fresh tab
// never auto-plays); the mount effect consumes it. Stored
// resumes (hadr key, riwaya map, wird, per-mode) are
// untouched, so tap-resume always remains as the fallback
// if the browser blocks the auto-play. Locking the screen
// or backgrounding the app is different: the engines never
// pause on hide, so audio keeps playing there (see the
// visible-sync effect); only in-app navigation pauses.
const AUTO_RESUME_KEY = 'quran-listen-auto-resume';
const AUTO_RESUME_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// External-audio auto-resume (2026-11-06): when ANOTHER app's audio
// (YouTube / Facebook / a call) pauses our listen audio, the engine
// records a resume intent under this key — separate from the
// route-hide auto-resume key above, so the two flows never clobber
// each other. The return handler consumes it on visibilitychange →
// visible (+ pageshow fallback). A USER pause never writes here
// (see userPausedRef), so it can never auto-resume.
const EXTERNAL_INTERRUPT_KEY = 'quran-listen-external-interrupt';

type AutoResumeIntent =
  | { kind: 'hadr'; surah: number; time: number; at: number }
  | { kind: 'riwaya'; riwaya: string; surah: number; time: number; at: number }
  | { kind: 'hafs'; surah: number; reciter: string; mode: ListenMode; ayah: number; time: number; at: number }
  | { kind: 'journey'; position: ThreeModePosition; at: number };

function validResumeSurah(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 114;
}
function validResumeTime(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}
function readIntentFromKey(key: string): AutoResumeIntent | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (typeof p !== 'object' || p === null) return null;
    if (!validResumeTime(p.at) || (p.at as number) > Date.now() + 60000 || Date.now() - (p.at as number) > AUTO_RESUME_MAX_AGE_MS) return null;
    const at = p.at as number;
    if (p.kind === 'hadr' && validResumeSurah(p.surah) && validResumeTime(p.time)) {
      return { kind: 'hadr', surah: p.surah, time: p.time, at };
    }
    if (p.kind === 'riwaya' && typeof p.riwaya === 'string' && RIWAYAT.some((r) => r.id === p.riwaya) && validResumeSurah(p.surah) && validResumeTime(p.time)) {
      return { kind: 'riwaya', riwaya: p.riwaya, surah: p.surah, time: p.time, at };
    }
    if (p.kind === 'hafs' && validResumeSurah(p.surah) && typeof p.reciter === 'string' && RECITERS.some((r) => r.id === p.reciter) && (p.mode === 'free' || p.mode === 'wird') && typeof p.ayah === 'number' && Number.isInteger(p.ayah) && (p.ayah as number) >= 1 && validResumeTime(p.time)) {
      return { kind: 'hafs', surah: p.surah, reciter: p.reciter, mode: p.mode, ayah: p.ayah, time: p.time, at };
    }
    if (p.kind === 'journey' && typeof p.position === 'object' && p.position !== null) {
      const pos = p.position as Record<string, unknown>;
      const inter = pos.interstitial;
      const interOk = inter === undefined || (Array.isArray(inter) && inter.every((it) => typeof it === 'object' && it !== null && validResumeSurah((it as Record<string, unknown>).surah) && typeof (it as Record<string, unknown>).ayah === 'number' && Number.isInteger((it as Record<string, unknown>).ayah) && ((it as Record<string, unknown>).ayah as number) >= 1));
      // Juhani is a valid journey start reciter for the single
      // khatma only — a Juhani intent for varied/tadabbur is
      // still rejected (the picker never saves one there).
      if (THREE_MODES.some((m) => m.id === pos.mode) && validResumeSurah(pos.startSurah) && typeof pos.startReciterId === 'string' && (RECITERS.some((r) => r.id === pos.startReciterId) || (pos.mode === 'single' && pos.startReciterId === JUHANI_RECITER_ID)) && (pos.kind === 'ayah' || pos.kind === 'tafsir') && validResumeSurah(pos.surah) && typeof pos.ayah === 'number' && Number.isInteger(pos.ayah) && (pos.ayah as number) >= 1 && validResumeTime(pos.time) && interOk) {
        return { kind: 'journey', position: pos as unknown as ThreeModePosition, at };
      }
    }
    return null;
  } catch {
    return null;
  }
}
function readAutoResumeIntent(): AutoResumeIntent | null {
  return readIntentFromKey(AUTO_RESUME_KEY);
}
function readExternalInterruptIntent(): AutoResumeIntent | null {
  return readIntentFromKey(EXTERNAL_INTERRUPT_KEY);
}
function writeAutoResumeIntent(intent: AutoResumeIntent): void {
  try {
    sessionStorage.setItem(AUTO_RESUME_KEY, JSON.stringify(intent));
  } catch {}
}
function writeExternalInterruptIntent(intent: AutoResumeIntent): void {
  try {
    sessionStorage.setItem(EXTERNAL_INTERRUPT_KEY, JSON.stringify(intent));
  } catch {}
}
function clearAutoResumeIntent(): void {
  try {
    sessionStorage.removeItem(AUTO_RESUME_KEY);
  } catch {}
}
function clearExternalInterruptIntent(): void {
  try {
    sessionStorage.removeItem(EXTERNAL_INTERRUPT_KEY);
  } catch {}
}

// Electronic speed (audio.playbackRate), persisted under
// 'quran-playback-rate'. Only the three offered rates are valid;
// anything else falls back to 1. Labels use Arabic-Indic digits
// (the app's numbers rule): ١x، ١٫٢٥x، ١٫٥x.
const PLAYBACK_RATES = [1, 1.25, 1.5] as const;
const PLAYBACK_RATE_LABELS: Record<number, string> = {
  1: '١x',
  1.25: '١٫٢٥x',
  1.5: '١٫٥x',
};
function readPersistedRate(): number {
  try {
    const n = Number(localStorage.getItem('quran-playback-rate'));
    if (PLAYBACK_RATES.includes(n as (typeof PLAYBACK_RATES)[number])) return n;
  } catch {}
  return 1;
}

function surahName(no: number): string {
  return surahLabel(no);
}

function surahCount(no: number): number {
  return SURAH_AYAH_COUNTS[no - 1] || 0;
}

// Feature #9 recording — "سمعت / سمّعت مؤخرًا" (the recents row on
// Home is built by another agent from this key): every Listen start
// writes one entry to localStorage 'quran-recent-activity-v1' — a
// JSON array, most recent first, max 6, entry { type: 'listen',
// surah, ayah?, label, ts }. Same type+surah dedups (the old entry
// is dropped, the new one goes first). try/catch everywhere:
// recording must never break playback. No new server table.
const RECENT_ACTIVITY_KEY = 'quran-recent-activity-v1';
type RecentActivityEntry = {
  type: 'listen';
  surah: number;
  ayah?: number;
  label: string;
  ts: number;
};
function recordRecentListen(surah: number, ayah?: number): void {
  try {
    let arr: RecentActivityEntry[] = [];
    try {
      const raw = localStorage.getItem(RECENT_ACTIVITY_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        arr = parsed.filter(
          (e): e is RecentActivityEntry =>
            typeof e === 'object' &&
            e !== null &&
            (e as RecentActivityEntry).type === 'listen' &&
            typeof (e as RecentActivityEntry).surah === 'number' &&
            typeof (e as RecentActivityEntry).label === 'string' &&
            typeof (e as RecentActivityEntry).ts === 'number',
        );
      }
    } catch {
      arr = [];
    }
    arr = arr.filter((e) => e.surah !== surah);
    const entry: RecentActivityEntry = {
      type: 'listen',
      surah,
      ...(ayah !== undefined ? { ayah } : {}),
      label: `سورة ${surahName(surah)}`,
      ts: Date.now(),
    };
    arr.unshift(entry);
    localStorage.setItem(RECENT_ACTIVITY_KEY, JSON.stringify(arr.slice(0, 6)));
  } catch {
    // ignore: recording must never break playback.
  }
}

// Arabic-Indic digits for the sleep countdown (the app's numbers
// rule): 05:30 reads ٠٥:٣٠.
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function formatSleepRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const toIndic = (n: number): string =>
    String(n)
      .padStart(2, '0')
      .replace(/\d/g, (d) => ARABIC_INDIC_DIGITS[Number(d)]);
  return `${toIndic(minutes)}:${toIndic(seconds)}`;
}

// Sleep-timer chip labels, by duration (minutes).
const SLEEP_TIMER_LABELS: Record<SleepTimerMinutes, string> = {
  30: 'بعد نصف ساعة',
  60: 'بعد ساعة',
  120: 'بعد ساعتين',
};

// استمع للقرآن: continuous surah playback with read-along ayah
// highlighting. The audio itself lives in the sibling ListenEngine
// (single audio element, so playback can keep going while the
// screen is off or the app is switched away — a real-device check,
// not something a headless render can prove). This page only owns
// the UI: pickers, text, controls, and the offline section.
// No whole-Quran download, no synthetic audio, no pre-generation.
// 2026-11-06: hub-level journey resume cards are hidden (sub-doors keep their own استئناف).
const SHOW_HUB_RESUMES = false;

export default function ListenPage({ onNavigate, visible = true }: { onNavigate: (r: Route) => void; visible?: boolean }) {
  const [surah, setSurah] = useState(1);
  const [reciterId, setReciterId] = useState(readPersistedReciter);
  const [riwayaId, setRiwayaId] = useState<string | null>(readPersistedRiwaya);
  const [savedRiwayatResume, setSavedRiwayatResume] = useState<RiwayaPosition | null>(() => {
    try {
      const id = readPersistedRiwaya();
      return id ? readRiwayaResume(id) : null;
    } catch {
      return null;
    }
  });
  const [showRiwayatResume, setShowRiwayatResume] = useState(true);
  // Hadr (Juhani natural fast pace, surah-file mode): selected
  // from the pace area, persisted under 'quran-hadr'. It shares
  // the riwaya engine ref (same surah-file engine, different
  // edition) — see startHadrPlayback.
  const [hadrOn, setHadrOn] = useState(readHadrSelected);
  const [savedHadrResume, setSavedHadrResume] = useState<HadrPosition | null>(() => {
    try {
      return readHadrResume();
    } catch {
      return null;
    }
  });
  const [showHadrResume, setShowHadrResume] = useState(true);
  // Electronic speed, persisted (see readPersistedRate). Applied
  // to the Hafs, riwaya, and journey engines on construction;
  // hadr always plays at rate 1 (its pace is natural, not
  // electronic) and disables these chips while selected.
  const [playbackRate, setPlaybackRate] = useState(readPersistedRate);
  // Home khatma card preselection (one-time sessionStorage flag
  // 'quran-listen-preselect', same pattern as
  // 'quran-open-fullscreen'): consumed by the mount effect below,
  // which switches to Hafs, highlights this mode's button, and
  // scrolls the journey section into view. Never auto-plays:
  // iOS audio still needs the user's tap on the mode button.
  const [preselectedMode, setPreselectedMode] = useState<ThreeMode | null>(null);
  // Listening hub (Amr 2026-10-30): 'hub' shows four big cards; a card
  // opens its detail view below. Resume cards above stay first, and
  // the playback view stays visible whenever an engine plays.
  const [hubView, setHubView] = useState<'hub' | 'free' | ThreeMode>('hub');
  const [mode, setMode] = useState<ListenMode>('free');
  // Three-mode journeys (additive section, Hafs only): the active
  // journey's mode, its current item for display, and one saved
  // resume per mode (hidden per mode after resume/dismiss).
  const [journeyMode, setJourneyMode] = useState<ThreeMode | null>(null);
  const [journeyItem, setJourneyItem] = useState<JourneyPlayable | null>(null);
  // Journey start reciter (2026-11-06, Juhani single khatma):
  // SEPARATE from the global listen-preference reciter (reciterId,
  // persisted as 'quran-reciter'). Juhani is a journey-only voice —
  // it must never leak into the global preference: the free Hafs
  // engine's resolveListenUrl THROWS on an unknown reciter id and
  // the offline download throws too, so a shared 'juhani' state
  // would break free listening and its download. Picking one of
  // the 8 here also updates the global preference (the old shared
  // behaviour, via changeJourneyReciter); picking Juhani updates
  // only this state, and is never persisted.
  const [journeyReciterId, setJourneyReciterId] = useState<string>(readPersistedReciter);
  // The reciter a fresh journey actually starts with: Juhani is
  // single-mode only — a varied/tadabbur detail never offers it,
  // and a stale 'juhani' pick falls back to the global reciter
  // there instead of showing a blank select.
  const journeyReciterForMode = (): string => {
    if (hubView === 'single') return journeyReciterId;
    return journeyReciterId === JUHANI_RECITER_ID ? reciterId : journeyReciterId;
  };
  const journeyReciterName = (id: string): string =>
    id === JUHANI_RECITER_ID
      ? JUHANI_RECITER_NAME
      : RECITERS.find((r) => r.id === id)?.name || '';
  // Tadabbur tafsir order (user toggle, 2026-10-31): persisted,
  // default 'after'. Applies to fresh journeys; a resumed journey
  // keeps the order it started with (see startJourney).
  const [tadabburTafsirOrder, setTadabburTafsirOrder] =
    useState<TadabburTafsirOrder>(readTadabburTafsirOrder);
  // Tadabbur tafsir voice (Feature 1, 2026-11-05): persisted,
  // default 'natural' (the King Fahd recording). Unlike the order
  // toggle, this is a LIVE preference: the engine's resolver reads
  // the stored setting on every clip, so a change takes effect at
  // the next tafsir clip — including inside a resumed journey.
  const [tafsirVoice, setTafsirVoice] = useState<TafsirVoice>(readTafsirVoice);
  const [savedJourneys, setSavedJourneys] = useState<
    Partial<Record<ThreeMode, ThreeModePosition>>
  >(() => {
    try {
      return readAllThreeModeResumes();
    } catch {
      return {};
    }
  });
  const [hiddenJourneyResumes, setHiddenJourneyResumes] = useState<ThreeMode[]>([]);
  const [savedWird, setSavedWird] = useState<ListenPosition | null>(() => {
    try {
      return readListeningWird();
    } catch {
      return null;
    }
  });
  const [showResume, setShowResume] = useState(true);
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  // Sleep timer (#10): remaining ms, synced from the shared lib
  // (its 1s tick re-renders the countdown). Null = no timer.
  // 2026-11-07: khatma timer stop-at-unit (juz / hizb / surah end) and clock time.
  const [unitTarget, setUnitTarget] = useState<number | null>(null);
  const [unitLabel, setUnitLabel] = useState('');
  const [clockAt, setClockAt] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [sleepRemainingMs, setSleepRemainingMs] = useState<number | null>(() =>
    getSleepTimerRemainingMs(),
  );
  // Redirect B: set only by the engine's onInterrupted callback. The
  // page never auto-plays from this state — only a tap on استئناف does.
  const [interrupted, setInterrupted] = useState(false);
  const [currentAyah, setCurrentAyah] = useState(1);
  const [ayahs, setAyahs] = useState<CachedTextRow[] | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [offlineChecking, setOfflineChecking] = useState(false);
  const [estimate, setEstimate] = useState<{ bytes: number | null; count: number } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [offlineError, setOfflineError] = useState<string | null>(null);
  // In-context audio downloads (2026-11-05, offline feature):
  // ONE shared job state for the two spots that offer a download
  // here — the Juhani surah file in hadr mode, and the tafsir
  // clips in the tadabbur detail. The two spots never show at
  // once (hubView is either 'free' or a mode), so one job is
  // enough; the full manager lives in Settings ('التنزيلات الصوتية').
  type CtxAudioJob = {
    kind: AudioDownloadKind; surah: number;
    downloaded: boolean; checking: boolean;
    estimating: boolean; estimate: AudioSizeEstimate | null;
    space: { neededMB: number; freeMB: number | null } | null;
    confirm: boolean; running: boolean;
    progress: { done: number; total: number } | null;
    error: string; quota: boolean;
  };
  const [ctxAudio, setCtxAudio] = useState<CtxAudioJob | null>(null);
  const ctxAudioAbortRef = useRef<AbortController | null>(null);
  // Black-screen mode: a fullscreen black overlay that hides the UI
  // while audio keeps playing untouched. It never touches the audio
  // engine, Media Session, or Wake Lock (none is used here). Exit is
  // long-press (>=1000ms) or swipe (>60px) only — never a single
  // tap, so pocket touches cannot dismiss it.
  const [blackScreen, setBlackScreen] = useState(false);
  const [showBlackHint, setShowBlackHint] = useState(false);
  const blackPressRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const engineRef = useRef<ListenEngine | null>(null);
  const riwayaEngineRef = useRef<RiwayaEngine | null>(null);
  const journeyEngineRef = useRef<JourneyEngine | null>(null);
  const currentAyahRef = useRef(1);
  const activeSurahRef = useRef(1);
  const activeReciterRef = useRef(reciterId);
  const activeRiwayaRef = useRef<string | null>(riwayaId);
  // True while the active surah-file engine is a hadr engine
  // (not a riwaya engine): the stop path needs this to refresh
  // the hadr resume card instead of the riwaya one.
  const activeHadrRef = useRef(false);
  const activeModeRef = useRef<ListenMode>('free');

  // Route visibility: App keeps this page mounted while hidden so
  // audio can resume across routes (anywhere-resume). Mirrored in
  // a ref for the mount effect (which runs once).
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  // [LISTEN_RECOVERY] diagnostics: live overlay state for the hide log
  // (state in a listener closure would go stale; refs do not).
  const blackScreenRef = useRef(blackScreen);
  blackScreenRef.current = blackScreen;
  const prevVisibleRef = useRef(visible);
  // Anywhere-resume dispatcher target: always the latest closure.
  const listenResumeRef = useRef<(() => void) | null>(null);

  // External-audio auto-resume (2026-11-06): set ONLY by the pause
  // button (togglePlayPause) immediately BEFORE it calls
  // engine.pause(). A `pause` event observed while this is false
  // therefore means the SYSTEM paused us (another app's audio, a
  // call) — never the user. Cleared on every play / resume / stop,
  // so a stale "user paused" can never block a later system
  // interruption's auto-resume. A USER pause must NEVER auto-resume.
  const userPausedRef = useRef(false);

  // Clear both halves of the external-interrupt state: the stored
  // intent and the user-paused flag. Called on every play / resume /
  // stop, so a stale intent or flag can never fire later.
  const clearExternalInterruptState = (): void => {
    try {
      clearExternalInterruptIntent();
    } catch {
      // ignore
    }
    userPausedRef.current = false;
  };

  // Sleep timer (#10) — the page's own stop handler ('listen-ui').
  // The engines each register their own handler too (which pauses
  // the audio), but only the page can sync the UI: this handler
  // pauses whichever engine is live AND flips the playing state,
  // and marks it a USER pause (userPausedRef) so a sleep pause can
  // never auto-resume like a system interruption. It only touches
  // refs + the stable setPlaying, so the mount effect's first-
  // render closure stays correct. The lib calls every handler in
  // its own try/catch, so the double pause (engine + page) is a
  // harmless no-op. Never touches adhan audio.
  const pauseAllForSleep = (): void => {
    try {
      userPausedRef.current = true;
      clearExternalInterruptIntent();
    } catch {
      // ignore
    }
    try {
      journeyEngineRef.current?.pause();
    } catch {
      // ignore
    }
    try {
      riwayaEngineRef.current?.pause();
    } catch {
      // ignore
    }
    try {
      engineRef.current?.pause();
    } catch {
      // ignore
    }
    setPlaying(false);
  };

  // Record a system-interruption resume intent. Called from every
  // engine's onInterrupted — which the engines fire ONLY for
  // external pauses (their internal-pause tokens already filter
  // engine-initiated pauses) plus tab-hide and preemption, which
  // the checks below exclude. Records ONLY when ALL of:
  //  - the user did NOT tap pause (userPausedRef false), and
  //  - the shared element is actually PAUSED (rules out tab-hide
  //    while background playback still runs), and
  //  - listen still owns the element (rules out preemption, where
  //    the owner is null / another source, and adhkar).
  // The position comes from the live engine's getPosition() — valid
  // even after its playing flag cleared, because the engine has
  // not moved. No engine ref means nothing was playing: nothing
  // to record. Idempotent: a repeat firing overwrites the same
  // intent with the same position.
  const recordExternalInterrupt = (): void => {
    try {
      if (userPausedRef.current) return;
      const audio = getSharedAudio();
      let paused = true;
      try {
        paused = audio.paused;
      } catch {
        paused = true;
      }
      if (!paused) return;
      if (currentAudioOwner() !== 'listen') return;
      const j = journeyEngineRef.current;
      const r = riwayaEngineRef.current;
      const e = engineRef.current;
      let intent: AutoResumeIntent | null = null;
      if (j) {
        intent = { kind: 'journey', position: j.getPosition(), at: Date.now() };
      } else if (r) {
        const pos = r.getPosition();
        intent = activeHadrRef.current
          ? { kind: 'hadr', surah: pos.surah, time: pos.time, at: Date.now() }
          : { kind: 'riwaya', riwaya: r.current.riwaya, surah: pos.surah, time: pos.time, at: Date.now() };
      } else if (e) {
        const pos = e.getPosition();
        intent = { kind: 'hafs', surah: pos.surah, reciter: pos.reciter, mode: activeModeRef.current, ayah: pos.ayah, time: pos.time ?? 0, at: Date.now() };
      }
      if (!intent) return;
      writeExternalInterruptIntent(intent);
    } catch {
      // ignore: recording must never break the interruption UI.
    }
  };

  const setCurrent = (ayah: number) => {
    currentAyahRef.current = ayah;
    setCurrentAyah(ayah);
  };

  // Faint exit hint: shows when the overlay opens, hides itself.
  useEffect(() => {
    if (!blackScreen) return;
    setShowBlackHint(true);
    const timer = setTimeout(() => setShowBlackHint(false), 4000);
    return () => clearTimeout(timer);
  }, [blackScreen]);

  // Sleep timer (#10): register the page's stop handler once, and
  // subscribe to the shared timer so the countdown re-renders on
  // every 1s tick (and clears when the timer fires or is
  // cancelled). The timer itself lives in the lib, outside any
  // component, so it keeps running across page navigation; a full
  // app reload resets it (module state), and the UI then shows
  // "not running" automatically.
  useEffect(() => {
    registerSleepStopHandler('listen-ui', pauseAllForSleep);
    const unsubscribe = subscribeSleepTimer(() => {
      try {
        setSleepRemainingMs(getSleepTimerRemainingMs());
      } catch {
        // ignore: a failed read must never break the page.
      }
    });
    return () => {
      unregisterSleepStopHandler('listen-ui');
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow-along (#4): publish the currently playing ayah to the
  // shared now-playing store (see nowPlaying.ts) so the Mushaf
  // page can highlight it later without any Listen change. Null
  // when nothing ayah-tracked plays (stopped, riwaya/hadr surah
  // file, or a Juhani surah file inside a journey — its item ayah
  // is always 1, not a real ayah step). The bar below reads the
  // same state from the ayah text; the store is the cross-page seam.
  useEffect(() => {
    if (!active) {
      clearNowPlaying();
      return;
    }
    if (journeyMode !== null) {
      if (journeyItem) {
        setNowPlaying({ surah: journeyItem.surah, ayah: journeyItem.ayah, kind: journeyItem.kind });
      } else {
        clearNowPlaying();
      }
      return;
    }
    if (hadrOn || riwayaId !== null) {
      clearNowPlaying();
      return;
    }
    if (currentAyah >= 1) {
      setNowPlaying({ surah, ayah: currentAyah, kind: 'ayah' });
    } else {
      clearNowPlaying();
    }
    return () => clearNowPlaying();
  }, [active, journeyMode, journeyItem, hadrOn, riwayaId, surah, currentAyah]);

  const blackPressStart = (x: number, y: number) => {
    blackPressRef.current = { t: Date.now(), x, y };
  };
  const blackPressMove = (x: number, y: number) => {
    const p = blackPressRef.current;
    if (!p) return;
    if (Math.hypot(x - p.x, y - p.y) > 60) {
      blackPressRef.current = null;
      setBlackScreen(false);
    }
  };
  const blackPressEnd = () => {
    const p = blackPressRef.current;
    blackPressRef.current = null;
    if (p && Date.now() - p.t >= 1000) setBlackScreen(false);
  };

  // Black-screen wake lock (2026-10-30 report: the screen went off
  // mid-listen). While the black overlay is open AND audio plays,
  // hold a screen wake lock so auto-lock cannot fire — the screen
  // stays black, the audio never stops. The lock auto-releases on
  // hide, so returning with the overlay still open re-acquires it.
  // If wakeLock is unavailable, iOS background audio (engines never
  // pause on hide) is the fallback. Released on overlay close,
  // pause, end, or unmount — never held for a paused screen.
  const blackWakeLockRef = useRef<any>(null);
  const blackWakeGenRef = useRef(0);
  const acquireBlackWakeLock = async () => {
    if (blackWakeLockRef.current) return;
    const gen = ++blackWakeGenRef.current;
    try {
      const nav = navigator as unknown as { wakeLock?: { request: (t: string) => Promise<any> } };
      if (!nav.wakeLock?.request) return;
      const wl = await nav.wakeLock.request('screen');
      if (gen !== blackWakeGenRef.current) { try { await wl.release(); } catch {} return; }
      blackWakeLockRef.current = wl;
      wl.addEventListener('release', () => { if (blackWakeLockRef.current === wl) blackWakeLockRef.current = null; });
    } catch {}
  };
  const releaseBlackWakeLock = async () => {
    blackWakeGenRef.current++;
    const wl = blackWakeLockRef.current;
    blackWakeLockRef.current = null;
    if (wl) { try { await wl.release(); } catch {} }
  };
  useEffect(() => {
    if (blackScreen && playing) void acquireBlackWakeLock();
    else void releaseBlackWakeLock();
    return () => { void releaseBlackWakeLock(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blackScreen, playing]);
  useEffect(() => {
    const onVis = () => {
      try {
        if (document.visibilityState === 'visible' && blackScreen && playing) void acquireBlackWakeLock();
      } catch {}
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blackScreen, playing]);

  const scrollToAyah = (ayah: number) => {
    try {
      const el = document.getElementById(`listen-ayah-${ayah}`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {}
  };

  const destroyEngine = () => {
    // All three engines share the single audio element, but only
    // one ever exists at a time (mode switch destroys first) — so
    // destroying all here is safe and keeps the stop path one call
    // for every mode.
    try {
      engineRef.current?.destroy();
    } catch {}
    engineRef.current = null;
    try {
      riwayaEngineRef.current?.destroy();
    } catch {}
    riwayaEngineRef.current = null;
    try {
      journeyEngineRef.current?.destroy();
    } catch {}
    journeyEngineRef.current = null;
  };

  // Start (or restart) playback. Takes explicit values so the resume
  // card can start at the saved position without waiting for state
  // updates to land. This is always called from a tap (user gesture),
  // which iOS requires before audio may play.
  const startPlayback = async (
    surahNo: number,
    reciter: string,
    listenMode: ListenMode,
    startAyah: number,
    startTime = 0,
  ) => {
    setEngineError(null);
    setInterrupted(false);
    // A fresh start supersedes any pending external-interrupt
    // auto-resume: the user made a new choice.
    clearExternalInterruptState();
    destroyEngine();
    activeSurahRef.current = surahNo;
    activeReciterRef.current = reciter;
    activeHadrRef.current = false;
    activeModeRef.current = listenMode;
    setSurah(surahNo);
    setReciterId(reciter);
    setMode(listenMode);
    setCurrent(startAyah);
    // Feature #9: record this listen start for "سمعت مؤخرًا".
    recordRecentListen(surahNo, startAyah);
    const engine = new ListenEngineClass({
      reciterId: reciter,
      surah: surahNo,
      startAyah,
      startTime,
      playbackRate,
      mode: listenMode,
      resolveUrl: resolveListenUrl,
      onAyahChange: (s, a) => {
        setCurrent(a);
        scrollToAyah(a);
        if (activeModeRef.current === 'wird') {
          try {
            writeListeningWird({ surah: s, ayah: a, reciter: activeReciterRef.current, time: 0 });
          } catch {}
        }
      },
      onEnded: () => {
        setPlaying(false);
      },
      onError: (message) => {
        setEngineError(message);
        setPlaying(false);
      },
      onInterrupted: () => {
        // Redirect B: show the resume button; do NOT auto-play.
        setInterrupted(true);
        setPlaying(false);
        // External-audio auto-resume: record the intent iff the
        // system (not the user) paused us.
        recordExternalInterrupt();
      },
    });
    engineRef.current = engine;
    setActive(true);
    try {
      await engine.play();
      setPlaying(true);
    } catch {
      setEngineError('تعذر تشغيل الصوت — تحقق من الاتصال وحاول مجددا.');
      setPlaying(false);
    }
  };

  const stopPlayback = () => {
    // Stopping is a deliberate user choice: drop any pending
    // external-interrupt auto-resume (never auto-resume a stop).
    clearExternalInterruptState();
    // Three-mode journey: stopping saves the live position
    // (per-mode resume) via the engine's destroy path, so the
    // next visit returns to exactly here. The Hafs and riwaya
    // paths below are untouched.
    if (journeyEngineRef.current) {
      stopJourney();
      return;
    }
    // Hadr mode: stopping saves the surah AND time-in-surah
    // (hadr resume) via the engine's destroy path (its persist
    // override writes the hadr key, not the riwaya map), so the
    // next visit returns to exactly here.
    if (riwayaEngineRef.current && activeHadrRef.current) {
      destroyEngine();
      try {
        setSavedHadrResume(readHadrResume());
      } catch {}
      activeHadrRef.current = false;
      setActive(false);
      setPlaying(false);
      setInterrupted(false);
      setShowHadrResume(true);
      return;
    }
    // Riwaya mode: stopping saves the surah AND time-in-surah
    // (per-riwaya resume), so the next visit returns to exactly
    // here. The Hafs wird path below is untouched.
    if (riwayaEngineRef.current) {
      let pos: RiwayaPosition | null = null;
      try {
        pos = riwayaEngineRef.current.getPosition();
      } catch {}
      if (pos) {
        try {
          writeRiwayaResume(pos);
        } catch {}
      }
      const id = activeRiwayaRef.current;
      try {
        setSavedRiwayatResume(id ? readRiwayaResume(id) : null);
      } catch {}
      destroyEngine();
      setActive(false);
      setPlaying(false);
      setInterrupted(false);
      setShowRiwayatResume(true);
      return;
    }
    // ورد استماع: stopping saves the exact ayah AND time-in-ayah
    // (redirect A), so the next visit resumes from precisely here.
    if (activeModeRef.current === 'wird') {
      let time = 0;
      try {
        const pos = engineRef.current?.getPosition();
        if (pos && typeof pos.time === 'number') time = pos.time;
      } catch {}
      try {
        writeListeningWird({
          surah: activeSurahRef.current,
          ayah: currentAyahRef.current,
          reciter: activeReciterRef.current,
          time,
        });
      } catch {}
      try {
        setSavedWird(readListeningWird());
      } catch {}
    }
    destroyEngine();
    setActive(false);
    setPlaying(false);
    setInterrupted(false);
    setShowResume(true);
  };

  // Riwaya mode: start (or restart) surah-file playback. Takes
  // explicit values so the resume card can start at the saved
  // position without waiting for state updates. Always called
  // from a tap (user gesture), which iOS requires before audio
  // may play. No ayah chaining, no read-along: one file plays
  // to its end and stops.
  const startRiwayaPlayback = async (
    surahNo: number,
    riwaya: string,
    startTime = 0,
  ) => {
    setEngineError(null);
    setInterrupted(false);
    // A fresh start supersedes any pending external-interrupt
    // auto-resume: the user made a new choice.
    clearExternalInterruptState();
    destroyEngine();
    activeSurahRef.current = surahNo;
    activeRiwayaRef.current = riwaya;
    activeHadrRef.current = false;
    setSurah(surahNo);
    setRiwayaId(riwaya);
    // Feature #9: record this listen start for "سمعت مؤخرًا".
    recordRecentListen(surahNo);
    const engine = new RiwayaEngineClass({
      riwayaId: riwaya,
      surah: surahNo,
      startTime,
      playbackRate,
      onEnded: () => {
        setPlaying(false);
        // Finished: same dead-position rule as hadr — clear so
        // the resume card never offers the end of a done surah.
        try {
          clearRiwayaResume(riwaya);
        } catch {}
        setSavedRiwayatResume(null);
      },
      onError: (message) => {
        setEngineError(message);
        setPlaying(false);
      },
      onInterrupted: () => {
        // Same rule as Hafs: show the resume button; do NOT auto-play.
        setInterrupted(true);
        setPlaying(false);
        // External-audio auto-resume: record the intent iff the
        // system (not the user) paused us.
        recordExternalInterrupt();
      },
    });
    riwayaEngineRef.current = engine;
    setActive(true);
    try {
      await engine.play();
      setPlaying(true);
    } catch {
      setEngineError('تعذر تشغيل الصوت — تحقق من الاتصال وحاول مجددا.');
      setPlaying(false);
    }
  };

  // Hadr mode: Juhani natural fast pace, surah-file playback
  // through the SAME RiwayaEngine (edition/label/persist
  // overrides — see hadr.ts), so it inherits the riwaya
  // engine's Media Session + interruption behaviour exactly.
  // playbackRate is forced to 1 here: hadr's pace is natural,
  // and an electronic rate left over from Hafs listening must
  // never stack on top of it. No ayah chaining, no read-along:
  // one file plays to its end and stops. Resume is supported
  // (hadr resume card), like the riwaya modes.
  const startHadrPlayback = async (
    surahNo: number,
    startTime = 0,
  ) => {
    setEngineError(null);
    setInterrupted(false);
    // A fresh start supersedes any pending external-interrupt
    // auto-resume: the user made a new choice.
    clearExternalInterruptState();
    destroyEngine();
    activeSurahRef.current = surahNo;
    activeRiwayaRef.current = null;
    activeHadrRef.current = true;
    setSurah(surahNo);
    setHadrOn(true);
    // Feature #9: record this listen start for "سمعت مؤخرًا".
    recordRecentListen(surahNo);
    const engine = new RiwayaEngineClass({
      riwayaId: 'hadr',
      edition: HADR_EDITION,
      label: HADR_NAME,
      surah: surahNo,
      startTime,
      playbackRate: 1,
      onPersistPosition: (pos) => {
        try {
          writeHadrResume({ surah: pos.surah, time: pos.time });
        } catch {}
      },
      onEnded: () => {
        setPlaying(false);
        // Finished: no position left to resume — clear so the
        // resume card (and any auto-resume) never offers a dead
        // end-of-file position.
        try {
          clearHadrResume();
        } catch {}
        setSavedHadrResume(null);
      },
      onError: (message) => {
        setEngineError(message);
        setPlaying(false);
      },
      onInterrupted: () => {
        // Same rule as every other engine: show the resume
        // button; do NOT auto-play.
        setInterrupted(true);
        setPlaying(false);
        // External-audio auto-resume: record the intent iff the
        // system (not the user) paused us.
        recordExternalInterrupt();
      },
    });
    riwayaEngineRef.current = engine;
    setActive(true);
    try {
      await engine.play();
      setPlaying(true);
    } catch {
      setEngineError('تعذر تشغيل الصوت — تحقق من الاتصال وحاول مجددا.');
      setPlaying(false);
    }
  };

  // Three-mode journey: continuous listening from the selected
  // surah (and selected reciter as the rotation's start) to the
  // end of surah 114. Takes explicit values so a resume card can
  // start at the saved position. Always called from a tap (user
  // gesture), which iOS requires before audio may play. In
  // tadabbur mode the journey's interstitials come from the
  // Complex's الميسر recording (see threeModeListen); the mode
  // button is disabled while the clips are unconfigured, so this
  // never starts an interstitial-less tadabbur journey by mistake.
  const startJourney = async (
    journey: ThreeMode,
    fromSaved?: ThreeModePosition,
  ) => {
    setEngineError(null);
    setInterrupted(false);
    // A fresh start supersedes any pending external-interrupt
    // auto-resume: the user made a new choice.
    clearExternalInterruptState();
    destroyEngine();
    activeHadrRef.current = false;
    const startSurah = fromSaved ? fromSaved.startSurah : surah;
    // A fresh journey starts with the detail view's journey
    // reciter (Juhani included, single mode only); a resume uses
    // the saved position's start reciter.
    const startReciter = fromSaved ? fromSaved.startReciterId : journeyReciterForMode();
    setJourneyMode(journey);
    setJourneyItem(null);
    setPreselectedMode(null);
    setSurah(startSurah);
    // Feature #9: record this listen start for "سمعت مؤخرًا"
    // (start surah + start ayah of the journey / resume point).
    recordRecentListen(startSurah, fromSaved?.ayah ?? 1);
    // The journey's start reciter lives in its own state: Juhani
    // must never reach the global preference (see the state
    // comment above). The 8 keep the old behaviour — the global
    // state follows the journey's reciter.
    setJourneyReciterId(startReciter);
    if (startReciter !== JUHANI_RECITER_ID) setReciterId(startReciter);
    const engine = new JourneyEngineClass({
      mode: journey,
      startSurah,
      startReciterId: startReciter,
      startAyah: 1,
      playbackRate,
      // Tadabbur order: a resume keeps the order its journey
      // started with (recorded on the position; pre-toggle
      // positions carry no order and were always 'after', so they
      // stay 'after'). Only a fresh journey uses the toggle.
      tafsirOrder:
        journey === 'tadabbur'
          ? fromSaved
            ? (fromSaved.tafsirOrder ?? 'after')
            : tadabburTafsirOrder
          : undefined,
      // Tafsir voice (Feature 1): the resolver reads the live
      // setting per clip (natural / generated / alternate by
      // quarter) and falls back to the natural recording on any
      // failure; the warmer prefetches generated audio while the
      // quarter plays. Dialogue mode ('حوار التفسير') plays each
      // tafsir clip as a 3-part sequence — generated male host,
      // natural recording as guest, generated female host — via
      // the dialogue resolver/warmer below; any dialogue failure
      // plays the natural clip alone. All are no-ops outside
      // tadabbur (the engine only calls them for tafsir items /
      // tadabbur ayahs).
      resolveTafsirUrl: (s, a) => resolveTafsirAudio(s, a),
      warmTafsirAudio: (s, a) => warmTafsirAudio(s, a),
      resolveDialogueAudio: (s, a) => resolveDialogueAudio(s, a),
      warmDialogueAudio: (s, a) => warmDialogueAudio(s, a),
      isDialogueTafsir: () => readTafsirVoice() === 'dialogue',
      startItem: fromSaved
        ? { kind: fromSaved.kind, surah: fromSaved.surah, ayah: fromSaved.ayah }
        : undefined,
      startInterstitial: fromSaved?.interstitial,
      startTime: fromSaved?.time ?? 0,
      onItemChange: (item) => {
        setJourneyItem(item);
        if (item.kind === 'ayah') {
          // Read-along follows ayah items (Hafs text matches the
          // Hafs reciters); the surah text effect loads the new
          // surah, and the playing ayah highlights as usual.
          setSurah(item.surah);
          if (item.reciterId === JUHANI_RECITER_ID) {
            // Juhani is a surah file: no per-ayah read-along (the
            // item's ayah is always 1, the file's first ayah).
            // The surah text still loads; nothing is highlighted.
            setCurrent(-1);
          } else {
            setCurrent(item.ayah);
            scrollToAyah(item.ayah);
          }
        } else {
          // Interstitial: no ayah highlight (nothing matches -1).
          setCurrent(-1);
        }
      },
      onEnded: () => {
        // A journey's onEnded means TRUE completion (surah 114,
        // ayah 6 — the final quarter has no interstitial by owner
        // decision): a finished journey has no resume to offer,
        // so its saved position is cleared.
        try {
          clearThreeModeResume(journey);
        } catch {}
        try {
          setSavedJourneys(readAllThreeModeResumes());
        } catch {}
        setPlaying(false);
      },
      onError: (message) => {
        setEngineError(message);
        setPlaying(false);
      },
      onInterrupted: () => {
        // Same rule as every other engine: show the resume
        // button; do NOT auto-play.
        setInterrupted(true);
        setPlaying(false);
        // External-audio auto-resume: record the intent iff the
        // system (not the user) paused us.
        recordExternalInterrupt();
      },
    });
    journeyEngineRef.current = engine;
    setActive(true);
    try {
      await engine.play();
      setPlaying(true);
    } catch {
      setEngineError('تعذر تشغيل الصوت — تحقق من الاتصال وحاول مجددا.');
      setPlaying(false);
    }
  };

  const stopJourney = () => {
    // Stopping is a deliberate user choice: drop any pending
    // external-interrupt auto-resume (never auto-resume a stop).
    clearExternalInterruptState();
    // JourneyEngine.destroy() persists the live position (with
    // time), so the next visit resumes from precisely here.
    destroyEngine();
    try {
      setSavedJourneys(readAllThreeModeResumes());
    } catch {}
    setJourneyMode(null);
    setJourneyItem(null);
    setActive(false);
    setPlaying(false);
    setInterrupted(false);
  };

  const resumeJourneySaved = (journey: ThreeMode) => {
    const saved = savedJourneys[journey];
    if (!saved) return;
    setHiddenJourneyResumes((prev) => (prev.includes(journey) ? prev : [...prev, journey]));
    void startJourney(journey, saved);
  };

  const dismissJourneyResume = (journey: ThreeMode) => {
    try {
      clearThreeModeResume(journey);
    } catch {}
    try {
      setSavedJourneys(readAllThreeModeResumes());
    } catch {}
    setHiddenJourneyResumes((prev) => (prev.includes(journey) ? prev : [...prev, journey]));
  };

  // Redirect B: the interruption resume button. A tap only — the
  // page never calls this on its own after an interruption.
  const resumeAfterInterruption = async () => {
    const jEngine = journeyEngineRef.current;
    if (jEngine) {
      setEngineError(null);
      try {
        await jEngine.play();
        setInterrupted(false);
        setPlaying(true);
        clearExternalInterruptState();
      } catch {
        setEngineError('تعذر تشغيل الصوت — تحقق من الاتصال وحاول مجددا.');
      }
      return;
    }
    const rEngine = riwayaEngineRef.current;
    if (rEngine) {
      setEngineError(null);
      try {
        await rEngine.play();
        setInterrupted(false);
        setPlaying(true);
        clearExternalInterruptState();
      } catch {
        setEngineError('تعذر تشغيل الصوت — تحقق من الاتصال وحاول مجددا.');
      }
      return;
    }
    const engine = engineRef.current;
    if (!engine) return;
    setEngineError(null);
    try {
      await engine.play();
      setInterrupted(false);
      setPlaying(true);
      clearExternalInterruptState();
    } catch {
      setEngineError('تعذر تشغيل الصوت — تحقق من الاتصال وحاول مجددا.');
    }
  };

  const togglePlayPause = async () => {
    const jEngine = journeyEngineRef.current;
    if (jEngine) {
      setEngineError(null);
      try {
        if (playing) {
          // User pause: mark it BEFORE pausing (see userPausedRef)
          // and drop any pending external-interrupt auto-resume.
          userPausedRef.current = true;
          clearExternalInterruptIntent();
          jEngine.pause();
          setPlaying(false);
        } else {
          clearExternalInterruptState();
          await jEngine.play();
          setInterrupted(false);
          setPlaying(true);
        }
      } catch {
        setEngineError('تعذر تشغيل الصوت — تحقق من الاتصال وحاول مجددا.');
      }
      return;
    }
    const rEngine = riwayaEngineRef.current;
    if (rEngine) {
      setEngineError(null);
      try {
        if (playing) {
          // User pause: mark it BEFORE pausing (see userPausedRef)
          // and drop any pending external-interrupt auto-resume.
          userPausedRef.current = true;
          clearExternalInterruptIntent();
          rEngine.pause();
          setPlaying(false);
        } else {
          clearExternalInterruptState();
          await rEngine.play();
          setInterrupted(false);
          setPlaying(true);
        }
      } catch {
        setEngineError('تعذر تشغيل الصوت — تحقق من الاتصال وحاول مجددا.');
      }
      return;
    }
    const engine = engineRef.current;
    if (!engine) return;
    setEngineError(null);
    try {
      if (playing) {
        // User pause: mark it BEFORE pausing (see userPausedRef)
        // and drop any pending external-interrupt auto-resume.
        userPausedRef.current = true;
        clearExternalInterruptIntent();
        engine.pause();
        setPlaying(false);
      } else {
        clearExternalInterruptState();
        await engine.play();
        setInterrupted(false);
        setPlaying(true);
      }
    } catch {
      setEngineError('تعذر تشغيل الصوت — تحقق من الاتصال وحاول مجددا.');
    }
  };

  const changeReciter = (id: string) => {
    if (!RECITERS.some((r) => r.id === id)) return;
    setReciterId(id);
    try {
      localStorage.setItem('quran-reciter', id);
    } catch {}
  };

  // Journey detail reciter pick (2026-11-06): Juhani is offered
  // in the single-khatma detail only, and sets the journey
  // reciter state WITHOUT touching the global preference (never
  // persisted — 'quran-reciter' keeps holding one of the 8).
  // Picking one of the 8 keeps the old shared behaviour: the
  // journey pick also becomes the global listen preference.
  const changeJourneyReciter = (id: string) => {
    if (id === JUHANI_RECITER_ID) {
      // Single-khatma only: the option is rendered only there,
      // and this guard keeps a stray value out of the other modes.
      if (hubView !== 'single') return;
      setJourneyReciterId(JUHANI_RECITER_ID);
      return;
    }
    if (!RECITERS.some((r) => r.id === id)) return;
    setJourneyReciterId(id);
    changeReciter(id);
  };

  const changeRiwaya = (id: string | null) => {
    if (id !== null && !RIWAYAT.some((r) => r.id === id)) return;
    setRiwayaId(id);
    try {
      if (id === null) localStorage.removeItem('quran-riwaya');
      else localStorage.setItem('quran-riwaya', id);
    } catch {}
    try {
      setSavedRiwayatResume(id ? readRiwayaResume(id) : null);
    } catch {}
    setShowRiwayatResume(true);
  };

  // The three pace-mode selectors. Exactly one of Hafs / riwaya /
  // hadr is selected at a time; selecting one clears the others'
  // selection flags (the persisted riwaya id itself is left
  // alone when hadr is picked, so reselecting it later still
  // finds its own resume — only the hadr flag outranks it).
  const selectHafs = () => {
    setHadrOn(false);
    setHadrSelected(false);
    changeRiwaya(null);
  };

  const selectRiwaya = (id: string) => {
    setHadrOn(false);
    setHadrSelected(false);
    changeRiwaya(id);
  };

  const selectHadr = () => {
    setHadrOn(true);
    setHadrSelected(true);
    // State only (not changeRiwaya(null), which would erase the
    // persisted riwaya id): the riwaya resume card hides because
    // riwayaId is null, and the hadr flag outranks the stored id
    // on the next load.
    setRiwayaId(null);
    try {
      setSavedHadrResume(readHadrResume());
    } catch {}
    setShowHadrResume(true);
  };

  const changeRate = (rate: number) => {
    if (!PLAYBACK_RATES.includes(rate as (typeof PLAYBACK_RATES)[number])) return;
    setPlaybackRate(rate);
    try {
      localStorage.setItem('quran-playback-rate', String(rate));
    } catch {}
  };

  const resumeHadrSaved = () => {
    setHubView('free');
    if (!savedHadrResume) return;
    setShowHadrResume(false);
    void startHadrPlayback(savedHadrResume.surah, savedHadrResume.time ?? 0);
  };

  const dismissHadrResume = () => {
    try {
      clearHadrResume();
    } catch {}
    setSavedHadrResume(null);
    setShowHadrResume(false);
  };

  // Live intent, same priority as the unmount effect: journey,
  // riwaya, hafs. Reads engine refs (stable objects), so it is
  // safe to call from any effect cleanup or dispatcher.
  const captureIntent = (): AutoResumeIntent | null => {
    try {
      const j = journeyEngineRef.current;
      const r = riwayaEngineRef.current;
      const e = engineRef.current;
      if (j?.playing) {
        return { kind: 'journey', position: j.getPosition(), at: Date.now() };
      }
      if (r?.playing) {
        const pos = r.getPosition();
        return activeHadrRef.current
          ? { kind: 'hadr', surah: pos.surah, time: pos.time, at: Date.now() }
          : { kind: 'riwaya', riwaya: r.current.riwaya, surah: pos.surah, time: pos.time, at: Date.now() };
      }
      if (e?.playing) {
        const pos = e.getPosition();
        return { kind: 'hafs', surah: pos.surah, reciter: pos.reciter, mode: activeModeRef.current, ayah: pos.ayah, time: pos.time ?? 0, at: Date.now() };
      }
    } catch {
      // ignore
    }
    return null;
  };

  // The old mount effect's resume body, factored out so the mount
  // effect, the show effect, and the anywhere-resume dispatcher
  // all run the same proven path. Consumes the intent up front;
  // if no engine ends up playing (blocked play), the intent is
  // re-saved so the next show retries, and the stored resume
  // cards stay as the tap fallback.
  const resumeFromIntent = async (intent: AutoResumeIntent): Promise<void> => {
    try {
      if (sessionStorage.getItem('quran-listen-preselect')) {
        clearAutoResumeIntent();
        return;
      }
    } catch {}
    clearAutoResumeIntent();
    try {
      if (intent.kind === 'hadr') { await startHadrPlayback(intent.surah, intent.time); setHubView('free'); }
      else if (intent.kind === 'riwaya') { await startRiwayaPlayback(intent.surah, intent.riwaya, intent.time); setHubView('free'); }
      else if (intent.kind === 'hafs') { await startPlayback(intent.surah, intent.reciter, intent.mode, intent.ayah, intent.time); setHubView('free'); }
      else { await startJourney(intent.position.mode, intent.position); setHubView(intent.position.mode); }
    } catch {
      // The start functions swallow a blocked play into an error
      // line instead of throwing; the check below catches it.
    }
    try {
      const anyPlaying =
        journeyEngineRef.current?.playing ||
        riwayaEngineRef.current?.playing ||
        engineRef.current?.playing;
      if (!anyPlaying) writeAutoResumeIntent(intent);
    } catch {
      // ignore
    }
  };

  // Anywhere-resume: rebuild an intent from the positions the
  // engines captured at preemption time (live getPosition would
  // be stale — the element's src changed under it). One-shot:
  // captures are cleared after use so a stale position can never
  // replay. No capture means the engine was paused, not playing,
  // when preempted — nothing resumes.
  const buildListenResume = (): void => {
    const j = journeyEngineRef.current;
    const r = riwayaEngineRef.current;
    const e = engineRef.current;
    let intent: AutoResumeIntent | null = null;
    if (j?.preemptedPosition) {
      intent = { kind: 'journey', position: j.preemptedPosition, at: Date.now() };
    } else if (r?.preemptedPosition) {
      const p = r.preemptedPosition;
      intent = p.editionOverride
        ? { kind: 'hadr', surah: p.surah, time: p.time, at: Date.now() }
        : { kind: 'riwaya', riwaya: p.riwaya, surah: p.surah, time: p.time, at: Date.now() };
    } else if (e?.preemptedPosition) {
      const p = e.preemptedPosition;
      intent = { kind: 'hafs', surah: p.surah, reciter: p.reciter, mode: p.mode, ayah: p.ayah, time: p.time, at: Date.now() };
    }
    if (!intent) return;
    if (j) j.preemptedPosition = null;
    if (r) r.preemptedPosition = null;
    if (e) e.preemptedPosition = null;
    void resumeFromIntent(intent);
  };

  // Continuity: auto-resume a playback that was paused by
  // LEAVING this page (see the unmount effect). One attempt
  // only: the intent is consumed up front. A home khatma
  // preselection wins (a fresh choice): the intent is dropped
  // and that effect runs normally. If the browser blocks the
  // play (no gesture in this load), the intent is re-saved so
  // the next visit retries, and the stored resume cards stay
  // as the tap fallback. Declared BEFORE the preselect effect
  // on purpose: effects run in declaration order, so this one
  // still sees the preselect flag before that effect consumes it.
  useEffect(() => {
    // Hidden at mount (App mounts audio pages early, hidden):
    // the show effect owns the first resume when first shown.
    if (!visibleRef.current) return;
    const intent = readAutoResumeIntent();
    if (!intent) return;
    void resumeFromIntent(intent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Anywhere-resume: register a stable dispatcher once; the ref
  // always points at the latest resume closure (which reads live
  // refs, so a stale engine can never be resumed).
  useEffect(() => {
    registerResume('listen', () => {
      try {
        listenResumeRef.current?.();
      } catch {
        // ignore: a failing resume must not break the releaser
      }
    });
    return () => {
      unregisterResume('listen');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the dispatcher target after every render.
  useEffect(() => {
    listenResumeRef.current = buildListenResume;
  });

  // Route show/hide (App keeps this page mounted while hidden).
  // Hiding pauses a live engine and saves the intent — the old
  // unmount behavior, minus destroy, so the engine stays alive
  // for stack-resume. Showing consumes the intent: fast path
  // when this page still holds the element (hide-pause preserved
  // src+time), otherwise the recreate-from-intent path. UI state
  // is re-synced to engine reality at the end (a stack-resume
  // while hidden must not leave a stale paused UI on return).
  useEffect(() => {
    const wasVisible = prevVisibleRef.current;
    prevVisibleRef.current = visible;
    if (wasVisible === visible) return;
    if (!visible) {
      // Deliberate route-hide (not a document lock): leaving the page
      // clears the interruption marker — the route-hide intent above
      // already owns the return path for this case.
      clearInterruptionMarker('route-hide');
      try {
        const intent = captureIntent();
        if (intent) {
          writeAutoResumeIntent(intent);
          const j = journeyEngineRef.current;
          const r = riwayaEngineRef.current;
          const e = engineRef.current;
          if (j?.playing) j.pause();
          else if (r?.playing) r.pause();
          else if (e?.playing) e.pause();
          setPlaying(false);
          // Anywhere-resume: leaving the page closes it for stack
          // purposes — if another owner waits (this page preempted
          // it earlier), release so it resumes now. When nobody
          // waits, keep holding: the show path's instant resume
          // needs the element untouched.
          if (hasWaitingResumes()) releaseAudio('listen');
        } else {
          clearAutoResumeIntent();
        }
      } catch {
        // ignore
      }
      return;
    }
    // Showing.
    const intent = readAutoResumeIntent();
    if (intent) {
      clearAutoResumeIntent();
      const eng = journeyEngineRef.current ?? riwayaEngineRef.current ?? engineRef.current;
      if (eng && currentAudioOwner() === 'listen') {
        // Still holding the element: exact instant resume.
        void eng.play().catch(() => {
          // Blocked (e.g. autoplay policy): keep the intent so
          // the next show retries, and tap-resume stays available.
          try {
            writeAutoResumeIntent(intent);
          } catch {
            // ignore
          }
        });
      } else {
        void resumeFromIntent(intent);
      }
    }
    try {
      const anyPlaying =
        journeyEngineRef.current?.playing ||
        riwayaEngineRef.current?.playing ||
        engineRef.current?.playing;
      setPlaying(!!anyPlaying);
      if (anyPlaying) setInterrupted(false);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Lock/background return sync: the engines never pause on
  // hide, so audio keeps playing through a lock — but their
  // hidden handler still reports "interrupted", so a return
  // from lock could show "paused" while audio plays. On
  // becoming visible again, trust the element: playing →
  // clear the interrupted UI; paused → leave it (a real
  // suspension, e.g. a phone call, still needs the tap).
  useEffect(() => {
    const onVis = () => {
      try {
        if (document.visibilityState !== 'visible') return;
        const anyEngine = journeyEngineRef.current || riwayaEngineRef.current || engineRef.current;
        if (!anyEngine) return;
        const audio = getSharedAudio();
        if (!audio.paused) {
          setInterrupted(false);
          setPlaying(true);
        }
      } catch {}
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External-audio auto-resume (2026-11-06): when another app's
  // audio paused our listen audio, the engine recorded an intent
  // (see recordExternalInterrupt). On RETURN to the app — the
  // document becoming visible, or pageshow after a bfcache
  // restore — resume it immediately, from the saved position
  // (same reciter / mode / quarter). A user pause never records
  // an intent, so it can never auto-resume here; the check below
  // is belt-and-suspenders. HONEST BOUNDARY: a web page cannot
  // run while hidden, so the resume happens the moment the user
  // RETURNS to the app (the Safari tab becomes visible), not
  // while they are on the home screen or in the other app. The
  // resume is immediate on return. If the play is blocked
  // (autoplay policy), the intent is kept so the next return
  // retries, and the tap-resume button stays as the fallback.
  useEffect(() => {
    const tryResume = () => {
      try {
        let visible = false;
        try {
          visible = document.visibilityState === 'visible';
        } catch {
          visible = false;
        }
        if (!visible) return;
        const intent = readExternalInterruptIntent();
        if (!intent) return;
        if (userPausedRef.current) {
          // The user paused after the interruption was recorded:
          // never auto-resume; drop the stale intent.
          clearExternalInterruptIntent();
          return;
        }
        // Already playing again (e.g. the user tapped play before
        // this handler ran): drop the stale intent, nothing to do.
        try {
          if (!getSharedAudio().paused) {
            clearExternalInterruptIntent();
            return;
          }
        } catch {
          // fall through: attempt the resume below.
        }
        const eng = journeyEngineRef.current ?? riwayaEngineRef.current ?? engineRef.current;
        if (eng) {
          // Resume the live engine in place (same as the tap-resume
          // button): exact position, quarter tracking intact.
          void (async () => {
            try {
              await eng.play();
              clearExternalInterruptState();
              setInterrupted(false);
              setPlaying(true);
            } catch {
              // Blocked play: keep the intent for the next return;
              // the tap-resume button stays available.
              setEngineError('تعذر تشغيل الصوت — تحقق من الاتصال وحاول مجددا.');
            }
          })();
        } else {
          // No live engine (destroyed after the interruption):
          // rebuild from the saved intent. resumeFromIntent
          // re-saves to the route-hide key if the play is blocked,
          // so the next show retries.
          clearExternalInterruptState();
          void resumeFromIntent(intent);
        }
      } catch {
        // ignore: a failing auto-resume must never break the page.
      }
    };
    const onVis = () => {
      try {
        if (document.visibilityState === 'visible') tryResume();
      } catch {}
    };
    const onPageShow = (e: Event) => {
      try {
        // Only bfcache restores (a return to a loaded page), never
        // a fresh load — a fresh load has no user gesture, so an
        // auto-play attempt would only surface an error.
        const persisted = (e as { persisted?: boolean }).persisted;
        if (persisted) tryResume();
      } catch {}
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', onPageShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Interrupted-listening marker (Fix 2, 2026-10-30): on document-hide
  // or pagehide, record the interruption iff this page is the shown
  // route AND an engine is playing; otherwise clear any stale marker
  // (a paused player must never manufacture a playing interruption).
  // Separate listener from the return-sync above: this one owns the
  // marker, that one owns the interrupted UI. pagehide is the more
  // reliable event on iOS; both write idempotently.
  useEffect(() => {
    const anyPlaying = () =>
      !!(
        journeyEngineRef.current?.playing ||
        riwayaEngineRef.current?.playing ||
        engineRef.current?.playing
      );
    const onHidden = (kind: 'visibilitychange' | 'pagehide') => {
      try {
        handleInterruptionHidden('listen', anyPlaying(), blackScreenRef.current, visibleRef.current, kind);
      } catch {
        // ignore
      }
    };
    const onVis = () => {
      try {
        if (document.visibilityState === 'hidden') onHidden('visibilitychange');
        else if (document.visibilityState === 'visible') {
          recLog('VISIBILITY_VISIBLE', {
            page: 'listen',
            route: 'listen',
            hash: window.location.hash,
            playing: anyPlaying(),
          });
        }
      } catch {
        // ignore
      }
    };
    const onPageHide = () => onHidden('pagehide');
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onPageHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Home khatma card preselection (one-time flag, same pattern
  // as 'quran-open-fullscreen'): a home card sets
  // 'quran-listen-preselect' to 'varied' | 'tadabbur' and
  // navigates here. Consume it once: land in Hafs mode (a khatma
  // is a Hafs journey), highlight that mode's button, and scroll
  // the journey section into view. Never auto-plays — the user
  // still taps the mode button (or its resume card) to start.
  // A persisted riwaya/hadr first render may flash before this
  // effect switches to Hafs; that single frame is accepted
  // rather than reading sessionStorage in a state initializer
  // (which would run on every render path, not just mount).
  useEffect(() => {
    let flag: string | null = null;
    try {
      flag = sessionStorage.getItem('quran-listen-preselect');
    } catch {}
    if (flag !== 'varied' && flag !== 'tadabbur') return;
    try {
      sessionStorage.removeItem('quran-listen-preselect');
    } catch {}
    setHadrOn(false);
    setHadrSelected(false);
    changeRiwaya(null);
    setPreselectedMode(flag);
    setHubView(flag);
    const timer = setTimeout(() => {
      try {
        document.getElementById('three-mode-section')?.scrollIntoView({ block: 'start' });
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // «اؤمرني» (2026-11-08): "عايز أسمع سورة الملك" sets a one-time
  // 'quran-listen-surah' and navigates here. The page stays mounted
  // between routes, so this runs whenever it becomes visible. Plays
  // the whole surah from ayah 1 with the user's current reciter.
  useEffect(() => {
    if (!visible) return;
    let n = 0;
    try {
      n = Number(sessionStorage.getItem('quran-listen-surah') || 0);
      sessionStorage.removeItem('quran-listen-surah');
    } catch {}
    if (!Number.isInteger(n) || n < 1 || n > 114) return;
    setHadrOn(false);
    setHadrSelected(false);
    changeRiwaya(null);
    setHubView('free');
    setSurah(n);
    void startPlayback(n, reciterId, 'free', 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const resumeRiwayatSaved = () => {
    setHubView('free');
    if (!savedRiwayatResume) return;
    setShowRiwayatResume(false);
    void startRiwayaPlayback(
      savedRiwayatResume.surah,
      savedRiwayatResume.riwaya,
      savedRiwayatResume.time ?? 0,
    );
  };

  const dismissRiwayatResume = () => {
    try {
      if (savedRiwayatResume) clearRiwayaResume(savedRiwayatResume.riwaya);
    } catch {}
    setSavedRiwayatResume(null);
    setShowRiwayatResume(false);
  };

  const resumeSaved = () => {
    setHubView('free');
    if (!savedWird) return;
    setShowResume(false);
    // Redirect A: resume passes the stored time-in-ayah as startTime.
    void startPlayback(savedWird.surah, savedWird.reciter, 'wird', savedWird.ayah, savedWird.time ?? 0);
  };

  const dismissResume = () => {
    try {
      clearListeningWird();
    } catch {}
    setSavedWird(null);
    setShowResume(false);
  };

  const handleEstimate = async () => {
    setOfflineError(null);
    setEstimating(true);
    try {
      const est = await estimateSurahSize(reciterId, surah);
      setEstimate(est);
    } catch {
      setOfflineError('تعذر تقدير حجم السورة — حاول مجددا.');
    } finally {
      setEstimating(false);
    }
  };

  const handleDownload = async () => {
    setOfflineError(null);
    setDownloading(true);
    setProgress(null);
    try {
      await downloadSurah(reciterId, surah, (done, total) => {
        setProgress({ done, total });
      });
      setDownloaded(true);
      setEstimate(null);
      setProgress(null);
    } catch {
      setOfflineError('تعذر تحميل السورة — تحقق من الاتصال وحاول مجددا.');
    } finally {
      setDownloading(false);
    }
  };

  const handleDeleteDownload = async () => {
    setOfflineError(null);
    try {
      await deleteDownloadedSurah(reciterId, surah);
      setDownloaded(false);
    } catch {
      setOfflineError('تعذر حذف التحميل — حاول مجددا.');
    }
  };

  // Ayah text: cache first, network fallback, then cache the rows.
  // Text is never invented: on total failure an honest error shows.
  useEffect(() => {
    let cancelled = false;
    const loadText = async () => {
      // Riwaya mode is listening-only: no Hafs text is shown
      // under a non-Hafs voice (the words differ between readings).
      // Hadr is Hafs-voiced but surah-file: no ayah steps, so no
      // read-along either (the text block hides, same as riwaya).
      if (riwayaId !== null || hadrOn) {
        setAyahs(null);
        setTextLoading(false);
        setTextError(null);
        return;
      }
      setTextLoading(true);
      setTextError(null);
      const expected = surahCount(surah);
      try {
        const cached = await getQuranTextCache().getSurah(surah, expected);
        if (cancelled) return;
        if (cached) {
          setAyahs(cached);
          setTextLoading(false);
          return;
        }
        const { data, error } = await supabase
          .from('quran_verses')
          .select('id, surah_no, surah_name, ayah_no, ayah_text, ayah_text_clean')
          .eq('surah_no', surah)
          .order('ayah_no', { ascending: true });
        if (cancelled) return;
        if (error || !data || data.length !== expected) {
          setAyahs(null);
          setTextError('تعذر تحميل نص السورة — تحقق من الاتصال وحاول مجددا.');
        } else {
          setAyahs(data as CachedTextRow[]);
          void getQuranTextCache().putRows(data);
        }
      } catch {
        if (!cancelled) {
          setAyahs(null);
          setTextError('تعذر تحميل نص السورة — تحقق من الاتصال وحاول مجددا.');
        }
      } finally {
        if (!cancelled) setTextLoading(false);
      }
    };
    void loadText();
    return () => {
      cancelled = true;
    };
  }, [surah, riwayaId, hadrOn]);

  // Offline status for the selected surah + reciter.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      setOfflineChecking(true);
      try {
        const found = await isSurahDownloaded(reciterId, surah);
        if (!cancelled) setDownloaded(found);
      } catch {
        if (!cancelled) setDownloaded(false);
      } finally {
        if (!cancelled) setOfflineChecking(false);
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [surah, reciterId]);

  // In-context audio download status: which kind applies here —
  // Juhani file in hadr mode, tafsir clips in the tadabbur
  // detail — and whether this surah is already downloaded. A
  // running/estimating job is never orphaned by a surah change.
  useEffect(() => {
    const kind: AudioDownloadKind | null =
      hadrOn && hubView === 'free'
        ? 'juhani'
        : hubView === 'tadabbur' && tafsirConfigured()
          ? 'tafsir'
          : null;
    if (kind === null) {
      setCtxAudio(null);
      return;
    }
    setCtxAudio((prev) => {
      if (prev && prev.kind === kind && prev.surah === surah) return prev;
      if (prev && (prev.running || prev.estimating)) return prev;
      return {
        kind, surah,
        downloaded: isAudioDownloaded(kind, surah), checking: false,
        estimating: false, estimate: null, space: null,
        confirm: false, running: false, progress: null,
        error: '', quota: false,
      };
    });
  }, [surah, hadrOn, hubView]);

  const ctxAskAudio = async () => {
    const job = ctxAudio;
    if (!job || job.running || job.estimating) return;
    setCtxAudio({ ...job, estimating: true, error: '', quota: false });
    try {
      const est = job.kind === 'tafsir'
        ? await estimateTafsirSurah(job.surah)
        : await estimateJuhaniSurah(job.surah);
      const space = await checkAudioDownloadSpace(est.bytes);
      if (space.status === 'low') {
        setCtxAudio({
          ...job, estimating: false, estimate: est,
          space: { neededMB: space.neededMB, freeMB: space.freeMB },
          error: `مساحة جهازك لا تكفي — التحميل يحتاج حوالي ${space.neededMB.toLocaleString('ar-EG')} ميجابايت (بهامش أمان) والمتاح حوالي ${(space.freeMB ?? 0).toFixed(0)} ميجابايت. فضّي مساحة وحاول تاني.`,
          quota: true,
        });
        return;
      }
      setCtxAudio({
        ...job, estimating: false, estimate: est,
        space: { neededMB: space.neededMB, freeMB: space.freeMB }, confirm: true,
      });
    } catch {
      setCtxAudio({ ...job, estimating: false, error: AUDIO_DOWNLOAD_FAILED_MESSAGE });
    }
  };

  const ctxStartAudio = async () => {
    const job = ctxAudio;
    if (!job || !job.confirm || job.running) return;
    ctxAudioAbortRef.current = new AbortController();
    setCtxAudio({ ...job, confirm: false, running: true, progress: { done: 0, total: job.estimate?.count ?? 1 }, error: '', quota: false });
    try {
      const onP = (p: { done: number; total: number }) =>
        setCtxAudio((prev) => prev && prev.kind === job.kind && prev.surah === job.surah ? { ...prev, progress: p } : prev);
      if (job.kind === 'tafsir') {
        await downloadTafsirSurah(job.surah, onP, { signal: ctxAudioAbortRef.current.signal });
      } else {
        await downloadJuhaniSurah(job.surah, onP, { signal: ctxAudioAbortRef.current.signal });
      }
      setCtxAudio((prev) => prev && prev.kind === job.kind && prev.surah === job.surah
        ? { ...prev, running: false, progress: null, downloaded: true, error: '' } : prev);
    } catch (e) {
      const msg = e instanceof Error ? e.message : AUDIO_DOWNLOAD_FAILED_MESSAGE;
      setCtxAudio((prev) => prev && prev.kind === job.kind && prev.surah === job.surah
        ? { ...prev, running: false, progress: null, error: msg, quota: msg === AUDIO_QUOTA_MESSAGE } : prev);
    } finally {
      ctxAudioAbortRef.current = null;
    }
  };

  const ctxStopAudio = () => {
    ctxAudioAbortRef.current?.abort();
  };

  const ctxDeleteAudio = async () => {
    const job = ctxAudio;
    if (!job || job.running) return;
    await deleteAudioDownload(job.kind, job.surah);
    setCtxAudio({ ...job, downloaded: false, estimate: null, error: '' });
  };

  // Engine destroyed on unmount (and on Stop, via stopPlayback).
  // Continuity: if playback is LIVE at unmount (the user opened
  // another in-app page mid-listen), record a one-time
  // auto-resume intent FIRST — the mount effect resumes it on
  // return, from the pause point, with no tap. destroyEngine()
  // then persists the stored resumes, so tap-resume still works
  // if auto-play is ever blocked. Explicit stops and finished
  // surahs never reach here with playing=true, so they never
  // record an intent. Engine refs (not state) are read here:
  // this cleanup closes over the first render's state.
  useEffect(() => {
    return () => {
      // Teardown (logout): no resume may fire after this page is
      // gone — clear the stack BEFORE any release/destroy below.
      clearResumeStack();
      unregisterResume('listen');
      try {
        const intent = captureIntent();
        if (intent) writeAutoResumeIntent(intent);
        else clearAutoResumeIntent();
      } catch {}
      destroyEngine();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const count = surahCount(surah);
  const locked = active;

  // Shared back button (2026-11-06): while a detail view is open
  // (free listening or a journey), the shell BackButton returns to
  // the hub cards instead of الرئيسية. This page stays mounted when
  // hidden, so it registers ONLY while visible — a hidden page must
  // never hijack the shell button. Cleanup on view change, on hide,
  // and on unmount clears the target.
  //
  // LOCKED GATING (2026-11-06, part 3): `locked` IS a navigation
  // guard for the hub-back path, not just a playback guard. The old
  // per-page «عودة إلى الكروت» buttons were disabled={locked}, and
  // for a reason: the hub view exposes «استئناف» resume cards whose
  // buttons are NOT locked, so reaching the hub mid-session could
  // start a second journey while an engine is still live. The
  // target is therefore registered ONLY while not locked; while a
  // session is live the shell button falls back to «الرئيسية»
  // (route-leave, the established BottomNav behavior: audio pauses
  // on hide, resume on return). This effect lives HERE, after
  // `locked` is declared — its deps array evaluates eagerly during
  // render, so referencing `locked` from the old position (above
  // its declaration) would throw a TDZ ReferenceError.
  useEffect(() => {
    if (!visible || hubView === 'hub' || locked) {
      setBackTarget(null);
      return;
    }
    setBackTarget({ label: 'عودة إلى الكروت', onBack: () => setHubView('hub') });
    return () => setBackTarget(null);
  }, [visible, hubView, locked]);

  // Follow-along (#4): the ayah row for the now-playing bar — the
  // row must belong to the CURRENT surah (during a journey the
  // surah state changes before the new surah's text loads, so a
  // bare ayah_no match could show the previous surah's ayah).
  // Null while the text loads, for tafsir clips, for riwaya/hadr
  // surah files, and for Juhani journeys (currentAyah -1 there).
  const nowPlayingRow =
    active && riwayaId === null && !hadrOn && journeyItem?.kind !== 'tafsir' && currentAyah >= 1
      ? ayahs?.find((r) => r.surah_no === surah && r.ayah_no === currentAyah) ?? null
      : null;

  // 2026-11-07: stop at a unit boundary (end of juz / hizb / surah).
  useEffect(() => {
    if (unitTarget === null) return;
    if (getGlobalAyahNumber(surah, currentAyah) >= unitTarget) {
      stopPlayback();
      setUnitTarget(null);
      setUnitLabel('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surah, currentAyah, unitTarget]);

  function armTimerMinutes(m: number) {
    setUnitTarget(null);
    setUnitLabel('');
    setSleepTimer(m);
  }
  function armTimerAtClock(hhmm: string) {
    const [hh, mm] = hhmm.split(':').map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return;
    const now = new Date();
    const target = new Date(now);
    target.setHours(hh, mm, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    armTimerMinutes((target.getTime() - now.getTime()) / 60000);
  }
  function armTimerAtUnit(kind: 'juz' | 'hizb' | 'surah') {
    const cur = getGlobalAyahNumber(surah, currentAyah);
    if (kind === 'surah') {
      const next = surah >= 114 ? 6237 : getGlobalAyahNumber(surah + 1, 1);
      setUnitTarget(next);
      setUnitLabel('نهاية السورة');
    } else {
      const list = kind === 'juz' ? JUZ_STARTS : HIZB_STARTS;
      const nextStart = list.find((x) => x.global > cur);
      setUnitTarget(nextStart ? nextStart.global : 6237);
      setUnitLabel(kind === 'juz' ? 'نهاية الجزء' : 'نهاية الحزب');
    }
    clearSleepTimer(); // one timer at a time: the unit stop replaces a timed one
  }
  function cancelAllTimers() {
    setUnitTarget(null);
    setUnitLabel('');
    clearSleepTimer();
  }

  // Sleep timer (#10): the setter + live countdown + cancel. Always
  // rendered (not only while playing) so the user can arm it before
  // starting, and so a timer running after playback stopped stays
  // visible and cancellable. Emerald/gold only — no new hue.
  const KHATMA_MINUTE_CHIPS: [number, string][] = [[15, 'ربع ساعة'], [30, 'نص ساعة'], [45, '٤٥ دقيقة']];
  const KHATMA_HOUR_CHIPS: [number, string][] = [[60, 'ساعة'], [120, 'ساعتين'], [180, '٣ ساعات']];
  const [wheelMinutes, setWheelMinutes] = useState<number>(30);
  const sleepTimerBlock = (
    <div className="bg-white rounded-2xl border border-hairline-emerald shadow-sm p-5 mb-4">
      <p className="font-semibold text-accent-800 flex items-center gap-2">
        <Timer className="w-5 h-5 text-emerald-700" />
        مؤقت النوم
      </p>
      {sleepRemainingMs !== null || unitTarget !== null ? (
        <div>
          {sleepRemainingMs !== null && (
            <p className="text-sm text-accent-800 mt-2">
              سيتوقف التشغيل بعد{' '}
              <span className="font-bold">{formatSleepRemaining(sleepRemainingMs)}</span>
            </p>
          )}
          {unitTarget !== null && (
            <p className="text-sm text-accent-800 mt-2">سيتوقف التشغيل عند <span className="font-bold">{unitLabel}</span></p>
          )}
          <p className="text-xs text-accent-600 mt-1">
            يعمل حتى لو انتقلت لصفحة تانية — لكنه لا يعمل بعد إغلاق التطبيق.
          </p>
          <button
            onClick={cancelAllTimers}
            className="mt-3 w-full py-2.5 bg-white border border-hairline-emerald text-accent-800 font-semibold rounded-xl polish-press"
          >
            إلغاء المؤقت
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-accent-600 mt-2">اختار إمتى يتوقف التشغيل:</p>
          <p className="text-xs font-semibold text-accent-700">المدة</p>
          <TimerWheel items={[...KHATMA_MINUTE_CHIPS, ...KHATMA_HOUR_CHIPS]} initialIndex={1} onChange={setWheelMinutes} />
          <button onClick={() => armTimerMinutes(wheelMinutes)}
            className="w-full py-3.5 grad-emerald-door text-white text-lg font-bold rounded-xl polish-press">ابدأ المؤقت</button>
          <p className="text-xs font-semibold text-accent-700">بالساعة</p>
          <div className="flex gap-2">
            <div className="flex-1 min-w-0"><ClockWheel initial={clockAt} onChange={setClockAt} /></div>
            <button onClick={() => armTimerAtClock(clockAt)}
              className="self-center px-4 min-h-[44px] bg-white border border-hairline-emerald text-accent-800 font-semibold rounded-xl polish-press">ابدأ</button>
          </div>
          <p className="text-xs font-semibold text-accent-700">بالجزء أو الحزب أو السورة</p>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="بالوحدة">
            <button onClick={() => armTimerAtUnit('juz')} className="py-3.5 px-2 bg-white border border-hairline-emerald text-accent-800 text-base font-bold rounded-xl polish-press">الجزء</button>
            <button onClick={() => armTimerAtUnit('hizb')} className="py-3.5 px-2 bg-white border border-hairline-emerald text-accent-800 text-base font-bold rounded-xl polish-press">الحزب</button>
            <button onClick={() => armTimerAtUnit('surah')} className="py-3.5 px-2 bg-white border border-hairline-emerald text-accent-800 text-base font-bold rounded-xl polish-press">السورة</button>
          </div>
          <p className="text-xs text-accent-600">مؤقت واحد بس في كل مرة؛ لو ظبطت واحد جديد يلغي القديم.</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen page-bg pb-24">
      <header className="sticky top-0 z-40 app-header">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          {/* Header «الرئيسية» removed 2026-11-06: the shared BackButton
              above the page is the one way back. */}
          <div>
            <h1
              className="text-2xl md:text-3xl font-bold font-display-ar text-accent-800 flex items-center gap-2"
            >
              <Headphones className="w-5 h-5 text-emerald-600" />
              استمع للقرآن
            </h1>
            <p className="text-sm text-accent-600">واقفل الشاشة لو عايز</p>
          </div>
        </div>
      </header>

      {/* 2026-11-07: always-visible control bar while a recitation is active.
          Fixed to the bottom of the screen so the user never has to scroll back
          to the top to stop or lock while the page follows the ayah. */}
      {(playing || journeyMode !== null) && (
        <div className="fixed bottom-0 inset-x-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 bg-white/95 backdrop-blur border-t border-hairline-emerald shadow-2xl">
          <div className="max-w-5xl mx-auto grid grid-cols-2 gap-3">
            <button
              onClick={stopPlayback}
              className="py-4 bg-red-600 hover:bg-red-700 text-white text-lg font-bold rounded-xl flex items-center justify-center gap-2 polish-press"
            >
              <Square className="w-6 h-6" /> إيقاف
            </button>
            <button
              onClick={() => setBlackScreen(true)}
              className="py-4 bg-stone-800 hover:bg-stone-900 text-white text-lg font-bold rounded-xl flex items-center justify-center gap-2 polish-press"
            >
              <Moon className="w-6 h-6" /> قفل الشاشة
            </button>
          </div>
        </div>
      )}
      <main className="max-w-5xl mx-auto px-4 py-5">
        {/* Resume card FIRST, when a listening wird is saved */}
        {savedWird && showResume && (
          <div className="bg-amber-50 rounded-2xl border border-hairline-amber shadow-sm p-5 mb-4">
            <p className="font-semibold text-accent-800">
              استئناف من سورة {surahName(savedWird.surah)}، الآية {savedWird.ayah}
            </p>
            <p className="text-sm text-accent-600 mt-1">ورد استماع محفوظ من آخر مرة توقفت فيها.</p>
            <div className="flex gap-3 mt-4">
              <button
                onClick={resumeSaved}
                className="flex-1 py-3 grad-emerald-door text-white font-bold rounded-xl polish-press polish-focus"
              >
                استئناف
              </button>
              <button
                onClick={dismissResume}
                className="flex-1 py-3 bg-white border border-hairline-emerald text-accent-800 font-semibold rounded-xl polish-press"
              >
                ابدأ من الأول
              </button>
            </div>
          </div>
        )}

        {/* Riwaya resume card, when a position is saved for the
            selected riwaya. Per-riwaya: switching riwaya shows
            that riwaya's own saved position, not another's. */}
        {riwayaId !== null && savedRiwayatResume && showRiwayatResume && (
          <div className="bg-amber-50 rounded-2xl border border-hairline-amber shadow-sm p-5 mb-4">
            <p className="font-semibold text-accent-800">
              استئناف — سورة {surahName(savedRiwayatResume.surah)}، رواية{' '}
              {RIWAYAT.find((r) => r.id === savedRiwayatResume.riwaya)?.name || ''}
            </p>
            <p className="text-sm text-accent-600 mt-1">موضع محفوظ من آخر مرة توقفت فيها بهذه الرواية.</p>
            <div className="flex gap-3 mt-4">
              <button
                onClick={resumeRiwayatSaved}
                className="flex-1 py-3 grad-emerald-door text-white font-bold rounded-xl polish-press polish-focus"
              >
                استئناف
              </button>
              <button
                onClick={dismissRiwayatResume}
                className="flex-1 py-3 bg-white border border-hairline-emerald text-accent-800 font-semibold rounded-xl polish-press"
              >
                ابدأ من الأول
              </button>
            </div>
          </div>
        )}

        {/* Hadr resume card, when a hadr position is saved.
            Mirrors the riwaya card; shown only while hadr is the
            selected pace mode. */}
        {hadrOn && savedHadrResume && showHadrResume && (
          <div className="bg-amber-50 rounded-2xl border border-hairline-amber shadow-sm p-5 mb-4">
            <p className="font-semibold text-accent-800">
              استئناف — {HADR_NAME}: سورة {surahName(savedHadrResume.surah)}
            </p>
            <p className="text-sm text-accent-600 mt-1">موضع محفوظ من آخر مرة توقفت فيها بوضع الحدر.</p>
            <div className="flex gap-3 mt-4">
              <button
                onClick={resumeHadrSaved}
                className="flex-1 py-3 grad-emerald-door text-white font-bold rounded-xl polish-press polish-focus"
              >
                استئناف
              </button>
              <button
                onClick={dismissHadrResume}
                className="flex-1 py-3 bg-white border border-hairline-emerald text-accent-800 font-semibold rounded-xl polish-press"
              >
                ابدأ من الأول
              </button>
            </div>
          </div>
        )}

        {/* Listening hub (Amr 2026-10-30): four big cards; entering a
            card shows its details below. Cards are disabled while an
            engine plays (locked), like every other mode switch here.
            Cards use grad-amber-door (gold sub-door treatment, same
            as the Home sub-doors — Amr 2026-11-06), so the hub reads
            as the level below the emerald main doors. */}
        {hubView === 'hub' && (
        <div className="mb-4">
          <p className="font-semibold text-accent-800 text-lg mb-1">اختر طريقة الاستماع</p>
          <Hint id="listen-free"><p className="text-sm text-accent-600 mb-4">اضغط على كارت لاختيار التفاصيل والبدء. ولتوفير البطارية، يمكنك قفل الشاشة.</p></Hint>
          {/* Saved journey resumes first, so a returning journey
              user continues in one tap without entering a card. */}
          {THREE_MODES.map((m) => {
            const saved = savedJourneys[m.id];
            // 2026-11-06: hub-level resume cards removed (each sub-door keeps its own استئناف).
            if (!SHOW_HUB_RESUMES || !saved || hiddenJourneyResumes.includes(m.id)) return null;
            return (
              <div key={`hub-resume-${m.id}`} className="bg-amber-50 rounded-2xl border border-hairline-amber shadow-sm p-4 mb-3">
                <p className="font-semibold text-accent-800">
                  استئناف — {m.name}:{' '}
                  {saved.kind === 'tafsir'
                    ? `تفسير سورة ${surahName(saved.surah)} آية ${saved.ayah}`
                    : saved.startReciterId === JUHANI_RECITER_ID
                      // A Juhani position is a surah file: its ayah
                      // is always 1, so no ayah number is shown.
                      ? `سورة ${surahName(saved.surah)} — حدر (الجهني)`
                      : `سورة ${surahName(saved.surah)}، الآية ${saved.ayah}`}
                </p>
                <div className="flex gap-3 mt-3">
                  <button
                    onClick={() => { resumeJourneySaved(m.id); setHubView(m.id); }}
                    className="flex-1 py-3 grad-emerald-door text-white font-bold rounded-xl polish-press polish-focus"
                  >
                    استئناف
                  </button>
                  <button
                    onClick={() => dismissJourneyResume(m.id)}
                    className="flex-1 py-3 bg-white border border-hairline-emerald text-accent-800 font-semibold rounded-xl polish-press"
                  >
                    ابدأ من الأول
                  </button>
                </div>
              </div>
            );
          })}
          <div className="grid gap-3 polish-hub">
            {THREE_MODES.map((m) => {
              const disabled = locked || (m.id === 'tadabbur' && !tafsirConfigured());
              return (
                <button
                  key={m.id}
                  disabled={disabled}
                  onClick={() => {
                    setHadrOn(false);
                    setHadrSelected(false);
                    changeRiwaya(null);
                    setHubView(m.id);
                  }}
                  className="w-full p-5 rounded-2xl font-semibold text-right grad-amber-door glass-door-highlight text-white disabled:opacity-50 shadow-sm polish-listen-card polish-hub-item"
                >
                  <span className="flex items-start gap-3"><span className="flex items-center justify-center w-11 h-11 rounded-full bg-white/20 shrink-0" aria-hidden="true">{m.id === 'single' ? <HubUser className="w-6 h-6" /> : m.id === 'varied' ? <HubShuffle className="w-6 h-6" /> : <HubLight className="w-6 h-6" />}</span><span className="flex-1 min-w-0">
                  <span className="block text-lg">{m.name}</span>
                  <Hint id="listen-free"><span className="block text-sm font-normal text-amber-100 mt-1">{m.description}</span></Hint>
                  {m.id === 'tadabbur' && !tafsirConfigured() && (
                    <span className="block text-xs font-normal text-amber-100 mt-2">مقاطع التفسير لم تُرفع بعد — سيُتاح هذا النمط بعد رفع المقاطع.</span>
                  )}
                  </span></span>
                </button>
              );
            })}
            <button
              disabled={locked}
              onClick={() => setHubView('free')}
              className="w-full p-5 rounded-2xl font-semibold text-right grad-amber-door glass-door-highlight text-white disabled:opacity-50 shadow-sm polish-listen-card polish-hub-item"
            >
              <span className="flex items-start gap-3"><span className="flex items-center justify-center w-11 h-11 rounded-full bg-white/20 shrink-0" aria-hidden="true"><HubList className="w-6 h-6" /></span><span className="flex-1 min-w-0">
              <span className="block text-lg">سماع حر</span>
              <Hint id="listen-free"><span className="block text-sm font-normal text-amber-100 mt-1">استمع لأي سورة بصوت أي قارئ — مع القراءة. اختر السورة والقارئ والسرعة بالداخل.</span></Hint>
              </span></span>
            </button>
            <button
              disabled={locked}
              onClick={() => {
                // Quran radio: every reciter, random order, shown in the
                // varied panel so the user starts it there (same engine).
                writeVariedPlan({ kind: 'random', ids: RECITERS.map((r) => r.id), seed: Math.floor(Math.random() * 1e6) + 1 });
                setHadrOn(false);
                setHadrSelected(false);
                changeRiwaya(null);
                setHubView('varied');
              }}
              className="w-full p-5 rounded-2xl font-semibold text-right grad-amber-door glass-door-highlight text-white disabled:opacity-50 shadow-sm polish-listen-card polish-hub-item"
            >
              <span className="flex items-start gap-3"><span className="flex items-center justify-center w-11 h-11 rounded-full bg-white/20 shrink-0" aria-hidden="true"><HubRadio className="w-6 h-6" /></span><span className="flex-1 min-w-0">
              <span className="block text-lg">إذاعة التطبيق</span>
              <Hint id="listen-free"><span className="block text-sm font-normal text-amber-100 mt-1">تلاوات متواصلة من كل القراء بترتيب عشوائي. اضغط ابدأ بالداخل.</span></Hint>
              </span></span>
            </button>
            <a
              href="https://makkahlive.net/en/radio/quran-cairo"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full p-5 rounded-2xl font-semibold text-right bg-white border border-hairline-emerald text-accent-800 shadow-sm polish-hub-item"
            >
              <span className="flex items-start gap-3"><span className="flex items-center justify-center w-11 h-11 rounded-full bg-emerald-50 shrink-0" aria-hidden="true"><HubExternal className="w-6 h-6 text-emerald-700" /></span><span className="flex-1 min-w-0">
              <span className="block text-lg">إذاعة القرآن الكريم</span>
              <span className="block text-sm font-normal text-accent-800 mt-1">من القاهرة</span>
              <span className="block text-sm font-normal text-accent-600 mt-1">بث مباشر على موقع خارجي، يفتح في تبويب جديد.</span>
              </span></span>
            </a>
          </div>
        </div>
        )}

        {/* Pickers BEFORE start; locked while an engine is active.
            Free-listening detail: shown only when the سماع حر hub
            card is entered (hubView 'free'). */}
        {hubView === 'free' && (
        <div className="bg-white rounded-2xl border border-hairline-emerald shadow-sm p-5 mb-4">
          <label className="block font-medium text-accent-800 mb-2" htmlFor="listen-surah">
            اختر السورة
          </label>
          <DrumSelect
            id="listen-surah"
            label="اختر السورة"
            value={surah}
            disabled={locked}
            onChange={(n) => { setSurah(n); setCurrent(1); }}
            options={SURAHS.map((x) => ({ value: x.no, label: `${x.no} — ${x.name}` }))}
          />

          {/* Picker order (restructured): surah, then Group 1 —
              حفص FIRST, then Group 2 — الروايات, then the pace
              area (electronic speed + hadr), then نوع الاستماع,
              then ابدأ الاستماع. Locked while any engine is
              active. Selecting a riwaya or hadr hides the
              reciter group; the speed picker stays visible for
              riwaya (and is disabled, not hidden, for hadr). */}
          <p className="font-semibold text-accent-800 mt-5 mb-2">حفص</p>
          <button
            disabled={locked}
            onClick={selectHafs}
            className={`w-full p-4 rounded-xl font-semibold text-right disabled:opacity-50 ${
              riwayaId === null && !hadrOn
                ? 'grad-emerald-door text-white polish-press'
                : 'bg-white border border-hairline-emerald text-accent-800 polish-press'
            }`}
          >
            حفص — القراء الثمانية
            <span className={`block text-sm font-normal mt-1 ${riwayaId === null && !hadrOn ? 'text-emerald-100' : 'text-accent-600'}`}>
              تلاوة بالآيات مع تتبع النص.
            </span>
          </button>

          {riwayaId === null && !hadrOn && (
            <>
          <p className="font-semibold text-accent-800 mt-5 mb-2">القراء للاختيار بينهم</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {RECITERS.map((r) => (
              <button
                key={r.id}
                disabled={locked}
                onClick={() => changeReciter(r.id)}
                className={`w-full px-4 py-2.5 rounded-xl font-semibold text-center disabled:opacity-50 ${
                  reciterId === r.id
                    ? 'grad-emerald-door text-white polish-press'
                    : 'bg-white border border-hairline-emerald text-accent-800 polish-press'
                }`}
              >
                {r.name}
              </button>
            ))}
          </div>
            </>
          )}

          {/* Group 2 — الروايات, as clear rows (not wrapping
              chips): each row shows riwaya + narrator, and the
              selected row is unmistakable (emerald + check). */}
          <p className="font-semibold text-accent-800 mt-5 mb-2">الروايات</p>
          <div className="grid gap-2">
            {RIWAYAT.map((r) => (
              <button
                key={r.id}
                disabled={locked}
                onClick={() => selectRiwaya(r.id)}
                className={`w-full p-3.5 rounded-xl font-semibold text-right disabled:opacity-50 flex items-center justify-between gap-2 ${
                  riwayaId === r.id
                    ? 'grad-emerald-door text-white polish-press'
                    : 'bg-white border border-hairline-emerald text-accent-800 polish-press'
                }`}
              >
                {r.name}
                {riwayaId === r.id ? <Check className="w-5 h-5 shrink-0" /> : <span className="w-5 h-5 shrink-0" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <p className="text-sm text-accent-600 mt-3">
            وضع الرواية: استماع بملف السورة كاملًا — دون تتبع للآيات، لأن نص الآيات يختلف بين الروايات، ودون تحميل دون اتصال في هذه النسخة (أما صوت الحدر — الجهني — فملف سورته قابل للتحميل من قسم «الاستماع دون اتصال» تحت).
          </p>

          {/* Pace area: electronic speed chips (persisted) +
              the hadr card. The chips apply to the Hafs, riwaya,
              and journey engines; hadr disables them (its pace is
              natural, never electronic) and always plays at 1x.
              Read-along highlight stays on at every speed: it
              follows ayah files via 'ended' events, not a clock,
              so speed cannot desync it (no timers in the ayah
              advance path — verified by grep, see EVIDENCE.md). */}
          <p className="font-semibold text-accent-800 mt-5 mb-2">سرعة التلاوة</p>
          <div className="grid grid-cols-3 gap-2">
            {PLAYBACK_RATES.map((rate) => (
              <button
                key={rate}
                disabled={locked || hadrOn}
                onClick={() => changeRate(rate)}
                className={`w-full px-4 py-2.5 rounded-xl font-semibold text-center disabled:opacity-50 ${
                  playbackRate === rate
                    ? 'grad-emerald-door text-white polish-press'
                    : 'bg-white border border-hairline-emerald text-accent-800 polish-press'
                }`}
              >
                {PLAYBACK_RATE_LABELS[rate]}
              </button>
            ))}
          </div>
          <p className="text-sm text-accent-600 mt-2">
            سرعة إلكترونية — اختيارك يُحفظ لمراتك القادمة.
          </p>
          {hadrOn && (
            <p className="text-sm text-accent-600 mt-1">
              السرعة الإلكترونية لا تنطبق على وضع الحدر — سرعته طبيعية من التسجيل نفسه.
            </p>
          )}

          {/* Hadr: natural fast pace, surah-file playback (no
              read-along, resume supported). DISTINCT from the
              electronic chips above — never label a playbackRate
              as hadr. */}
          <button
            disabled={locked}
            onClick={selectHadr}
            className={`w-full p-4 rounded-xl font-semibold text-right mt-5 disabled:opacity-50 ${
              hadrOn
                ? 'grad-emerald-door text-white polish-press'
                : 'bg-white border border-hairline-emerald text-accent-800 polish-press'
            }`}
          >
            {HADR_FULL_LABEL}
            <span className={`block text-sm font-normal mt-1 ${hadrOn ? 'text-emerald-100' : 'text-accent-600'}`}>
              ملف السورة كاملًا، دون تتبع للآيات.
            </span>
          </button>

          {riwayaId === null && !hadrOn && (
            <>
          <p className="font-semibold text-accent-800 mt-5 mb-2">نوع الاستماع</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              disabled={locked}
              onClick={() => setMode('free')}
              className={`p-4 rounded-xl font-semibold text-right disabled:opacity-50 ${
                mode === 'free'
                  ? 'grad-emerald-door text-white polish-press'
                  : 'bg-white border border-hairline-emerald text-accent-800 polish-press'
              }`}
            >
              استماع حر
              <span className={`block text-sm font-normal mt-1 ${mode === 'free' ? 'text-emerald-100' : 'text-accent-600'}`}>
                استمع فقط، دون حفظ موضع للاستئناف.
              </span>
            </button>
            <button
              disabled={locked}
              onClick={() => setMode('wird')}
              className={`p-4 rounded-xl font-semibold text-right disabled:opacity-50 ${
                mode === 'wird'
                  ? 'grad-emerald-door text-white polish-press'
                  : 'bg-white border border-hairline-emerald text-accent-800 polish-press'
              }`}
            >
              ورد استماع
              <span className={`block text-sm font-normal mt-1 ${mode === 'wird' ? 'text-emerald-100' : 'text-accent-600'}`}>
                وردك اليومي للاستماع — التوقف يحفظ الآية بالضبط لتكمل منها لاحقا.
              </span>
            </button>
          </div>
            </>
          )}
          {locked && (
            <p className="text-sm text-accent-600 mt-3">
              {hadrOn
                ? 'السورة ووضع الحدر مقفلان أثناء التشغيل — أوقف التشغيل أولا لتغييرهما.'
                : riwayaId !== null
                  ? 'السورة والرواية مقفلتان أثناء التشغيل — أوقف التشغيل أولا لتغييرهما.'
                  : 'السورة والقارئ والسرعة ونوع الاستماع مقفلة أثناء التشغيل — أوقف التشغيل أولا لتغييرها.'}
            </p>
          )}

          {!active && (
            <button
              onClick={() =>
                hadrOn
                  ? void startHadrPlayback(surah, 0)
                  : riwayaId !== null
                    ? void startRiwayaPlayback(surah, riwayaId, 0)
                    : void startPlayback(surah, reciterId, mode, 1)
              }
              className="mt-5 w-full py-3.5 grad-emerald-door text-white font-bold rounded-xl flex items-center justify-center gap-2 polish-press polish-focus"
            >
              <Play className="w-5 h-5" />
              ابدأ الاستماع
            </button>
          )}
        </div>
        )}

        {/* أنماط الاستماع: additive journey section, Hafs only.
            The single-surah player above is untouched; these three
            buttons start continuous journeys from the selected
            surah (and selected reciter as the rotation's start)
            to the end of surah 114, each with its own resume.
            Riwaya AND hadr modes hide this section: journeys are
            Hafs reciter journeys, and the pickers above already
            cover non-Hafs listening. id="three-mode-section" is
            the home khatma cards' scroll target (preselect). */}
        {/* Journey detail: shown only when a journey hub card is
            entered (hubView is that mode). The surah + start-reciter
            pickers live here now — the player pickers above are
            hidden in detail views. */}
        {riwayaId === null && !hadrOn && hubView !== 'hub' && hubView !== 'free' && (
        <div id="three-mode-section" className="bg-white rounded-2xl border border-hairline-emerald shadow-sm p-5 mb-4">
          <p className="font-bold text-accent-800 text-lg">{threeModeName(hubView as ThreeMode)}</p>
          <p className="text-sm text-accent-600 mt-1">
            رحلة متواصلة من سورة {surahName(surah)} بصوت{' '}
            {journeyReciterName(journeyReciterForMode())} حتى نهاية المصحف — التوقف
            يحفظ موضعك في كل نمط على حدة.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div>
              <label className="block font-medium text-accent-800 mb-2" htmlFor="journey-surah">
                ابدأ من سورة
              </label>
              <DrumSelect
                id="journey-surah"
                label="ابدأ من سورة"
                value={surah}
                disabled={locked}
                onChange={(n) => { setSurah(n); setCurrent(1); }}
                options={SURAHS.map((x) => ({ value: x.no, label: `${x.no} — ${x.name}` }))}
              />
            </div>
            <div>
              <label className="block font-medium text-accent-800 mb-2" htmlFor="journey-reciter">
                قارئ البداية
              </label>
              <DrumSelect
                id="journey-reciter"
                label="قارئ البداية"
                value={journeyReciterForMode()}
                disabled={locked}
                onChange={changeJourneyReciter}
                options={[
                  ...RECITERS.map((r) => ({ value: r.id as string, label: r.name })),
                  ...(hubView === 'single' ? [{ value: JUHANI_RECITER_ID as string, label: JUHANI_RECITER_NAME }] : []),
                ]}
              />
              {hubView === 'single' && journeyReciterForMode() === JUHANI_RECITER_ID && (
                <p className="text-xs text-accent-600 mt-2">
                  صوت الجهني حدر — ملف السورة كامل بسرعته الطبيعية؛ السرعة الإلكترونية لا تنطبق
                  عليه، ولو حمّلت السورة من «التنزيلات الصوتية» بتشتغل من غير نت.
                </p>
              )}
            </div>
          </div>
          {/* Tadabbur tafsir order (user toggle, 2026-10-31):
              preview before each quarter, or review after it.
              Persisted on tap; applies to fresh journeys, while a
              resumed journey keeps the order it started with. */}
          {hubView === 'tadabbur' && (
            <div className="mt-4">
              <p className="font-semibold text-accent-800 mb-2">ترتيب التفسير</p>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="ترتيب التفسير">
                <button
                  disabled={locked}
                  onClick={() => {
                    setTadabburTafsirOrder('before');
                    writeTadabburTafsirOrder('before');
                  }}
                  className={`py-3 px-3 font-semibold rounded-xl disabled:opacity-50 ${
                    tadabburTafsirOrder === 'before'
                      ? 'grad-emerald-door text-white polish-press'
                      : 'bg-white border border-hairline-emerald text-accent-800 polish-press'
                  }`}
                >
                  التفسير قبل الربع
                </button>
                <button
                  disabled={locked}
                  onClick={() => {
                    setTadabburTafsirOrder('after');
                    writeTadabburTafsirOrder('after');
                  }}
                  className={`py-3 px-3 font-semibold rounded-xl disabled:opacity-50 ${
                    tadabburTafsirOrder === 'after'
                      ? 'grad-emerald-door text-white polish-press'
                      : 'bg-white border border-hairline-emerald text-accent-800 polish-press'
                  }`}
                >
                  التفسير بعد الربع
                </button>
              </div>
              <p className="text-xs text-accent-600 mt-2">
                يُطبَّق على الرحلات الجديدة؛ الرحلة المحفوظة تكمل بنفس ترتيبها.
              </p>
            </div>
          )}
          {/* Tadabbur tafsir voice (Feature 1, 2026-11-05): the
              King Fahd recording is the default; the generated voice
              matches the user's gender and each clip is generated
              once and cached for everyone; 'alternate' flips by
              quarter; 'حوار التفسير' plays each clip as a dialogue
              — generated male host, the recording as guest,
              generated female host. A change applies at the next
              tafsir clip, and any generation failure plays the
              natural recording instead — never silence. */}
          {hubView === 'tadabbur' && (
            <div className="mt-4">
              <p className="font-semibold text-accent-800 mb-2">صوت التفسير</p>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="صوت التفسير">
                {TAFSIR_VOICES.map((v) => (
                  <button
                    key={v.id}
                    disabled={locked}
                    onClick={() => {
                      setTafsirVoice(v.id);
                      writeTafsirVoice(v.id);
                    }}
                    className={`py-3 px-2 font-semibold rounded-xl disabled:opacity-50 ${
                      tafsirVoice === v.id
                        ? 'grad-emerald-door text-white polish-press'
                        : 'bg-white border border-hairline-emerald text-accent-800 polish-press'
                    }`}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
              <p className="text-xs text-accent-600 mt-2">
                {TAFSIR_VOICES.find((v) => v.id === tafsirVoice)?.description}
                {' '}يسري التغيير من وقفة التفسير التالية.
              </p>
            </div>
          )}
          {/* Explicit start control: the mode card below also starts
              playback on tap, but it reads as an info card (same
              name as the hub card just tapped), so first-time
              journey users see no play button. This button is
              unmissable and calls the same startJourney. */}
          {hubView === 'varied' && (
            <VariedPlanPanel />
          )}
          {THREE_MODES.filter((m) => m.id === hubView).map((m) => {
            const disabled = locked || (m.id === 'tadabbur' && !tafsirConfigured());
            return (
              <button
                key={`start-${m.id}`}
                disabled={disabled}
                onClick={() => void startJourney(m.id)}
                className="w-full mt-4 py-4 grad-emerald-door text-white font-bold rounded-xl disabled:opacity-50 polish-press polish-focus"
              >
                ▶ ابدأ الاستماع
              </button>
            );
          })}
          <div className="grid gap-3 mt-4">
            {THREE_MODES.filter((m) => m.id === hubView).map((m) => {
              const disabled = locked || (m.id === 'tadabbur' && !tafsirConfigured());
              return (
                <div key={m.id}>
                  <button
                    disabled={disabled}
                    onClick={() => void startJourney(m.id)}
                    className={`w-full p-4 rounded-xl font-semibold text-right disabled:opacity-50 ${
                      journeyMode === m.id
                        ? 'grad-emerald-door text-white polish-press'
                        : 'bg-white border border-hairline-emerald text-accent-800 polish-press'
                    }${preselectedMode === m.id && journeyMode !== m.id ? ' ring-2 ring-emerald-500' : ''}`}
                  >
                    {m.name}
                    <span className={`block text-sm font-normal mt-1 ${journeyMode === m.id ? 'text-emerald-100' : 'text-accent-600'}`}>
                      {m.description}
                    </span>
                  </button>
                  {preselectedMode === m.id && !locked && (
                    <p className="text-xs text-emerald-700 font-medium mt-2">
                      مختارة من الرئيسية — اضغط للبدء أو استأنف من البطاقة المحفوظة.
                    </p>
                  )}
                  {m.id === 'tadabbur' && (
                    <p className="text-xs text-accent-600 mt-2">
                      {tafsirConfigured()
                        ? TAFSIR_ATTRIBUTION
                        : 'مقاطع التفسير لم تُرفع بعد — سيُتاح هذا النمط بعد رفع المقاطع.'}
                    </p>
                  )}
                  {/* Tafsir download (offline feature): per-surah
                      clips for the journey's start surah, so the
                      tafsir parts play offline too. Full manager in
                      Settings ('التنزيلات الصوتية'). */}
                  {m.id === 'tadabbur' && tafsirConfigured() && ctxAudio?.kind === 'tafsir' && (
                    <div className="mt-3 rounded-xl border border-hairline-emerald bg-emerald-50/50 p-3">
                      {ctxAudio.checking ? (
                        <p className="text-sm text-accent-600">جارٍ التحقق…</p>
                      ) : ctxAudio.downloaded ? (
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-emerald-800">
                            تفسير سورة {surahName(surah)} محمل على جهازك ✓
                          </p>
                          <button
                            onClick={() => void ctxDeleteAudio()}
                            className="px-3 py-1.5 bg-white border border-red-200 text-red-700 text-sm font-semibold rounded-lg polish-press"
                          >
                            مسح
                          </button>
                        </div>
                      ) : ctxAudio.confirm && ctxAudio.estimate ? (
                        <div>
                          <p className="text-sm font-semibold text-accent-800">
                            تفسير سورة {surahName(surah)} — {formatAudioSize(ctxAudio.estimate.bytes)}
                            {ctxAudio.estimate.count > 1 ? ` — ${ctxAudio.estimate.count.toLocaleString('ar-EG')} مقطع` : ''}
                          </p>
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => void ctxStartAudio()}
                              className="flex-1 py-2 grad-emerald-door text-white text-sm font-bold rounded-xl polish-press"
                            >
                              تأكيد التحميل
                            </button>
                            <button
                              onClick={() => setCtxAudio((prev) => prev ? { ...prev, confirm: false, estimate: null } : prev)}
                              className="px-4 py-2 bg-white border border-hairline-emerald text-accent-800 text-sm font-semibold rounded-xl polish-press"
                            >
                              إلغاء
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <button
                            disabled={ctxAudio.estimating || ctxAudio.running}
                            onClick={() => void ctxAskAudio()}
                            className="w-full py-2.5 grad-emerald-door text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 polish-press"
                          >
                            <Download className="w-4 h-4" />
                            {ctxAudio.estimating
                              ? 'جارٍ تقدير الحجم…'
                              : `حمّل تفسير سورة ${surahName(surah)} دون نت`}
                          </button>
                          {ctxAudio.running && ctxAudio.progress && (
                            <p className="text-xs text-accent-600 mt-2">
                              جارٍ التحميل… {ctxAudio.progress.done.toLocaleString('ar-EG')} من {ctxAudio.progress.total.toLocaleString('ar-EG')} مقطع
                            </p>
                          )}
                          {ctxAudio.running && (
                            <button
                              onClick={ctxStopAudio}
                              className="mt-2 w-full py-2 bg-gray-100 hover:bg-gray-200 text-accent-700 text-sm font-semibold rounded-xl polish-press"
                            >
                              إيقاف التحميل
                            </button>
                          )}
                        </div>
                      )}
                      {ctxAudio.error && <p className={`text-xs mt-2 ${ctxAudio.quota ? 'text-red-600 font-medium' : 'text-red-600'}`}>{ctxAudio.error}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Per-mode resume cards (tap-only, like every resume here). */}
          {THREE_MODES.filter((m) => m.id === hubView).map((m) => {
            const saved = savedJourneys[m.id];
            if (!saved || hiddenJourneyResumes.includes(m.id)) return null;
            return (
              <div key={`resume-${m.id}`} className="bg-amber-50 rounded-2xl border border-hairline-amber shadow-sm p-4 mt-4">
                <p className="font-semibold text-accent-800">
                  استئناف — {m.name}:{' '}
                  {saved.kind === 'tafsir'
                    ? `تفسير سورة ${surahName(saved.surah)} آية ${saved.ayah}`
                    : saved.startReciterId === JUHANI_RECITER_ID
                      // A Juhani position is a surah file: its ayah
                      // is always 1, so no ayah number is shown.
                      ? `سورة ${surahName(saved.surah)} — حدر (الجهني)`
                      : `سورة ${surahName(saved.surah)}، الآية ${saved.ayah}`}
                </p>
                <p className="text-sm text-accent-600 mt-1">موضع محفوظ من آخر مرة توقفت فيها بهذا النمط.</p>
                <div className="flex gap-3 mt-3">
                  <button
                    onClick={() => resumeJourneySaved(m.id)}
                    className="flex-1 py-3 grad-emerald-door text-white font-bold rounded-xl polish-press polish-focus"
                  >
                    استئناف
                  </button>
                  <button
                    onClick={() => dismissJourneyResume(m.id)}
                    className="flex-1 py-3 bg-white border border-hairline-emerald text-accent-800 font-semibold rounded-xl polish-press"
                  >
                    ابدأ من الأول
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        )}

        {/* Playback view */}
        {active && (
          <div className="bg-white rounded-2xl border border-hairline-emerald shadow-sm p-5 mb-4">
            <p className="font-semibold text-accent-800">
              {journeyMode !== null
                ? journeyItem !== null
                  ? journeyItem.kind === 'tafsir'
                    ? `تفسير سورة ${surahName(journeyItem.surah)} آية ${journeyItem.ayah} — ${threeModeName(journeyMode)}`
                    : `${threeModeName(journeyMode)} — سورة ${surahName(journeyItem.surah)} — آية ${journeyItem.ayah} من ${surahCount(journeyItem.surah)}`
                  : `${threeModeName(journeyMode)} — سورة ${surahName(surah)}`
                : hadrOn
                  ? `سورة ${surahName(surah)} — ${HADR_NAME}`
                  : riwayaId !== null
                    ? `سورة ${surahName(surah)} — ${RIWAYAT.find((r) => r.id === riwayaId)?.name || ''}`
                    : `سورة ${surahName(surah)} — آية ${currentAyah} من ${count}`}
            </p>
            {/* Follow-along (#4): the "now playing" bar — the
                current ayah's text, updating in real time as the
                engine advances (Hafs single-surah + journeys with
                a real ayah step). The surah text loads per surah,
                so the bar appears once the text is in; while it
                loads, the header line above already shows surah +
                ayah number. Hidden for tafsir clips (the header
                shows the tafsir line instead), riwaya/hadr surah
                files, and Juhani journeys (no ayah steps there).
                The ayah list below keeps its amber highlight as
                before; this bar is the always-visible follow-
                along, even when the list is scrolled away. The
                same ayah is published to nowPlaying.ts for the
                Mushaf page to read later. */}
            {nowPlayingRow && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3" aria-live="polite">
                <p className="text-xs font-semibold text-amber-700">
                  الآية الجارية الآن — سورة {surahName(surah)} ﴿{currentAyah}﴾
                </p>
                {/* 2026-11-12 (agreed UI rule): no written ayah text
                    under a listening page; listening is by ear. */}
              </div>
            )}
            {/* Grant attribution, visible WHILE a tafsir clip plays
                (the section line alone would vanish once playback
                starts). */}
            {journeyMode === 'tadabbur' && journeyItem?.kind === 'tafsir' && (
              <p className="text-xs text-accent-600 mt-2">{TAFSIR_ATTRIBUTION}</p>
            )}
            {/* Which tafsir voice is actually playing now (Feature 1):
                the label reads the live setting for this ayah, the
                same mapping the engine's resolver used for the clip. */}
            {journeyMode === 'tadabbur' && journeyItem?.kind === 'tafsir' && (
              <p className="text-xs text-accent-600 mt-1">
                {tafsirVoiceLabelForAyah(journeyItem.surah, journeyItem.ayah)}
              </p>
            )}
            {engineError && <p className="text-sm text-red-600 font-medium mt-2">{engineError}</p>}
            {/* Redirect B: interruption resume — prominent, tap-only */}
            {interrupted && (
              <div className="mt-4 bg-amber-50 border border-hairline-amber rounded-xl p-4">
                <p className="font-semibold text-accent-800">توقف التشغيل مؤقتا</p>
                <p className="text-sm text-accent-600 mt-1">اضغط استئناف للمتابعة من حيث توقفت.</p>
                <button
                  onClick={() => void resumeAfterInterruption()}
                  className="mt-3 w-full py-3.5 grad-amber-door text-white font-bold rounded-xl polish-press polish-focus"
                >
                  استئناف
                </button>
              </div>
            )}
            <button
              onClick={stopPlayback}
              className="mt-4 w-full py-4 bg-red-600 hover:bg-red-700 text-white text-xl font-bold rounded-xl flex items-center justify-center gap-2 polish-press polish-focus"
            >
              <Square className="w-6 h-6" /> إيقاف التشغيل
            </button>
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={() => void togglePlayPause()}
                className="flex-1 min-w-[120px] py-3 grad-emerald-door text-white font-bold rounded-xl flex items-center justify-center gap-2 polish-press polish-focus"
              >
                {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                {playing ? 'إيقاف مؤقت' : 'تشغيل'}
              </button>
            {/* Ayah-step buttons exist only in Hafs single-surah
                mode: a riwaya or hadr surah file has no ayah steps,
                and a journey advances automatically (no seeking in v1). */}
            {riwayaId === null && !hadrOn && journeyMode === null && (
              <>
              <button
                onClick={() => void engineRef.current?.prev()}
                className="px-4 py-3 bg-white border border-hairline-emerald text-accent-800 font-semibold rounded-xl flex items-center gap-2 polish-press"
              >
                <SkipBack className="w-5 h-5" /> الآية السابقة
              </button>
              <button
                onClick={() => void engineRef.current?.next()}
                className="px-4 py-3 bg-white border border-hairline-emerald text-accent-800 font-semibold rounded-xl flex items-center gap-2 polish-press"
              >
                الآية التالية <SkipForward className="w-5 h-5" />
              </button>
              </>
            )}
              <button
                onClick={() => {
                  if (journeyEngineRef.current) {
                    // Journey restart: refresh the page's playing
                    // state from the engine (restart while paused
                    // stays paused).
                    void (async () => {
                      try {
                        await journeyEngineRef.current?.restart();
                        setPlaying(journeyEngineRef.current?.playing ?? false);
                      } catch {
                        setEngineError('تعذر تشغيل الصوت — تحقق من الاتصال وحاول مجددا.');
                      }
                    })();
                  } else if (riwayaEngineRef.current) {
                    // Covers riwaya AND hadr (both use this ref).
                    void riwayaEngineRef.current?.restart();
                  } else {
                    void engineRef.current?.restart();
                  }
                }}
                className="px-4 py-3 bg-white border border-hairline-emerald text-accent-800 font-semibold rounded-xl flex items-center gap-2 polish-press"
              >
                <RotateCcw className="w-5 h-5" /> {journeyMode !== null ? 'من أول الرحلة' : 'من أول السورة'}
              </button>
            </div>
            <button
              onClick={() => setBlackScreen(true)}
              className="mt-3 w-full py-3 bg-stone-800 hover:bg-stone-900 text-white font-semibold rounded-xl flex items-center justify-center gap-2 polish-press"
              aria-label="شاشة سوداء"
            >
              <Moon className="w-5 h-5" />
              شاشة سوداء
            </button>
            <p className="text-sm text-accent-600 mt-1 text-center">يخفي الواجهة والصوت مستمر</p>
          </div>
        )}

        {/* Sleep timer (#10): always visible (see sleepTimerBlock
            above) — arm it before starting, or cancel a running
            timer after playback stopped. */}
        {journeyMode !== null && sleepTimerBlock}

        {/* Read-along text — Hafs only: riwaya mode is
            listening-only (the Hafs text does not match a non-Hafs
            voice), and hadr is surah-file (no ayah steps), so this
            block hides under either. */}
        {riwayaId === null && !hadrOn && hubView !== 'hub' && (
        <div className="bg-white rounded-2xl border border-hairline-emerald shadow-sm p-5 mb-4">
          <p className="font-semibold text-accent-800 mb-3">سورة {surahName(surah)}</p>
          {textLoading && <p className="text-accent-600">جارٍ تحميل نص السورة…</p>}
          {textError && <p className="text-red-600 font-medium">{textError}</p>}
          {!textLoading && !textError && ayahs && (
            <div className="space-y-2">
              {ayahs.map((row) => (
                <button
                  key={row.id}
                  id={`listen-ayah-${row.ayah_no}`}
                  onClick={() => {
                    // Hafs single-surah only: journeys advance
                    // automatically (no intra-journey seeking in
                    // v1), and riwaya files have no ayah steps.
                    if (active && engineRef.current) void engineRef.current.seekTo(row.ayah_no);
                  }}
                  className={`w-full text-right p-3 rounded-xl border leading-loose ${
                    active && row.ayah_no === currentAyah
                      ? 'bg-amber-100 border-amber-300'
                      : 'bg-white border-hairline-emerald'
                  }`}
                  style={{ fontFamily: "'Noto Naskh Arabic', serif", fontSize: '1.25rem' }}
                >
                  <span className="text-accent-800">{row.ayah_text}</span>
                  <span className="text-emerald-700 font-bold mr-2">﴿{row.ayah_no}﴾</span>
                </button>
              ))}
            </div>
          )}
        </div>)}

        {/* Offline section (redirect E: additive only — playback,
            highlight and resume above never wait on any download
            state; deleting this block leaves the page fully working) */}
        {/* Offline section: this surah + reciter only, never whole-Quran.
            Hafs per-surah; hadr (Juhani file) has its own block
            below; riwaya modes have no offline downloads. */}
        {riwayaId === null && !hadrOn && hubView === 'free' && (
        <div className="bg-white rounded-2xl border border-hairline-emerald shadow-sm p-5 mb-4">
          <p className="font-semibold text-accent-800">الاستماع دون اتصال</p>
          <p className="text-sm text-accent-600 mt-1">
            سورة {surahName(surah)} — {RECITERS.find((r) => r.id === reciterId)?.name || ''}
          </p>
          {offlineError && <p className="text-sm text-red-600 font-medium mt-2">{offlineError}</p>}
          {offlineChecking ? (
            <p className="text-accent-600 mt-3">جارٍ التحقق…</p>
          ) : downloaded ? (
            <div className="mt-3">
              <p className="inline-block px-3 py-1.5 bg-emerald-100 text-emerald-800 font-medium rounded-xl">
                متاح دون اتصال
              </p>
              <button
                onClick={() => void handleDeleteDownload()}
                className="mt-3 w-full py-3 bg-white border border-red-200 text-red-700 font-semibold rounded-xl flex items-center justify-center gap-2 polish-press"
              >
                <Trash2 className="w-5 h-5" /> حذف التحميل
              </button>
            </div>
          ) : (
            <div className="mt-3">
              {estimate ? (
                <div>
                  <p className="font-semibold text-accent-800">
                    حجم التحميل: {formatApproxSize(estimate.bytes)} — {estimate.count} مقاطع
                  </p>
                  <div className="flex gap-3 mt-3">
                    <button
                      disabled={downloading}
                      onClick={() => void handleDownload()}
                      className="flex-1 py-3 grad-emerald-door text-white font-bold rounded-xl disabled:opacity-50 polish-press polish-focus"
                    >
                      تأكيد التحميل
                    </button>
                    <button
                      disabled={downloading}
                      onClick={() => setEstimate(null)}
                      className="flex-1 py-3 bg-white border border-hairline-emerald text-accent-800 font-semibold rounded-xl polish-press disabled:opacity-50"
                    >
                      إلغاء
                    </button>
                  </div>
                  {downloading && progress && (
                    <p className="text-sm text-accent-600 mt-3">
                      تم تحميل {progress.done} من {progress.total}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  disabled={estimating || downloading}
                  onClick={() => void handleEstimate()}
                  className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 polish-press polish-focus"
                >
                  <Download className="w-5 h-5" />
                  {estimating ? 'جارٍ تقدير الحجم…' : 'تحميل السورة للاستماع دون اتصال'}
                </button>
              )}
              {downloading && !progress && (
                <p className="text-sm text-accent-600 mt-3">جارٍ تحميل السورة…</p>
              )}
            </div>
          )}
        </div>)}

        {/* Offline section: Juhani surah file (hadr mode). The
            same file is the self-test correction voice, so a
            download here also makes corrections faster (local
            instead of streamed). Riwaya modes still have no
            offline download — only Hafs (above) and hadr. */}
        {hadrOn && hubView === 'free' && ctxAudio?.kind === 'juhani' && (
        <div className="bg-white rounded-2xl border border-hairline-emerald shadow-sm p-5 mb-4">
          <p className="font-semibold text-accent-800">الاستماع دون اتصال — ملف الجهني</p>
          <p className="text-sm text-accent-600 mt-1">
            سورة {surahName(surah)} — حدر (الجهني)، ملف السورة كامل. بعد التحميل بيشتغل من جهازك من غير نت، وتصحيحات التسميع بتبقى أسرع.
          </p>
          {ctxAudio.error && <p className={`text-sm mt-2 ${ctxAudio.quota ? 'text-red-600 font-medium' : 'text-red-600'}`}>{ctxAudio.error}</p>}
          {ctxAudio.checking ? (
            <p className="text-accent-600 mt-3">جارٍ التحقق…</p>
          ) : ctxAudio.downloaded ? (
            <div className="mt-3">
              <p className="inline-block px-3 py-1.5 bg-emerald-100 text-emerald-800 font-medium rounded-xl">
                متاح دون اتصال
              </p>
              <button
                onClick={() => void ctxDeleteAudio()}
                className="mt-3 w-full py-3 bg-white border border-red-200 text-red-700 font-semibold rounded-xl flex items-center justify-center gap-2 polish-press"
              >
                <Trash2 className="w-5 h-5" /> حذف التحميل
              </button>
            </div>
          ) : ctxAudio.confirm && ctxAudio.estimate ? (
            <div className="mt-3">
              <p className="font-semibold text-accent-800">
                حجم التحميل: {formatAudioSize(ctxAudio.estimate.bytes)}
              </p>
              {ctxAudio.space && ctxAudio.space.freeMB !== null && (
                <p className="text-sm text-accent-600 mt-1">المتاح على جهازك حوالي {ctxAudio.space.freeMB.toFixed(0)} ميجابايت.</p>
              )}
              <div className="flex gap-3 mt-3">
                <button
                  onClick={() => void ctxStartAudio()}
                  className="flex-1 py-3 grad-emerald-door text-white font-bold rounded-xl polish-press polish-focus"
                >
                  تأكيد التحميل
                </button>
                <button
                  onClick={() => setCtxAudio((prev) => prev ? { ...prev, confirm: false, estimate: null } : prev)}
                  className="flex-1 py-3 bg-white border border-hairline-emerald text-accent-800 font-semibold rounded-xl polish-press"
                >
                  إلغاء
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <button
                disabled={ctxAudio.estimating || ctxAudio.running}
                onClick={() => void ctxAskAudio()}
                className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 polish-press polish-focus"
              >
                <Download className="w-5 h-5" />
                {ctxAudio.estimating ? 'جارٍ تقدير الحجم…' : 'تحميل ملف السورة للاستماع دون اتصال'}
              </button>
              {ctxAudio.running && (
                <p className="text-sm text-accent-600 mt-3">جارٍ تحميل ملف السورة…</p>
              )}
              {ctxAudio.running && (
                <button
                  onClick={ctxStopAudio}
                  className="mt-2 w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-accent-700 font-semibold rounded-xl polish-press"
                >
                  إيقاف التحميل
                </button>
              )}
            </div>
          )}
        </div>)}

        <p className="text-center text-sm text-emerald-700 font-semibold mt-6">
          معك في كل آية، حتى نُتمّ حفظ كتاب الله
        </p>
      </main>
      {blackScreen && (
        <div
          className="fixed inset-0 z-[100] bg-black flex items-center justify-center select-none touch-none"
          style={{ WebkitTouchCallout: 'none' }}
          onContextMenu={(e) => e.preventDefault()}
          onTouchStart={(e) => {
            const t = e.touches[0];
            if (t) blackPressStart(t.clientX, t.clientY);
          }}
          onTouchMove={(e) => {
            const t = e.touches[0];
            if (t) blackPressMove(t.clientX, t.clientY);
          }}
          onTouchEnd={blackPressEnd}
          onTouchCancel={() => {
            blackPressRef.current = null;
          }}
          onMouseDown={(e) => blackPressStart(e.clientX, e.clientY)}
          onMouseMove={(e) => {
            if (blackPressRef.current) blackPressMove(e.clientX, e.clientY);
          }}
          onMouseUp={blackPressEnd}
        >
          {showBlackHint && (
            <p className="text-white/20 text-sm font-medium">اضغط مطوّلًا للعودة</p>
          )}
        </div>
      )}
    </div>
  );
}

// Varied khatma reciter choice (2026-11-07): rotation (default), the
// user's own order, or a random pick from a chosen set.
function VariedPlanPanel() {
  const [plan, setPlan] = useState<VariedPlan>(() => readVariedPlan());
  const ids = RECITERS.map((r) => r.id);
  const chosen = plan.kind === 'rotate' ? [] : plan.ids;
  const update = (next: VariedPlan) => { setPlan(next); writeVariedPlan(next); };
  const toggle = (id: string) => {
    const list = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    if (plan.kind === 'random') update({ kind: 'random', ids: list, seed: plan.seed });
    else if (plan.kind === 'order') update({ kind: 'order', ids: list });
  };
  const mode = (kind: 'rotate' | 'order' | 'random') => {
    if (kind === 'rotate') update({ kind: 'rotate' });
    else if (kind === 'order') update({ kind: 'order', ids: chosen.length ? chosen : ids.slice(0, 4) });
    else update({ kind: 'random', ids: chosen.length ? chosen : ids, seed: Math.floor(Math.random() * 1e6) + 1 });
  };
  const label = (id: string) => RECITERS.find((r) => r.id === id)?.name ?? id;
  const btn = (active: boolean) =>
    `py-3 px-3 rounded-xl text-base font-bold ${active ? 'grad-emerald-door text-white' : 'bg-white border border-hairline-emerald text-accent-800'}`;
  return (
    <div className="bg-white rounded-2xl border border-hairline-emerald p-4 mt-4">
      <p className="font-semibold text-accent-800 mb-3">القراء في الختمة المنوعة</p>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <button className={btn(plan.kind === 'rotate')} onClick={() => mode('rotate')}>بالترتيب الثابت</button>
        <button className={btn(plan.kind === 'order')} onClick={() => mode('order')}>أختار الترتيب</button>
        <button className={btn(plan.kind === 'random')} onClick={() => mode('random')}>عشوائي</button>
      </div>
      {plan.kind !== 'rotate' && (
        <>
          <p className="text-sm text-accent-600 mb-2">
            {plan.kind === 'order' ? 'اضغط القراء بالترتيب اللي تحبه: كل ربع يأخذ القارئ اللي بعده.' : 'اختار القراء اللي تحب يدخلوا في الاختيار العشوائي.'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {RECITERS.map((r) => {
              const idx = chosen.indexOf(r.id);
              const on = idx >= 0;
              return (
                <button key={r.id} onClick={() => toggle(r.id)}
                  className={`py-3 px-2 rounded-xl text-base font-bold ${on ? 'grad-amber-door text-white' : 'bg-gray-100 text-accent-600'}`}>
                  {plan.kind === 'order' && on ? `${idx + 1}. ` : ''}{label(r.id)}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
