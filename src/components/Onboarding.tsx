// Elegant first-run onboarding (2026-11-06, feature #7).
// 3 short screens + a quick setup (reciter + self-test level), shown
// on first run behind a localStorage flag, skippable on every screen,
// and re-playable from Settings (which dispatches
// ONBOARDING_REOPEN_EVENT — App listens and re-opens it).
// Palette is emerald + gold only (unified palette; no new hue), calm
// transitions from the alive styles (push 204), no loud effects.
import { useState } from 'react';
import { BookMarked, Mic, Headphones, ChevronLeft, X } from 'lucide-react';
import { RECITERS, DEFAULT_RECITER_ID } from '../lib/reciters';
import { pressFeedback } from '../lib/pressFeedback';

export const ONBOARDING_DONE_KEY = 'quran-onboarding-done';
export const ONBOARDING_REOPEN_EVENT = 'quran-reopen-onboarding';

export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_DONE_KEY) === '1';
  } catch {
    return true; // storage unavailable: never block the app
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1');
  } catch {
    // ignore: the flag is best-effort only
  }
}

export function clearOnboardingDone(): void {
  try {
    localStorage.removeItem(ONBOARDING_DONE_KEY);
  } catch {
    // ignore
  }
}

type VerifyLevel = 'beginner' | 'intermediate' | 'advanced';

const LEVELS: { id: VerifyLevel; label: string; hint: string }[] = [
  { id: 'beginner', label: 'مبتدئ', hint: 'تصحيح متساهل — ابدأ براحتك' },
  { id: 'intermediate', label: 'متوسط', hint: 'تصحيح أدق للكلمات' },
  { id: 'advanced', label: 'متقدم', hint: 'أدق تصحيح — زي الحفظ المتقن' },
];

const SCREENS = [
  {
    icon: BookMarked,
    title: 'احفظ بالتربيطات',
    line: 'كل آية ليها روابط تربطها باللي قبلها وبعدها — احفظ بالمعنى، مش بالتكرار بس.',
  },
  {
    icon: Mic,
    title: 'سـمّع لي',
    line: 'سمّع بصوتك والتطبيق يصحح لك لحظيًا — من غير ما تحتاج حد يسمع لك.',
  },
  {
    icon: Headphones,
    title: 'استمع',
    line: 'ختمة كاملة بأصوات القرّاء، وتفسير مسموع، وأذكار — اسمع في أي وقت.',
  },
];

const TEST_SETTINGS_KEY = 'quran-test-settings';

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const totalSteps = SCREENS.length + 1; // 3 screens + quick setup
  const isSetup = step === SCREENS.length;
  const [reciterId, setReciterId] = useState(() => {
    try {
      const saved = localStorage.getItem('quran-reciter');
      return RECITERS.some((r) => r.id === saved) ? (saved as string) : DEFAULT_RECITER_ID;
    } catch {
      return DEFAULT_RECITER_ID;
    }
  });
  const [level, setLevel] = useState<VerifyLevel>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(TEST_SETTINGS_KEY) || '{}') as { level?: string };
      return p.level === 'intermediate' || p.level === 'advanced' ? p.level : 'beginner';
    } catch {
      return 'beginner';
    }
  });

  const finish = () => {
    markOnboardingDone();
    onDone();
  };

  const saveSetup = () => {
    try {
      localStorage.setItem('quran-reciter', reciterId);
    } catch {
      // ignore
    }
    try {
      // Merge into the existing self-test settings (same key + shape
      // SelfTestPage reads): only the level changes, mode / delay /
      // rate the user already has are preserved.
      const prev = JSON.parse(localStorage.getItem(TEST_SETTINGS_KEY) || '{}') as Record<string, unknown>;
      localStorage.setItem(TEST_SETTINGS_KEY, JSON.stringify({ ...prev, level }));
    } catch {
      // ignore
    }
    finish();
  };

  const screen = SCREENS[Math.min(step, SCREENS.length - 1)];
  const ScreenIcon = screen.icon;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-label="جولة تعريفية"
    >
      <div className="w-full max-w-md glass-card rounded-3xl shadow-2xl overflow-hidden polish-fade-up">
        {/* Top bar: skip on every screen + dots */}
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span
                key={i}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === step ? 'w-6 bg-amber-500' : i < step ? 'w-2 bg-emerald-500' : 'w-2 bg-gray-300'
                }`}
              />
            ))}
          </div>
          <button
            onClick={finish}
            onPointerDown={pressFeedback}
            className="flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink px-2 py-1.5 rounded-lg"
          >
            <X className="w-4 h-4" /> تخطي
          </button>
        </div>

        {!isSetup ? (
          <div key={step} className="px-6 pb-6 pt-2 text-center polish-fade-up">
            <div className="mx-auto w-20 h-20 rounded-3xl grad-emerald-door flex items-center justify-center shadow-lg mb-5">
              <ScreenIcon className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-bold font-display-ar text-ink">{screen.title}</h2>
            <p className="text-base text-ink-2 leading-relaxed mt-3 min-h-[4.5rem]">{screen.line}</p>
            <button
              onClick={() => setStep(step + 1)}
              onPointerDown={pressFeedback}
              className="btn-3d mt-4 w-full py-3.5 bg-emerald-600 text-white text-base font-bold rounded-2xl flex items-center justify-center gap-1"
            >
              {step === SCREENS.length - 1 ? 'جهّز التطبيق' : 'التالي'}
              <ChevronLeft className="w-5 h-5" />
            </button>
            <p className="text-xs text-ink-3 mt-3">تربيطات آيات القرآن — احفظ القرآن بالتربيطات</p>
          </div>
        ) : (
          <div key="setup" className="px-6 pb-6 pt-2 polish-fade-up">
            <div className="text-center mb-4">
              <h2 className="text-2xl font-bold font-display-ar text-ink">جهّز التطبيق في ثانية</h2>
              <p className="text-sm text-ink-2 mt-2 leading-relaxed">
                اختر قارئك ومستواك — وتقدر تغيّرهم في أي وقت من الإعدادات والتسميع.
              </p>
            </div>

            <p className="text-sm font-semibold text-ink mb-2">القارئ</p>
            <div className="flex flex-wrap gap-2 mb-5">
              {RECITERS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setReciterId(r.id)}
                  onPointerDown={pressFeedback}
                  className={`px-3.5 py-2.5 rounded-xl text-sm font-semibold border-2 transition-smooth ${
                    reciterId === r.id
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-white text-ink-2 border-hairline hover:border-hairline-emerald'
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>

            <p className="text-sm font-semibold text-ink mb-2">مستواك في التسميع</p>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLevel(l.id)}
                  onPointerDown={pressFeedback}
                  className={`p-3 rounded-xl border-2 transition-smooth text-center ${
                    level === l.id
                      ? 'border-amber-400 bg-amber-50'
                      : 'border-hairline bg-white hover:border-hairline-amber'
                  }`}
                >
                  <span className="block text-base font-bold text-ink">{l.label}</span>
                  <span className="block text-[11px] text-ink-2 leading-snug mt-1">{l.hint}</span>
                </button>
              ))}
            </div>

            <button
              onClick={saveSetup}
              onPointerDown={pressFeedback}
              className="btn-3d w-full py-3.5 bg-emerald-600 text-white text-base font-bold rounded-2xl"
            >
              ابدأ الحفظ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
