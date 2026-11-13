// صفحة تجربة الأذن الجديدة (2026-11-13) — hidden page at #/ear-lab.
// Runs the Quran-Lab zipformer on the mic or on a recorded file and shows
// the phonemes it heard, live, with timing. Not linked from the app.
import { useEffect, useRef, useState } from 'react';
import { earLabOn, setEarLab } from '../lib/quranLabEar';

const TARGET = 16000;

function downsample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET) return new Float32Array(input);
  const ratio = fromRate / TARGET;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const s = Math.floor(i * ratio);
    const e = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = s; j < e; j++) sum += input[j];
    out[i] = sum / Math.max(1, e - s);
  }
  return out;
}

export default function EarLabPage() {
  const worker = useRef<Worker | null>(null);
  const [status, setStatus] = useState('لسه ما اتحمّلش');
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState('');
  const [chunkMs, setChunkMs] = useState<number[]>([]);
  const [recording, setRecording] = useState(false);
  const [clean, setClean] = useState(false);
  const [info, setInfo] = useState('');
  const [copied, setCopied] = useState(false);
  const [inTest, setInTest] = useState(earLabOn());
  const mic = useRef<{ ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode; t0: number; samples: number } | null>(null);
  const runInfo = useRef({ audioSec: 0, startedAt: 0, firstTokenAt: 0 });

  useEffect(() => {
    const w = new Worker(new URL('../workers/quranLab.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') setProgress(Math.round((m.loaded / m.total) * 100));
      else if (m.type === 'ready') { setReady(true); setStatus(`جاهز (${m.backend}) — التحميل ${(m.loadMs / 1000).toFixed(1)} ث`); }
      else if (m.type === 'tokens') {
        if (!runInfo.current.firstTokenAt && m.text) runInfo.current.firstTokenAt = performance.now();
        setText((t) => t + m.text);
        setChunkMs((a) => [...a, m.chunkMs]);
      } else if (m.type === 'flushed') setStatus((s) => s.replace(' — بيحلل…', ''));
      else if (m.type === 'error') setStatus(`خطأ: ${m.message}`);
    };
    worker.current = w;
    return () => { w.terminate(); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = () => { setStatus('بيحمّل النموذج (٧٣ ميجا أول مرة بس)…'); worker.current?.postMessage({ type: 'load' }); };
  const clear = () => { setText(''); setChunkMs([]); setInfo(''); runInfo.current = { audioSec: 0, startedAt: 0, firstTokenAt: 0 }; };

  const start = async () => {
    clear();
    worker.current?.postMessage({ type: 'reset' });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: clean, noiseSuppression: clean, autoGainControl: true } });
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const rate = ctx.sampleRate;
    const state = { ctx, stream, node, t0: performance.now(), samples: 0 };
    node.onaudioprocess = (ev) => {
      const s = downsample(ev.inputBuffer.getChannelData(0), rate);
      state.samples += s.length;
      worker.current?.postMessage({ type: 'audio', samples: s }, [s.buffer]);
    };
    src.connect(node);
    node.connect(ctx.destination);
    mic.current = state;
    runInfo.current.startedAt = performance.now();
    setRecording(true);
    setStatus('بيسمع…');
  };

  function stop() {
    const m = mic.current;
    if (!m) return;
    try { m.node.disconnect(); m.stream.getTracks().forEach((t) => t.stop()); void m.ctx.close(); } catch { /* ignore */ }
    runInfo.current.audioSec = m.samples / TARGET;
    mic.current = null;
    setRecording(false);
    setStatus('جاهز — بيحلل…');
    worker.current?.postMessage({ type: 'flush' });
  }

  const onFile = async (f: File) => {
    clear();
    setStatus(`بيقرا الملف ${f.name}…`);
    const buf = await f.arrayBuffer();
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const audio = await ctx.decodeAudioData(buf);
    void ctx.close();
    const off = new OfflineAudioContext(1, Math.ceil(audio.duration * TARGET), TARGET);
    const src = off.createBufferSource();
    src.buffer = audio;
    src.connect(off.destination);
    src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    runInfo.current = { audioSec: pcm.length / TARGET, startedAt: performance.now(), firstTokenAt: 0 };
    worker.current?.postMessage({ type: 'reset' });
    for (let i = 0; i < pcm.length; i += 4096) worker.current?.postMessage({ type: 'audio', samples: pcm.slice(i, i + 4096) });
    worker.current?.postMessage({ type: 'flush' });
    setStatus(`جاهز — بيحلل… (${runInfo.current.audioSec.toFixed(1)} ث صوت)`);
  };

  const avg = chunkMs.length ? Math.round(chunkMs.reduce((a, b) => a + b, 0) / chunkMs.length) : 0;
  const max = chunkMs.length ? Math.max(...chunkMs) : 0;

  useEffect(() => {
    if (!chunkMs.length) return;
    setInfo(`مقاطع: ${chunkMs.length} · متوسط الوقت لكل نص ثانية صوت: ${avg} مللي · أقصى: ${max} مللي · ${avg < 480 ? 'أسرع من الكلام ✓' : 'أبطأ من الكلام ✗'}`);
  }, [chunkMs, avg, max]);

  const copy = async () => {
    const report = JSON.stringify({ format: 'ear-lab/v1', ua: navigator.userAgent, status, chunks: chunkMs.length, avgChunkMs: avg, maxChunkMs: max, audioSec: Number(runInfo.current.audioSec.toFixed(1)), clean, text }, null, 1);
    try { await navigator.clipboard.writeText(report); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  const btn = 'px-4 py-3 rounded-xl font-bold text-base polish-press disabled:opacity-40';
  return (
    <div dir="rtl" className="min-h-screen bg-cream p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-accent-900 mb-1">تجربة الأذن الجديدة</h1>
      <p className="text-sm text-accent-700 mb-4">نموذج Quran-Lab — بيكتب الحروف اللي سمعها بالظبط، مش الكلمات.</p>

      <div className="glass-card rounded-2xl p-4 mb-4">
        <p className="font-semibold text-accent-800 mb-2">{status}</p>
        {!ready && progress > 0 && progress < 100 && (
          <div className="h-2 bg-white rounded-full overflow-hidden mb-2"><div className="h-full grad-emerald-door" style={{ width: `${progress}%` }} /></div>
        )}
        <div className="flex flex-wrap gap-2">
          {!ready && <button className={`${btn} grad-emerald-door text-white`} onClick={load}>١. حمّل النموذج</button>}
          {ready && !recording && <button className={`${btn} grad-emerald-door text-white`} onClick={start}>٢. ابدأ التسميع بالميكروفون</button>}
          {recording && <button className={`${btn} bg-rose-600 text-white`} onClick={stop}>وقّف</button>}
          {ready && !recording && (
            <label className={`${btn} bg-white border border-hairline-emerald text-accent-800 cursor-pointer`}>
              أو اختار تسجيل
              <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
            </label>
          )}
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm text-accent-700">
          <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} disabled={recording} />
          تنقية الصوت من الجهاز (جرّب بيها ومن غيرها)
        </label>
      </div>

      <div className="glass-card rounded-2xl p-4 mb-4">
        <p className="font-semibold text-accent-800 mb-2">اللي اتسمع</p>
        <p className="text-2xl leading-[2.4] text-accent-900 min-h-[6rem] break-words" style={{ fontFamily: "'Amiri', 'Noto Naskh Arabic', serif" }}>{text || '—'}</p>
        {info && <p className="text-sm text-accent-700 mt-2">{info}</p>}
      </div>

      <div className="glass-card rounded-2xl p-4 mb-4">
        <label className="flex items-center gap-3 text-base font-bold text-accent-900">
          <input type="checkbox" className="w-6 h-6 accent-emerald-600" checked={inTest} onChange={(e) => { setEarLab(e.target.checked); setInTest(e.target.checked); }} />
          استخدم الأذن الجديدة في «اختبر نفسك» (التسميع المتواصل)
        </label>
        <p className="text-sm text-accent-700 mt-1">تجريبي، على الجهاز ده بس. شيل العلامة ترجع للأذن القديمة.</p>
      </div>

      <div className="flex gap-2">
        <button className={`${btn} grad-amber-door text-white`} onClick={copy} disabled={!text}>{copied ? 'اتنسخ ✓' : 'انسخ النتيجة وابعتها'}</button>
        <button className={`${btn} bg-white border border-hairline-emerald text-accent-800`} onClick={clear} disabled={recording}>امسح</button>
        <a href="/" className={`${btn} bg-white border border-hairline-emerald text-accent-800`}>الرئيسية</a>
      </div>
    </div>
  );
}
