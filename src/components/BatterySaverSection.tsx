// «توفير البطارية» sub-page (W3-S2), opened from the Settings hub door.
// One master switch (the old «وضع التوفير», same storage key) plus one
// switch per effect, each with a one-line explanation and an honest effect
// size. The screen keeps awake in the Mushaf / tasmee / Listen pages no
// matter what is chosen here (useKeepAwake is not touched by this mode).
import { useSyncExternalStore } from 'react';
import { ScreenShare } from 'lucide-react';
import LiteModeButton from './LiteModeButton';
import { LITE_OPTIONS, isLite, isLiteOption, liteSnapshot, setLiteOption, subscribeLite } from '../lib/liteMode';
import { pressFeedback } from '../lib/pressFeedback';

const IMPACT: Record<'high' | 'med' | 'low', { label: string; cls: string }> = {
  high: { label: 'أثر كبير', cls: 'bg-emerald-100 text-emerald-800' },
  med: { label: 'أثر متوسط', cls: 'bg-amber-100 text-amber-800' },
  low: { label: 'أثر صغير', cls: 'bg-gray-100 text-accent-700' },
};

export default function BatterySaverSection() {
  useSyncExternalStore(subscribeLite, liteSnapshot, () => '');
  const on = isLite();
  return (
    <div className="space-y-4">
      <p className="text-sm text-accent-700 leading-relaxed">
        بيقلل شغل الشاشة والمعالج. اختار اللي يناسبك.
      </p>
      <LiteModeButton />
      <section className="glass-card rounded-2xl p-4 space-y-3" aria-label="خيارات التوفير">
        {!on && <p className="text-xs text-accent-600">الخيارات دي بتشتغل لما تشغّل وضع التوفير فوق.</p>}
        {LITE_OPTIONS.map((o) => {
          const enabled = isLiteOption(o.id);
          const imp = IMPACT[o.impact];
          return (
            <button
              key={o.id}
              type="button"
              onPointerDown={pressFeedback}
              onClick={() => setLiteOption(o.id, !enabled)}
              aria-pressed={enabled}
              className="w-full flex items-center gap-3 p-3 rounded-xl border-2 border-hairline text-start polish-press"
            >
              <span className="flex-1 min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-accent-800">{o.title}</span>
                  <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${imp.cls}`}>{imp.label}</span>
                </span>
                <span className="block text-sm text-accent-600 mt-0.5">{o.hint}</span>
              </span>
              <span className={`w-12 h-7 rounded-full p-1 transition-smooth shrink-0 ${enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                <span className={`block w-5 h-5 bg-white rounded-full shadow transition-smooth ${enabled ? 'mr-auto' : ''}`} />
              </span>
            </button>
          );
        })}
      </section>
      <section className="rounded-2xl border border-hairline-emerald bg-emerald-50 p-4 flex gap-3">
        <ScreenShare className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-accent-800 leading-relaxed">
          الشاشة بتفضل صاحية وإنت في المصحف أو التسميع أو الاستماع، حتى والتوفير شغّال. محدش من الخيارات دي بيفكّها.
        </p>
      </section>
    </div>
  );
}
