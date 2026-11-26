// 15.3 (2026-11-26): under «كلماتي اللي بغلط فيها»: record yourself reading
// each weak word right, and play it back. Local only, after one consent.
import { useEffect, useRef, useState } from 'react';
import { Mic, Play, Square } from 'lucide-react';
import { startRecording } from '../lib/alarmRecordings';
import { hasVoiceConsent, giveVoiceConsent, listVoiceIds, saveVoice, voiceUrl } from '../lib/mistakeVoice';
import type { WeakWord } from '../lib/wordMistakes';

export default function MistakeVoiceList({ words }: { words: WeakWord[] }) {
  const [consent, setConsent] = useState(hasVoiceConsent);
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [recId, setRecId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const stopRef = useRef<(() => Promise<Blob>) | null>(null);
  useEffect(() => { void listVoiceIds().then(setIds); }, []);
  useEffect(() => () => { void stopRef.current?.(); }, []);

  const idOf = (w: WeakWord) => `${w.surah}:${w.ayah}:${w.wordNo}`;
  const record = async (id: string) => {
    setErr('');
    if (recId === id) {
      const stop = stopRef.current; stopRef.current = null; setRecId(null);
      if (!stop) return;
      try { await saveVoice(id, await stop()); setIds(await listVoiceIds()); } catch { setErr('ما قدرناش نحفظ التسجيل.'); }
      return;
    }
    if (recId) return;
    try { const r = await startRecording(); stopRef.current = r.stop; setRecId(id); }
    catch { setErr('لازم تسمح بالمايك عشان تسجّل.'); }
  };
  const play = async (id: string) => {
    const url = await voiceUrl(id);
    if (!url) return;
    const a = new Audio(url);
    a.onended = () => URL.revokeObjectURL(url);
    void a.play().catch(() => {});
  };

  if (!consent) {
    return (
      <div className="rounded-xl bg-emerald-50 border border-hairline-emerald p-3 space-y-2">
        <p className="text-sm text-accent-800 leading-relaxed">تقدر تسجّل صوتك وانت بتقرأ كل كلمة صح، وتسمعه وقت المراجعة. التسجيل بيتحفظ على جهازك بس، ومش بيترفع لأي مكان (آخر ٥٠ تسجيل).</p>
        <button type="button" onClick={() => { giveVoiceConsent(); setConsent(true); }}
          className="min-h-[44px] px-4 rounded-xl grad-emerald-door text-white text-sm font-bold polish-press">موافق، خليني أسجّل</button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-accent-600">سجّل نفسك وانت بتقرأ الكلمة صح (على جهازك بس):</p>
      <ul className="space-y-1.5">
        {words.slice(0, 12).map((w) => {
          const id = idOf(w);
          const recording = recId === id;
          return (
            <li key={id} className="flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate text-base text-ink">{w.word}</span>
              <button type="button" onClick={() => void record(id)} aria-label={recording ? `وقّف تسجيل ${w.word}` : `سجّل ${w.word}`}
                className={`min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center ${recording ? 'bg-red-600 text-white animate-pulse' : 'bg-white border border-hairline text-emerald-800'}`}>
                {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              {ids.has(id) && (
                <button type="button" onClick={() => void play(id)} aria-label={`اسمع تسجيلك لـ ${w.word}`}
                  className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center bg-white border border-hairline text-emerald-800">
                  <Play className="w-4 h-4" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {err && <p className="text-sm text-red-700">{err}</p>}
    </div>
  );
}
