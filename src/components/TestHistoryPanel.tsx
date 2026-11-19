// «سجل الدرجات» (W4-D): last 100 tests + a progress curve pinned to one
// grading level (tabs). Plain SVG, no chart library.
import { useMemo, useState } from 'react';
import { HISTORY_LEVEL_LABEL, type HistoryLevel, type TestHistoryEntry } from '../lib/testHistory';

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

export default function TestHistoryPanel({ entries, showMaster, initialLevel }: {
  entries: TestHistoryEntry[];
  /** «متقن» tab only in the admin view. */
  showMaster: boolean;
  initialLevel: HistoryLevel;
}) {
  const levels: HistoryLevel[] = showMaster ? ['beginner', 'advanced', 'master'] : ['beginner', 'advanced'];
  const [level, setLevel] = useState<HistoryLevel>(levels.includes(initialLevel) ? initialLevel : 'beginner');
  const visible = useMemo(() => entries.filter((e) => showMaster || e.level !== 'master'), [entries, showMaster]);
  const ofLevel = useMemo(() => visible.filter((e) => e.level === level), [visible, level]);
  const curve = useMemo(() => [...ofLevel].reverse(), [ofLevel]);

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
      {ofLevel.length === 0 ? (
        <p className="text-sm text-accent-600">مفيش اختبارات على مستوى «{HISTORY_LEVEL_LABEL[level]}» لسه.</p>
      ) : (
        <>
          <p className="text-xs text-accent-600">المنحنى لمستوى «{HISTORY_LEVEL_LABEL[level]}» بس، عشان المقارنة تبقى حقيقية. النقطة المفرّغة = اختبار ما كملش.</p>
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
