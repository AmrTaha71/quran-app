// 10.15 (phase 6): moved out of ListenPage.tsx unchanged.
import { useState } from 'react';
import { RECITERS } from '../../lib/reciters';
import type { VariedPlan } from '../../lib/threeModeListen';
import { readVariedPlan, writeVariedPlan } from '../../lib/threeModeListen';

// Varied khatma reciter choice (2026-11-07): rotation (default), the
// user's own order, or a random pick from a chosen set.
export default function VariedPlanPanel() {
  const [plan, setPlan] = useState<VariedPlan>(() => readVariedPlan());
  const ids = RECITERS.map((r) => r.id);
  const chosen = plan.kind === 'rotate' ? [] : plan.ids;
  const update = (next: VariedPlan) => { setPlan(next); writeVariedPlan(next); };
  const toggle = (id: string) => {
    const list = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    if (plan.kind === 'random') update({ kind: 'random', ids: list, seed: plan.seed });
    else if (plan.kind === 'order') update({ kind: 'order', ids: list });
  };
  const mode = (kind: 'rotate' | 'order' | 'random') => {
    if (kind === 'rotate') update({ kind: 'rotate' });
    else if (kind === 'order') update({ kind: 'order', ids: chosen.length ? chosen : ids.slice(0, 4) });
    else update({ kind: 'random', ids: chosen.length ? chosen : ids, seed: Math.floor(Math.random() * 1e6) + 1 });
  };
  const label = (id: string) => RECITERS.find((r) => r.id === id)?.name ?? id;
  const btn = (active: boolean) =>
    `py-3 px-3 rounded-xl text-base font-bold ${active ? 'grad-emerald-door text-white' : 'bg-white border border-hairline-emerald text-accent-800'}`;
  return (
    <div className="bg-white rounded-2xl border border-hairline-emerald p-4 mt-4">
      <p className="font-semibold text-accent-800 mb-3">القراء في الختمة المنوعة</p>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <button className={btn(plan.kind === 'rotate')} onClick={() => mode('rotate')}>بالترتيب الثابت</button>
        <button className={btn(plan.kind === 'order')} onClick={() => mode('order')}>أختار الترتيب</button>
        <button className={btn(plan.kind === 'random')} onClick={() => mode('random')}>عشوائي</button>
      </div>
      {plan.kind !== 'rotate' && (
        <>
          <p className="text-sm text-accent-600 mb-2">
            {plan.kind === 'order' ? 'اضغط القراء بالترتيب اللي تحبه: كل ربع يأخذ القارئ اللي بعده.' : 'اختار القراء اللي تحب يدخلوا في الاختيار العشوائي.'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {RECITERS.map((r) => {
              const idx = chosen.indexOf(r.id);
              const on = idx >= 0;
              return (
                <button key={r.id} onClick={() => toggle(r.id)}
                  className={`py-3 px-2 rounded-xl text-base font-bold ${on ? 'grad-amber-door text-white' : 'bg-gray-100 text-accent-600'}`}>
                  {plan.kind === 'order' && on ? `${idx + 1}. ` : ''}{label(r.id)}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
