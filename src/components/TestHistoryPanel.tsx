// «سجل الدرجات» (W4-D): last 100 tests + a progress curve pinned to one
// grading level (tabs). Plain SVG, no chart library.
import { useMemo, useState } from 'react';
import { HISTORY_LEVEL_LABEL, TEST_KIND_LABEL, kindOf, type HistoryLevel, type TestHistoryEntry, type TestKind } from '../lib/testHistory';

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

export default function TestHistoryPanel({ entries, initialLevel }: {
  entries: TestHistoryEntry[];
  initialLevel: HistoryLevel;
}) {
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
  const curve = useMemo(() => [...inRange].reverse(), [inRange]);
  // Item 16.10: the average and the count use finished tests only; an
  // abandoned test's partial score would drag the average down unfairly.
  // The curve still shows every test (hollow point = not finished).
  const done = useMemo(() => inRange.filter((e) => e.completed === true), [inRange]);
  const avg = done.length ? Math.round(done.reduce((a, e) => a + e.score, 0) / done.length) : 0;
  const unfinished = inRange.length - done.length;
  const hijriOk = HIJRI_FMT !== null && hijriOf(now) !== null;
  const chip = (label: string, on: boolean, onClick: () => void) => (
    <button type="button" key={label} onClick={onClick}
      className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap ${on ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-accent-700'}`}>{label}</button>
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
              className={`flex-1 min-h-[36px] rounded-lg text-xs font-semibold ${kind === k ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-accent-700'}`}>{TEST_KIND_LABEL[k]}</button>
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
                <button type="button" aria-label="الشهر اللي بعده" onClick={() => setPeriod(step(period, 1))} className="min-h-[36px] min-w-[36px] rounded-lg bg-gray-100 text-accent-700">›</button>
                <span className="text-xs font-semibold text-accent-800 min-w-[96px] text-center">{periodLabel(period)}</span>
                <button type="button" aria-label="الشهر اللي قبله" onClick={() => setPeriod(step(period, -1))} className="min-h-[36px] min-w-[36px] rounded-lg bg-gray-100 text-accent-700">‹</button>
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
          </p>
          <Curve points={curve} />
        </>
      )}
      {visible.length > 0 && (
        <ul className="divide-y divide-hairline text-sm max-h-80 overflow-y-auto">
          {visible.map((e, i) => (
            <li key={i} className="py-2 flex items-center justify-between gap-2">
              <span className="text-accent-700 min-w-0 truncate">{e.label}</span>
              <span className="font-bold text-emerald-700 whitespace-nowrap">{ar(e.score)}٪</span>
              <span className={`text-xs whitespace-nowrap ${e.completed ? 'text-emerald-700' : 'text-amber-link'}`}>{e.completed ? 'كمّل' : 'ما كملش'}</span>
              <span className="text-xs text-accent-500 whitespace-nowrap">{HISTORY_LEVEL_LABEL[e.level]}</span>
              <span className="text-xs text-accent-400 whitespace-nowrap">{when(e.ts)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
