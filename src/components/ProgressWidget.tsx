import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { TOTAL_VERSES } from '../lib/types';
import CircularProgressIndicator from './CircularProgressIndicator';
import { TrendingUp, Bookmark, BookOpen, BarChart3 } from 'lucide-react';

export default function ProgressWidget() {
  const [stats, setStats] = useState({
    totalVerses: TOTAL_VERSES,
    indexedVerses: 0,
    withLinks: 0,
    withoutLinks: 0,
    totalLinks: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { count: indexedCount } = await supabase
        .from('quran_verses')
        .select('*', { count: 'exact', head: true })
        .eq('has_links', true);

      const { count: totalLinks } = await supabase
        .from('ayah_links')
        .select('*', { count: 'exact', head: true });

      const total = TOTAL_VERSES;
      setStats({
        totalVerses: total,
        indexedVerses: indexedCount || 0,
        withLinks: indexedCount || 0,
        withoutLinks: total - (indexedCount || 0),
        totalLinks: totalLinks || 0,
      });
      setLoading(false);
    })();
  }, []);

  const indexedPercent = stats.totalVerses > 0
    ? Math.round((stats.indexedVerses / stats.totalVerses) * 100)
    : 0;

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-emerald-600 to-teal-700 rounded-2xl p-5 shadow-lg animate-pulse h-[140px]" />
    );
  }

  return (
    <div className="bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 rounded-2xl p-5 shadow-lg overflow-hidden relative">
      {/* Decorative blobs */}
      <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
      <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-teal-300/10 rounded-full blur-xl" />

      <div className="relative flex items-center gap-5">
        {/* Circular progress */}
        <CircularProgressIndicator value={indexedPercent} size={110} label="له رابط" />

        {/* Stats grid */}
        <div className="flex-1 grid grid-cols-2 gap-2.5">
          <StatChip
            icon={<Bookmark className="w-3.5 h-3.5" />}
            label="روابط"
            value={stats.totalLinks}
            color="bg-white/15"
          />
          <StatChip
            icon={<BookOpen className="w-3.5 h-3.5" />}
            label="له رابط"
            value={stats.indexedVerses}
            color="bg-white/15"
          />
          <StatChip
            icon={<TrendingUp className="w-3.5 h-3.5" />}
            label="متبقي"
            value={stats.withoutLinks}
            color="bg-white/15"
          />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="relative mt-4 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-emerald-200" />
        <div className="flex-1 h-2 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-300 to-white rounded-full transition-all duration-1000"
            style={{ width: `${indexedPercent}%` }}
          />
        </div>
        <span className="text-xs font-bold text-white tabular-nums">{indexedPercent}%</span>
      </div>
    </div>
  );
}

function StatChip({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg ${color} px-2.5 py-2`}>
      <span className="text-emerald-100">{icon}</span>
      <div className="min-w-0">
        <p className="text-base font-bold text-white leading-none tabular-nums">{value.toLocaleString('ar-EG')}</p>
        <p className="text-xs text-emerald-200 mt-0.5">{label}</p>
      </div>
    </div>
  );
}
