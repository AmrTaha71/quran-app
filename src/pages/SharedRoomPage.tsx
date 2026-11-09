import { roomLabel } from '../lib/roomLabel';
import { useEffect, useRef, useState } from 'react';
import type { Session, RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { SURAHS, SURAH_AYAH_COUNTS } from '../lib/surahs';
import { pressFeedback } from '../lib/pressFeedback';
import QRCode from 'qrcode';
import { editionPageUrl } from '../lib/pageDownload';
import { getSurahStartPage, TOTAL_MUSHAF_PAGES } from '../lib/mushafEditions';
import { getQuranTextCache } from '../lib/quranTextCache';
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
type Pos = { surah: number; ayah: number; by: string; at: number; page?: number; tasbih?: { phrase: string; count: number } };
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
  useEffect(() => {
    if (!tvView || !code) return;
    const url = `${window.location.origin}/#/room?join=${code}`;
    void QRCode.toDataURL(url, { width: 360, margin: 1 }).then(setTvQr).catch(() => setTvQr(''));
  }, [tvView, code]);
  const [joinInput, setJoinInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [members, setMembers] = useState(0);
  const [pos, setPos] = useState<Pos>({ surah: 1, ayah: 1, by: '', at: 0 });
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
  posRef.current = pos;

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

  const sendPos = (next: { surah: number; ayah: number; page?: number; tasbih?: { phrase: string; count: number } }) => {
    const p: Pos = { ...next, by: me, at: Date.now() };
    setPos(p);
    channelRef.current?.send({ type: 'broadcast', event: 'pos', payload: p });
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
  const surahName = SURAHS.find((s) => s.no === pos.surah)?.name ?? '';

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
        <p className="text-slate-600 text-sm">
          افتحوا نفس الآية مع بعض، وتكلموا بالصوت أو بالكتابة، من غير ما تحتاجوا حساب.
        </p>

        <button
          onPointerDown={pressFeedback}
          onClick={createRoom}
          className="w-full py-4 bg-emerald-600 text-white font-bold rounded-xl text-lg"
        >
          ابدأ غرفة جديدة
        </button>

        <div className="bg-white rounded-xl border p-4 space-y-3">
          <p className="font-semibold text-slate-800">أو ادخل بكود الغرفة</p>
          <input
            value={joinInput}
            onChange={(e) => setJoinInput(e.target.value)}
            maxLength={CODE_LENGTH}
            placeholder="مثال: K7P2QX"
            dir="ltr"
            className="w-full border rounded-lg px-3 py-3 text-center text-xl tracking-widest uppercase"
          />
          {joinError && <p className="text-sm text-red-600">{joinError}</p>}
          <button
            onPointerDown={pressFeedback}
            onClick={joinRoom}
            className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl"
          >
            ادخل الغرفة
          </button>
        </div>
        {audioEl}
      </div>
    );
  }

  if (tvView) {
    return (
      <div dir="rtl" className="min-h-screen bg-emerald-950 text-white flex flex-col items-center justify-center gap-8 p-10 text-center">
        {pos.tasbih ? (
          <>
            <p className="text-8xl font-bold text-amber-300 font-display-ar">{pos.tasbih.phrase}</p>
            <p className="text-[12rem] leading-none font-bold">{pos.tasbih.count.toLocaleString('ar-EG')}</p>
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

      <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 space-y-3">
        <p className="text-lg font-bold text-emerald-900">السبحة على الشاشة الكبيرة</p>
        {pos.tasbih ? (
          <>
            <button onPointerDown={pressFeedback}
              onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah, tasbih: { phrase: pos.tasbih!.phrase, count: pos.tasbih!.count + 1 } })}
              className="w-full min-h-[140px] rounded-3xl bg-emerald-700 text-white text-4xl font-bold font-display-ar active:scale-95 transition-transform">
              {pos.tasbih.phrase}
            </button>
            <div className="grid grid-cols-3 items-center gap-2">
              <button onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah })} className="min-h-[48px] rounded-xl border text-sm">اقفل السبحة</button>
              <span className="text-center text-4xl font-bold text-emerald-800">{pos.tasbih.count.toLocaleString('ar-EG')}</span>
              <button onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah, tasbih: { phrase: pos.tasbih!.phrase, count: 0 } })} className="min-h-[48px] rounded-xl border-2 text-sm font-semibold">ابدأ من جديد</button>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {ROOM_TASBIH.map((ph) => (
              <button key={ph} onClick={() => sendPos({ surah: pos.surah, ayah: pos.ayah, tasbih: { phrase: ph, count: 0 } })}
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
          <select
            value={pos.surah}
            onChange={(e) => sendPos({ surah: Number(e.target.value), ayah: 1 })}
            className="flex-1 border rounded-lg px-2 py-2 bg-white"
          >
            {SURAHS.map((s) => (
              <option key={s.no} value={s.no}>{s.no}. {s.name}</option>
            ))}
          </select>
          <input
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
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
            placeholder="اكتب رسالة"
            className="flex-1 border rounded-lg px-3 py-2"
          />
          <button onClick={sendMessage} className="px-4 rounded-lg bg-slate-800 text-white flex items-center">
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
