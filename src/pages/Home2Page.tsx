// The home page (#/home; #/home2 kept for old links): three big entries
// (حفظ / استماع / قراءة), each opening its sub-tabs. Owner decision
// 2026-11-26 (§11.1–2): this is THE home; the old HomeStartPage is hidden.
// Its extra tiles (radio, nearest mosque, qibla, big screen, grandpa page,
// link of the day, QR) are not on the home any more: grandpa mode stays in
// Settings, radio under استماع, the shared room joins استماع (6.2).
import { useState } from 'react';
import { BookOpen, Headphones, Brain } from 'lucide-react';
import type { Route } from '../lib/routes';
import BottomNav from '../components/BottomNav';
import ElderlyHomeScreen from '../components/ElderlyHomeScreen';
import { useElderlyMode } from '../lib/elderlyMode';

type SectionId = 'hifz' | 'listen' | 'read';

const SECTIONS: {
  id: SectionId;
  title: string;
  Icon: typeof Brain;
  tabs: { label: string; route: Route }[];
}[] = [
  {
    id: 'hifz',
    title: 'حفظ',
    Icon: Brain,
    tabs: [
      { label: 'الحفظ', route: 'hifz' },
      { label: 'الاختبار', route: 'test' },
      { label: 'الأسئلة', route: 'quiz' },
    ],
  },
  {
    id: 'listen',
    title: 'استماع',
    Icon: Headphones,
    tabs: [
      { label: 'استمع للقرآن', route: 'listen' },
      { label: 'الأذكار', route: 'adhkar' },
      { label: 'الراديو', route: 'radio' },
      { label: 'الغرفة المشتركة', route: 'room' },
    ],
  },
  {
    id: 'read',
    title: 'قراءة',
    Icon: BookOpen,
    tabs: [
      { label: 'المصحف', route: 'mushaf' },
      { label: 'تتبع قراءة الإمام', route: 'follow' },
    ],
  },
];

export default function Home2Page({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const [open, setOpen] = useState<SectionId | null>(null);
  // 7.5: elderly mode keeps its simplified home (it lived in the hidden
  // HomeStartPage before 6.1).
  const elderly = useElderlyMode();
  if (elderly) return <ElderlyHomeScreen onNavigate={onNavigate} />;

  return (
    <main dir="rtl" className="min-h-screen bg-emerald-50 px-4 pt-6 pb-24">
      <h1 className="text-center text-xl font-bold text-emerald-900 mb-5">اختار تعمل إيه</h1>
      <div className="max-w-md mx-auto space-y-4">
        {SECTIONS.map(({ id, title, Icon, tabs }) => {
          const isOpen = open === id;
          return (
            <section key={id} className="rounded-2xl bg-emerald-900 text-white shadow-lg overflow-hidden">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : id)}
                className="w-full flex items-center justify-center gap-3 py-6 text-2xl font-bold polish-press"
              >
                <Icon className="w-9 h-9 text-amber-300" />
                {title}
              </button>
              {isOpen && (
                <div className="grid gap-2 p-3 bg-emerald-800/60">
                  {tabs.map((t) => (
                    <button
                      key={t.route}
                      type="button"
                      onClick={() => onNavigate(t.route)}
                      className="w-full py-3.5 rounded-xl grad-amber-door text-white text-base font-bold polish-press"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <BottomNav current="home" onNavigate={onNavigate} />
    </main>
  );
}
