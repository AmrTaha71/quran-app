import { useEffect, useRef, useState } from 'react';
import { Moon, Pause, Play, Radio } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  acquireAudio,
  getSharedAudio,
  releaseAudio,
} from '../lib/sharedAudio';

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

// إذاعة القرآن الكريم من القاهرة — بث مباشر. MINIMAL audio-only
// player on the SHARED audio unit (second redirect): this page
// creates NO audio element of its own. play() acquires the unit
// as 'radio' (which stops listen playback, and vice versa); stop
// and unmount release it. The 'adhkar' owner is reserved for the
// future only — this patch builds no adhkar audio and hotlinks no
// third-party files beyond the two verified live streams below.
//
// SHIP-GATE (second redirect + Claude review 2026-10-29): the
// #/radio route is CLOSED by default in production — opening
// #/radio without the dev flag shows only a "soon" notice and
// loads no stream, so no third-party broadcast plays before
// permission. Testing: set localStorage 'quran-radio-dev' to
// '1'. When Maspero permission arrives, remove this gate and
// move the radio + adhkar cards up near listen in the same
// activating push. NO home card ships in this patch —
// permission from the rights holder (National Media Authority,
// Maspero) is still pending parent-side.
//
// STREAM RESOLUTION (tier order; every tier guarded, failure
// falls through silently and never breaks the player):
//   (1) Supabase app_settings row key 'radio_streams' (same
//       key/value pattern AdminPage already uses), read with
//       .maybeSingle() so a missing row is not an error. value
//       is a JSON string: {"primary": "https://...",
//       "fallbacks": ["https://...", ...]}. Every URL must start
//       with https://, else it is dropped. A remote fetch that
//       yields usable URLs also refreshes the tier-2 cache.
//   (2) localStorage 'quran-radio-streams' last-known-good.
//   (3) Bundled verified list (verified live 2026-10-29 with
//       curl -I + real audio bytes + ffprobe; full log in NOTES):
//       primary https://radio.xecod.com/station/quran-cairo
//         (HEAD 200 audio/mpeg, icy-name "Holy Quran Radio
//         Cairo", mp3 44100 Hz 32 kbps; TuneIn guide s361458
//         resolves to this same URL), fallback
//         https://stream.zeno.fm/tv0x28xvyc9uv (stable URL
//         302-redirects to a per-request signed token URL;
//         GET -L yields real mp3 bytes, 44100 Hz ~84 kbps).
//       NOT shipped: https://stream.radiojar.com/8s5u5tpdtwzuv
//       (embedded on holyquranradio.com but returns 404).
//       HONEST CAVEAT: both live hosts are third-party relays
//       carrying the Cairo station; no stream served from an
//       official Maspero domain was found.
// HTTPS-only at every tier: http:// URLs are dropped, never used.
//
// ROTATION STATE MACHINE (error/stalled handling): on 'error'
// or 'stalled', retry the CURRENT url once after a 1.5s delay;
// if it fails again, rotate to the NEXT url in the resolved list;
// when the list is exhausted, show the Arabic error. A later
// 'playing' event resets the retry allowance, so a new stall
// gets its own retry. Timers are cleared on stop/unmount and
// every step checks that playback is still wanted, so a stale
// timer can never restart audio after the user stopped it.
//
// LIVE EDGE: play() from a paused state where a source was
// already loaded re-sets audio.src + audio.load() before play(),
// so playback returns to the live edge, not a stale buffer.
//
// LIVE DISCIPLINE: no seek buttons, no Media Session position
// state, fixed Media Session title only. No program names are
// ever shown (stream metadata is never promised or displayed).
// DATA NOTE: ≈ 14 م.ب/ساعة, computed from the REAL verified
// primary bitrate (32 kbps × 3600 / 8 / 1024 = 14.06 MB/hour) —
// never an invented number.
const RADIO_TITLE = 'إذاعة القرآن الكريم من القاهرة — بث مباشر';
const PRIMARY_STREAM = 'https://radio.xecod.com/station/quran-cairo';
const FALLBACK_STREAM = 'https://stream.zeno.fm/tv0x28xvyc9uv';
const REMOTE_SETTINGS_KEY = 'radio_streams';
const LOCAL_STORAGE_KEY = 'quran-radio-streams';
const RETRY_DELAY_MS = 1500;
// Dev flag for the testing route: production default CLOSED.
// Set localStorage 'quran-radio-dev' to '1' to test playback.
const DEV_FLAG_KEY = 'quran-radio-dev';

function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('https://');
}

function validStreamList(primary: unknown, fallbacks: unknown): string[] | null {
  const out: string[] = [];
  if (isHttpsUrl(primary)) out.push(primary);
  if (Array.isArray(fallbacks)) {
    for (const f of fallbacks) if (isHttpsUrl(f)) out.push(f);
  }
  return out.length > 0 ? out : null;
}

function parseStreamsValue(value: unknown): string[] | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as { primary?: unknown; fallbacks?: unknown };
    return validStreamList(obj.primary, obj.fallbacks);
  } catch {
    return null;
  }
}

export default function RadioPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  const retriedRef = useRef(false);
  const handlingFailureRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const listenersAttachedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Black-screen mode (ungated player UI only): a fullscreen black
  // overlay that hides the UI while audio keeps playing untouched.
  // It never touches the audio unit, Media Session, or Wake Lock
  // (none is used here). Exit is long-press (>=1000ms) or swipe
  // (>60px) only — never a single tap, so pocket touches cannot
  // dismiss it. This state lives in the main return below; the
  // gated branch above never mounts the button or the overlay.
  const [blackScreen, setBlackScreen] = useState(false);
  const [showBlackHint, setShowBlackHint] = useState(false);
  const blackPressRef = useRef<{ t: number; x: number; y: number } | null>(null);
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
  // Production gate (Claude review 2026-10-29): the route must
  // not play third-party streams before Maspero permission.
  // Default closed; testing only with the dev flag set.
  let radioDevEnabled = false;
  try {
    radioDevEnabled = localStorage.getItem(DEV_FLAG_KEY) === '1';
  } catch {}

  const clearRetryTimer = () => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  const showError = () => {
    setError('تعذر تشغيل البث — تحقق من الاتصال وحاول مجددا.');
    setPlaying(false);
    setConnecting(false);
  };

  // Rotation state machine: retry current once after a delay,
  // then rotate to the next url, then error when exhausted.
  // (Declared before playAtIndex, which calls it, so no function
  // in this file ever references a later declaration.)
  const handleFailure = () => {
    if (!activeRef.current || handlingFailureRef.current) return;
    handlingFailureRef.current = true;
    if (!retriedRef.current) {
      retriedRef.current = true;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        handlingFailureRef.current = false;
        if (!activeRef.current) return;
        const audio = audioRef.current;
        const url = listRef.current[indexRef.current];
        if (!audio || !url) {
          showError();
          return;
        }
        try {
          audio.src = url;
          void audio.play().catch(() => handleFailure());
        } catch {
          handleFailure();
        }
      }, RETRY_DELAY_MS);
      return;
    }
    handlingFailureRef.current = false;
    const next = indexRef.current + 1;
    if (next < listRef.current.length) {
      playAtIndex(next);
    } else {
      showError();
    }
  };

  // Starts playback of listRef[indexRef] and records the attempt.
  const playAtIndex = (index: number) => {
    const audio = audioRef.current;
    const url = listRef.current[index];
    if (!audio || !url || !activeRef.current) return;
    indexRef.current = index;
    retriedRef.current = false;
    handlingFailureRef.current = false;
    hasLoadedRef.current = true;
    setConnecting(true);
    try {
      audio.src = url;
      void audio.play().catch(() => {
        // The 'error' event usually fires too; handleFailure's
        // guard makes a double trigger harmless.
        handleFailure();
      });
    } catch {
      handleFailure();
    }
  };

  // Tiered resolution (see header): remote → last-known-good →
  // bundled. A usable remote fetch refreshes the local cache.
  const resolveStreams = async (): Promise<string[]> => {
    try {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', REMOTE_SETTINGS_KEY)
        .maybeSingle();
      const remote = data ? parseStreamsValue(data.value) : null;
      if (remote) {
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(remote));
        } catch {}
        return remote;
      }
    } catch {}
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const cached = parseStreamsValue(raw);
        if (cached) return cached;
      }
    } catch {}
    return [PRIMARY_STREAM, FALLBACK_STREAM];
  };

  const playStream = () => {
    // Acquiring as 'radio' stops listen playback (and vice versa).
    const audio = acquireAudio('radio', () => {
      activeRef.current = false;
      clearRetryTimer();
      setPlaying(false);
      setConnecting(false);
    });
    audioRef.current = audio;
    // Radio must never inherit a listen speed: the shared element
    // keeps the last playbackRate, so a radio session started
    // after 1.5x listening would otherwise play at 1.5x.
    audio.playbackRate = 1;
    activeRef.current = true;
    setError(null);
    // Live-edge resume: a source already loaded (paused, not
    // stopped) is re-set + re-loaded before play, so playback
    // returns to the live edge instead of a stale buffer.
    if (hasLoadedRef.current && audio.src) {
      const url = listRef.current[indexRef.current] || audio.src;
      indexRef.current = listRef.current.indexOf(url) >= 0 ? listRef.current.indexOf(url) : indexRef.current;
      retriedRef.current = false;
      handlingFailureRef.current = false;
      setConnecting(true);
      try {
        audio.src = url;
        audio.load();
        void audio.play().catch(() => handleFailure());
      } catch {
        handleFailure();
      }
      return;
    }
    void (async () => {
      const list = await resolveStreams();
      if (!activeRef.current) return;
      listRef.current = list;
      playAtIndex(0);
    })();
  };

  const stopStream = () => {
    activeRef.current = false;
    clearRetryTimer();
    const audio = audioRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch {}
    }
    hasLoadedRef.current = false;
    indexRef.current = 0;
    retriedRef.current = false;
    handlingFailureRef.current = false;
    releaseAudio('radio');
    setPlaying(false);
    setConnecting(false);
  };

  // One-time wiring on the shared element: events + Media
  // Session. Every handler references only functions declared
  // earlier and stable setters/refs, so empty deps are TDZ-safe.
  useEffect(() => {
    if (!radioDevEnabled) return;
    const audio = getSharedAudio();
    audioRef.current = audio;
    const onPlaying = () => {
      // A successful play resets the retry allowance: a later
      // stall gets its own retry-then-rotate cycle.
      retriedRef.current = false;
      handlingFailureRef.current = false;
      setError(null);
      setConnecting(false);
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    const onFailure = () => handleFailure();
    if (!listenersAttachedRef.current) {
      audio.addEventListener('playing', onPlaying);
      audio.addEventListener('pause', onPause);
      audio.addEventListener('error', onFailure);
      audio.addEventListener('stalled', onFailure);
      listenersAttachedRef.current = true;
    }
    try {
      const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
      if (ms) {
        ms.metadata = new MediaMetadata({
          title: RADIO_TITLE,
          artist: 'إذاعة القرآن الكريم',
          album: 'روابط الذكر الحكيم',
        });
        ms.setActionHandler('play', playStream);
        ms.setActionHandler('pause', stopStream);
      }
    } catch {}
    return () => {
      clearRetryTimer();
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onFailure);
      audio.removeEventListener('stalled', onFailure);
      listenersAttachedRef.current = false;
      activeRef.current = false;
      try {
        audio.pause();
      } catch {}
      releaseAudio('radio');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Faint exit hint: shows when the overlay opens, hides itself.
  useEffect(() => {
    if (!blackScreen) return;
    setShowBlackHint(true);
    const timer = setTimeout(() => setShowBlackHint(false), 4000);
    return () => clearTimeout(timer);
  }, [blackScreen]);

  // Closed by default: no player, no Media Session, no stream
  // fetch — only the gate notice and a way home.
  if (!radioDevEnabled) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-stone-50/30 pb-24">
        <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-emerald-100 shadow-sm">
          <div className="max-w-5xl mx-auto px-4 py-3">
            <button
              onClick={() => onNavigate('home')}
              className="px-4 py-2 bg-white border border-emerald-200 text-accent-800 font-bold rounded-xl"
            >
              الرئيسية
            </button>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-5">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 text-center opacity-60">
            <p className="font-bold text-accent-800">إذاعة القرآن الكريم — قريبًا</p>
            <p className="text-sm text-accent-600 mt-2">بانتظار إذن البث من الهيئة الوطنية للإعلام</p>
          </div>
        </main>
      </div>
    );
  }

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
              <Radio className="w-5 h-5 text-emerald-600" />
              {RADIO_TITLE}
            </h1>
            <p className="text-sm text-accent-600">بث مباشر — صوت فقط</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5">
        {/* No audio element here by design: playback uses the
            shared audio unit (see header). */}
        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 mb-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="relative flex h-3 w-3">
              {playing && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              )}
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600" />
            </span>
            <span className="font-bold text-accent-800">بث مباشر</span>
          </div>

          <button
            onClick={playing ? stopStream : playStream}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 text-lg"
          >
            {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            {playing ? 'إيقاف البث' : 'تشغيل البث'}
          </button>

          <button
            onClick={() => setBlackScreen(true)}
            className="mt-3 w-full py-3 bg-stone-800 hover:bg-stone-900 text-white font-bold rounded-xl flex items-center justify-center gap-2"
            aria-label="شاشة سوداء"
          >
            <Moon className="w-5 h-5" />
            شاشة سوداء
          </button>
          <p className="text-sm text-accent-600 mt-1">يخفي الواجهة والصوت مستمر</p>

          {connecting && !playing && (
            <p className="text-sm text-accent-600 mt-3">جارٍ الاتصال بالبث…</p>
          )}
          {error && <p className="text-sm text-red-600 font-bold mt-3">{error}</p>}

          <p className="text-sm text-accent-600 mt-4">
            يستهلك بيانات الجوال باستمرار أثناء التشغيل — ≈ 14 م.ب/ساعة (على البث الأساسي، 32 كيلوبت/ثانية)
          </p>
          <p className="text-sm text-accent-600 mt-1">
            بث مباشر عبر الإنترنت فقط — لا يعمل دون اتصال، ولا يوجد تحميل أو استئناف.
          </p>
        </div>

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
