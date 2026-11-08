// Pilot: «ودن القرآن على جهازك» (2026-11-08). Record a few ayahs, then the
// on-device Quran model transcribes them. Measures download, speed and
// accuracy on the user's own iPad before it replaces the browser ear.
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Download } from 'lucide-react';

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
  const workerRef = useRef<Worker | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [pct, setPct] = useState(0);
  const [backend, setBackend] = useState('');
  const [text, setText] = useState('');
  const [info, setInfo] = useState('');
  const [err, setErr] = useState('');
  const loadStartRef = useRef(0);

  const ensureWorker = () => {
    if (workerRef.current) return workerRef.current;
    const w = new Worker(new URL('../workers/quranAsr.worker.ts', import.meta.url), { type: 'module' });
    const files: Record<string, number> = {};
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') {
        files[m.file] = m.progress ?? 0;
        const vals = Object.values(files);
        setPct(Math.round(vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length)));
      } else if (m.type === 'ready') {
        setBackend(m.backend);
        setStatus('ready');
        setInfo(`البرنامج جاهز (${m.backend}) — التحميل خد ${Math.round((Date.now() - loadStartRef.current) / 1000)} ثانية`);
      } else if (m.type === 'result') {
        setText(m.text);
        setInfo(`التحليل خد ${(m.ms / 1000).toFixed(1)} ثانية على جهازك (${m.backend})`);
        setStatus('ready');
      } else if (m.type === 'error') {
        setErr(m.message);
        setStatus(m.loaded ? 'ready' : 'idle');
      }
    };
    workerRef.current = w;
    return w;
  };

  useEffect(() => () => { workerRef.current?.terminate(); }, []);

  const load = () => {
    setErr('');
    setStatus('loading');
    loadStartRef.current = Date.now();
    ensureWorker().postMessage({ type: 'load' });
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
          ensureWorker().postMessage({ type: 'run', id: Date.now(), audio }, [audio.buffer]);
        } catch (e) {
          setErr(String((e as Error).message || e));
          setStatus('ready');
        }
      };
      recRef.current = rec;
      rec.start();
      setStatus('recording');
    } catch (e) {
      setErr('الميكروفون مش متاح: ' + String((e as Error).message || e));
    }
  };

  return (
    <div dir="rtl" className="bg-white border-2 border-amber-300 rounded-2xl p-4 space-y-3">
      <p className="font-bold text-accent-800">تجربة: التعرّف على التلاوة على جهازك</p>
      <p className="text-xs text-accent-600">برنامج متدرب على سماع القرآن، بيشتغل على جهازك من غير إنترنت بعد أول تحميل (حوالي 100 ميجا مرة واحدة). سجّل كام آية، وشوف هو سمع إيه.</p>
      {status === 'idle' && (
        <button type="button" onClick={load} className="w-full min-h-[48px] rounded-xl bg-amber-500 text-white font-bold flex items-center justify-center gap-2">
          <Download className="w-5 h-5" /> حمّل البرنامج
        </button>
      )}
      {status === 'loading' && <p className="text-sm text-accent-700">بيحمّل… {pct}%</p>}
      {(status === 'ready' || status === 'working') && (
        <button type="button" disabled={status === 'working'} onClick={startRec} className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          <Mic className="w-5 h-5" /> {status === 'working' ? 'بيحلّل…' : 'ابدأ سجّل'}
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
      {backend && <p className="text-[11px] text-accent-500">النموذج: tarteel-ai/whisper-base-ar-quran (Apache-2.0)</p>}
    </div>
  );
}
