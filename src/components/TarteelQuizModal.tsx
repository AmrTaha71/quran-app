// اختبار الترتيل (2026-11-07): the app picks a random place inside the
// chosen range (surah / juz / hizb / quarter), tells the user to read
// from after a given ayah, then plays a reciter's audio from the next
// ayah so the user can compare. Nothing is generated: audio comes from
// the reciter sources in src/lib/reciters.ts.
import { useEffect, useRef, useState } from 'react';
import { SURAH_AYAH_COUNTS, SURAHS, getGlobalAyahNumber, surahLabel } from '../lib/surahs';
import { JUZ_STARTS, HIZB_STARTS, QUARTER_STARTS } from '../lib/quranBoundaries';
import { CORR_RECITERS } from '../lib/juhaniCorr';
import { recitersForRange, ayahUrl, planRangeReciters, downloadRange, isRangeDownloaded, rangeSizeMb, formatSize, type RangeReciterPart } from '../lib/corrDownload';
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

// Juz range [first..last] as a global ayah range [start, end).
function juzSpan(first: number, last: number): { start: number; end: number } {
  const start = JUZ_STARTS[first - 1].global;
  const end = last < 30 ? JUZ_STARTS[last].global : TOTAL_AYAT + 1;
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
  // Juz range (2026-11-10): «من جزء» = num, «إلى جزء» = toNum (scope juz only).
  const [toNum, setToNum] = useState(1);
  const [reciterId, setReciterId] = useState('');
  const [round, setRound] = useState<{ from: { s: number; a: number }; urls: string[]; reciter: string; notes: string[] } | null>(null);
  const [text, setText] = useState<Map<string, string> | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { loadText().then(setText); }, []);
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const count = SCOPE_COUNT[scope];
  // Only readers with word timings for the WHOLE picked range are offered
  // (2026-11-10). One reader -> used silently; none -> nothing to play.
  const range = scope === 'juz' ? juzSpan(num, toNum) : scopeRange(scope, num);
  const options = recitersForRange(range.start, range.end - 1);
  const activeId = options.includes(reciterId) ? reciterId : (options[0] ?? '');
  const reciterName = (f: string) => CORR_RECITERS.find((r) => r.folder === f)?.name ?? f;
  // No single reader covers the whole range: split it between readers (2026-11-10).
  const mixed: RangeReciterPart[] | null = options.length === 0 ? planRangeReciters(range.start, range.end - 1) : null;
  const folderAt = (g: number): string => (mixed?.find((p) => g >= p.start && g <= p.end)?.folder) ?? activeId;
  const canStart = options.length > 0 || mixed !== null;
  // Range download (2026-11-10): the chosen range only, one part per reader if split.
  const dlParts: RangeReciterPart[] = mixed ?? (activeId ? [{ start: range.start, end: range.end - 1, folder: activeId }] : []);
  const dlSizeMb = dlParts.reduce((a, p) => a + rangeSizeMb(p.folder, p.start, p.end), 0);
  const dlDone = dlParts.length > 0 && dlParts.every((p) => isRangeDownloaded(p.folder, p.start, p.end));
  const [dlBusy, setDlBusy] = useState(false);
  const [dlPct, setDlPct] = useState(0);
  const [dlMsg, setDlMsg] = useState('');
  const dlAbort = useRef<AbortController | null>(null);
  const runRangeDownload = async () => {
    const ctrl = new AbortController();
    dlAbort.current = ctrl;
    setDlBusy(true);
    setDlMsg('');
    let failed = false;
    for (const p of dlParts) {
      if (isRangeDownloaded(p.folder, p.start, p.end)) continue;
      const res = await downloadRange(p.folder, p.start, p.end, (d, t) => setDlPct(t ? Math.round((d / t) * 100) : 0), ctrl.signal);
      if (res !== 'done') { failed = true; break; }
    }
    setDlBusy(false);
    setDlPct(0);
    setDlMsg(ctrl.signal.aborted ? 'وقفنا التحميل' : failed ? 'التحميل ما اكتملش — جرّب تاني' : 'تم التحميل، هيتسمّع بدون نت');
  };
  const partLabel = (p: RangeReciterPart) => {
    const a = fromGlobal(p.start);
    const b = fromGlobal(p.end);
    return `من ${surahNameOf(a.s)} آية ${a.a} إلى ${surahNameOf(b.s)} آية ${b.a}: بصوت ${reciterName(p.folder)}`;
  };

  function startRound() {
    const { start, end } = range;
    if (!canStart) return;
    // Need at least one ayah after the picked one inside the range.
    const span = Math.max(1, end - start - 1);
    const g = start + Math.floor(Math.random() * span);
    const from = fromGlobal(g);
    const last = Math.min(g + PLAY_AYAT, end - 1);
    const urls: string[] = [];
    for (let x = g + 1; x <= last; x++) {
      const p = fromGlobal(x);
      urls.push(ayahUrl(folderAt(x), p.s, p.a));
    }
    audioRef.current?.pause();
    setPlaying(false);
    setRound({ from, urls, reciter: mixed ? '' : activeId, notes: mixed ? mixed.map(partLabel) : [] });
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

  const surahNameOf = (s: number) => surahLabel(s);
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
                <button key={k} onClick={() => { setScope(k); setNum(1); setToNum(1); }}
                  className={`py-2 rounded-lg text-sm font-bold ${scope === k ? 'grad-emerald-door text-white' : 'bg-gray-100 text-accent-600'}`}>
                  {SCOPE_LABEL[k]}
                </button>
              ))}
            </div>
            {scope === 'juz' ? (
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div>
                  <label className="block text-sm text-accent-700 mb-1">من جزء</label>
                  <select value={num} onChange={(e) => { const v = Number(e.target.value); setNum(v); if (toNum < v) setToNum(v); }} className="w-full border border-emerald-200 rounded-lg p-2">
                    {Array.from({ length: count }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{`جزء ${n}`}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-accent-700 mb-1">إلى جزء</label>
                  <select value={toNum} onChange={(e) => setToNum(Number(e.target.value))} className="w-full border border-emerald-200 rounded-lg p-2">
                    {Array.from({ length: count - num + 1 }, (_, i) => num + i).map((n) => <option key={n} value={n}>{`جزء ${n}`}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <>
                <label className="block text-sm text-accent-700 mb-1">{SCOPE_LABEL[scope]}</label>
                <select value={num} onChange={(e) => setNum(Number(e.target.value))} className="w-full border border-emerald-200 rounded-lg p-2 mb-4">
                  {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {scope === 'surah' ? `${n} - ${surahNameOf(n)}` : `${SCOPE_LABEL[scope]} ${n}`}
                    </option>
                  ))}
                </select>
              </>
            )}
            {options.length === 0 && mixed === null && (
              <p className="text-sm text-amber-700 mb-4">ما فيش قارئ عنده توقيت كلمات لجزء من النطاق ده. اختار نطاق تاني.</p>
            )}
            {options.length === 0 && mixed !== null && (
              <div className="text-sm text-accent-700 mb-4 space-y-1">
                <p>ما فيش قارئ واحد عنده النطاق ده كله، فهيتقسم بين أكتر من قارئ:</p>
                {mixed.map((p) => <p key={`${p.start}-${p.folder}`} className="text-xs text-accent-600">{partLabel(p)}</p>)}
              </div>
            )}
            {options.length > 1 && (
              <>
                <label className="block text-sm text-accent-700 mb-1">القارئ</label>
                <select value={activeId} onChange={(e) => setReciterId(e.target.value)} className="w-full border border-emerald-200 rounded-lg p-2 mb-5">
                  {options.map((f) => <option key={f} value={f}>{reciterName(f)}</option>)}
                </select>
              </>
            )}
            {canStart && (
              <div className="mb-4 space-y-2">
                {dlDone ? (
                  <p className="text-sm text-emerald-700">النطاق ده محمّل على جهازك ✓</p>
                ) : (
                  <>
                    <p className="text-xs text-accent-600">حجم النطاق تقريباً {formatSize(dlSizeMb)}</p>
                    <button type="button" onClick={() => void runRangeDownload()} disabled={dlBusy}
                      className="w-full py-2 rounded-xl border border-emerald-300 text-emerald-800 font-bold disabled:opacity-50">
                      {dlBusy ? `بنزّل… ${dlPct}٪` : 'نزّل النطاق ده (اختياري)'}
                    </button>
                    {dlBusy && (
                      <button type="button" onClick={() => dlAbort.current?.abort()} className="w-full text-xs text-accent-600 underline">وقّف التحميل</button>
                    )}
                    {dlMsg && <p className="text-xs text-accent-700">{dlMsg}</p>}
                  </>
                )}
              </div>
            )}
            <button onClick={startRound} disabled={!canStart} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl disabled:opacity-50">تمام، سيف</button>
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
            {round.notes.length > 0
              ? round.notes.map((n) => <p key={n} className="text-xs text-accent-600 text-center mt-1">{n}</p>)
              : <p className="text-xs text-accent-600 text-center mt-3">القارئ: {reciterName(round.reciter)}</p>}
          </>
        )}
      </div>
    </div>
  );
}
