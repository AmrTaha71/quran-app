// The home page (#/home; #/home2 kept for old links): three big entries
// (حفظ / استماع / قراءة), each opening its sub-tabs. Owner decision
// 2026-11-26 (§11.1–2): this is THE home; the old HomeStartPage is hidden.
// Its extra tiles (radio, nearest mosque, qibla, big screen, grandpa page,
// link of the day, QR) are not on the home any more: grandpa mode stays in
// Settings, radio under استماع, the shared room joins استماع (6.2).
import { useState, type ComponentType } from 'react';
import { BookOpen, Brain, ChevronDown } from 'lucide-react';
import CdIcon from '../components/icons/CdIcon';
import type { Route } from '../lib/routes';
import BottomNav from '../components/BottomNav';
import ElderlyHomeScreen from '../components/ElderlyHomeScreen';
import { useElderlyMode } from '../lib/elderlyMode';

type SectionId = 'hifz' | 'listen' | 'read';

// Jasmine Night (owner identity): deep purple + gold + cream, same values as AppLogo.
const PURPLE = '#3A065F', PURPLE_HI = '#4C0B7A', PURPLE_LO = '#24053B';
const GOLD_HI = '#F0C85A', GOLD_LO = '#C9A227', CREAM = '#FFFCF3';
// Faint gold 8-point stars behind the frame.
const PATTERN = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><g fill="#C9A227" opacity="0.10"><rect x="22" y="22" width="12" height="12"/><rect x="22" y="22" width="12" height="12" transform="rotate(45 28 28)"/></g></svg>')}")`;

function Star8({ className = '', fill }: { className?: string; fill: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g fill={fill}><rect x="5" y="5" width="14" height="14" /><rect x="5" y="5" width="14" height="14" transform="rotate(45 12 12)" /></g>
    </svg>
  );
}

function Divider() {
  return (
    <div className="flex items-center justify-center gap-2 my-2" aria-hidden="true">
      <span className="h-px w-16" style={{ background: `linear-gradient(to left, ${GOLD_LO}, transparent)` }} />
      <Star8 className="w-3 h-3" fill={GOLD_LO} />
      <span className="h-px w-16" style={{ background: `linear-gradient(to right, ${GOLD_LO}, transparent)` }} />
    </div>
  );
}

const SECTIONS: {
  id: SectionId;
  title: string;
  Icon: ComponentType<{ className?: string; active?: boolean; spinning?: boolean }>;
  tabs: { label: string; route: Route }[];
}[] = [
  {
    id: 'hifz',
    title: 'حفظ',
    Icon: Brain,
    tabs: [
      { label: 'الحفظ', route: 'hifz' },
      { label: 'سمّع لي', route: 'test' },
      { label: 'الأسئلة', route: 'quiz' },
    ],
  },
  {
    id: 'listen',
    title: 'استماع',
    Icon: CdIcon,
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
  const [pressed, setPressed] = useState<SectionId | null>(null);
  // 7.5: elderly mode keeps its simplified home (it lived in the hidden
  // HomeStartPage before 6.1).
  const elderly = useElderlyMode();
  if (elderly) return <ElderlyHomeScreen onNavigate={onNavigate} />;

  return (
    <main dir="rtl" className="min-h-screen px-4 pt-6 pb-28" style={{ backgroundColor: CREAM, backgroundImage: PATTERN }}>
      {/* Owner 2026-11-28: a framed home, not three bare tiles. Double gold frame, star corners, header medallion. */}
      <div className="relative max-w-md mx-auto rounded-[28px] p-[3px] polish-fade-up" style={{ background: `linear-gradient(160deg, ${GOLD_HI}, ${GOLD_LO})` }}>
        <div className="relative rounded-[25px] px-4 pt-5 pb-6" style={{ background: CREAM }}>
          <div className="pointer-events-none absolute inset-2 rounded-[20px] border" style={{ borderColor: `${GOLD_LO}66` }} />
          {(['top-0 right-0', 'top-0 left-0', 'bottom-0 right-0', 'bottom-0 left-0'] as const).map((pos) => (
            <Star8 key={pos} className={`absolute ${pos} w-5 h-5 -m-2.5`} fill={GOLD_HI} />
          ))}

          <header className="relative text-center mb-5">
            <div className="mx-auto mb-2 w-16 h-16 rounded-full grid place-items-center shadow-md" style={{ background: `radial-gradient(circle at 50% 40%, ${PURPLE_HI}, ${PURPLE_LO})`, boxShadow: `0 0 0 2px ${GOLD_HI}, 0 0 0 5px ${CREAM}, 0 0 0 6px ${GOLD_LO}88` }}>
              <Star8 className="w-8 h-8" fill={GOLD_HI} />
            </div>
            <h1 className="text-xl font-extrabold" style={{ color: PURPLE }}>تربيطات آيات القرآن</h1>
            <Divider />
            <p className="text-sm font-bold text-accent-600">اختار تعمل إيه</p>
          </header>

          <div className="relative space-y-4">
            {SECTIONS.map(({ id, title, Icon, tabs }, n) => {
              const isOpen = open === id;
              return (
                <section key={id} className="rounded-2xl text-white shadow-lg overflow-hidden polish-fade-up"
                  style={{ background: `linear-gradient(150deg, ${PURPLE_HI}, ${PURPLE_LO})`, boxShadow: `inset 0 0 0 1px ${GOLD_HI}55, 0 10px 22px rgba(36,5,59,0.22)`, animationDelay: `${120 + n * 90}ms` }}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : id)}
                    onPointerDown={() => setPressed(id)}
                    onPointerUp={() => setPressed(null)}
                    onPointerLeave={() => setPressed(null)}
                    onPointerCancel={() => setPressed(null)}
                    className="w-full flex items-center gap-4 px-5 py-5 text-2xl font-bold polish-press"
                  >
                    <span className="shrink-0 w-16 h-16 rounded-full grid place-items-center" style={{ boxShadow: `inset 0 0 0 1.5px ${GOLD_HI}aa`, background: 'rgba(255,255,255,0.06)' }}>
                      <Icon className="w-10 h-10 text-amber-300" active={pressed === id} spinning={isOpen} />
                    </span>
                    <span className="flex-1 text-right">{title}</span>
                    <ChevronDown className={`w-6 h-6 text-amber-300 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                  {isOpen && (
                    <div className="grid gap-2 p-3 animate-fade-in" style={{ background: 'rgba(0,0,0,0.18)', borderTop: `1px solid ${GOLD_HI}33` }}>
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

          <figure className="relative mt-6 text-center polish-fade-up" style={{ animationDelay: '420ms' }}>
            <Divider />
            <blockquote className="font-arabic text-lg leading-loose" style={{ color: PURPLE }}>وَلَقَدْ يَسَّرْنَا الْقُرْآنَ لِلذِّكْرِ فَهَلْ مِن مُّدَّكِرٍ</blockquote>
            <figcaption className="text-xs text-accent-500">[القمر: ١٧]</figcaption>
          </figure>
        </div>
      </div>
      <BottomNav current="home" onNavigate={onNavigate} />
    </main>
  );
}
