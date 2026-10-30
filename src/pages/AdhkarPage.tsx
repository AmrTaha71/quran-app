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
// Honesty: the wird MIXES sources since 2026-10-29 (Amr's decision).
// Quranic items (Kursi, the three surahs) play REAL recitation in the
// male voice; every supplication, and every Quranic item in the female
// voice, plays generated audio. The now-playing card carries a
// per-item source badge ("تلاوة — {reciter}" vs "صوت مولّد بالذكاء
// الاصطناعي"), so the label is accurate at every moment, not just
// in the description.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw, SunMoon, AlertCircle } from 'lucide-react';
import { acquireAudio, currentAudioOwner, releaseAudio, registerResume, unregisterResume, clearResumeStack, hasWaitingResumes } from '../lib/sharedAudio';
import { adhkarClipUrl, adhkarList, type AdhkarClip, type AdhkarVoice, type AdhkarWird } from '../lib/adhkarClips';
import { DEFAULT_RECITER_ID, RECITERS, type Reciter } from '../lib/reciters';
import { hadrAudioUrl, HADR_NAME } from '../lib/hadr';

type Route = 'home' | 'adhkar';

const VOICE_KEY = 'quran-adhkar-voice';
const WIRD_KEY = 'quran-adhkar-wird';
const POS_KEY = 'quran-adhkar-position';
// Saved-position version. Bumped to 2 on 2026-10-29 when the wird lists
// changed (5 additions, lailaha split, subhan-count moved): old saved
// indices point at different adhkar now, so a stale position resets
// to the top instead of resuming at the wrong dhikr.
const POS_VERSION = 2;

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
      const p = JSON.parse(raw) as SavedPos & { v?: number };
      if (p.v !== POS_VERSION) return { index: 0, rep: 1 };
      if (p.wird === wird && Number.isInteger(p.index) && p.index >= 0 && Number.isInteger(p.rep) && p.rep >= 1) {
        return { index: p.index, rep: p.rep };
      }
    }
  } catch { /* ignore */ }
  return { index: 0, rep: 1 };
}

// One-time auto-resume intent for route hide (mirrors listen's
// 12h sessionStorage intent): segment + time-in-clip, so a hidden
// page can resume exactly where it paused. Position (wird/index/
// rep) already lives in POS_KEY; this only adds seg/time.
const ADHKAR_RESUME_KEY = 'quran-adhkar-auto-resume';
const ADHKAR_RESUME_MAX_AGE_MS = 12 * 60 * 60 * 1000;
interface AdhkarIntent { seg: number; time: number; at: number }
function readAdhkarIntent(): AdhkarIntent | null {
  try {
    const raw = sessionStorage.getItem(ADHKAR_RESUME_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (typeof p !== 'object' || p === null) return null;
    if (typeof p.at !== 'number' || !Number.isFinite(p.at) || p.at > Date.now() + 60000 || Date.now() - p.at > ADHKAR_RESUME_MAX_AGE_MS) return null;
    if (typeof p.seg !== 'number' || !Number.isInteger(p.seg) || p.seg < 0) return null;
    if (typeof p.time !== 'number' || !Number.isFinite(p.time) || p.time < 0) return null;
    return { seg: p.seg, time: p.time, at: p.at };
  } catch {
    return null;
  }
}
function writeAdhkarIntent(i: AdhkarIntent): void {
  try {
    sessionStorage.setItem(ADHKAR_RESUME_KEY, JSON.stringify(i));
  } catch {}
}
function clearAdhkarIntent(): void {
  try {
    sessionStorage.removeItem(ADHKAR_RESUME_KEY);
  } catch {}
}

function preview(text: string, max = 64): string {
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

// The reciter for KURSI (the only adhkar item still using per-ayah
// files): the user's listen preference ('quran-reciter'), default
// المنشاوي. Read once at mount; a change in Settings takes effect
// on the next adhkar open. Surahs3 uses Juhani hadr surah files
// (see segmentsFor) and does not use this reciter.
function resolveReciter(): Reciter {
  try {
    const id = localStorage.getItem('quran-reciter');
    if (id) {
      const found = RECITERS.find((r) => r.id === id);
      if (found) return found;
    }
  } catch { /* ignore */ }
  return RECITERS.find((r) => r.id === DEFAULT_RECITER_ID) ?? RECITERS[0];
}

// The reciter label shown for a Quranic item. Surahs3 plays Juhani
// hadr surah files (below), so its label is the hadr name; Kursi
// uses the listen-preference reciter's name. The badges stay honest
// about this split — never a single reciter name for both.
function adhkarReciterLabel(clip: AdhkarClip, reciter: Reciter): string {
  return clip.id === 'surahs3' ? HADR_NAME : reciter.name;
}

// Segments one repetition of a dhikr plays.
// Quranic items play REAL recitation in BOTH voices (2026-10-29
// review decision): a synthetic TTS voice cannot guarantee tajwid,
// and a recitation recording does not depend on the listener's
// gender — so the male/female toggle affects only the
// supplications. Non-Quranic items are single synthetic clips in
// both voices.
// Kursi is one ayah file (2:255 = global 262) from the
// listen-preference reciter (reciters.ts builder). The three surahs
// (2026-10-29, Amr's order) play Juhani hadr SURAH files instead —
// one file per surah per rep, chained exactly as the 15 ayah files
// were before (verified 2026-10-29: 112/113/114 all return 206
// audio/mpeg). Kursi cannot come from Juhani: AlQuranCloud lists
// ar.abdullahawadaljuhani as surahbysurah only, and no
// everyayah/Quran.com per-ayah Juhani was found.
function segmentsFor(clip: AdhkarClip, voice: AdhkarVoice, reciter: Reciter): string[] {
  if (!clip.quranic) return [adhkarClipUrl(clip, voice)];
  if (clip.id === 'kursi') return [reciter.audioUrl(2, 255)];
  return [112, 113, 114].map((surah) => hadrAudioUrl(surah));
}

function isRecitation(clip: AdhkarClip, voice: AdhkarVoice): boolean {
  return !!clip.quranic;
}

export default function AdhkarPage({ onNavigate, visible = true }: { onNavigate: (r: Route) => void; visible?: boolean }) {
  const [wird, setWird] = useState<AdhkarWird>(readWird);
  const [voice, setVoice] = useState<AdhkarVoice>(readVoice);
  const [pos, setPos] = useState(() => readPosition(readWird()));
  const [playing, setPlaying] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ t: 0, d: 0 });
  const [seg, setSeg] = useState(0);

  const list = useMemo(() => adhkarList(wird), [wird]);
  const index = Math.min(pos.index, list.length - 1);
  const clip: AdhkarClip = list[index];
  const rep = Math.min(pos.rep, clip.count);
  const reciter = useMemo(resolveReciter, []);
  const segments = useMemo(() => segmentsFor(clip, voice, reciter), [clip, voice, reciter]);

  // Refs mirror state for the shared-element handlers (attached once).
  const stateRef = useRef({ wird, voice, index, rep, playing, list, seg, segments });
  stateRef.current = { wird, voice, index, rep, playing, list, seg, segments };
  const elRef = useRef<HTMLAudioElement | null>(null);
  const wiredRef = useRef(false);
  // Route visibility (App keeps this page mounted while hidden).
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const prevVisibleRef = useRef(visible);
  // Position captured at preemption time (only when actually
  // playing). Read by the anywhere-resume dispatcher.
  const preemptedRef = useRef<{ index: number; rep: number; seg: number; time: number } | null>(null);

  const setMediaSession = useCallback((c: AdhkarClip, w: AdhkarWird, isPlaying: boolean) => {
    try {
      const nav = navigator as unknown as { mediaSession?: { metadata: unknown; playbackState: string } };
      const MM = (window as unknown as { MediaMetadata?: new (init: { title: string; artist: string }) => unknown }).MediaMetadata;
      if (nav.mediaSession && MM) {
        nav.mediaSession.metadata = new MM({
          title: `أذكار ${w === 'morning' ? 'الصباح' : 'المساء'} — ${preview(c.display, 40)}`,
          artist: isRecitation(c, stateRef.current.voice) ? `تلاوة — ${adhkarReciterLabel(c, reciter)}` : 'صوت مولّد بالذكاء الاصطناعي',
        });
      }
      if (nav.mediaSession) nav.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch { /* ignore */ }
  }, [reciter]);

  const savePosition = useCallback((w: AdhkarWird, i: number, r: number) => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ v: POS_VERSION, wird: w, index: i, rep: r }));
    } catch { /* ignore */ }
  }, []);

  const loadClip = useCallback((c: AdhkarClip, v: AdhkarVoice, el: HTMLAudioElement) => {
    const url = segmentsFor(c, v, reciter)[0];
    if (el.src !== url) {
      el.src = url;
      el.load();
    }
    setSeg(0);
    setProgress({ t: 0, d: 0 });
  }, [reciter]);

  const handlePreempted = useCallback(() => {
    // Capture the live preempt point (only when actually playing).
    if (stateRef.current.playing) {
      let time = 0;
      try {
        const t = elRef.current?.currentTime;
        if (typeof t === 'number' && Number.isFinite(t) && t >= 0) time = t;
      } catch {
        // ignore: time stays 0
      }
      preemptedRef.current = { index: stateRef.current.index, rep: stateRef.current.rep, seg: stateRef.current.seg, time };
    } else {
      preemptedRef.current = null;
    }
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
        // More segments left in this repetition (Quranic items chain
        // several ayah files per rep): advance within the rep.
        if (s.seg + 1 < s.segments.length) {
          const nextSeg = s.seg + 1;
          setSeg(nextSeg);
          el.src = s.segments[nextSeg];
          el.load();
          void el.play().catch(() => setPlaying(false));
          return;
        }
        if (s.rep < cur.count) {
          const nextRep = s.rep + 1;
          setPos({ index: s.index, rep: nextRep });
          setSeg(0);
          savePosition(s.wird, s.index, nextRep);
          el.src = s.segments[0];
          el.load();
          void el.play().catch(() => setPlaying(false));
        } else if (s.index + 1 < s.list.length) {
          const nextIndex = s.index + 1;
          setPos({ index: nextIndex, rep: 1 });
          setSeg(0);
          savePosition(s.wird, nextIndex, 1);
          const next = s.list[nextIndex];
          if (next) {
            el.src = segmentsFor(next, s.voice, reciter)[0];
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
  }, [handlePreempted, savePosition, setMediaSession, reciter]);

  // Persist position on change (not after completion).
  useEffect(() => {
    if (!completed) savePosition(wird, index, rep);
  }, [wird, index, rep, completed, savePosition]);

  // Pause + release on unmount (return resumes via saved position).
  useEffect(() => {
    return () => {
      // Teardown (logout): no resume may fire after this page is
      // gone — clear the stack BEFORE any release below.
      clearResumeStack();
      unregisterResume('adhkar');
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

  // Resume from a captured position (preempted or hidden):
  // reload the captured segment, seek to the captured time,
  // play. Used by the show effect and the anywhere-resume
  // dispatcher. On failure the caller keeps tap-resume (position
  // stays persisted); nothing throws.
  const resumeAdhkarFrom = useCallback((cap: { index: number; rep: number; seg: number; time: number }): void => {
    try {
      const s = stateRef.current;
      const target = s.list[cap.index];
      if (!target) return;
      setCompleted(false);
      setError(null);
      setPos({ index: cap.index, rep: cap.rep });
      setSeg(cap.seg);
      savePosition(s.wird, cap.index, cap.rep);
      const el = ensureElement();
      const segs = segmentsFor(target, s.voice, reciter);
      const url = segs[Math.min(cap.seg, segs.length - 1)];
      if (!url) return;
      if (el.src !== url) {
        el.src = url;
        el.load();
      }
      const seekAndPlay = (): void => {
        try {
          if (Number.isFinite(cap.time) && cap.time > 0) {
            const d = el.duration;
            el.currentTime = Number.isFinite(d) && d > 0 ? Math.min(cap.time, d) : cap.time;
          }
        } catch {
          // ignore: play from 0
        }
        setMediaSession(target, s.wird, true);
        void el.play().then(() => setPlaying(true)).catch(() => {
          setPlaying(false);
          setError('تعذر استئناف التشغيل — اضغط تشغيل مرة أخرى.');
        });
      };
      try {
        if (el.readyState >= 1) seekAndPlay();
        else el.addEventListener('loadedmetadata', seekAndPlay, { once: true });
      } catch {
        seekAndPlay();
      }
    } catch {
      // ignore
    }
  }, [ensureElement, reciter, savePosition, setMediaSession]);

  // Anywhere-resume dispatcher target: one-shot capture, cleared
  // after use. No capture means paused, not playing, at preempt.
  const adhkarResume = useCallback((): void => {
    const cap = preemptedRef.current;
    if (!cap) return;
    preemptedRef.current = null;
    resumeAdhkarFrom(cap);
  }, [resumeAdhkarFrom]);

  useEffect(() => {
    registerResume('adhkar', adhkarResume);
    return () => {
      unregisterResume('adhkar');
    };
  }, [adhkarResume]);

  // Route show/hide (App keeps this page mounted while hidden).
  // Hiding pauses (no release: the element must stay preemptable
  // so closing the preemptor can stack-resume this page) and
  // saves a one-time intent. Showing resumes from it: fast path
  // when still holding the element (hide-pause preserved src
  // and time), otherwise full reload from the intent.
  useEffect(() => {
    const wasVisible = prevVisibleRef.current;
    prevVisibleRef.current = visible;
    if (wasVisible === visible) return;
    if (!visible) {
      try {
        const s = stateRef.current;
        if (s.playing) {
          let time = 0;
          try {
            const t = elRef.current?.currentTime;
            if (typeof t === 'number' && Number.isFinite(t) && t >= 0) time = t;
          } catch {
            // ignore: time stays 0
          }
          writeAdhkarIntent({ seg: s.seg, time, at: Date.now() });
          pause();
          // Anywhere-resume: same rule as Listen — leaving closes
          // for stack purposes only when someone waits.
          if (hasWaitingResumes()) releaseAudio('adhkar');
        } else {
          clearAdhkarIntent();
        }
      } catch {
        // ignore
      }
      return;
    }
    // Showing.
    const intent = readAdhkarIntent();
    if (!intent) {
      // No intent, but a stack-resume while hidden may already be
      // playing — sync UI to reality.
      try {
        setPlaying(stateRef.current.playing);
      } catch {
        // ignore
      }
      return;
    }
    clearAdhkarIntent();
    try {
      const s = stateRef.current;
      if (currentAudioOwner() === 'adhkar' && elRef.current) {
        // Still holding the element: exact instant resume.
        const el = elRef.current;
        const cur = s.list[s.index];
        if (cur) setMediaSession(cur, s.wird, true);
        void el.play().then(() => setPlaying(true)).catch(() => {
          try {
            writeAdhkarIntent(intent);
          } catch {
            // ignore
          }
          setPlaying(false);
        });
        return;
      }
      resumeAdhkarFrom({ index: s.index, rep: s.rep, seg: intent.seg, time: intent.time });
    } catch {
      // ignore
    }
  }, [visible]);

  const jumpTo = useCallback((i: number, autoplay: boolean) => {
    const target = Math.max(0, Math.min(i, list.length - 1));
    setCompleted(false);
    setError(null);
    setPos({ index: target, rep: 1 });
    setSeg(0);
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
    setSeg(0);
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
    setSeg(0);
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
    setSeg(0);
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
          <span className="text-xs font-bold bg-amber-100 text-amber-800 px-2 py-1 rounded-full">تلاوة وصوت مولّد</span>
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
              <p className="mt-1">
                {isRecitation(clip, voice) ? (
                  <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full">تلاوة — {adhkarReciterLabel(clip, reciter)}</span>
                ) : (
                  <span className="text-xs font-bold bg-amber-100 text-amber-800 px-2 py-1 rounded-full">صوت مولّد بالذكاء الاصطناعي</span>
                )}
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
              {isRecitation(item, voice) && (
                <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full">تلاوة</span>
              )}
              <span className="text-xs font-bold bg-stone-100 text-stone-600 px-2 py-1 rounded-full">×{item.count}</span>
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-stone-500 mt-4">
          آيات القرآن تُتلى بصوت قارئ، والأدعية بصوت مولّد بالذكاء الاصطناعي. التكرار يتم في المشغّل.
        </p>
      </div>
    </main>
  );
}
