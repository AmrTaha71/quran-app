// «التعرّف على التلاوة على جهازك» (2026-11-08): download the on-device
// Quran model, try it on a short recording, and choose it as the ear for
// recitation (setting 'quran-ear'). Shares the one worker in lib/quranEar.
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Download } from 'lucide-react';
import { loadEar, transcribe, onEarMessage, earBackend, getEar, setEar } from '../lib/quranEar';

type Status = 'idle' | 'loading' | 'ready' | 'recording' | 'working';

async function toMono16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer();
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(buf);
  void ctx.close();
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const r = await off.startRendering();
  return r.getChannelData(0);
}

export default function QuranAsrLab() {
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [status, setStatus] = useState<Status>(earBackend() ? 'ready' : 'idle');
  const [pct, setPct] = useState(0);
  const [text, setText] = useState('');
  const [info, setInfo] = useState('');
  const [err, setErr] = useState('');
  const [useIt, setUseIt] = useState(getEar() === 'model');

  useEffect(() => {
    const files: Record<string, number> = {};
    return onEarMessage((m) => {
      if (m.type === 'progress') {
        files[m.file] = m.progress ?? 0;
        const vals = Object.values(files);
        setPct(Math.round(vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length)));
      }
    });
  }, []);

  const load = async () => {
    setErr('');
    setStatus('loading');
    const t0 = Date.now();
    try {
      const b = await loadEar();
      setStatus('ready');
      setInfo(`البرنامج جاهز (${b}) — خد ${Math.round((Date.now() - t0) / 1000)} ثانية`);
    } catch (e) {
      setErr(String((e as Error).message || e));
      setStatus('idle');
    }
  };

  const startRec = async () => {
    setErr(''); setText(''); setInfo('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setStatus('working');
        try {
          const audio = await toMono16k(new Blob(chunksRef.current, { type: rec.mimeType }));
          const r = await transcribe(audio);
          if (r) { setText(r.text); setInfo(`التحليل خد ${(r.ms / 1000).toFixed(1)} ثانية على جهازك (${earBackend()})`); }
          else setErr('ما قدرش يحلّل التسجيل');
        } catch (e) {
          setErr(String((e as Error).message || e));
        }
        setStatus('ready');
      };
      recRef.current = rec;
      rec.start();
      setStatus('recording');
    } catch (e) {
      setErr('الميكروفون مش متاح: ' + String((e as Error).message || e));
    }
  };

  const toggleUse = (v: boolean) => { setEar(v ? 'model' : 'browser'); setUseIt(v); if (v) void load(); };

  return (
    <div dir="rtl" className="bg-white border-2 border-amber-300 rounded-2xl p-4 space-y-3">
      <p className="font-bold text-accent-800">التعرّف على التلاوة على جهازك</p>
      <p className="text-xs text-accent-600">برنامج متدرب على سماع القرآن، بيشتغل على جهازك من غير إنترنت بعد أول تحميل (حوالي 100 ميجا مرة واحدة).</p>
      <label className="flex items-center gap-2 text-sm font-semibold text-accent-900 bg-emerald-50 rounded-xl p-3">
        <input type="checkbox" checked={useIt} onChange={(e) => toggleUse(e.target.checked)} className="w-5 h-5 accent-emerald-600" />
        استخدمه هو اللي يسمعني في التسميع المتصل (بدل سمع المتصفح)
      </label>
      {status === 'idle' && (
        <button type="button" onClick={() => void load()} className="w-full min-h-[48px] rounded-xl bg-amber-500 text-white font-bold flex items-center justify-center gap-2">
          <Download className="w-5 h-5" /> حمّل البرنامج
        </button>
      )}
      {status === 'loading' && <p className="text-sm text-accent-700">بيحمّل… {pct}%</p>}
      {(status === 'ready' || status === 'working') && (
        <button type="button" disabled={status === 'working'} onClick={() => void startRec()} className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          <Mic className="w-5 h-5" /> {status === 'working' ? 'بيحلّل…' : 'جرّب: سجّل كام آية'}
        </button>
      )}
      {status === 'recording' && (
        <button type="button" onClick={() => recRef.current?.stop()} className="w-full min-h-[48px] rounded-xl bg-red-600 text-white font-bold flex items-center justify-center gap-2 animate-pulse">
          <Square className="w-5 h-5" /> وقّف وحلّل
        </button>
      )}
      {info && <p className="text-xs text-accent-600">{info}</p>}
      {text && <p className="text-lg leading-loose bg-emerald-50 rounded-xl p-3 text-accent-900">{text}</p>}
      {err && <p className="text-xs text-red-600 break-all">{err}</p>}
      <p className="text-[11px] text-accent-500">النموذج: tarteel-ai/whisper-base-ar-quran (Apache-2.0)</p>
    </div>
  );
}
