// اختبار الترتيل (2026-11-07): the app picks a random place inside the
// chosen range (surah / juz / hizb / quarter), tells the user to read
// from after a given ayah, then plays a reciter's audio from the next
// ayah so the user can compare. Nothing is generated: audio comes from
// the reciter sources in src/lib/reciters.ts.
import { useEffect, useRef, useState } from 'react';
import { SURAH_AYAH_COUNTS, SURAHS, getGlobalAyahNumber } from '../lib/surahs';
import { JUZ_STARTS, HIZB_STARTS, QUARTER_STARTS } from '../lib/quranBoundaries';
import { RECITERS, DEFAULT_RECITER_ID } from '../lib/reciters';
import { getQuranTextCache, type CachedTextRow } from '../lib/quranTextCache';
import { useEscapeClose } from '../lib/useEscape';

type Scope = 'surah' | 'juz' | 'hizb' | 'quarter';
const SCOPE_LABEL: Record<Scope, string> = { surah: 'سورة', juz: 'جزء', hizb: 'حزب', quarter: 'ربع' };
const SCOPE_COUNT: Record<Scope, number> = { surah: 114, juz: 30, hizb: 60, quarter: 240 };
const TOTAL_AYAT = SURAH_AYAH_COUNTS.reduce((a, b) => a + b, 0);
const PLAY_AYAT = 8;

// Global ayah range [start, end) for a scope and its number (1-based).
function scopeRange(scope: Scope, n: number): { start: number; end: number } {
  if (scope === 'surah') {
    const start = getGlobalAyahNumber(n, 1);
    return { start, end: start + SURAH_AYAH_COUNTS[n - 1] };
  }
  const table = scope === 'juz' ? JUZ_STARTS : scope === 'hizb' ? HIZB_STARTS : QUARTER_STARTS;
  const start = table[n - 1].global;
  const end = n < table.length ? table[n].global : TOTAL_AYAT + 1;
  return { start, end };
}

// Global ayah number -> surah/ayah.
function fromGlobal(g: number): { s: number; a: number } {
  let rest = g;
  for (let s = 1; s <= 114; s++) {
    const c = SURAH_AYAH_COUNTS[s - 1];
    if (rest <= c) return { s, a: rest };
    rest -= c;
  }
  return { s: 114, a: SURAH_AYAH_COUNTS[113] };
}

let textMap: Promise<Map<string, string> | null> | null = null;
function loadText(): Promise<Map<string, string> | null> {
  if (!textMap) {
    textMap = getQuranTextCache().getAll(6000).then((rows: CachedTextRow[] | null) => {
      if (!rows) return null;
      const m = new Map<string, string>();
      for (const r of rows) m.set(`${r.surah_no}:${r.ayah_no}`, r.ayah_text);
      return m;
    }).catch(() => null);
  }
  return textMap;
}

export default function TarteelQuizModal({ onClose }: { onClose: () => void }) {
  useEscapeClose(true, onClose);
  const [scope, setScope] = useState<Scope>('juz');
  const [num, setNum] = useState(1);
  const [reciterId, setReciterId] = useState(DEFAULT_RECITER_ID);
  const [round, setRound] = useState<{ from: { s: number; a: number }; urls: string[] } | null>(null);
  const [text, setText] = useState<Map<string, string> | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { loadText().then(setText); }, []);
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const count = SCOPE_COUNT[scope];
  const reciter = RECITERS.find((r) => r.id === reciterId) ?? RECITERS[0];

  function startRound() {
    const { start, end } = scopeRange(scope, num);
    // Need at least one ayah after the picked one inside the range.
    const span = Math.max(1, end - start - 1);
    const g = start + Math.floor(Math.random() * span);
    const from = fromGlobal(g);
    const last = Math.min(g + PLAY_AYAT, end - 1);
    const urls: string[] = [];
    for (let x = g + 1; x <= last; x++) {
      const p = fromGlobal(x);
      urls.push(reciter.audioUrl(p.s, p.a));
    }
    audioRef.current?.pause();
    setPlaying(false);
    setRound({ from, urls });
  }

  function play() {
    if (!round || round.urls.length === 0) return;
    audioRef.current?.pause();
    let i = 0;
    const a = new Audio(round.urls[0]);
    audioRef.current = a;
    setPlaying(true);
    const next = () => {
      i += 1;
      if (i >= round.urls.length) { setPlaying(false); return; }
      a.src = round.urls[i];
      void a.play().catch(() => setPlaying(false));
    };
    a.onended = next;
    a.onerror = () => setPlaying(false);
    void a.play().catch(() => setPlaying(false));
  }

  function stop() {
    audioRef.current?.pause();
    setPlaying(false);
  }

  const surahNameOf = (s: number) => SURAHS.find((x) => x.no === s)?.name ?? `سورة ${s}`;
  const fromText = round ? text?.get(`${round.from.s}:${round.from.a}`) : undefined;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div dir="rtl" role="dialog" aria-modal="true" aria-label="اختبار الترتيل" className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-accent-800">اختبار الترتيل</h2>
          <button onClick={onClose} className="text-accent-600 font-bold px-2">إغلاق</button>
        </div>

        {!round && (
          <>
            <p className="text-sm text-accent-600 mb-2">اختار النطاق اللي عايز تتختبر فيه</p>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {(Object.keys(SCOPE_LABEL) as Scope[]).map((k) => (
                <button key={k} onClick={() => { setScope(k); setNum(1); }}
                  className={`py-2 rounded-lg text-sm font-bold ${scope === k ? 'grad-emerald-door text-white' : 'bg-gray-100 text-accent-600'}`}>
                  {SCOPE_LABEL[k]}
                </button>
              ))}
            </div>
            <label className="block text-sm text-accent-700 mb-1">{SCOPE_LABEL[scope]}</label>
            <select value={num} onChange={(e) => setNum(Number(e.target.value))} className="w-full border border-emerald-200 rounded-lg p-2 mb-4">
              {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {scope === 'surah' ? `${n} - ${surahNameOf(n)}` : `${SCOPE_LABEL[scope]} ${n}`}
                </option>
              ))}
            </select>
            <label className="block text-sm text-accent-700 mb-1">القارئ</label>
            <select value={reciterId} onChange={(e) => setReciterId(e.target.value)} className="w-full border border-emerald-200 rounded-lg p-2 mb-5">
              {RECITERS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button onClick={startRound} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">تمام، سيف</button>
          </>
        )}

        {round && (
          <>
            <div className="bg-gray-50 rounded-lg p-4 border border-emerald-100 mb-4">
              <p className="text-sm text-accent-600 mb-2">اقرأ من بعد قوله تعالى</p>
              {fromText
                ? <p className="font-arabic text-xl text-accent-800 leading-loose">«{fromText}»</p>
                : null}
              <p className="text-sm text-accent-700 mt-2">{surahNameOf(round.from.s)} — آية {round.from.a}</p>
            </div>
            <p className="text-sm text-accent-600 mb-3">اقرأ بصوتك، وبعدين اضغط «استمع» تقارن بالقارئ.</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={playing ? stop : play} disabled={round.urls.length === 0}
                className="py-3 grad-amber-door text-white font-bold rounded-xl disabled:opacity-50">
                {playing ? 'إيقاف' : 'استمع'}
              </button>
              <button onClick={startRound} className="py-3 grad-emerald-door text-white font-bold rounded-xl">الجولة الجاية</button>
            </div>
            <p className="text-xs text-accent-600 text-center mt-3">القارئ: {reciter.name}</p>
          </>
        )}
      </div>
    </div>
  );
}
