import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { BookOpen, Lock, User, ArrowRight } from 'lucide-react';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'follow';

export default function AdminLogin({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const loginEmail = username.includes('@') ? username : `${username}@quran-app.user`;
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    if (error) {
      setError('بيانات الدخول غير صحيحة. تأكد من اسم المستخدم وكلمة المرور.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-blue-50 px-4">
      <div className="absolute inset-0 overflow-hidden opacity-10">
        <div className="absolute top-20 right-20 w-72 h-72 bg-emerald-300 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-20 w-96 h-96 bg-blue-300 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-emerald-100 p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl flex items-center justify-center shadow-lg mb-4">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-accent-800">لوحة الإدارة</h1>
            <p className="text-sm text-accent-500 mt-1">روابط الذكر الحكيم</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-accent-700 mb-1.5">اسم المستخدم</label>
              <div className="relative">
                <User className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  placeholder="admin"
                  className="w-full pr-10 pl-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-accent-800 placeholder:text-gray-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition-smooth"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-accent-700 mb-1.5">كلمة المرور</label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••"
                  className="w-full pr-10 pl-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-accent-800 placeholder:text-gray-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition-smooth"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-semibold rounded-xl shadow-lg transition-smooth"
            >
              {loading ? 'جارٍ تسجيل الدخول...' : 'تسجيل الدخول'}
            </button>
          </form>

          <button
            onClick={() => onNavigate('home')}
            className="flex items-center gap-1.5 mt-6 text-sm text-accent-500 hover:text-accent-700 transition-smooth mx-auto"
          >
            <ArrowRight className="w-4 h-4" />
            العودة للرئيسية
          </button>
        </div>

        <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 text-center">
          <p className="font-semibold mb-1">بيانات دخول الإدارة:</p>
          <p>المستخدم: <span className="font-bold">admin</span> — كلمة المرور: <span className="font-bold">Quran@Admin2026</span></p>
        </div>
      </div>
    </div>
  );
}
