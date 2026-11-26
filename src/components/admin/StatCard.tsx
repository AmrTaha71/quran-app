// 10.15 (phase 6): moved out of AdminPage.tsx unchanged.
import type React from 'react';

export default function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-hairline-emerald',
    red: 'bg-red-50 text-red-600 border-red-100',
    amber: 'bg-amber-50 text-amber-link border-hairline-amber',
  };
  return (
    <div className={`p-5 rounded-2xl border ${colorMap[color]} flex items-center gap-4 shadow-sm hover:shadow-md transition-smooth`}>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colorMap[color]}`}>{icon}</div>
      <div>
        <p className="text-xs text-accent-600 font-semibold">{label}</p>
        <p className="text-2xl font-bold text-accent-800">{value.toLocaleString('ar-EG')}</p>
      </div>
    </div>
  );
}
