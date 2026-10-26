import { useState, useEffect } from 'react';
import { Bookmark, BookOpen, Home, Mic, Settings } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow';

/**
 * Bottom navigation, in logical RTL order.
 * In an RTL flex row the first DOM item is the rightmost one, so
 * الرئيسية comes first (rightmost), then لوحتي right after it, then
 * المصحف, then الحق الإمام, then الإعدادات (leftmost).
 */
export default function BottomNav({
  current,
  onNavigate,
}: {
  current: 'app' | 'mushaf' | 'settings' | 'follow';
  onNavigate: (r: Route) => void;
}) {
  // The board's name is the user's kunya when they set one
  // ("لوحة أبو …"), otherwise the plain "لوحتي". Loaded here so the
  // label matches on every page that shows this bar.
  const [appLabel, setAppLabel] = useState('لوحتي');
  useEffect(() => {
    const loadLabel = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) return;
        const { data } = await supabase.from('user_profiles').select('preferred_name').eq('user_id', userId).single();
        if (data?.preferred_name) setAppLabel(`لوحة ${data.preferred_name}`);
      } catch {}
    };
    loadLabel();
  }, []);
  const items = [
    { id: 'home' as const, label: 'الرئيسية', icon: <Home className="w-7 h-7" /> },
    { id: 'app' as const, label: appLabel, icon: <Bookmark className="w-7 h-7" /> },
    { id: 'mushaf' as const, label: 'المصحف', icon: <BookOpen className="w-7 h-7" /> },
    { id: 'follow' as const, label: 'الحق الإمام', icon: <Mic className="w-7 h-7" /> },
    { id: 'settings' as const, label: 'الإعدادات', icon: <Settings className="w-7 h-7" /> },
  ];
  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="fixed bottom-0 right-0 left-0 z-40 bg-white/95 backdrop-blur-md border-t border-emerald-100 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] pb-[calc(0.5rem_+_env(safe-area-inset-bottom))]"
    >
      <div className="max-w-5xl mx-auto flex">
        {items.map((item) => {
          const active = item.id === current;
          return (
            <button
              key={item.id}
              onClick={() => {
                onNavigate(item.id);
              }}
              className={`icon-action flex-1 flex-col py-2 text-sm font-bold transition-smooth ${
                active ? 'text-emerald-700 bg-emerald-50' : 'text-accent-500 hover:bg-gray-50'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
