import { roomLabel } from '../lib/roomLabel';
import DrumSelect from '../components/DrumSelect';
import Hint from '../components/Hint';
import { useEffect, useRef, useState } from 'react';
import type { Session, RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { SURAHS, SURAH_AYAH_COUNTS, surahLabel } from '../lib/surahs';
import { pressFeedback } from '../lib/pressFeedback';
import QRCode from 'qrcode';
import { editionPageUrl } from '../lib/pageDownload';
import { getSurahStartPage, TOTAL_MUSHAF_PAGES } from '../lib/mushafEditions';
import { getQuranTextCache } from '../lib/quranTextCache';
import { downloadAdhanVoice, isAdhanVoiceDownloaded, getAdhanVoice, playAdhanSound, ADHAN_PRAYERS, ensureAdhanDay, loadAdhanSettings, timeInTimezone, type AdhanLocation, type AdhanDay } from '../lib/adhan';
import { CORR_RECITERS, reciterWordTimings, reciterAyahUrl } from '../lib/juhaniCorr';
import { Users, Copy, BookOpen, LogOut, Send, Mic, MicOff, PhoneOff } from 'lucide-react';

// «راجع مع الرفيق»: a shared room between two people, joined by a code.
// No accounts yet (the code is the key). Position, chat and the voice
// call's signaling travel over Supabase Realtime broadcast; nothing is
// stored in the database. Voice is a direct browser-to-browser WebRTC
// connection (free STUN only, no TURN relay yet). Last write wins for
// the position.

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const STUN_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

// page: when set, the TV shows that Madinah mushaf page (phone turns pages).
// tasbih: when set, the TV shows the phrase and count (phone is the sabha).
type Tasbih = { phrase: string; count: number; font?: number; frame?: number };
type Khatma = { reciter: string; playing: boolean };
type HomeBoard = { loc: AdhanLocation; voice?: string };
type Pos = { surah: number; ayah: number; by: string; at: number; page?: number; tasbih?: Tasbih; khatma?: Khatma; home?: HomeBoard };
// Home board adhkar: morning (Fajr -> Asr), evening (Asr -> Isha), else tasbih.
const MORNING_ADHKAR = [
  'أصبحنا وأصبح الملك لله، والحمد لله',
  'اللهم بك أصبحنا وبك أمسينا وبك نحيا وبك نموت وإليك النشور',
  'رضيت بالله ربًا وبالإسلام دينًا وبمحمد ﷺ نبيًا',
  'بسم الله الذي لا يضر مع اسمه شيء في الأرض ولا في السماء وهو السميع العليم',
  'سبحان الله وبحمده',
];
const EVENING_ADHKAR = [
  'أمسينا وأمسى الملك لله، والحمد لله',
  'اللهم بك أمسينا وبك أصبحنا وبك نحيا وبك نموت وإليك المصير',
  'أعوذ بكلمات الله التامات من شر ما خلق',
  'رضيت بالله ربًا وبالإسلام دينًا وبمحمد ﷺ نبيًا',
  'بسم الله الذي لا يضر مع اسمه شيء في الأرض ولا في السماء وهو السميع العليم',
];
const toMin = (hhmm: string) => { const [h, m] = hhmm.slice(0, 5).split(':').map(Number); return h * 60 + m; };
// Sabha board styles (2026-11-09): Arabic display fonts + ornamental frames.
const DHIKR_FONTS = [
  { name: 'أميري', css: "'Amiri', serif" },
  { name: 'رقعة', css: "'Aref Ruqaa', serif" },
  { name: 'كوفي', css: "'Reem Kufi', sans-serif" },
  { name: 'نسخ', css: "'Scheherazade New', serif" },
  { name: 'لطيف', css: "'Lateef', serif" },
  { name: 'نستعليق', css: "'Noto Nastaliq Urdu', serif" },
];
const DHIKR_FRAMES = ['ذهبي', 'مزخرف', 'هادئ', 'بدون'];
const DHIKR_FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Amiri:wght@700&family=Aref+Ruqaa:wght@700&family=Reem+Kufi:wght@700&family=Scheherazade+New:wght@700&family=Lateef:wght@700&family=Noto+Nastaliq+Urdu:wght@700&display=swap';
function DhikrFrame({ frame, children }: { frame: number; children: React.ReactNode }) {
  if (frame === 3) return <div className="w-full px-8">{children}</div>;
  const outer = frame === 0
    ? 'border-[10px] border-double border-amber-400 shadow-[0_0_60px_rgba(246,210,122,.35)]'
    : frame === 1
      ? 'border-[6px] border-amber-300 outline outline-[3px] outline-offset-[14px] outline-amber-500/70 shadow-[inset_0_0_80px_rgba(246,210,122,.25)]'
      : 'border-2 border-emerald-300/40';
  return (
    <div className={`relative w-[94vw] min-h-[70vh] flex items-center justify-center rounded-[3rem] px-12 py-16 bg-gradient-to-b from-emerald-900/60 to-emerald-950 ${outer}`}>
      {frame === 1 && ['top-4 right-4', 'top-4 left-4', 'bottom-4 right-4', 'bottom-4 left-4'].map((c) => (
        <span key={c} className={`absolute ${c} text-6xl text-amber-400`}>۞</span>
      ))}
      {children}
    </div>
  );
}
const ROOM_TASBIH = ['سبحان الله', 'الحمد لله', 'الله أكبر', 'لا إله إلا الله', 'أستغفر الله'];
type Msg = { id: string; by: string; text: string; at: number };
type VoiceApi = { start: () => Promise<void>; stop: () => void; setMuted: (m: boolean) => void };

function newCode(): string {
  const bytes = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const n of bytes) out += CODE_ALPHABET[n % CODE_ALPHABET.length];
  return out;
}

function isValidCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

function connectionText(state: RTCPeerConnectionState): string {
  if (state === 'connected') return 'الصوت متصل';
  if (state === 'failed' || state === 'disconnected' || state === 'closed') return 'الاتصال الصوتي انقطع';
  return 'جاري الاتصال الصوتي...';
}

type Props = {
  session: Session | null;
  onNavigate: (r: 'mushaf' | 'home') => void;
};

export default function SharedRoomPage({ session, onNavigate }: Props) {
  const [me] = useState(
    () => session?.user?.id?.slice(0, 8) ?? Math.random().toString(36).slice(2, 8),
  );
  // TV mode: opened as #/room?view=tv on the TV browser. It makes its own
  // code and shows it big; the phone joins with that code and acts as the remote.
  const tvView = typeof window !== 'undefined' && window.location.hash.includes('view=tv');
  // Phone scanned the TV's QR: #/room?join=CODE joins at once (2026-11-09).
  const joinFromLink = (() => {
    if (typeof window === 'undefined') return null;
    const m = /[?&]join=([A-Z0-9]{6})/i.exec(window.location.hash);
    return m && isValidCode(m[1].toUpperCase()) ? m[1].toUpperCase() : null;
  })();
  const [code, setCode] = useState<string | null>(() => (tvView ? newCode() : joinFromLink));
  const [tvQr, setTvQr] = useState('');
  // TV sabha: idle -> slideshow of the five adhkar; soft tick on each count.
  const [tvIdle, setTvIdle] = useState(false);
  const [slide, setSlide] = useState(0);
  const tickCtxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!tvView || !code) return;
    const url = `${window.location.origin}/#/room?join=${code}`;
    void QRCode.toDataURL(url, { width: 360, margin: 1 }).then(setTvQr).catch(() => setTvQr(''));
  }, [tvView, code]);
  const [joinInput, setJoinInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [members, setMembers] = useState(0);
  const [pos, setPos] = useState<Pos>({ surah: 1, ayah: 1, by: '', at: 0 });
  useEffect(() => {
    if (!tvView) return;
    if (!document.getElementById('dhikr-fonts')) {
      const l = document.createElement('link');
      l.id = 'dhikr-fonts'; l.rel = 'stylesheet'; l.href = DHIKR_FONTS_HREF;
      document.head.appendChild(l);
    }
  }, [tvView]);
  const tvCount = pos.tasbih?.count ?? -1;
  useEffect(() => {
    if (!tvView || !pos.tasbih) return;
    setTvIdle(false);
    // Soft wooden tick on the TV (may be muted until the TV page was
    // interacted with; the phone gives its own tap feedback anyway).
    if (pos.tasbih.count > 0) {
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = tickCtxRef.current || new AC();
        tickCtxRef.current = ctx;
        const t = ctx.currentTime;
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(520, t);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.14);
      } catch { /* no audio on this TV */ }
    }
    const idle = setTimeout(() => setTvIdle(true), 20000);
    return () => clearTimeout(idle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvView, tvCount, pos.at]);
  useEffect(() => {
    if (!tvIdle) return;
    const iv = setInterval(() => setSlide((n) => (n + 1) % (ROOM_TASBIH.length * DHIKR_FONTS.length)), 5000);
    return () => clearInterval(iv);
  }, [tvIdle]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);

  const [voiceOn, setVoiceOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [voiceError, setVoiceError] = useState('');

  const channelRef = useRef<RealtimeChannel | null>(null);
  const voiceApiRef = useRef<VoiceApi | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const posRef = useRef(pos);
  // TV mode: show the ayah text itself (not only the number), read from the local text cache.
  const [tvAyahText, setTvAyahText] = useState<string>('');
  useEffect(() => {
    if (!tvView) return;
    let cancelled = false;
    const count = SURAH_AYAH_COUNTS[pos.surah - 1] ?? 0;
    void getQuranTextCache()
      .getSurah(pos.surah, count)
      .then((rows) => {
        if (cancelled) return;
        const row = rows?.find((r) => r.ayah_no === pos.ayah);
        setTvAyahText(row?.ayah_text ?? '');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.surah, pos.ayah]);
  // TV khatma: the TV plays the reciter ayah by ayah, highlights the word
  // being recited (cpfair timings; proportional fallback), and moves on.
  const khAudioRef = useRef<HTMLAudioElement | null>(null);
  const [khWord, setKhWord] = useState(-1);
  const [khBlocked, setKhBlocked] = useState(false);
  const kh = pos.khatma;
  useEffect(() => {
    if (!tvView || !kh) { khAudioRef.current?.pause(); setKhWord(-1); return; }
    const a = khAudioRef.current || new Audio();
    khAudioRef.current = a;
    if (!kh.playing) { a.pause(); return; }
    let cancelled = false;
    let times: number[] | null = null;
    void reciterWordTimings(kh.reciter, pos.surah, pos.ayah).then((t) => { times = t; });
    const words = () => (tvAyahText ? tvAyahText.split(/\s+/).filter(Boolean).length : 0);
    a.src = reciterAyahUrl(kh.reciter, pos.surah, pos.ayah);
    a.ontimeupdate = () => {
      const n = words(); if (!n) return;
      const t = a.currentTime;
      let w = -1;
      if (times && times.length === n * 2) {
        for (let i = 0; i < n; i++) if (t >= times[i * 2] - 0.05) w = i;
      } else if (a.duration > 0) {
        w = Math.min(n - 1, Math.floor((t / a.duration) * n));
      }
      setKhWord(w);
    };
    a.onended = () => {
      if (cancelled) return;
      const count = SURAH_AYAH_COUNTS[pos.surah - 1] ?? 0;
      const next = pos.ayah < count ? { surah: pos.surah, ayah: pos.ayah + 1 } : pos.surah < 114 ? { surah: pos.surah + 1, ayah: 1 } : null;
      if (next) sendPos({ ...next, khatma: kh }); else sendPos({ surah: pos.surah, ayah: pos.ayah, khatma: { ...kh, playing: false } });
    };
    setKhWord(-1);
    a.play().then(() => setKhBlocked(false)).catch(() => setKhBlocked(true));
    return () => { cancelled = true; a.onended = null; a.ontimeupdate = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvView, kh?.reciter, kh?.playing, pos.surah, pos.ayah, tvAyahText]);
  // TV home board: clock, prayer times + countdown, adhkar by time of day.
  const [homeDay, setHomeDay] = useState<AdhanDay | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const homeLocKey = pos.home ? JSON.stringify(pos.home.loc) : '';
  useEffect(() => {
    if (!tvView || !pos.home) return;
    let off = false;
    const load = () => { void ensureAdhanDay(pos.home!.loc).then((d) => { if (!off) setHomeDay(d); }).catch(() => {}); };
    load();
    // TV keeps its own offline copy of the chosen adhan voice.
    const vid = pos.home.voice || 'makkah';
    void isAdhanVoiceDownloaded(vid).then((y) => { if (!y) void downloadAdhanVoice(vid); });
    const iv = setInterval(() => { setNowTick((n) => n + 1); }, 1000);
    const daily = setInterval(load, 30 * 60 * 1000);
    return () => { off = true; clearInterval(iv); clearInterval(daily); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvView, homeLocKey]);
  // Adhan on the TV at each prayer time (once per prayer per day).
  const [adhanNow, setAdhanNow] = useState('');
  const adhanFiredRef = useRef('');
  const adhanAudioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!tvView || !pos.home || !homeDay) return;
    const nowStr = timeInTimezone(homeDay.timezone);
    const p = ADHAN_PRAYERS.find((x) => homeDay.timings[x.key]?.slice(0, 5) === nowStr);
    if (!p) return;
    const key = `${homeDay.dateKey}:${p.key}`;
    if (adhanFiredRef.current === key) return;
    adhanFiredRef.current = key;
    setAdhanNow(p.label);
    const a = playAdhanSound('full', pos.home.voice);
    adhanAudioRef.current = a;
    const done = () => setAdhanNow('');
    if (a) a.onended = done;
    const t = setTimeout(done, 5 * 60 * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTick]);  posRef.current = pos;

  useEffect(() => {
    if (!code) return;
    const ch = supabase.channel(`room-${code}`, {
      config: { broadcast: { self: false }, presence: { key: me } },
    });
    channelRef.current = ch;

    const send = (event: string, payload: Record<string, unknown>) => {
      ch.send({ type: 'broadcast', event, payload });
    };

    // ---- voice (WebRTC) state, private to this room session ----
    let stream: MediaStream | null = null;
    let pc: RTCPeerConnection | null = null;
    let voiceEnabled = false;
    let pendingIce: RTCIceCandidateInit[] = [];

    const teardownPc = () => {
      pc?.close();
      pc = null;
      pendingIce = [];
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    };

    const buildPc = (): RTCPeerConnection => {
      const c = new RTCPeerConnection({ iceServers: STUN_SERVERS });
      if (stream) stream.getTracks().forEach((t) => c.addTrack(t, stream as MediaStream));
      c.ontrack = (e) => {
        const el = remoteAudioRef.current;
        if (el) {
          el.srcObject = e.streams[0];
          el.play().catch(() => { /* browser may wait for a tap; the call button is a tap */ });
        }
      };
      c.onicecandidate = (e) => {
        if (e.candidate) send('ice', { candidate: e.candidate.toJSON(), by: me });
      };
      c.onconnectionstatechange = () => setVoiceStatus(connectionText(c.connectionState));
      pc = c;
      return c;
    };

    const flushIce = async (c: RTCPeerConnection) => {
      for (const cand of pendingIce) await c.addIceCandidate(cand).catch(() => {});
      pendingIce = [];
    };

    const makeOffer = async () => {
      const c = buildPc();
      const offer = await c.createOffer();
      await c.setLocalDescription(offer);
      send('sdp', { type: 'offer', sdp: offer.sdp, by: me });
    };

    ch.on('broadcast', { event: 'pos' }, ({ payload }) => {
      setPos(payload as Pos);
    })
      .on('broadcast', { event: 'msg' }, ({ payload }) => {
        setMsgs((prev) => [...prev.slice(-99), payload as Msg]);
      })
      .on('broadcast', { event: 'voice-ready' }, async ({ payload }) => {
        const p = payload as { by: string };
        if (!voiceEnabled || pc) return;
        // The smaller id makes the offer; the larger answers with a ready
        // ping so the smaller side knows to start.
        if (me < p.by) await makeOffer();
        else send('voice-ready', { by: me });
      })
      .on('broadcast', { event: 'sdp' }, async ({ payload }) => {
        const p = payload as { type: 'offer' | 'answer'; sdp: string };
        if (!voiceEnabled) return;
        if (p.type === 'offer') {
          const c = pc ?? buildPc();
          await c.setRemoteDescription({ type: 'offer', sdp: p.sdp });
          await flushIce(c);
          const answer = await c.createAnswer();
          await c.setLocalDescription(answer);
          send('sdp', { type: 'answer', sdp: answer.sdp, by: me });
        } else if (pc) {
          await pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
          await flushIce(pc);
        }
      })
      .on('broadcast', { event: 'ice' }, async ({ payload }) => {
        const p = payload as { candidate: RTCIceCandidateInit };
        if (!voiceEnabled) return;
        if (pc && pc.remoteDescription) await pc.addIceCandidate(p.candidate).catch(() => {});
        else pendingIce.push(p.candidate);
      })
      .on('broadcast', { event: 'voice-off' }, () => {
        teardownPc();
        setVoiceStatus('الرفيق قفل الصوت');
      })
      .on('presence', { event: 'sync' }, () => {
        setMembers(Object.keys(ch.presenceState()).length);
      })
      .on('presence', { event: 'join' }, () => {
        // A newcomer needs the current position; whoever is here sends it.
        if (posRef.current.at > 0) send('pos', posRef.current as unknown as Record<string, unknown>);
        if (voiceEnabled) send('voice-ready', { by: me });
      })
      .on('presence', { event: 'leave' }, () => {
        teardownPc();
        setVoiceStatus('');
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await ch.track({ at: Date.now() });
      });

    voiceApiRef.current = {
      start: async () => {
        if (voiceEnabled) return;
        setVoiceError('');
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
        } catch {
          setVoiceError('لازم تسمح للمتصفح يستخدم المايك عشان الصوت يشتغل');
          return;
        }
        voiceEnabled = true;
        setVoiceOn(true);
        setMuted(false);
        setVoiceStatus('مستني الرفيق يدخل الصوت...');
        send('voice-ready', { by: me });
      },
      stop: () => {
        voiceEnabled = false;
        teardownPc();
        stream?.getTracks().forEach((t) => t.stop());
        stream = null;
        setVoiceOn(false);
        setMuted(false);
        setVoiceStatus('');
        send('voice-off', { by: me });
      },
      setMuted: (m: boolean) => {
        stream?.getAudioTracks().forEach((t) => { t.enabled = !m; });
      },
    };

    return () => {
      voiceApiRef.current = null;
      voiceEnabled = false;
      teardownPc();
      stream?.getTracks().forEach((t) => t.stop());
      channelRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [code, me]);

  const sendPos = (next: { surah: number; ayah: number; page?: number; tasbih?: Tasbih; khatma?: Khatma; home?: HomeBoard }) => {
    const p: Pos = { ...next, by: me, at: Date.now() };
    setPos(p);
    channelRef.current?.send({ type: 'broadcast', event: 'pos', payload: p });
  };

  const [homeMsg, setHomeMsg] = useState('');
  const startHomeBoard = () => {
    setHomeMsg('');
    const saved = loadAdhanSettings().location;
    if (saved) { sendPos({ surah: pos.surah, ayah: pos.ayah, home: { loc: saved, voice: getAdhanVoice().id } }); return; }
    if (!navigator.geolocation) { setHomeMsg('حدد مدينتك من إعدادات الأذان الأول'); return; }
    navigator.geolocation.getCurrentPosition(
      (g) => sendPos({ surah: pos.surah, ayah: pos.ayah, home: { loc: { kind: 'gps', lat: g.coords.latitude, lng: g.coords.longitude, label: 'موقعي' }, voice: getAdhanVoice().id } }),
      () => setHomeMsg('محتاج إذن الموقع، أو حدد مدينتك من إعدادات الأذان'),
      { timeout: 10000 },
    );
  };

  const joinRoom = () => {
    const c = joinInput.trim().toUpperCase();
    if (!isValidCode(c)) {
      setJoinError('الكود لازم يكون 6 حروف أو أرقام زي ما بيظهر عند صاحب الغرفة');
      return;
    }
    setJoinError('');
    setPos({ surah: 1, ayah: 1, by: '', at: 0 });
    setMsgs([]);
    setCode(c);
  };

  const createRoom = () => {
    setPos({ surah: 1, ayah: 1, by: '', at: 0 });
    setMsgs([]);
    setCode(newCode());
  };

  const leaveRoom = () => {
    voiceApiRef.current?.stop();
    setVoiceOn(false);
    setMuted(false);
    setVoiceStatus('');
    setCode(null);
    setMembers(0);
    setMsgs([]);
  };

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const ayahCount = SURAH_AYAH_COUNTS[pos.surah - 1] ?? 1;
  const surahName = SURAHS.find((s) => s.no === pos.surah) ? surahLabel(pos.surah) : '';

  const moveAyah = (delta: number) => {
    let s = pos.surah;
    let a = pos.ayah + delta;
    if (a < 1 && s > 1) {
      s -= 1;
      a = SURAH_AYAH_COUNTS[s - 1];
    } else if (a > ayahCount && s < 114) {
      s += 1;
      a = 1;
    }
    a = Math.min(Math.max(a, 1), SURAH_AYAH_COUNTS[s - 1]);
    sendPos({ surah: s, ayah: a });
  };

  const sendMessage = () => {
    const text = draft.trim();
    if (!text || !channelRef.current) return;
    const m: Msg = { id: `${Date.now()}-${me}`, by: me, text, at: Date.now() };
    channelRef.current.send({ type: 'broadcast', event: 'msg', payload: m });
    setMsgs((prev) => [...prev.slice(-99), m]);
    setDraft('');
  };

  const openInMushaf = () => {
    try {
      localStorage.setItem('quran-mushaf-target', JSON.stringify({ surah: pos.surah, ayah: pos.ayah }));
    } catch { /* ignore */ }
    onNavigate('mushaf');
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    voiceApiRef.current?.setMuted(next);
  };

  // The audio element stays mounted in every room state so the call can
  // attach to it without remounting.
  const audioEl = <audio ref={remoteAudioRef} autoPlay playsInline />;

  if (!code) {
    return (
      <div dir="rtl" className="max-w-xl mx-auto px-4 py-6 space-y-5">
        <h1 className="text-2xl font-bold text-emerald-800 flex items-center gap-2">
          <Users className="w-6 h-6" /> {roomLabel()}
        </h1>
        <p className="text-slate-600 text-base">صوت أو كتابة</p>

        <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 space-y-3">
          <p className="font-semibold text-emerald-900">لو إنت اللي هتبدأ</p>
          <button
            onPointerDown={pressFeedback}
            onClick={createRoom}
            className="w-full py-4 bg-emerald-600 text-white font-bold rounded-xl text-lg"
          >
            ابدأ
          </button>
          <p className="text-sm text-emerald-800">هيطلع لك كود — ابعته لصديقك</p>
        </div>

        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 space-y-3">
          <p className="font-semibold text-amber-900">لو صديقك هو اللي بدأ</p>
          <p className="text-sm text-amber-800">خليه يبعت لك الكود ودخّله هنا</p>
          <input
            aria-label="كود الغرفة"
            value={joinInput}
            onChange={(e) => setJoinInput(e.target.value)}
            maxLength={CODE_LENGTH}
            placeholder="مثال: K7P2QX"
            dir="ltr"
            className="w-full border rounded-lg px-3 py-3 text-center text-xl tracking-widest uppercase bg-white"
          />
          {joinError && <p className="text-sm text-red-600">{joinError}</p>}
          <button
            onPointerDown={pressFeedback}
            onClick={joinRoom}
            className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl"
          >
            ادخل
          </button>
        </div>
        {audioEl}
      </div>
    );
  }

  if (tvView) {
    return (
      <div dir="rtl" className="min-h-screen bg-emerald-950 text-white flex flex-col items-center justify-center gap-8 p-10 text-center">
        {pos.home ? (() => {
          void nowTick;
          const tz = homeDay?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
          const nowStr = timeInTimezone(tz);
          const nowM = toMin(nowStr);
          const secs = new Date().getSeconds();
          const times = ADHAN_PRAYERS.map((p) => ({ ...p, t: homeDay?.timings[p.key]?.slice(0, 5) || '' }));
          const next = times.find((p) => p.t && toMin(p.t) > nowM) || times[0];
          let left = next.t ? toMin(next.t) - nowM : 0; if (left <= 0) left += 1440;
          const leftS = left * 60 - secs;
          const hh = Math.floor(leftS / 3600), mm = Math.floor((leftS % 3600) / 60), ss = leftS % 60;
          const fajr = toMin(times[0].t || '05:00'), asr = toMin(times[2].t || '15:00'), isha = toMin(times[4].t || '19:00');
          const list = nowM >= fajr && nowM < asr ? MORNING_ADHKAR : nowM >= asr && nowM < isha ? EVENING_ADHKAR : ROOM_TASBIH;
          const label = list === MORNING_ADHKAR ? 'أذكار الصباح' : list === EVENING_ADHKAR ? 'أذكار المساء' : 'تسبيح';
          const idx = Math.floor(Date.now() / 10000) % list.length;
          const p2 = (n: number) => String(n).padStart(2, '0');
          return (
            <>
              <div className="w-[94vw] flex items-start justify-between">
                <div className="text-right">
                  <p className="text-[7vw] font-bold leading-none" dir="ltr">{nowStr}</p>
                  {homeDay?.hijri && <p className="text-3xl opacity-70 mt-2">{homeDay.hijri}</p>}
                </div>
                <div className="text-left">
                  <p className="text-3xl opacity-80">باقي على {next.label}</p>
                  <p className="text-[5vw] font-bold text-amber-300 leading-none" dir="ltr">{p2(hh)}:{p2(mm)}:{p2(ss)}</p>
                </div>
              </div>
              <DhikrFrame frame={1}>
                {adhanNow ? (
                  <div>
                    <p className="text-[4vw] text-amber-200/90">حان الآن موعد أذان</p>
                    <p className="text-[10vw] font-bold text-amber-300 leading-tight" style={{ fontFamily: DHIKR_FONTS[0].css }}>{adhanNow}</p>
                    <button onClick={() => { adhanAudioRef.current?.pause(); setAdhanNow(''); }} className="mt-4 px-8 py-3 rounded-2xl bg-white/15 text-2xl">إيقاف الأذان</button>
                  </div>
                ) : (
                <div>
                  <p className="text-3xl text-amber-200/80 mb-4">{label}</p>
                  <p key={`${label}${idx}`} style={{ fontFamily: DHIKR_FONTS[0].css }} className="text-[5.5vw] leading-snug font-bold text-amber-200 animate-[dhikrSlide_10s_ease-in-out]">{list[idx]}</p>
                </div>
                )}
              </DhikrFrame>
              <style>{`@keyframes dhikrSlide { 0% { opacity: 0 } 10% { opacity: 1 } 90% { opacity: 1 } 100% { opacity: 0 } }`}</style>
              <div className="w-[94vw] grid grid-cols-5 gap-4">
                {times.map((p) => (
                  <div key={p.key} className={`rounded-2xl py-3 ${p.key === next.key ? 'bg-amber-400 text-emerald-950' : 'bg-white/10'}`}>
                    <p className="text-3xl font-bold">{p.label}</p>
                    <p className="text-4xl" dir="ltr">{p.t || '--:--'}</p>
                  </div>
                ))}
              </div>
              <p className="fixed bottom-2 left-4 text-lg opacity-50" dir="ltr">{code}</p>
            </>
          );
        })() : kh ? (
          <>
            <p className="fixed top-3 left-4 text-xl opacity-60" dir="ltr">{code}</p>
            <p className="text-4xl font-bold opacity-90">سورة {surahName} • الآية {pos.ayah.toLocaleString('ar-EG')}</p>
            <p className="text-[5.5vw] leading-[1.9] font-bold max-w-[92vw] mx-auto font-display-ar">
              {(tvAyahText || '').split(/\s+/).filter(Boolean).map((w, i) => (
                <span key={i} className={`inline-block px-2 mx-0.5 rounded-2xl transition-colors duration-200 ${i === khWord ? 'bg-amber-400 text-emerald-950' : i < khWord ? 'text-amber-200' : 'text-white/70'}`}>{w}</span>
              ))}
            </p>
            {khBlocked && kh.playing && (
              <button onClick={() => { void khAudioRef.current?.play().then(() => setKhBlocked(false)).catch(() => {}); }}
                className="mt-6 px-10 py-5 rounded-2xl bg-amber-400 text-emerald-950 text-4xl font-bold">▶ دوس OK بالريموت لتشغيل الصوت</button>
            )}
            {!kh.playing && <p className="text-3xl opacity-60">متوقف مؤقتاً</p>}
          </>
        ) : pos.tasbih ? (
          <>
            <style>{`@keyframes dhikrPulse { 0% { opacity: .15; transform: scale(.94) } 100% { opacity: 1; transform: scale(1) } } @keyframes dhikrSlide { 0% { opacity: 0 } 15% { opacity: 1 } 85% { opacity: 1 } 100% { opacity: 0 } }`}</style>
            <DhikrFrame frame={tvIdle ? Math.floor(slide / ROOM_TASBIH.length) % 3 : (pos.tasbih.frame ?? 0)}>
              {tvIdle ? (
                <p key={`s${slide}`} style={{ fontFamily: DHIKR_FONTS[Math.floor(slide / ROOM_TASBIH.length) % DHIKR_FONTS.length].css }}
                  className="text-[11vw] leading-tight font-bold text-amber-200 animate-[dhikrSlide_5s_ease-in-out]">{ROOM_TASBIH[slide % ROOM_TASBIH.length]}</p>
              ) : (
                <p key={pos.tasbih.count} style={{ fontFamily: DHIKR_FONTS[pos.tasbih.font ?? 0].css }}
                  className="text-[11vw] leading-tight font-bold text-amber-300 animate-[dhikrPulse_0.45s_ease-out]">{pos.tasbih.phrase}</p>
              )}
            </DhikrFrame>
            {!tvIdle && <p className="text-3xl opacity-40">{pos.tasbih.count.toLocaleString('ar-EG')}</p>}
            <p className="fixed bottom-3 left-4 text-xl opacity-60" dir="ltr">{code}</p>
          </>
        ) : pos.page ? (
          <>
            <img src={editionPageUrl('madinah', pos.page)} alt="" className="h-[92vh] w-auto rounded-lg shadow-2xl bg-[#fdf8ec]" />
            <p className="fixed bottom-3 left-4 text-xl opacity-70">صفحة {pos.page} • كود {code}</p>
          </>
        ) : members > 1 ? (
          <>
            <p className="fixed top-3 left-4 text-xl opacity-60" dir="ltr">{code}</p>
            <p className="text-5xl font-bold">سورة {surahName}</p>
            <p className="text-7xl leading-relaxed font-bold text-amber-300 max-w-6xl mx-auto">{tvAyahText || pos.ayah}</p>
            <p className="text-3xl opacity-80 mt-4">الآية {pos.ayah}</p>
          </>
        ) : (<>
        {tvQr && (
          <div className="flex flex-col items-center gap-3">
            <img src={tvQr} alt="" className="w-64 h-64 rounded-2xl bg-white p-3" />
            <p className="text-3xl font-bold text-amber-300">صوّر الكود ده بكاميرا موبايلك</p>
          </div>
        )}
        <p className="text-2xl opacity-80">أو اكتب الكود ده في الموبايل</p>
        <p dir="ltr" className="text-8xl font-bold tracking-[0.3em]">{code}</p>
        <p className="text-3xl opacity-80">الموجودين: {members || 1}</p>
        <div className="mt-6">
          <p className="text-4xl font-bold">سورة {surahName}</p>
          <p className="text-6xl leading-relaxed font-bold text-amber-300 max-w-6xl mx-auto">{tvAyahText || pos.ayah}</p>
          <p className="text-3xl opacity-80 mt-4">الآية {pos.ayah}</p>
        </div>
        </>)}
      </div>
    );
  }

  return (
    <div dir="rtl" className="max-w-xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-emerald-800 flex items-center gap-2">
          <Users className="w-5 h-5" /> {roomLabel()}
        </h1>
        <span className="text-sm text-slate-600">الموجودين: {members || 1}</span>
      </div>

      <div className="bg-white rounded-xl border p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500">كود الغرفة</p>
          <p dir="ltr" className="text-2xl font-bold tracking-widest text-slate-800">{code}</p>
        </div>
        <button onClick={copyCode} className="flex items-center gap-1 px-3 py-2 rounded-lg border text-sm">
          <Copy className="w-4 h-4" /> {copied ? 'اتنسخ' : 'انسخ الكود'}
        </button>
      </div>

      <div className="bg-white rounded-xl border p-4 space-y-2 text-sm text-slate-600">
        <p className="font-semibold text-slate-800">شاشة التلفزيون</p>
        <p>على متصفح التلفزيون افتح الرابط ده (مرة واحدة، وبعدين احفظه):</p>
        <p dir="ltr" className="break-all text-slate-800">{typeof window !== 'undefined' ? `${window.location.host}/tv` : ''}</p>
        <p>التلفزيون هيظهر كود، وانت ادخله هنا عشان تتحكم فيه.</p>
      </div>

      <div className="bg-white rounded-xl border p-4 space-y-3">
        <p className="font-semibold text-slate-800">الصوت</p>
        {!voiceOn ? (
          <button
            onPointerDown={pressFeedback}
            onClick={() => voiceApiRef.current?.start()}
            className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl flex items-center justify-center gap-2"
          >
            <Mic className="w-5 h-5" /> شغّل الصوت
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={toggleMute} className="flex-1 py-3 rounded-lg border font-semibold flex items-center justify-center gap-2">
              {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              {muted ? 'فك الكتم' : 'كتم المايك'}
            </button>
            <button onClick={() => voiceApiRef.current?.stop()} className="flex-1 py-3 rounded-lg bg-red-600 text-white font-semibold flex items-center justify-center gap-2">
              <PhoneOff className="w-4 h-4" /> اقفل الصوت
            </button>
          </div>
        )}
        {voiceStatus && <p className="text-sm text-slate-600">{voiceStatus}</p>}
        {voiceError && <p className="text-sm text-red-600">{voiceError}</p>}
      </div>

      <div className="bg-sky-50 rounded-xl border border-sky-200 p-4 space-y-3">
        <p className="text-lg font-bold text-sky-900">شاشة البيت: مواقيت الصلاة والأذكار</p>
        <p className="text-xs text-sky-800">الساعة، والوقت الباقي على الصلاة الجاية، وأذكار الصباح بعد الفجر والمساء بعد العصر بتتغير لوحدها.</p>
        {homeMsg && <p className="text-xs text-red-600">{homeMsg}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={startHomeBoard} className="min-h-[48px] rounded-xl bg-sky-600 text-white font-bold">{pos.home ? 'حدّث المكان' : 'اعرضها على التلفزيون'}</button>
          <button onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah })} disabled={!pos.home} className="min-h-[48px] rounded-xl border text-sm disabled:opacity-40">اقفلها</button>
        </div>
      </div>

      <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 space-y-3">
        <p className="text-lg font-bold text-amber-900">ختمة بصوت القارئ على الشاشة</p>
        <p className="text-xs text-amber-800">التلفزيون يقرأ من الآية الحالية، والكلمة اللي بتتقري بتنوّر عشان العين تمشي معاها.</p>
        <DrumSelect label="القارئ" value={pos.khatma?.reciter ?? CORR_RECITERS[0].folder}
          onChange={(v) => sendPos({ surah: pos.surah, ayah: pos.ayah, khatma: { reciter: v, playing: pos.khatma?.playing ?? false } })}
          options={CORR_RECITERS.map((r) => ({ value: r.folder, label: r.name }))} />
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah, khatma: { reciter: pos.khatma?.reciter ?? CORR_RECITERS[0].folder, playing: !pos.khatma?.playing } })}
            className="min-h-[48px] rounded-xl bg-amber-500 text-white font-bold">{pos.khatma?.playing ? 'إيقاف مؤقت' : 'شغّل'}</button>
          <button onClick={() => { const c = SURAH_AYAH_COUNTS[pos.surah - 1] ?? 1; sendPos({ surah: pos.surah, ayah: Math.min(c, pos.ayah + 1), khatma: pos.khatma }); }}
            className="min-h-[48px] rounded-xl border text-sm">الآية اللي بعدها</button>
          <button onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah })} disabled={!pos.khatma}
            className="min-h-[48px] rounded-xl border text-sm disabled:opacity-40">اقفل الختمة</button>
        </div>
      </div>

      <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 space-y-3">
        <p className="text-lg font-bold text-emerald-900">السبحة على الشاشة الكبيرة</p>
        {pos.tasbih ? (
          <>
            <button onPointerDown={pressFeedback}
              onClick={() => { try { navigator.vibrate?.(15); } catch { /* ignore */ } sendPos({ surah: pos.surah, ayah: pos.ayah, tasbih: { ...pos.tasbih!, count: pos.tasbih!.count + 1 } }); }}
              className="w-full min-h-[140px] rounded-3xl bg-emerald-700 text-white text-5xl font-bold font-display-ar active:scale-95 transition-transform">
              <span key={pos.tasbih.count} className="inline-block animate-[dhikrPulse_0.45s_ease-out]">{pos.tasbih.phrase}</span>
            </button>
            <style>{`@keyframes dhikrPulse { 0% { opacity: .15; transform: scale(.94) } 100% { opacity: 1; transform: scale(1) } }`}</style>
            <div className="grid grid-cols-3 items-center gap-2">
              <button onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah })} className="min-h-[48px] rounded-xl border text-sm">اقفل السبحة</button>
              <span className="text-center text-xl text-emerald-700/70">{pos.tasbih.count.toLocaleString('ar-EG')}</span>
              <button onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah, tasbih: { ...pos.tasbih!, count: 0 } })} className="min-h-[48px] rounded-xl border-2 text-sm font-semibold">ابدأ من جديد</button>
            </div>
            <p className="text-sm font-semibold text-emerald-900">الخط</p>
            <div className="grid grid-cols-3 gap-2">
              {DHIKR_FONTS.map((f, i) => (
                <button key={f.name} onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah, tasbih: { ...pos.tasbih!, font: i } })}
                  className={`min-h-[44px] rounded-lg border text-sm ${((pos.tasbih!.font ?? 0) === i) ? 'bg-emerald-700 text-white' : 'bg-white'}`}>{f.name}</button>
              ))}
            </div>
            <p className="text-sm font-semibold text-emerald-900">الإطار</p>
            <div className="grid grid-cols-4 gap-2">
              {DHIKR_FRAMES.map((f, i) => (
                <button key={f} onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah, tasbih: { ...pos.tasbih!, frame: i } })}
                  className={`min-h-[44px] rounded-lg border text-sm ${((pos.tasbih!.frame ?? 0) === i) ? 'bg-amber-500 text-white' : 'bg-white'}`}>{f}</button>
              ))}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {ROOM_TASBIH.map((ph) => (
              <button key={ph} onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah, tasbih: { phrase: ph, count: 0, font: pos.tasbih?.font, frame: pos.tasbih?.frame } })}
                className="min-h-[52px] rounded-xl bg-white border-2 border-emerald-200 font-bold text-emerald-900">{ph}</button>
            ))}
          </div>
        )}
      </div>

      <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 space-y-3">
        <p className="text-lg font-bold text-amber-900">المصحف على الشاشة الكبيرة</p>
        {pos.page ? (
          <>
            <p className="text-center text-2xl font-bold text-amber-900">صفحة {pos.page}</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah, page: Math.max(1, (pos.page || 1) - 1) })} className="min-h-[64px] rounded-xl bg-white border-2 text-xl font-bold">الصفحة اللي قبلها</button>
              <button onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah, page: Math.min(TOTAL_MUSHAF_PAGES, (pos.page || 1) + 1) })} className="min-h-[64px] rounded-xl bg-emerald-700 text-white text-xl font-bold">الصفحة اللي بعدها</button>
            </div>
            <button onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah })} className="w-full py-2 rounded-lg border text-sm">ارجع لعرض الآية</button>
          </>
        ) : (
          <button onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah, page: getSurahStartPage(pos.surah) })} className="w-full min-h-[52px] rounded-xl bg-amber-500 text-white font-bold">اعرض صفحة المصحف (سورة {surahName})</button>
        )}
      </div>

      <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 space-y-3">
        <p className="text-lg font-bold text-emerald-900">
          سورة {surahName} — آية {pos.ayah}
        </p>
        <div className="flex gap-2">
          <button onClick={() => moveAyah(-1)} className="flex-1 py-3 rounded-lg bg-white border font-semibold">
            الآية السابقة
          </button>
          <button onClick={() => moveAyah(1)} className="flex-1 py-3 rounded-lg bg-white border font-semibold">
            الآية التالية
          </button>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <DrumSelect label="اختر السورة" value={pos.surah} onChange={(n) => sendPos({ surah: n, ayah: 1 })}
              options={SURAHS.map((s) => ({ value: s.no, label: `${s.no}. ${s.name}` }))} />
          </div>
          <input
            aria-label="رقم الآية"
            type="number"
            min={1}
            max={ayahCount}
            value={pos.ayah}
            onChange={(e) => {
              const v = Math.min(Math.max(Number(e.target.value) || 1, 1), ayahCount);
              sendPos({ surah: pos.surah, ayah: v });
            }}
            className="w-24 border rounded-lg px-2 py-2 bg-white text-center"
          />
        </div>
        <button onClick={openInMushaf} className="w-full py-3 rounded-lg bg-emerald-600 text-white font-semibold flex items-center justify-center gap-2">
          <BookOpen className="w-4 h-4" /> افتحها في المصحف
        </button>
      </div>

      <div className="bg-white rounded-xl border p-4 space-y-3">
        <p className="font-semibold text-slate-800">الرسائل</p>
        <div className="max-h-64 overflow-y-auto space-y-2">
          {msgs.length === 0 && <p className="text-sm text-slate-500">لسه مفيش رسائل</p>}
          {msgs.map((m) => (
            <div key={m.id} className={`text-sm rounded-lg px-3 py-2 ${m.by === me ? 'bg-emerald-100 mr-8' : 'bg-slate-100 ml-8'}`}>
              {m.text}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            aria-label="اكتب رسالة"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
            placeholder="اكتب رسالة"
            className="flex-1 border rounded-lg px-3 py-2"
          />
          <button onClick={sendMessage} aria-label="إرسال الرسالة" className="px-4 rounded-lg bg-slate-800 text-white flex items-center">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      <button onClick={leaveRoom} className="w-full py-3 rounded-xl border text-slate-700 flex items-center justify-center gap-2">
        <LogOut className="w-4 h-4" /> اخرج من الغرفة
      </button>
      {audioEl}
    </div>
  );
}
