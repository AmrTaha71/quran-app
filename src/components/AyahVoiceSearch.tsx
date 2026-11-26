// 15.7 (2026-11-26): «سمّع جزء من آية وأنا أقولك هي فين». The user recites a
// piece of an ayah they remember; the device ear (or the browser ear when
// the device ear is not here) turns it into letters, findAyahCandidates
// looks for it in the whole Mushaf, and the best places open in the Mushaf.
import { useEffect, useRef, useState } from 'react';
import { X, BookOpen } from 'lucide-react';
import StudioMic from './StudioMic';
import { useEscapeClose } from '../lib/useEscape';
import { loadFollowIndex } from '../lib/imamFollowIndex';
import { followSkel, textWordSkel, type FollowIndex } from '../lib/imamFollow';
import { findAyahCandidates, type AyahHit } from '../lib/ayahVoiceSearch';
import { QuranLabPhonemeTap, earLabUsable, earLabMayStart, EAR_NEEDS_DOWNLOAD_MSG, releaseEarMic } from '../lib/quranLabEar';
import { normalizeArabic } from '../lib/arabicNormalize';
import { speechErrorMessage } from '../lib/speechErrors';
import { SURAHS } from '../lib/surahs';

type Rec = { start: () => void; stop: () => void; abort?: () => void; onerror: ((e: { error?: string }) => void) | null; onend: (() => void) | null };
const MAX_LISTEN_MS = 12000;

export default function AyahVoiceSearch({ onClose }: { onClose: () => void }) {
  useEscapeClose(true, onClose);
  const [phase, setPhase] = useState<'idle' | 'listening' | 'done'>('idle');
  const [hits, setHits] = useState<AyahHit[]>([]);
  const [msg, setMsg] = useState('');
  const idxRef = useRef<FollowIndex | null>(null);
  const lettersRef = useRef('');
  const recRef = useRef<Rec | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    loadFollowIndex().then((i) => { if (alive) idxRef.current = i; }).catch(() => { if (alive) setMsg('تعذّر تحميل فهرس المصحف — جرّب تاني'); });
    return () => {
      alive = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      try { recRef.current?.abort?.(); } catch { /* ignore */ }
      recRef.current = null;
      releaseEarMic();
    };
  }, []);

  const update = () => {
    const idx = idxRef.current;
    if (!idx) return;
    setHits(findAyahCandidates(idx, lettersRef.current));
  };

  const stop = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    try { recRef.current?.stop(); } catch { /* ignore */ }
    recRef.current = null;
    update();
    setPhase('done');
  };

  const start = () => {
    setMsg(''); setHits([]); lettersRef.current = '';
    const W = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
    const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
    let rec: Rec;
    if (earLabUsable() || (!SR && earLabMayStart())) {
      const tap = new QuranLabPhonemeTap();
      tap.onparts = (parts) => { lettersRef.current += followSkel(parts.map((p) => p.s).join('')); update(); };
      rec = tap as unknown as Rec;
    } else if (SR) {
      const r = new SR() as Rec & { lang: string; continuous: boolean; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null };
      r.lang = 'ar-SA'; r.continuous = true; r.interimResults = true;
      r.onresult = (e) => {
        let text = '';
        for (let i = 0; i < e.results.length; i++) text += ' ' + e.results[i][0].transcript;
        lettersRef.current = normalizeArabic(text).split(/\s+/).filter(Boolean).map(textWordSkel).join('');
        update();
      };
      rec = r;
    } else {
      setMsg(EAR_NEEDS_DOWNLOAD_MSG);
      return;
    }
    rec.onerror = (e) => {
      const code = e?.error;
      const m = code === 'model-load' || code === 'network' ? null : speechErrorMessage(code);
      if (code === 'model-load' || code === 'network') setMsg('السماع ما اشتغلش دلوقتي — جرّب تاني');
      else if (m) setMsg(m.text);
      if (code !== 'no-speech' && code !== 'aborted') stop();
    };
    rec.onend = () => { if (recRef.current === rec) stop(); };
    recRef.current = rec;
    try { rec.start(); } catch { setMsg('الميكروفون ما اشتغلش — جرّب تاني'); return; }
    setPhase('listening');
    timerRef.current = setTimeout(stop, MAX_LISTEN_MS);
  };

  const open = (h: AyahHit) => {
    onClose();
    window.location.hash = `#/mushaf?surah=${h.surah}&ayah=${h.ayah}`;
  };
  const surahName = (n: number) => SURAHS.find((s) => s.no === n)?.name ?? String(n);

  return (
    <div className="fixed inset-0 z-[1500] bg-black/50 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="ابحث عن آية بتلاوتها" dir="rtl"
        className="bg-cream rounded-3xl shadow-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-accent-900">سمّع جزء من الآية</h2>
          <button type="button" onClick={onClose} aria-label="اقفل" className="w-11 h-11 rounded-full flex items-center justify-center text-ink-2 hover:bg-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-ink-2">اقرأ جملة من الآية اللي فاكرها (٣ كلمات أو أكتر)، وهنقولك هي فين في المصحف.</p>

        <button type="button" onClick={phase === 'listening' ? stop : start}
          className={`w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 polish-press ${phase === 'listening' ? 'bg-red-600 text-white animate-pulse' : 'grad-emerald-door text-white'}`}>
          <StudioMic className="w-6 h-6" />
          {phase === 'listening' ? 'خلاص' : phase === 'done' ? 'سمّع تاني' : 'ابدأ'}
        </button>

        {msg && <p className="text-sm text-red-700 font-semibold" role="alert">{msg}</p>}

        <div aria-live="polite" className="space-y-2">
          {hits.map((h, i) => (
            <button key={`${h.surah}:${h.ayah}`} type="button" onClick={() => open(h)}
              className={`w-full min-h-[44px] px-4 py-3 rounded-xl border text-right flex items-center justify-between gap-2 polish-press ${i === 0 ? 'bg-amber-50 border-amber-300' : 'bg-white border-hairline'}`}>
              <span className="font-bold text-accent-900">سورة {surahName(h.surah)} — آية {h.ayah.toLocaleString('ar-EG')}</span>
              <span className="flex items-center gap-1 text-sm text-emerald-800"><BookOpen className="w-4 h-4" /> افتح</span>
            </button>
          ))}
          {phase === 'done' && !hits.length && !msg && (
            <p className="text-sm text-ink-2">ما لقيناش آية قريبة — جرّب تقرأ كلمات أكتر وبوضوح.</p>
          )}
          {phase === 'listening' && !hits.length && <p className="text-sm text-ink-2">بيسمع…</p>}
        </div>
      </div>
    </div>
  );
}
