import { useSyncExternalStore } from 'react';
import { BatteryCharging, BatteryFull } from 'lucide-react';
import { isLite, setLite, subscribeLite } from '../lib/liteMode';

/** One tap: «وضع التوفير» on/off. */
export default function LiteModeButton({ className = '' }: { className?: string }) {
  const lite = useSyncExternalStore(subscribeLite, isLite, () => false);
  return (
    <button
      type="button"
      onClick={() => setLite(!lite)}
      aria-pressed={lite}
      className={`w-full flex items-center justify-between gap-3 p-3 rounded-xl border-2 transition-smooth ${lite ? 'border-emerald-500 bg-emerald-50' : 'border-hairline bg-white'} ${className}`}
    >
      <span className="flex items-center gap-2 font-bold text-accent-800">
        {lite ? <BatteryCharging className="w-5 h-5 text-emerald-600" /> : <BatteryFull className="w-5 h-5 text-accent-600" />}
        {lite ? 'وضع التوفير شغّال' : 'وضع التوفير'}
      </span>
      <span className={`text-sm font-semibold ${lite ? 'text-emerald-700' : 'text-accent-600'}`}>{lite ? 'اضغط للرجوع للعادي' : 'للبطارية الضعيفة'}</span>
    </button>
  );
}
