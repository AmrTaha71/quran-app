// اختبار الترتيل (W4-E, 2026-11-19): «سمّعني»-style rounds. Pick a range, then
// a reciter (the list shows only readers with word timings for the range).
// Each round: 5 words from the reciter, the user completes the ayah by voice
// (RoundRecite), then «في أي سورة؟» (tiles). Round = 8 (completion)
// + 2 (surah name; skipped inside a single surah); final /40 = average of the rounds x 4, kept in the score log.
import { loadHifzCorpus } from '../lib/hifzCorpus';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ROUND_CORRECTIONS } from '../lib/roundJudge';
import RoundRecite, { RoundReveal, RoundDebugOverlay } from './RoundRecite';
import SurahTiles from './SurahTiles';
import { addTestHistoryV1 } from '../lib/testHistory';
import { HINT_COST, arNum, currentHistoryLevel, loadQuranText, pickRoundAyah, surahsOfRange, tarteelFinal, tarteelRoundScore, type PickedAyah, type RoundResult } from '../lib/roundTest';
import { SURAH_AYAH_COUNTS, getGlobalAyahNumber, surahLabel } from '../lib/surahs';
import { JUZ_STARTS, HIZB_STARTS, QUARTER_STARTS } from '../lib/quranBoundaries';
import { CORR_RECITERS } from '../lib/juhaniCorr';
import { recitersForRange, planRangeReciters, downloadRange, isRangeDownloaded, rangeSizeMb, formatSize, type RangeReciterPart } from '../lib/corrDownload';
import { useEscapeClose } from '../lib/useEscape';
import DrumSelect from './DrumSelect';
import { unitPickLabel } from '../lib/testRanges';
import RoundCutPicker from './RoundCutPicker';

type Scope = 'surah' | 'juz' | 'hizb' | 'quarter';
const SCOPE_LABEL: Record<Scope, string> = { surah: 'سورة', juz: 'جزء', hizb: 'حزب', quarter: 'ربع' };
const SCOPE_COUNT: Record<Scope, number> = { surah: 114, juz: 30, hizb: 60, quarter: 240 };
const TOTAL_AYAT = SURAH_AYAH_COUNTS.reduce((a, b) => a + b, 0);

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

type Done = { ayah: PickedAyah; result: RoundResult; surahOk: boolean | null; completion: number; surah: number; total: number };
type Phase = 'setup' | 'loading' | 'recite' | 'surah' | 'score' | 'summary';

export default function TarteelQuizModal({ onClose }: { onClose: () => void }) {
  const [scope, setScope] = useState<Scope>('juz');
  const [num, setNum] = useState(1);
  // Juz range (2026-11-10): «من جزء» = num, «إلى جزء» = toNum (scope juz only).
  const [toNum, setToNum] = useState(1);
  const [reciterId, setReciterId] = useState('');
  const [text, setText] = useState<Map<string, string> | null>(null);
  const [phase, setPhase] = useState<Phase>('setup');
  const [err, setErr] = useState('');
  const [cur, setCur] = useState<{ ayah: PickedAyah; result?: RoundResult; surahOk?: boolean | null } | null>(null);
  const [rounds, setRounds] = useState<Done[]>([]);
  const used = useRef<Set<number>>(new Set());
  const saved = useRef(false);

  // text === null while loading OR after a failure; textFailed tells them apart so the
  // disabled «ابدأ» always has a visible reason.
  const [textFailed, setTextFailed] = useState(false);
  const loadText = () => {
    setTextFailed(false);
    void loadQuranText().then((t) => { setText(t); setTextFailed(!t); });
  };
  useEffect(() => { loadText(); }, []);

  const count = SCOPE_COUNT[scope];
  // Only readers with word timings for the WHOLE picked range are offered
  // (2026-11-10). None -> the range is split between readers.
  const range = scope === 'juz' ? juzSpan(num, toNum) : scopeRange(scope, num);
  const options = recitersForRange(range.start, range.end - 1);
  const activeId = options.includes(reciterId) ? reciterId : (options[0] ?? '');
  const reciterName = (f: string) => CORR_RECITERS.find((r) => r.folder === f)?.name ?? f;
  const mixed: RangeReciterPart[] | null = options.length === 0 ? planRangeReciters(range.start, range.end - 1) : null;
  const folderAt = (g: number): string => (mixed?.find((p) => g >= p.start && g <= p.end)?.folder) ?? activeId;
  const canStart = (options.length > 0 || mixed !== null) && !!text;
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
  const surahNameOf = (s: number) => surahLabel(s);

  async function nextRound() {
    if (!text) return;
    setErr('');
    setPhase('loading');
    // Item 17.2: questions from «محفوظي» only, when it is declared.
    const corpus = loadHifzCorpus();
    const picked = await pickRoundAyah({ start: range.start, end: range.end - 1 }, folderAt, text, used.current, corpus);
    if (!picked) { setErr(rounds.length ? 'خلصت الآيات المميزة المتاحة في النطاق ده. اختار نطاق تاني لو عايز تكمّل.' : corpus ? 'مفيش في النطاق ده آية مناسبة من محفوظك — الأسئلة من محفوظك فقط. اختار نطاق فيه آيات علّمتها «حفظتها».' : 'ما لقيناش آية مناسبة في النطاق ده (محتاجة توقيت كلمات للقارئ). غيّر النطاق أو القارئ.'); setPhase(rounds.length ? 'score' : 'setup'); return; }
    setCur({ ayah: picked });
    setPhase('recite');
  }

  // A range inside ONE surah makes «في أي سورة؟» pointless: skipped, the ayah carries the 10.
  const pool = useMemo(() => surahsOfRange({ start: range.start, end: range.end - 1 }), [range.start, range.end]);
  const oneSurah = pool.length === 1;

  function settle(base: { ayah: PickedAyah; result: RoundResult }, ok: boolean | null) {
    const sc = tarteelRoundScore(base.result, ok);
    setRounds((r) => [...r, { ayah: base.ayah, result: base.result, surahOk: ok, ...sc }]);
    setCur({ ...base, surahOk: ok });
    setPhase('score');
  }

  function onRecited(result: RoundResult) {
    if (!cur) return;
    if (oneSurah) { settle({ ayah: cur.ayah, result }, null); return; }
    setCur({ ayah: cur.ayah, result });
    setPhase('surah');
  }

  function answerSurah(s: number) {
    if (!cur?.result) return;
    settle({ ayah: cur.ayah, result: cur.result }, s === cur.ayah.surah);
  }

  const final40 = tarteelFinal(rounds.map((r) => r.total));

  function save() {
    if (saved.current || rounds.length === 0) return;
    saved.current = true;
    const ear = rounds[rounds.length - 1].result.ear;
    addTestHistoryV1({
      ts: new Date().toISOString(),
      level: currentHistoryLevel(),
      score: Math.round((final40 / 40) * 100),
      correct: final40,
      attempted: 40,
      completed: true,
      mode: 'ayah',
      ear: ear === 'manual' ? 'manual' : ear,
      label: `ترتيل — ${rangeLabel()} (${arNum(rounds.length)} جولة)`,
      kind: 'tarteel',
    });
  }
  function rangeLabel(): string {
    if (scope === 'juz') return num === toNum ? `الجزء ${arNum(num)}` : `الأجزاء ${arNum(num)}–${arNum(toNum)}`;
    return scope === 'surah' ? `سورة ${surahNameOf(num)}` : unitPickLabel(scope, num);
  }
  const closeAll = () => { save(); onClose(); };
  useEscapeClose(true, closeAll);

  const lastRound = rounds[rounds.length - 1];
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={closeAll}>
      <div dir="rtl" role="dialog" aria-modal="true" aria-label="اختبار الترتيل" className={`bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 shadow-xl ${phase === 'setup' ? 'min-h-[80vh] flex flex-col' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-accent-800">اختبار الترتيل</h2>
          <button onClick={closeAll} className="text-accent-600 font-bold px-2">إغلاق</button>
        </div>

        {phase === 'setup' && (
          <div className="flex-1 flex flex-col justify-evenly gap-3">
            <p className="text-base text-accent-600 mb-2">اختار النطاق اللي عايز تتختبر فيه</p>
            {loadHifzCorpus() && <p className="text-sm font-semibold text-emerald-800 -mt-2">الأسئلة من محفوظك فقط (الآيات اللي علّمتها «حفظتها»).</p>}
            <div className="grid grid-cols-4 gap-2 mb-4">
              {(Object.keys(SCOPE_LABEL) as Scope[]).map((k) => (
                <button key={k} onClick={() => { setScope(k); setNum(1); setToNum(1); }}
                  className={`py-4 rounded-xl text-base font-bold ${scope === k ? 'grad-emerald-door text-white' : 'bg-gray-100 text-accent-600'}`}>
                  {SCOPE_LABEL[k]}
                </button>
              ))}
            </div>
            {scope === 'juz' ? (
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div>
                  <label className="block text-sm text-accent-700 mb-1">من جزء</label>
                  <DrumSelect label="من جزء" value={num} onChange={(v) => { setNum(v); if (toNum < v) setToNum(v); }}
                    options={Array.from({ length: count }, (_, i) => i + 1).map((n) => ({ value: n, label: `الجزء ${n}` }))} />
                </div>
                <div>
                  <label className="block text-sm text-accent-700 mb-1">إلى جزء</label>
                  <DrumSelect label="إلى جزء" value={toNum} onChange={setToNum}
                    options={Array.from({ length: count - num + 1 }, (_, i) => num + i).map((n) => ({ value: n, label: `الجزء ${n}` }))} />
                </div>
              </div>
            ) : (
              <>
                <label className="block text-sm text-accent-700 mb-1">{SCOPE_LABEL[scope]}</label>
                <div className="mb-4">
                  <DrumSelect label={SCOPE_LABEL[scope]} value={num} onChange={setNum}
                    options={Array.from({ length: count }, (_, i) => i + 1).map((n) => ({
                      value: n,
                      label: scope === 'surah' ? `${n} - ${surahNameOf(n)}` : unitPickLabel(scope, n),
                    }))} />
                </div>
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
            {options.length > 0 && (
              <>
                <p className="text-sm text-accent-700 mb-1">القرّاء اللي عندهم توقيت كلمات للنطاق ده</p>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {options.map((f) => (
                    <button key={f} type="button" onClick={() => setReciterId(f)}
                      className={`py-4 px-2 rounded-xl text-base font-bold ${activeId === f ? 'grad-amber-door text-white' : 'bg-gray-100 text-accent-700'}`}>{reciterName(f)}</button>
                  ))}
                </div>
              </>
            )}
            <RoundCutPicker />
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
            {err && <p className="text-sm text-amber-700 mb-3">{err}</p>}
            {!text && (
              <p className="text-sm text-amber-700 mb-3">
                {textFailed ? (
                  <>ما قدرناش نحمّل نص القرآن — اتأكد من النت. <button type="button" onClick={loadText} className="underline font-bold">جرّب تاني</button></>
                ) : 'بنحمّل نص القرآن… الزرار هيتفعّل أول ما يخلص.'}
              </p>
            )}
            <button onClick={() => void nextRound()} disabled={!canStart} className="w-full py-4 text-lg grad-emerald-door text-white font-bold rounded-xl disabled:opacity-50">ابدأ</button>
          </div>
        )}

        {phase === 'loading' && <p className="text-center text-accent-700 font-bold py-8">بنجهّز الجولة…</p>}
        {/* ?debug=1: keep the last «خلصت» snapshot visible after the round screen is gone. */}
        {(phase === 'surah' || phase === 'score') && <RoundDebugOverlay />}

        {phase === 'recite' && cur && (
          <>
            <p className="text-xs text-accent-600 mb-2">الجولة {arNum(rounds.length + 1)} · القارئ: {reciterName(cur.ayah.folder)}</p>
            <RoundRecite key={rounds.length} ayah={cur.ayah} corrections={ROUND_CORRECTIONS} onFinish={onRecited} />
          </>
        )}

        {phase === 'surah' && cur?.result && (
          <SurahTiles key={rounds.length} correct={cur.ayah.surah} pool={pool} onAnswer={answerSurah} />
        )}

        {phase === 'score' && cur?.result && lastRound && (
          <>
            <RoundReveal ayah={cur.ayah} result={cur.result} />
            <p className="text-sm text-accent-700 mt-1">{surahNameOf(cur.ayah.surah)} — آية {arNum(cur.ayah.ayah)}</p>
            <div className="bg-gray-50 rounded-lg p-3 border border-emerald-100 my-3 text-sm text-accent-800 space-y-1">
              <p>إكمال الآية: {arNum(lastRound.completion)} من {arNum(lastRound.surahOk === null ? 10 : 8)} ({arNum(cur.result.credited)} من {arNum(cur.result.total)} كلمة)</p>
              {lastRound.surahOk !== null && <p>السورة: {lastRound.surahOk ? '✓ صح' : '✗ غلط'} — {arNum(lastRound.surah)} من ٢</p>}
              {cur.result.extras > 0 && <p className="text-amber-700">طلبت «كلمتين كمان» {arNum(cur.result.extras)} مرة — خصم {arNum(cur.result.extras * HINT_COST * 100)}٪ من درجة الآية</p>}
              <p className="font-bold">درجة الجولة: {arNum(lastRound.total)} من ١٠</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => void nextRound()} className="py-3 grad-emerald-door text-white font-bold rounded-xl">جولة تانية</button>
              <button onClick={() => { save(); setPhase('summary'); }} className="py-3 grad-amber-door text-white font-bold rounded-xl">خلاص</button>
            </div>
            {err && <p className="text-sm text-amber-700 mt-2">{err}</p>}
          </>
        )}

        {phase === 'summary' && (
          <div className="text-center">
            <p className="text-sm text-accent-600">درجتك النهائية</p>
            <p className="text-4xl font-bold text-emerald-700 my-1">{arNum(final40)}</p>
            <p className="text-accent-600 mb-3">من ٤٠ — متوسط {arNum(rounds.length)} جولة × ٤</p>
            <div className="space-y-1 text-right mb-4">
              {rounds.map((r, i) => (
                <p key={i} className="text-sm text-accent-700">الجولة {arNum(i + 1)}: {surahNameOf(r.ayah.surah)} آية {arNum(r.ayah.ayah)} — {arNum(r.total)} من ١٠ {r.surahOk === null ? '' : r.surahOk ? '✓' : '✗'}</p>
              ))}
            </div>
            <button onClick={() => { saved.current = false; setRounds([]); used.current = new Set(); setCur(null); setPhase('setup'); }} className="w-full py-3 grad-emerald-door text-white font-bold rounded-xl">اختبار جديد</button>
          </div>
        )}
      </div>
    </div>
  );
}
