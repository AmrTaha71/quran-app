import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';

export default function SplashScreen({ onFinish, duration = 2000, message }: { onFinish: () => void; duration?: number; message?: string }) {
  const [progress, setProgress] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const interval = 50;
    const steps = duration / interval;
    let current = 0;

    const timer = setInterval(() => {
      current++;
      setProgress(Math.min(100, (current / steps) * 100));
      if (current >= steps) {
        clearInterval(timer);
        setFadeOut(true);
        setTimeout(onFinish, 500);
      }
    }, interval);

    return () => clearInterval(timer);
  }, [duration, onFinish]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-br from-emerald-700 via-emerald-800 to-teal-900 transition-opacity duration-500 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-emerald-300 rounded-full blur-3xl animate-pulse-soft" />
        <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-teal-300 rounded-full blur-3xl animate-pulse-soft" />
      </div>

      <div className="relative flex flex-col items-center mb-12 animate-slide-up">
        <div className="w-24 h-24 bg-white rounded-3xl flex items-center justify-center shadow-2xl mb-6">
          <BookOpen className="w-12 h-12 text-emerald-700" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">روابط الذكر الحكيم</h1>
        <p className="text-emerald-200 text-base text-center px-8 leading-relaxed">
          {message || 'معك في كل آية، حتى نُتمّ حفظ كتاب الله'}
        </p>
      </div>

      <div className="relative w-64">
        <div className="h-1.5 bg-emerald-900/50 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-300 to-white rounded-full transition-all duration-75 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-center text-emerald-200 text-xs mt-3">
          {Math.round(progress)}%
        </p>
      </div>
    </div>
  );
}
