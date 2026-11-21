// اختبر نفسك as its own screen (W3-H2): ترتيل / المتشابهات / الاختبار
// الشامل. The three games are still the same modals; the parent Home
// owns them (mutOpen is shared with the voice assistant), so this view
// only reports which one to open. Back = bottom-left control.
import { Award } from 'lucide-react';
import PageHeader from '../PageHeader';
import BottomBackBar from '../BottomBackBar';
import BottomNav from '../BottomNav';
import { pressFeedback } from '../../lib/pressFeedback';
import type { Route } from '../../lib/routes';

const BTN = 'py-3 grad-amber-door glass-door-highlight text-white font-semibold rounded-xl text-base polish-press polish-press-depth polish-focus';

export default function HomeQuizView({ onNavigate, onClose, onTarteel, onMutashabihat, onComprehensive }: {
  onNavigate: (r: Route) => void;
  onClose: () => void;
  onTarteel: () => void;
  onMutashabihat: () => void;
  onComprehensive: () => void;
}) {
  return (
    <div className="min-h-screen page-bg pb-32 route-in">
      <PageHeader title="اختبر نفسك" icon={Award} subtitle="ترتيل ومتشابهات واختبار شامل" />
      <main className="max-w-5xl mx-auto px-4 py-4 grid grid-cols-2 gap-3 alive-subdoors">
        <button onPointerDown={pressFeedback} onClick={onTarteel} className={BTN}>ترتيل</button>
        <button onPointerDown={pressFeedback} onClick={onMutashabihat} className={BTN}>المتشابهات</button>
        <button onPointerDown={pressFeedback} onClick={onComprehensive} className={`col-span-2 ${BTN}`}>اختبار شامل (١٠٠ درجة)</button>
      </main>
      <BottomBackBar hasBottomNav onHome={onClose} />
      <BottomNav current="home" onNavigate={onNavigate} />
    </div>
  );
}
