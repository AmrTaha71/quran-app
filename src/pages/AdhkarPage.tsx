// AdhkarPage.tsx — أذكار الصباح والمساء (صوت مولّد).
//
// Audio: the SHARED <audio> element (sharedAudio.ts, owner 'adhkar'),
// so starting adhkar preempts listen and starting listen preempts
// adhkar — never two sources at once. All shared-element handlers are
// owner-gated (currentAudioOwner() === 'adhkar') because the listeners
// stay attached after unmount; a stale handler must never react to
// another owner's audio.
//
// Repeat rule: each clip is generated ONCE; the player repeats it
// `count` times, then auto-advances. Voice switch restarts the current
// dhikr (rep 1) in the new voice. Position (wird/index/rep) persists
// in localStorage, so leaving and returning resumes where you stopped.
// Completion clears the saved position; the wird restarts from the top.
//
// Honesty: the voice is GENERATED. The player carries a permanent
// "صوت مولّد" label; it is never presented as a human recording.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw, SunMoon, AlertCircle } from 'lucide-react';
import { acquireAudio, currentAudioOwner, releaseAudio } from '../lib/sharedAudio';
import { adhkarClipUrl, adhkarList, type AdhkarClip, type AdhkarVoice, type AdhkarWird } from '../lib/adhkarClips';

type Route = 'home' | 'adhkar';

const VOICE_KEY = 'quran-adhkar-voice';
const WIRD_KEY = 'quran-adhkar-wird';
const POS_KEY = 'quran-adhkar-position';

function readVoice(): AdhkarVoice {
  try {
    const v = localStorage.getItem(VOICE_KEY);
    if (v === 'female' || v === 'male') return v;
  } catch { /* ignore */ }
  return 'male';
}

function readWird(): AdhkarWird {
  try {
    const w = localStorage.getItem(WIRD_KEY);
    if (w === 'evening' || w === 'morning') return w;
  } catch { /* ignore */ }
  return 'morning';
}

interface SavedPos { wird: AdhkarWird; index: number; rep: number }

function readPosition(wird: AdhkarWird): { index: number; rep: number } {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as SavedPos;
      if (p.wird === wird && Number.isInteger(p.index) && p.index >= 0 && Number.isInteger(p.rep) && p.rep >= 1) {
        return { index: p.index, rep: p.rep };
      }
    }
  } catch { /* ignore */ }
  return { index: 0, rep: 1 };
}

function preview(text: string, max = 64): string {
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

export default function AdhkarPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const [wird, setWird] = useState<AdhkarWird>(readWird);
  const [voice, setVoice] = useState<AdhkarVoice>(readVoice);
  const [pos, setPos] = useState(() => readPosition(readWird()));
  const [playing, setPlaying] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ t: 0, d: 0 });

  const list = useMemo(() => adhkarList(wird), [wird]);
  const index = Math.min(pos.index, list.length - 1);
  const clip: AdhkarClip = list[index];
  const rep = Math.min(pos.rep, clip.count);

  // Refs mirror state for the shared-element handlers (attached once).
  const stateRef = useRef({ wird, voice, index, rep, playing, list });
  stateRef.current = { wird, voice, index, rep, playing, list };
  const elRef = useRef<HTMLAudioElement | null>(null);
  const wiredRef = useRef(false);

  const setMediaSession = useCallback((c: AdhkarClip, w: AdhkarWird, isPlaying: boolean) => {
    try {
      const nav = navigator as unknown as { mediaSession?: { metadata: unknown; playbackState: string } };
      const MM = (window as unknown as { MediaMetadata?: new (init: { title: string; artist: string }) => unknown }).MediaMetadata;
      if (nav.mediaSession && MM) {
        nav.mediaSession.metadata = new MM({
          title: `أذكار ${w === 'morning' ? 'الصباح' : 'المساء'} — ${preview(c.display, 40)}`,
          artist: 'صوت مولّد',
        });
      }
      if (nav.mediaSession) nav.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch { /* ignore */ }
  }, []);

  const savePosition = useCallback((w: AdhkarWird, i: number, r: number) => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ wird: w, index: i, rep: r }));
    } catch { /* ignore */ }
  }, []);

  const loadClip = useCallback((c: AdhkarClip, v: AdhkarVoice, el: HTMLAudioElement) => {
    const url = adhkarClipUrl(c, v);
    if (el.src !== url) {
      el.src = url;
      el.load();
    }
    setProgress({ t: 0, d: 0 });
  }, []);

  const handlePreempted = useCallback(() => {
    setPlaying(false);
  }, []);

  // Wire the shared element once; handlers read stateRef + owner gate.
  const ensureElement = useCallback((): HTMLAudioElement => {
    const el = acquireAudio('adhkar', handlePreempted);
    elRef.current = el;
    if (!wiredRef.current) {
      wiredRef.current = true;
      el.addEventListener('ended', () => {
        if (currentAudioOwner() !== 'adhkar') return;
        const s = stateRef.current;
        const cur = s.list[s.index];
        if (!cur) return;
        if (s.rep < cur.count) {
          const nextRep = s.rep + 1;
          setPos({ index: s.index, rep: nextRep });
          savePosition(s.wird, s.index, nextRep);
          try {
            el.currentTime = 0;
            void el.play();
          } catch { /* ignore */ }
        } else if (s.index + 1 < s.list.length) {
          const nextIndex = s.index + 1;
          setPos({ index: nextIndex, rep: 1 });
          savePosition(s.wird, nextIndex, 1);
          const next = s.list[nextIndex];
          if (next) {
            el.src = adhkarClipUrl(next, s.voice);
            el.load();
            setMediaSession(next, s.wird, true);
            void el.play().catch(() => setPlaying(false));
          }
        } else {
          setCompleted(true);
          setPlaying(false);
          try {
            localStorage.removeItem(POS_KEY);
          } catch { /* ignore */ }
        }
      });
      el.addEventListener('timeupdate', () => {
        if (currentAudioOwner() !== 'adhkar') return;
        setProgress({ t: el.currentTime || 0, d: el.duration || 0 });
      });
      el.addEventListener('error', () => {
        if (currentAudioOwner() !== 'adhkar') return;
        setError('تعذر تشغيل المقطع — تحقق من الاتصال ثم أعد المحاولة.');
        setPlaying(false);
      });
    }
    return el;
  }, [handlePreempted, savePosition, setMediaSession]);

  // Persist position on change (not after completion).
  useEffect(() => {
    if (!completed) savePosition(wird, index, rep);
  }, [wird, index, rep, completed, savePosition]);

  // Pause + release on unmount (return resumes via saved position).
  useEffect(() => {
    return () => {
      try {
        elRef.current?.pause();
      } catch { /* ignore */ }
      releaseAudio('adhkar');
    };
  }, []);

  const play = useCallback(() => {
    setError(null);
    setCompleted(false);
    const el = ensureElement();
    loadClip(clip, voice, el);
    setMediaSession(clip, wird, true);
    void el.play().then(() => setPlaying(true)).catch(() => {
      setError('تعذر بدء التشغيل — اضغط تشغيل مرة أخرى.');
      setPlaying(false);
    });
  }, [clip, voice, wird, ensureElement, loadClip, setMediaSession]);

  const pause = useCallback(() => {
    try {
      elRef.current?.pause();
    } catch { /* ignore */ }
    setPlaying(false);
    setMediaSession(clip, wird, false);
  }, [clip, wird, setMediaSession]);

  const jumpTo = useCallback((i: number, autoplay: boolean) => {
    const target = Math.max(0, Math.min(i, list.length - 1));
    setCompleted(false);
    setError(null);
    setPos({ index: target, rep: 1 });
    savePosition(wird, target, 1);
    if (autoplay) {
      const el = ensureElement();
      loadClip(list[target], voice, el);
      setMediaSession(list[target], wird, true);
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      // Paused selection only: do NOT acquire the shared element here —
      // acquiring would preempt listen audio even though nothing plays.
      // The clip loads on the next play().
      setPlaying(false);
    }
  }, [list, voice, wird, ensureElement, loadClip, savePosition, setMediaSession]);

  const switchWird = useCallback((w: AdhkarWird) => {
    if (w === wird) return;
    try {
      localStorage.setItem(WIRD_KEY, w);
    } catch { /* ignore */ }
    // Stop current playback first: switching wirds must never leave the
    // old wird's audio playing under the new wird's UI.
    try {
      elRef.current?.pause();
    } catch { /* ignore */ }
    const start = readPosition(w);
    setWird(w);
    setCompleted(false);
    setError(null);
    setPos(start.index >= adhkarList(w).length ? { index: 0, rep: 1 } : start);
    setPlaying(false);
  }, [wird]);

  const switchVoice = useCallback((v: AdhkarVoice) => {
    if (v === voice) return;
    try {
      localStorage.setItem(VOICE_KEY, v);
    } catch { /* ignore */ }
    setVoice(v);
    setError(null);
    // Restart the current dhikr in the new voice (rep 1).
    setPos({ index, rep: 1 });
    savePosition(wird, index, 1);
    if (playing) {
      const el = ensureElement();
      loadClip(clip, v, el);
      setMediaSession(clip, wird, true);
      void el.play().catch(() => setPlaying(false));
    }
  }, [voice, index, playing, clip, wird, ensureElement, loadClip, savePosition, setMediaSession]);

  const restart = useCallback(() => {
    setCompleted(false);
    setError(null);
    setPos({ index: 0, rep: 1 });
    savePosition(wird, 0, 1);
    if (playing) {
      const el = ensureElement();
      loadClip(list[0], voice, el);
      setMediaSession(list[0], wird, true);
      void el.play().catch(() => setPlaying(false));
    }
  }, [playing, wird, list, voice, ensureElement, loadClip, savePosition, setMediaSession]);

  const pct = progress.d > 0 ? Math.min(100, (progress.t / progress.d) * 100) : 0;

  return (
    <main className="min-h-screen bg-stone-50 pb-24 px-4 pt-6" dir="rtl">
      <div className="max-w-2xl mx-auto">
        <button onClick={() => onNavigate('home')} className="text-sm text-emerald-700 font-semibold underline">
          → الرئيسية
        </button>

        <div className="flex items-center gap-2 mt-3">
          <SunMoon className="w-6 h-6 text-emerald-700" />
          <h1 className="text-xl font-bold text-accent-800">أذكار الصباح والمساء</h1>
          <span className="text-xs font-bold bg-amber-100 text-amber-800 px-2 py-1 rounded-full">صوت مولّد</span>
        </div>

        {/* Wird tabs */}
        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            onClick={() => switchWird('morning')}
            className={`py-3 font-bold rounded-xl ${wird === 'morning' ? 'bg-emerald-700 text-white' : 'bg-white border border-stone-200 text-accent-700'}`}
          >
            أذكار الصباح
          </button>
          <button
            onClick={() => switchWird('evening')}
            className={`py-3 font-bold rounded-xl ${wird === 'evening' ? 'bg-emerald-700 text-white' : 'bg-white border border-stone-200 text-accent-700'}`}
          >
            أذكار المساء
          </button>
        </div>

        {/* Voice toggle */}
        <div className="grid grid-cols-2 gap-2 mt-2">
          <button
            onClick={() => switchVoice('male')}
            className={`py-2 font-bold rounded-xl text-sm ${voice === 'male' ? 'bg-teal-700 text-white' : 'bg-white border border-stone-200 text-accent-700'}`}
          >
            صوت رجالي
          </button>
          <button
            onClick={() => switchVoice('female')}
            className={`py-2 font-bold rounded-xl text-sm ${voice === 'female' ? 'bg-teal-700 text-white' : 'bg-white border border-stone-200 text-accent-700'}`}
          >
            صوت نسائي
          </button>
        </div>

        {/* Now playing */}
        <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-5 mt-4">
          {completed ? (
            <div className="text-center">
              <p className="text-lg font-bold text-emerald-700">تم وردك ✓</p>
              <p className="text-sm text-accent-600 mt-1">أذكار {wird === 'morning' ? 'الصباح' : 'المساء'} كاملة — تقبّل الله.</p>
              <button onClick={restart} className="mt-4 px-5 py-3 bg-emerald-700 text-white font-bold rounded-xl">
                إعادة من الأول
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-accent-500 font-semibold">
                الذكر {index + 1} من {list.length} — التكرار {rep} من {clip.count}
              </p>
              <p className="text-lg leading-relaxed text-accent-800 font-semibold mt-2">{clip.display}</p>
              <div className="h-2 bg-stone-200 rounded-full mt-4 overflow-hidden" dir="ltr">
                <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${pct}%` }} />
              </div>
              {error && (
                <p className="flex items-center gap-2 text-sm text-red-700 font-semibold mt-3">
                  <AlertCircle className="w-4 h-4" /> {error}
                </p>
              )}
              <div className="flex items-center justify-center gap-3 mt-4">
                <button
                  onClick={() => jumpTo(index - 1, playing)}
                  disabled={index === 0}
                  className="p-3 bg-white border border-stone-200 rounded-full disabled:opacity-40"
                  aria-label="الذكر السابق"
                >
                  <SkipBack className="w-5 h-5" />
                </button>
                {playing ? (
                  <button onClick={pause} className="p-4 bg-emerald-700 text-white rounded-full" aria-label="إيقاف">
                    <Pause className="w-6 h-6" />
                  </button>
                ) : (
                  <button onClick={play} className="p-4 bg-emerald-700 text-white rounded-full" aria-label="تشغيل">
                    <Play className="w-6 h-6" />
                  </button>
                )}
                <button
                  onClick={() => jumpTo(index + 1, playing)}
                  disabled={index >= list.length - 1}
                  className="p-3 bg-white border border-stone-200 rounded-full disabled:opacity-40"
                  aria-label="الذكر التالي"
                >
                  <SkipForward className="w-5 h-5" />
                </button>
                <button onClick={restart} className="p-3 bg-white border border-stone-200 rounded-full" aria-label="من الأول">
                  <RotateCcw className="w-5 h-5" />
                </button>
              </div>
            </>
          )}
        </div>

        {/* List: tap to jump */}
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-3 mt-4">
          {list.map((item, i) => (
            <button
              key={item.id}
              onClick={() => jumpTo(i, playing)}
              className={`w-full text-right flex items-center gap-3 px-3 py-2.5 rounded-xl ${i === index && !completed ? 'bg-amber-50 border border-amber-200' : ''}`}
            >
              <span className={`text-xs font-bold w-6 text-center ${i < index ? 'text-emerald-600' : i === index ? 'text-amber-700' : 'text-stone-400'}`}>
                {i < index ? '✓' : i === index && !completed ? '▶' : i + 1}
              </span>
              <span className="flex-1 text-sm text-accent-800">{preview(item.display)}</span>
              <span className="text-xs font-bold bg-stone-100 text-stone-600 px-2 py-1 rounded-full">×{item.count}</span>
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-stone-500 mt-4">
          الصوت مولّد — وليس تسجيلًا بشريًا. التكرار يتم في المشغّل؛ كل مقطع مولّد مرة واحدة.
        </p>
      </div>
    </main>
  );
}
