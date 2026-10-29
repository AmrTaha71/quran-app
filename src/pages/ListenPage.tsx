import { useEffect, useRef, useState } from 'react';
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
  Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { SURAHS, SURAH_AYAH_COUNTS } from '../lib/surahs';
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
  clearThreeModeResume,
  readAllThreeModeResumes,
  tafsirConfigured,
  threeModeName,
} from '../lib/threeModeListen';
import type { ThreeMode, ThreeModePosition } from '../lib/threeModeListen';
import { JourneyEngine as JourneyEngineClass } from '../lib/threeModePlayback';
import type { JourneyEngine, JourneyPlayable } from '../lib/threeModePlayback';
import { getQuranTextCache } from '../lib/quranTextCache';
import type { CachedTextRow } from '../lib/quranTextCache';
import {
  clearListeningWird,
  readListeningWird,
  writeListeningWird,
} from '../lib/listenPlayback';
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

type Route =
  | 'home'
  | 'admin'
  | 'app'
  | 'auth'
  | 'mushaf'
  | 'settings'
  | 'follow'
  | 'test'
  | 'listen'
  | 'radio';

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
  return SURAHS.find((s) => s.no === no)?.name || `سورة ${no}`;
}

function surahCount(no: number): number {
  return SURAH_AYAH_COUNTS[no - 1] || 0;
}

// استمع للقرآن: continuous surah playback with read-along ayah
// highlighting. The audio itself lives in the sibling ListenEngine
// (single audio element, so playback can keep going while the
// screen is off or the app is switched away — a real-device check,
// not something a headless render can prove). This page only owns
// the UI: pickers, text, controls, and the offline section.
// No whole-Quran download, no synthetic audio, no pre-generation.
export default function ListenPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
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
  const [mode, setMode] = useState<ListenMode>('free');
  // Three-mode journeys (additive section, Hafs only): the active
  // journey's mode, its current item for display, and one saved
  // resume per mode (hidden per mode after resume/dismiss).
  const [journeyMode, setJourneyMode] = useState<ThreeMode | null>(null);
  const [journeyItem, setJourneyItem] = useState<JourneyPlayable | null>(null);
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
    destroyEngine();
    activeSurahRef.current = surahNo;
    activeReciterRef.current = reciter;
    activeHadrRef.current = false;
    activeModeRef.current = listenMode;
    setSurah(surahNo);
    setReciterId(reciter);
    setMode(listenMode);
    setCurrent(startAyah);
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
    destroyEngine();
    activeSurahRef.current = surahNo;
    activeRiwayaRef.current = riwaya;
    activeHadrRef.current = false;
    setSurah(surahNo);
    setRiwayaId(riwaya);
    const engine = new RiwayaEngineClass({
      riwayaId: riwaya,
      surah: surahNo,
      startTime,
      playbackRate,
      onEnded: () => {
        setPlaying(false);
      },
      onError: (message) => {
        setEngineError(message);
        setPlaying(false);
      },
      onInterrupted: () => {
        // Same rule as Hafs: show the resume button; do NOT auto-play.
        setInterrupted(true);
        setPlaying(false);
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
    destroyEngine();
    activeSurahRef.current = surahNo;
    activeRiwayaRef.current = null;
    activeHadrRef.current = true;
    setSurah(surahNo);
    setHadrOn(true);
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
    destroyEngine();
    activeHadrRef.current = false;
    const startSurah = fromSaved ? fromSaved.startSurah : surah;
    const startReciter = fromSaved ? fromSaved.startReciterId : reciterId;
    setJourneyMode(journey);
    setJourneyItem(null);
    setPreselectedMode(null);
    setSurah(startSurah);
    setReciterId(startReciter);
    const engine = new JourneyEngineClass({
      mode: journey,
      startSurah,
      startReciterId: startReciter,
      startAyah: 1,
      playbackRate,
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
          setCurrent(item.ayah);
          scrollToAyah(item.ayah);
        } else {
          // Interstitial: no ayah highlight (nothing matches -1).
          setCurrent(-1);
        }
      },
      onEnded: () => {
        // A journey's onEnded means TRUE completion (surah 114
        // + its quarter's interstitial): a finished journey has
        // no resume to offer, so its saved position is cleared.
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
          jEngine.pause();
          setPlaying(false);
        } else {
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
          rEngine.pause();
          setPlaying(false);
        } else {
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
        engine.pause();
        setPlaying(false);
      } else {
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
    const timer = setTimeout(() => {
      try {
        document.getElementById('three-mode-section')?.scrollIntoView({ block: 'start' });
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumeRiwayatSaved = () => {
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

  // Engine destroyed on unmount (and on Stop, via stopPlayback).
  useEffect(() => {
    return () => {
      destroyEngine();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const count = surahCount(surah);
  const locked = active;

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-stone-50/30 pb-24">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-emerald-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => onNavigate('home')}
            className="px-4 py-2 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl"
          >
            الرئيسية
          </button>
          <div>
            <h1
              className="text-lg font-bold text-accent-800 flex items-center gap-2"
              style={{ fontFamily: "'Noto Naskh Arabic', serif" }}
            >
              <Headphones className="w-5 h-5 text-emerald-600" />
              استمع للقرآن
            </h1>
            <p className="text-sm text-accent-600">تلاوة متواصلة مع القراءة — صُمّمت للاستماع مع غلق الشاشة</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5">
        {/* Resume card FIRST, when a listening wird is saved */}
        {savedWird && showResume && (
          <div className="bg-amber-50 rounded-2xl border border-amber-200 shadow-sm p-5 mb-4">
            <p className="font-bold text-accent-800">
              استئناف من سورة {surahName(savedWird.surah)}، الآية {savedWird.ayah}
            </p>
            <p className="text-sm text-accent-600 mt-1">ورد استماع محفوظ من آخر مرة توقفت فيها.</p>
            <div className="flex gap-3 mt-4">
              <button
                onClick={resumeSaved}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
              >
                استئناف
              </button>
              <button
                onClick={dismissResume}
                className="flex-1 py-3 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl"
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
          <div className="bg-amber-50 rounded-2xl border border-amber-200 shadow-sm p-5 mb-4">
            <p className="font-bold text-accent-800">
              استئناف — سورة {surahName(savedRiwayatResume.surah)}، رواية{' '}
              {RIWAYAT.find((r) => r.id === savedRiwayatResume.riwaya)?.name || ''}
            </p>
            <p className="text-sm text-accent-600 mt-1">موضع محفوظ من آخر مرة توقفت فيها بهذه الرواية.</p>
            <div className="flex gap-3 mt-4">
              <button
                onClick={resumeRiwayatSaved}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
              >
                استئناف
              </button>
              <button
                onClick={dismissRiwayatResume}
                className="flex-1 py-3 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl"
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
          <div className="bg-amber-50 rounded-2xl border border-amber-200 shadow-sm p-5 mb-4">
            <p className="font-bold text-accent-800">
              استئناف — {HADR_NAME}: سورة {surahName(savedHadrResume.surah)}
            </p>
            <p className="text-sm text-accent-600 mt-1">موضع محفوظ من آخر مرة توقفت فيها بوضع الحدر.</p>
            <div className="flex gap-3 mt-4">
              <button
                onClick={resumeHadrSaved}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
              >
                استئناف
              </button>
              <button
                onClick={dismissHadrResume}
                className="flex-1 py-3 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl"
              >
                ابدأ من الأول
              </button>
            </div>
          </div>
        )}

        {/* Pickers BEFORE start; locked while an engine is active */}
        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 mb-4">
          <label className="block font-bold text-accent-800 mb-2" htmlFor="listen-surah">
            اختر السورة
          </label>
          <select
            id="listen-surah"
            value={surah}
            disabled={locked}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= 114) {
                setSurah(n);
                setCurrent(1);
              }
            }}
            className="w-full py-3 px-3 bg-white border border-emerald-200 rounded-xl font-bold text-accent-800 disabled:opacity-50"
          >
            {SURAHS.map((s) => (
              <option key={s.no} value={s.no}>
                {s.no} — {s.name}
              </option>
            ))}
          </select>

          {/* Picker order (restructured): surah, then Group 1 —
              حفص FIRST, then Group 2 — الروايات, then the pace
              area (electronic speed + hadr), then نوع الاستماع,
              then ابدأ الاستماع. Locked while any engine is
              active. Selecting a riwaya or hadr hides the
              reciter group; the speed picker stays visible for
              riwaya (and is disabled, not hidden, for hadr). */}
          <p className="font-bold text-accent-800 mt-5 mb-2">حفص</p>
          <button
            disabled={locked}
            onClick={selectHafs}
            className={`w-full p-4 rounded-xl font-bold text-right disabled:opacity-50 ${
              riwayaId === null && !hadrOn
                ? 'bg-emerald-600 text-white'
                : 'bg-white border border-emerald-200 text-accent-800'
            }`}
          >
            حفص — القراء الثمانية
            <span className={`block text-sm font-normal mt-1 ${riwayaId === null && !hadrOn ? 'text-emerald-100' : 'text-accent-600'}`}>
              تلاوة بالآيات مع تتبع النص.
            </span>
          </button>

          {riwayaId === null && !hadrOn && (
            <>
          <p className="font-bold text-accent-800 mt-5 mb-2">القراء للاختيار بينهم</p>
          <div className="flex flex-wrap gap-2">
            {RECITERS.map((r) => (
              <button
                key={r.id}
                disabled={locked}
                onClick={() => changeReciter(r.id)}
                className={`px-4 py-2.5 rounded-xl font-bold disabled:opacity-50 ${
                  reciterId === r.id
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white border border-emerald-200 text-accent-800'
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
          <p className="font-bold text-accent-800 mt-5 mb-2">الروايات</p>
          <div className="grid gap-2">
            {RIWAYAT.map((r) => (
              <button
                key={r.id}
                disabled={locked}
                onClick={() => selectRiwaya(r.id)}
                className={`w-full p-3.5 rounded-xl font-bold text-right disabled:opacity-50 flex items-center justify-between gap-2 ${
                  riwayaId === r.id
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white border border-emerald-200 text-accent-800'
                }`}
              >
                {r.name}
                {riwayaId === r.id && <Check className="w-5 h-5 shrink-0" />}
              </button>
            ))}
          </div>
          <p className="text-sm text-accent-600 mt-3">
            وضع الرواية: استماع بملف السورة كاملًا — دون تتبع للآيات، لأن نص الآيات يختلف بين الروايات، ودون تحميل دون اتصال في هذه النسخة.
          </p>

          {/* Pace area: electronic speed chips (persisted) +
              the hadr card. The chips apply to the Hafs, riwaya,
              and journey engines; hadr disables them (its pace is
              natural, never electronic) and always plays at 1x.
              Read-along highlight stays on at every speed: it
              follows ayah files via 'ended' events, not a clock,
              so speed cannot desync it (no timers in the ayah
              advance path — verified by grep, see EVIDENCE.md). */}
          <p className="font-bold text-accent-800 mt-5 mb-2">سرعة التلاوة</p>
          <div className="flex flex-wrap gap-2">
            {PLAYBACK_RATES.map((rate) => (
              <button
                key={rate}
                disabled={locked || hadrOn}
                onClick={() => changeRate(rate)}
                className={`px-4 py-2.5 rounded-xl font-bold disabled:opacity-50 ${
                  playbackRate === rate
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white border border-emerald-200 text-accent-800'
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
            className={`w-full p-4 rounded-xl font-bold text-right mt-5 disabled:opacity-50 ${
              hadrOn
                ? 'bg-emerald-600 text-white'
                : 'bg-white border border-emerald-200 text-accent-800'
            }`}
          >
            {HADR_FULL_LABEL}
            <span className={`block text-sm font-normal mt-1 ${hadrOn ? 'text-emerald-100' : 'text-accent-600'}`}>
              تلاوة سريعة طبيعية بصوت عبد الله عواد الجهني — ملف السورة كاملًا، دون تتبع للآيات، مع استئناف من حيث توقفت.
            </span>
          </button>

          {riwayaId === null && !hadrOn && (
            <>
          <p className="font-bold text-accent-800 mt-5 mb-2">نوع الاستماع</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              disabled={locked}
              onClick={() => setMode('free')}
              className={`p-4 rounded-xl font-bold text-right disabled:opacity-50 ${
                mode === 'free'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white border border-emerald-200 text-accent-800'
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
              className={`p-4 rounded-xl font-bold text-right disabled:opacity-50 ${
                mode === 'wird'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white border border-emerald-200 text-accent-800'
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
              className="mt-5 w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5" />
              ابدأ الاستماع
            </button>
          )}
        </div>

        {/* أنماط الاستماع: additive journey section, Hafs only.
            The single-surah player above is untouched; these three
            buttons start continuous journeys from the selected
            surah (and selected reciter as the rotation's start)
            to the end of surah 114, each with its own resume.
            Riwaya AND hadr modes hide this section: journeys are
            Hafs reciter journeys, and the pickers above already
            cover non-Hafs listening. id="three-mode-section" is
            the home khatma cards' scroll target (preselect). */}
        {riwayaId === null && !hadrOn && (
        <div id="three-mode-section" className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 mb-4">
          <p className="font-bold text-accent-800">أنماط الاستماع</p>
          <p className="text-sm text-accent-600 mt-1">
            رحلة متواصلة من سورة {surahName(surah)} بصوت{' '}
            {RECITERS.find((r) => r.id === reciterId)?.name || ''} حتى نهاية المصحف — التوقف
            يحفظ موضعك في كل نمط على حدة.
          </p>
          <div className="grid gap-3 mt-4">
            {THREE_MODES.map((m) => {
              const disabled = locked || (m.id === 'tadabbur' && !tafsirConfigured());
              return (
                <div key={m.id}>
                  <button
                    disabled={disabled}
                    onClick={() => void startJourney(m.id)}
                    className={`w-full p-4 rounded-xl font-bold text-right disabled:opacity-50 ${
                      journeyMode === m.id
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white border border-emerald-200 text-accent-800'
                    }${preselectedMode === m.id && journeyMode !== m.id ? ' ring-2 ring-emerald-500' : ''}`}
                  >
                    {m.name}
                    <span className={`block text-sm font-normal mt-1 ${journeyMode === m.id ? 'text-emerald-100' : 'text-accent-600'}`}>
                      {m.description}
                    </span>
                  </button>
                  {preselectedMode === m.id && !locked && (
                    <p className="text-xs text-emerald-700 font-bold mt-2">
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
                </div>
              );
            })}
          </div>
          {/* Per-mode resume cards (tap-only, like every resume here). */}
          {THREE_MODES.map((m) => {
            const saved = savedJourneys[m.id];
            if (!saved || hiddenJourneyResumes.includes(m.id)) return null;
            return (
              <div key={`resume-${m.id}`} className="bg-amber-50 rounded-2xl border border-amber-200 shadow-sm p-4 mt-4">
                <p className="font-bold text-accent-800">
                  استئناف — {m.name}:{' '}
                  {saved.kind === 'tafsir'
                    ? `تدبّر، تفسير سورة ${surahName(saved.surah)} آية ${saved.ayah}`
                    : `سورة ${surahName(saved.surah)}، الآية ${saved.ayah}`}
                </p>
                <p className="text-sm text-accent-600 mt-1">موضع محفوظ من آخر مرة توقفت فيها بهذا النمط.</p>
                <div className="flex gap-3 mt-3">
                  <button
                    onClick={() => resumeJourneySaved(m.id)}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
                  >
                    استئناف
                  </button>
                  <button
                    onClick={() => dismissJourneyResume(m.id)}
                    className="flex-1 py-3 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl"
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
          <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 mb-4">
            <p className="font-bold text-accent-800">
              {journeyMode !== null
                ? journeyItem !== null
                  ? journeyItem.kind === 'tafsir'
                    ? `تدبّر — تفسير سورة ${surahName(journeyItem.surah)} آية ${journeyItem.ayah} — ${threeModeName(journeyMode)}`
                    : `${threeModeName(journeyMode)} — سورة ${surahName(journeyItem.surah)} — آية ${journeyItem.ayah} من ${surahCount(journeyItem.surah)}`
                  : `${threeModeName(journeyMode)} — سورة ${surahName(surah)}`
                : hadrOn
                  ? `سورة ${surahName(surah)} — ${HADR_NAME}`
                  : riwayaId !== null
                    ? `سورة ${surahName(surah)} — ${RIWAYAT.find((r) => r.id === riwayaId)?.name || ''}`
                    : `سورة ${surahName(surah)} — آية ${currentAyah} من ${count}`}
            </p>
            {/* Grant attribution, visible WHILE a tafsir clip plays
                (the section line alone would vanish once playback
                starts). */}
            {journeyMode === 'tadabbur' && journeyItem?.kind === 'tafsir' && (
              <p className="text-xs text-accent-600 mt-2">{TAFSIR_ATTRIBUTION}</p>
            )}
            {engineError && <p className="text-sm text-red-600 font-bold mt-2">{engineError}</p>}
            {/* Redirect B: interruption resume — prominent, tap-only */}
            {interrupted && (
              <div className="mt-4 bg-amber-50 border border-amber-300 rounded-xl p-4">
                <p className="font-bold text-accent-800">توقف التشغيل مؤقتا</p>
                <p className="text-sm text-accent-600 mt-1">اضغط استئناف للمتابعة من حيث توقفت.</p>
                <button
                  onClick={() => void resumeAfterInterruption()}
                  className="mt-3 w-full py-3.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl"
                >
                  استئناف
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-4">
              <button
                onClick={() => void togglePlayPause()}
                className="flex-1 min-w-[120px] py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2"
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
                className="px-4 py-3 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl flex items-center gap-2"
              >
                <SkipBack className="w-5 h-5" /> الآية السابقة
              </button>
              <button
                onClick={() => void engineRef.current?.next()}
                className="px-4 py-3 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl flex items-center gap-2"
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
                className="px-4 py-3 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl flex items-center gap-2"
              >
                <RotateCcw className="w-5 h-5" /> {journeyMode !== null ? 'من أول الرحلة' : 'من أول السورة'}
              </button>
              <button
                onClick={stopPlayback}
                className="px-4 py-3 bg-white border border-red-200 text-red-700 font-bold rounded-xl flex items-center gap-2"
              >
                <Square className="w-5 h-5" /> إيقاف
              </button>
            </div>
            <button
              onClick={() => setBlackScreen(true)}
              className="mt-3 w-full py-3 bg-stone-800 hover:bg-stone-900 text-white font-bold rounded-xl flex items-center justify-center gap-2"
              aria-label="شاشة سوداء"
            >
              <Moon className="w-5 h-5" />
              شاشة سوداء
            </button>
            <p className="text-sm text-accent-600 mt-1 text-center">يخفي الواجهة والصوت مستمر</p>
          </div>
        )}

        {/* Read-along text — Hafs only: riwaya mode is
            listening-only (the Hafs text does not match a non-Hafs
            voice), and hadr is surah-file (no ayah steps), so this
            block hides under either. */}
        {riwayaId === null && !hadrOn && (
        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 mb-4">
          <p className="font-bold text-accent-800 mb-3">سورة {surahName(surah)}</p>
          {textLoading && <p className="text-accent-600">جارٍ تحميل نص السورة…</p>}
          {textError && <p className="text-red-600 font-bold">{textError}</p>}
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
                      : 'bg-white border-emerald-100'
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
            Hafs only in v1 — riwaya and hadr modes have no offline downloads. */}
        {riwayaId === null && !hadrOn && (
        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 mb-4">
          <p className="font-bold text-accent-800">الاستماع دون اتصال</p>
          <p className="text-sm text-accent-600 mt-1">
            سورة {surahName(surah)} — {RECITERS.find((r) => r.id === reciterId)?.name || ''}
          </p>
          {offlineError && <p className="text-sm text-red-600 font-bold mt-2">{offlineError}</p>}
          {offlineChecking ? (
            <p className="text-accent-600 mt-3">جارٍ التحقق…</p>
          ) : downloaded ? (
            <div className="mt-3">
              <p className="inline-block px-3 py-1.5 bg-emerald-100 text-emerald-800 font-bold rounded-xl">
                متاح دون اتصال
              </p>
              <button
                onClick={() => void handleDeleteDownload()}
                className="mt-3 w-full py-3 bg-white border border-red-200 text-red-700 font-bold rounded-xl flex items-center justify-center gap-2"
              >
                <Trash2 className="w-5 h-5" /> حذف التحميل
              </button>
            </div>
          ) : (
            <div className="mt-3">
              {estimate ? (
                <div>
                  <p className="font-bold text-accent-800">
                    حجم التحميل: {formatApproxSize(estimate.bytes)} — {estimate.count} مقاطع
                  </p>
                  <div className="flex gap-3 mt-3">
                    <button
                      disabled={downloading}
                      onClick={() => void handleDownload()}
                      className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl disabled:opacity-50"
                    >
                      تأكيد التحميل
                    </button>
                    <button
                      disabled={downloading}
                      onClick={() => setEstimate(null)}
                      className="flex-1 py-3 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl disabled:opacity-50"
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
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
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
            <p className="text-white/20 text-sm font-bold">اضغط مطوّلًا للعودة</p>
          )}
        </div>
      )}
    </div>
  );
}
