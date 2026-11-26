// «سجل الدرجات» (W4-D): last 100 tests + a progress curve pinned to one
// grading level (tabs). Plain SVG, no chart library.
import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { HISTORY_LEVEL_LABEL, TEST_KIND_LABEL, kindOf, deleteTestHistoryEntry, undoDeleteTestHistoryEntry, deleteAllTestHistory, undoDeleteAll, type HistoryLevel, type TestHistoryEntry, type TestKind } from '../lib/testHistory';
import { askConfirm } from '../lib/confirmSheet';

// W4-O: the curve + average are computed on a chosen period only. The period
// uses each entry's stored `ts` (every V1 entry has one; the old
// 'quran-test-history' log is never read here and stays untouched).
type Period =
  | { k: 'all' }
  | { k: 'days'; n: number }
  | { k: 'greg'; y: number; m: number }   // m: 1-12
  | { k: 'hijri'; y: number; m: number }  // m: 1-12 (9 = رمضان)
  | { k: 'range'; from: string; to: string }; // 'YYYY-MM-DD' (either may be '')

const HIJRI_MONTHS = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
const GREG_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const HIJRI_FMT = (() => { try { return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric', month: 'numeric' }); } catch { return null; } })();

function hijriOf(d: Date): { y: number; m: number } | null {
  if (!HIJRI_FMT) return null;
  try {
    const parts = HIJRI_FMT.formatToParts(d);
    const y = Number(parts.find((p) => p.type === 'year')?.value);
    const m = Number(parts.find((p) => p.type === 'month')?.value);
    return Number.isFinite(y) && Number.isFinite(m) ? { y, m } : null;
  } catch { return null; }
}

function inPeriod(ts: string, p: Period, now: Date): boolean {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return p.k === 'all';
  switch (p.k) {
    case 'all': return true;
    case 'days': return d.getTime() >= now.getTime() - p.n * 86400000 && d.getTime() <= now.getTime();
    case 'greg': return d.getFullYear() === p.y && d.getMonth() + 1 === p.m;
    case 'hijri': { const h = hijriOf(d); return !!h && h.y === p.y && h.m === p.m; }
    case 'range': {
      const from = p.from ? new Date(`${p.from}T00:00:00`).getTime() : -Infinity;
      const to = p.to ? new Date(`${p.to}T23:59:59.999`).getTime() : Infinity;
      return d.getTime() >= from && d.getTime() <= to;
    }
  }
}

function periodLabel(p: Period): string {
  const ar0 = (n: number) => n.toLocaleString('ar-EG', { useGrouping: false });
  switch (p.k) {
    case 'all': return 'كل الفترات';
    case 'days': return p.n === 30 ? 'آخر ٣٠ يوم' : p.n === 90 ? 'آخر ٣ شهور' : `آخر ${ar0(p.n)} يوم`;
    case 'greg': return `${GREG_MONTHS[p.m - 1]} ${ar0(p.y)}`;
    case 'hijri': return `${HIJRI_MONTHS[p.m - 1]} ${ar0(p.y)} هـ`;
    case 'range': return `${p.from || '…'} ← ${p.to || '…'}`;
  }
}

/** Latest occurrence (not in the future) of a Gregorian / Hijri month. */
function latestGreg(m: number, now: Date): Period {
  return { k: 'greg', y: now.getMonth() + 1 >= m ? now.getFullYear() : now.getFullYear() - 1, m };
}
function latestHijri(m: number, now: Date): Period {
  const h = hijriOf(now);
  if (!h) return { k: 'all' };
  return { k: 'hijri', y: h.m >= m ? h.y : h.y - 1, m };
}
function step(p: Period, dir: 1 | -1): Period {
  if (p.k !== 'greg' && p.k !== 'hijri') return p;
  let m = p.m + dir, y = p.y;
  if (m > 12) { m = 1; y += 1; } else if (m < 1) { m = 12; y -= 1; }
  return { ...p, y, m };
}

const ar = (n: number) => n.toLocaleString('ar-EG');

function when(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function Curve({ points }: { points: TestHistoryEntry[] }) {
  // points: oldest → newest
  const W = 320, H = 140, L = 30, R = 8, T = 10, B = 18;
  const n = points.length;
  const x = (i: number) => (n <= 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + ((100 - v) * (H - T - B)) / 100;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="منحنى تطور الدرجات" direction="ltr">
      {[0, 50, 100].map((g) => (
        <g key={g}>
          <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="currentColor" className="text-accent-200" strokeWidth={1} strokeDasharray={g === 0 ? undefined : '3 3'} />
          <text x={L - 4} y={y(g) + 4} textAnchor="end" fontSize={10} className="fill-accent-500">{ar(g)}٪</text>
        </g>
      ))}
      {n > 1 && <path d={path} fill="none" stroke="#047857" strokeWidth={2} strokeLinejoin="round" />}
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.score)} r={3.5} fill={p.completed ? '#047857' : '#ffffff'} stroke="#047857" strokeWidth={1.5}>
          <title>{`${when(p.ts)} — ${p.score}%${p.completed ? '' : ' (ما كملش)'}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export default function TestHistoryPanel({ entries, initialLevel, onChange }: {
  entries: TestHistoryEntry[];
  initialLevel: HistoryLevel;
  /** 17.7: the visible list after a delete / undo. */
  onChange?: (list: TestHistoryEntry[]) => void;
}) {
  // 17.7: delete is a tombstone with a few seconds of «تراجع».
  const [undo, setUndo] = useState<{ text: string; run: () => TestHistoryEntry[] } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(t);
  }, [undo]);
  const removeOne = (e: TestHistoryEntry) => {
    onChange?.(deleteTestHistoryEntry(e.ts));
    setUndo({ text: `اتمسح «${e.label}»`, run: () => undoDeleteTestHistoryEntry(e.ts) });
  };
  const removeAll = async () => {
    if (!(await askConfirm({ text: 'تمسح كل السجل؟ تقدر ترجّعه بـ«تراجع» خلال ثواني.', confirmLabel: 'امسح الكل', danger: true }))) return;
    const { list, mark } = deleteAllTestHistory();
    onChange?.(list);
    setUndo({ text: 'اتمسح السجل كله', run: () => undoDeleteAll(mark) });
  };
  const levels: HistoryLevel[] = ['beginner', 'advanced'];
  const [level, setLevel] = useState<HistoryLevel>(levels.includes(initialLevel) ? initialLevel : 'beginner');
  const visible = entries;
  // W4-E: tarteel / comprehensive scores are out of 40: each kind has its own curve.
  const kinds = useMemo(() => (['tasmee', 'tarteel', 'comprehensive'] as TestKind[]).filter((k) => visible.some((e) => kindOf(e) === k)), [visible]);
  const [kind, setKind] = useState<TestKind>('tasmee');
  const ofLevel = useMemo(() => visible.filter((e) => e.level === level && kindOf(e) === kind), [visible, level, kind]);
  const [period, setPeriod] = useState<Period>({ k: 'all' });
  const [calendar, setCalendar] = useState<'greg' | 'hijri'>('greg');
  const now = useMemo(() => new Date(), []);
  const inRange = useMemo(() => ofLevel.filter((e) => inPeriod(e.ts, period, now)), [ofLevel, period, now]);
  // Item 2.14(a): a self-assessment (graded by hand) is listed with a tag
  // but kept out of the curve and the average — they measure the ear's
  // verdicts, not self-grading.
  const measured = useMemo(() => inRange.filter((e) => e.ear !== 'manual'), [inRange]);
  const curve = useMemo(() => [...measured].reverse(), [measured]);
  // Item 16.10: the average and the count use finished tests only; an
  // abandoned test's partial score would drag the average down unfairly.
  // The curve still shows every test (hollow point = not finished).
  const done = useMemo(() => measured.filter((e) => e.completed === true), [measured]);
  const avg = done.length ? Math.round(done.reduce((a, e) => a + e.score, 0) / done.length) : 0;
  const unfinished = measured.length - done.length;
  const selfGraded = inRange.length - measured.length;
  const hijriOk = HIJRI_FMT !== null && hijriOf(now) !== null;
  const chip = (label: string, on: boolean, onClick: () => void) => (
    <button type="button" key={label} onClick={onClick}
      className={`min-h-[44px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap ${on ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-accent-700'}`}>{label}</button>
  );
  const thisMonth: Period = { k: 'greg', y: now.getFullYear(), m: now.getMonth() + 1 };
  const same = (a: Period, b: Period) => JSON.stringify(a) === JSON.stringify(b);
  const monthMode = period.k === 'greg' || period.k === 'hijri';

  return (
    <div dir="rtl" className="bg-white rounded-2xl border border-hairline-emerald shadow-sm p-4 space-y-3">
      <h2 className="font-semibold text-accent-800">سجل الدرجات ومنحنى التطور</h2>
      <div className={`grid ${levels.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5`}>
        {levels.map((lv) => (
          <button key={lv} type="button" onClick={() => setLevel(lv)}
            className={`min-h-[44px] rounded-xl text-sm font-semibold polish-press ${level === lv ? 'grad-amber-door text-white' : 'bg-white border border-hairline text-accent-700'}`}>
            {HISTORY_LEVEL_LABEL[lv]}
          </button>
        ))}
      </div>
      {kinds.length > 1 && (
        <div className="flex gap-1.5">
          {kinds.map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`flex-1 min-h-[44px] rounded-lg text-xs font-semibold ${kind === k ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-accent-700'}`}>{TEST_KIND_LABEL[k]}</button>
          ))}
        </div>
      )}
      {ofLevel.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-accent-700">الفترة</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {chip('الكل', period.k === 'all', () => setPeriod({ k: 'all' }))}
            {chip('آخر ٣٠ يوم', same(period, { k: 'days', n: 30 }), () => setPeriod({ k: 'days', n: 30 }))}
            {chip('آخر ٣ شهور', same(period, { k: 'days', n: 90 }), () => setPeriod({ k: 'days', n: 90 }))}
            {chip('الشهر ده', same(period, thisMonth), () => { setCalendar('greg'); setPeriod(thisMonth); })}
            {hijriOk && chip('رمضان', period.k === 'hijri' && period.m === 9, () => { setCalendar('hijri'); setPeriod(latestHijri(9, now)); })}
            {chip('سبتمبر', period.k === 'greg' && period.m === 9, () => { setCalendar('greg'); setPeriod(latestGreg(9, now)); })}
            {chip('من تاريخ لتاريخ', period.k === 'range', () => setPeriod({ k: 'range', from: '', to: '' }))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-accent-600">شهر محدد:</span>
            {chip('ميلادي', calendar === 'greg', () => { setCalendar('greg'); setPeriod(thisMonth); })}
            {hijriOk && chip('هجري', calendar === 'hijri', () => { setCalendar('hijri'); setPeriod(latestHijri(hijriOf(now)!.m, now)); })}
            {monthMode && (
              <span className="flex items-center gap-1 mr-auto">
                <button type="button" aria-label="الشهر اللي بعده" onClick={() => setPeriod(step(period, 1))} className="min-h-[44px] min-w-[44px] rounded-lg bg-gray-100 text-accent-700">›</button>
                <span className="text-xs font-semibold text-accent-800 min-w-[96px] text-center">{periodLabel(period)}</span>
                <button type="button" aria-label="الشهر اللي قبله" onClick={() => setPeriod(step(period, -1))} className="min-h-[44px] min-w-[44px] rounded-lg bg-gray-100 text-accent-700">‹</button>
              </span>
            )}
          </div>
          {period.k === 'range' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-accent-600">من
                <input type="date" value={period.from} max={period.to || undefined} onChange={(e) => setPeriod({ ...period, from: e.target.value })}
                  className="block w-full min-h-[40px] rounded-lg border border-hairline px-2 text-sm text-accent-800" />
              </label>
              <label className="text-xs text-accent-600">إلى
                <input type="date" value={period.to} min={period.from || undefined} onChange={(e) => setPeriod({ ...period, to: e.target.value })}
                  className="block w-full min-h-[40px] rounded-lg border border-hairline px-2 text-sm text-accent-800" />
              </label>
            </div>
          )}
        </div>
      )}
      {ofLevel.length === 0 ? (
        <p className="text-sm text-accent-600">مفيش اختبارات على مستوى «{HISTORY_LEVEL_LABEL[level]}» لسه.</p>
      ) : inRange.length === 0 ? (
        <p className="text-sm text-amber-link bg-amber-50 rounded-xl px-3 py-2">مفيش اختبارات في الفترة دي ({periodLabel(period)}) على مستوى «{HISTORY_LEVEL_LABEL[level]}». جرّب فترة تانية.</p>
      ) : (
        <>
          <p className="text-xs text-accent-600">المنحنى لمستوى «{HISTORY_LEVEL_LABEL[level]}» بس، عشان المقارنة تبقى حقيقية. النقطة المفرّغة = اختبار ما كملش.</p>
          <p className="text-sm text-accent-800">
            {done.length > 0
              ? <>{periodLabel(period)}: <span className="font-bold text-emerald-700">متوسط {ar(avg)}٪</span> في {ar(done.length)} اختبار مكتمل</>
              : <>{periodLabel(period)}: مفيش اختبار مكتمل لسه، فمفيش متوسط.</>}
            {unfinished > 0 && <span className="text-accent-600"> (و{ar(unfinished)} ما كملوش، مش داخلين في المتوسط)</span>}
            {selfGraded > 0 && <span className="text-accent-600"> (و{ar(selfGraded)} تقييم ذاتي، مش داخلين في المنحنى ولا المتوسط)</span>}
          </p>
          <Curve points={curve} />
        </>
      )}
      {undo && (
        <div role="status" className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 border border-hairline-amber px-3 py-2 text-sm text-accent-800">
          <span className="min-w-0 truncate">{undo.text}</span>
          <button type="button" onClick={() => { onChange?.(undo.run()); setUndo(null); }}
            className="min-h-[44px] px-4 rounded-lg bg-white border border-hairline-amber font-bold text-amber-link">تراجع</button>
        </div>
      )}
      {visible.length > 0 && onChange && (
        <div className="flex justify-end">
          <button type="button" onClick={() => void removeAll()} className="min-h-[44px] px-3 text-xs font-semibold text-red-700">امسح السجل كله</button>
        </div>
      )}
      {visible.length > 0 && (
        <ul className="divide-y divide-hairline text-sm max-h-80 overflow-y-auto">
          {visible.map((e, i) => (
            <li key={e.ts || i} className="py-2">
              <div className="flex items-center justify-between gap-2">
              <span className="text-accent-700 min-w-0 truncate">{e.label}</span>
              <span className="font-bold text-emerald-700 whitespace-nowrap">{ar(e.score)}٪</span>
              {e.ear === 'manual' && <span className="text-xs text-amber-link whitespace-nowrap">تقييم ذاتي</span>}
              <span className={`text-xs whitespace-nowrap ${e.completed ? 'text-emerald-700' : 'text-amber-link'}`}>{e.completed ? 'كمّل' : 'ما كملش'}</span>
              <span className="text-xs text-ink-2 whitespace-nowrap">{HISTORY_LEVEL_LABEL[e.level]}</span>
              <span className="text-xs text-accent-400 whitespace-nowrap">{when(e.ts)}</span>
              {onChange && (
                <button type="button" onClick={() => removeOne(e)} aria-label={`امسح ${e.label}`}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-ink-2 hover:bg-red-50 hover:text-red-700">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              </div>
              {/* 17.11: where the words went wrong, per position. */}
              {e.wrong && e.wrong.length > 0 && (
                <p className="text-xs text-accent-600 mt-1 leading-relaxed">
                  {e.wrong.map((w) => `آية ${w.ayah.split(':').map((n) => ar(Number(n))).join(':')}: ${w.words.join('، ')}`).join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
