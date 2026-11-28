// 7.5 (2026-11-26): the elderly-mode home. It used to live inside
// HomeStartPage, which 6.1 hid, so the home route now shows it from
// Home2Page when the mode is on. «الوضع العادي» sits at the TOP (one
// clear tap out), not at the bottom of four look-alike buttons.
import { BookOpen, Headphones } from 'lucide-react';
import MicIcon from './icons/MicIcon';
import Sama3 from './Sama3';
import ElderlyHome from './ElderlyHome';
import OrderMeButton from './OrderMeButton';
import { pressFeedback } from '../lib/pressFeedback';
import { setElderlyMode } from '../lib/elderlyMode';
import type { Route } from '../lib/routes';

function resumeHifz(onNavigate: (r: Route) => void): void {
  try { sessionStorage.setItem('quran-open-fullscreen', '1'); } catch { /* ignore */ }
  onNavigate('mushaf');
}

const DOOR = 'w-full min-h-[80px] py-5 grad-emerald-door glass-door-highlight text-white font-bold rounded-2xl flex items-center justify-center gap-3 text-2xl polish-press polish-press-depth polish-focus';

export default function ElderlyHomeScreen({ onNavigate }: { onNavigate: (r: Route) => void }) {
  return (
    <div className="min-h-screen page-bg pb-24 route-in">
      <main className="max-w-5xl mx-auto px-4 py-8" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}>
        <button
          onPointerDown={pressFeedback}
          onClick={() => setElderlyMode(false)}
          className="w-full min-h-[64px] mb-6 py-4 bg-white text-ink font-bold rounded-2xl border-2 border-emerald-800 flex items-center justify-center gap-3 text-2xl polish-press polish-focus"
        >
          الوضع العادي
        </button>
        <div className="mb-6">
          <OrderMeButton onNavigate={onNavigate}
            onMutashabihat={() => setElderlyMode(false)}
            onElderly={() => {}} />
        </div>
        <ElderlyHome onNavigate={onNavigate} onResume={() => resumeHifz(onNavigate)} />
        <div className="flex flex-col gap-6 mt-6">
          <button onPointerDown={pressFeedback} onClick={() => onNavigate('listen')} className={DOOR}>
            <span className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20"><Headphones className="w-7 h-7 text-white" /></span>
            استمع
          </button>
          <button onPointerDown={pressFeedback} onClick={() => onNavigate('mushaf')} className={DOOR}>
            <span className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20"><BookOpen className="w-7 h-7 text-white" /></span>
            المصحف
          </button>
          <button onPointerDown={pressFeedback} onClick={() => { try { sessionStorage.removeItem('quran-test-range-choice'); } catch { /* ignore */ } onNavigate('test'); }} className={DOOR}>
            <span className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20"><MicIcon className="w-7 h-7" /></span>
            <Sama3 /> لي
          </button>
        </div>
      </main>
    </div>
  );
}
