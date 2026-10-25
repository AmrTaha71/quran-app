import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/LanguageContext';
import { LANGUAGES, COUNTRY_CODES } from '../lib/translations';
import {
  BookOpen, Lock, Mail, User, Phone, Calendar, Eye, EyeOff,
  Globe, ArrowRight, Shield, Heart, RotateCcw,
} from 'lucide-react';

type Route = 'home' | 'admin' | 'app' | 'auth';
type AuthMode = 'login' | 'signup' | 'recover';
type LoginMethod = 'username' | 'phone';

export default function AuthPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const { t, lang, setLang } = useLang();
  const [mode, setMode] = useState<AuthMode>('login');
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('username');
  const [showPassword, setShowPassword] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);

  const [email, setEmail] = useState('');
  const [emailConfirm, setEmailConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [countryCode, setCountryCode] = useState('+20');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const calculateAge = (birth: string) => {
    if (!birth) return 0;
    const today = new Date();
    const b = new Date(birth);
    let age = today.getFullYear() - b.getFullYear();
    const m = today.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
    return age;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (loginMethod === 'username') {
      const loginEmail = username.includes('@') ? username : `${username}@quran-app.user`;
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (error) setError(t('invalidCredentials'));
    } else {
      const phoneEmail = `${phone.replace(/[^0-9]/g, '')}@quran-app.user`;
      const dobPassword = birthDate.replace(/-/g, '');
      const { error } = await supabase.auth.signInWithPassword({ email: phoneEmail, password: dobPassword });
      if (error) setError(t('invalidCredentials'));
    }
    setLoading(false);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError(t('passwordTooShort'));
      return;
    }
    if (!gender) {
      setError(t('selectGender'));
      return;
    }
    if (!username.trim()) {
      setError(t('enterUsername'));
      return;
    }
    if (email.trim() && email !== emailConfirm) {
      setError('البريد الإلكتروني وتأكيده غير متطابقين');
      return;
    }

    setLoading(true);
    // The real email field, when filled, is the account email: the old
    // username-derived address (username@quran-app.user) is not a real
    // mailbox, so Supabase rejected it and signup could never succeed
    // for a plain username. Login already accepts a real email typed
    // in the username field, so the two now match.
    const signupEmail = email.trim() || (username.includes('@') ? username : `${username}@quran-app.user`);

    const { data, error } = await supabase.auth.signUp({ email: signupEmail, password });
    if (error) {
      if (error.message.includes('already') || error.message.includes('registered')) {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: signupEmail, password });
        if (signInError) {
          setError(t('invalidCredentials'));
          setLoading(false);
        }
      } else if (error.message.includes('rate') || error.message.includes('limit')) {
        setError('تم تجاوز عدد المحاولات. انتظر دقيقة ثم حاول مرة أخرى.');
        setLoading(false);
      } else if (error.message.includes('password')) {
        setError('كلمة المرور ضعيفة. استخدم ٦ أحرف على الأقل.');
        setLoading(false);
      } else {
        setError(error.message);
        setLoading(false);
      }
      return;
    }

    if (data.user) {
      await supabase.from('user_profiles').insert({
        user_id: data.user.id,
        username,
        gender,
        birth_date: birthDate || null,
        country_code: countryCode,
        phone: phone || null,
        preferred_language: lang,
      }).then(() => {});

      const { error: signInError } = await supabase.auth.signInWithPassword({ email: signupEmail, password });
      if (signInError) {
        setSuccess(t('signUpSuccess'));
        setLoading(false);
      }
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const recoverEmail = email || (phone ? `${phone.replace(/[^0-9]/g, '')}@quran-app.user` : '');
    if (!recoverEmail) {
      setError(t('enterPhone'));
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(recoverEmail);
    if (error) {
      setError(error.message);
    } else {
      setSuccess('تم إرسال رابط استرجاع كلمة المرور');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-blue-50 px-4 py-8">
      <div className="absolute inset-0 overflow-hidden opacity-10">
        <div className="absolute top-20 right-20 w-72 h-72 bg-emerald-300 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-20 w-96 h-96 bg-blue-300 rounded-full blur-3xl" />
      </div>

      {/* Language selector */}
      <div className="fixed top-4 right-4 z-50">
        <button
          onClick={() => setShowLangMenu(!showLangMenu)}
          className="flex items-center gap-2 px-3 py-2 bg-white/90 backdrop-blur rounded-xl shadow-md border border-gray-100 text-sm font-semibold text-accent-700 hover:bg-white transition-smooth"
        >
          <Globe className="w-4 h-4" />
          {LANGUAGES.find((l) => l.code === lang)?.nativeName}
        </button>
        {showLangMenu && (
          <div className="absolute mt-2 bg-white rounded-xl shadow-xl border border-gray-200 p-2 min-w-[160px] animate-slide-up">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                onClick={() => { setLang(l.code); setShowLangMenu(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-smooth ${
                  lang === l.code ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'hover:bg-gray-50 text-accent-600'
                }`}
              >
                <span>{l.flag}</span>
                {l.nativeName}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-emerald-100 p-8">
          {/* Logo */}
          <div className="flex flex-col items-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl flex items-center justify-center shadow-lg mb-3">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-xl font-bold text-accent-800">{t('appName')}</h1>
            <p className="text-xs text-accent-500 mt-1">{t('appTagline')}</p>
          </div>

          {/* Mode tabs */}
          {mode !== 'recover' && (
            <div className="flex bg-gray-50 rounded-xl p-1 mb-5 border border-gray-100">
              <button
                onClick={() => setMode('login')}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-smooth ${
                  mode === 'login' ? 'bg-emerald-600 text-white shadow-md' : 'text-accent-500 hover:text-accent-700'
                }`}
              >
                {t('login')}
              </button>
              <button
                onClick={() => setMode('signup')}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-smooth ${
                  mode === 'signup' ? 'bg-emerald-600 text-white shadow-md' : 'text-accent-500 hover:text-accent-700'
                }`}
              >
                {t('signup')}
              </button>
            </div>
          )}

          {mode === 'recover' ? (
            <form onSubmit={handleRecover} className="space-y-3">
              <p className="text-sm text-accent-600 text-center mb-4">{t('recoverPassword')}</p>
              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5">{t('email')}</label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@example.com"
                    className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                </div>
              </div>
              <div className="text-center text-xs text-accent-400">— أو —</div>
              <div className="flex gap-2">
                <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}
                  className="px-2 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500">
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                  ))}
                </select>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('phone')}
                  className="flex-1 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
              </div>
              {error && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 text-center">{error}</div>}
              {success && <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-600 text-center">{success}</div>}
              <button type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-smooth disabled:opacity-50">
                <RotateCcw className="w-4 h-4" />
                {loading ? '...' : t('recoverPassword')}
              </button>
              <button onClick={() => setMode('login')}
                className="w-full text-sm text-accent-500 hover:text-accent-700 py-2">
                {t('backToHome')}
              </button>
            </form>
          ) : mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-3">
              {/* Login method switch */}
              <div className="flex bg-gray-50 rounded-lg p-1 mb-3 border border-gray-100">
                <button type="button" onClick={() => setLoginMethod('username')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-smooth ${loginMethod === 'username' ? 'bg-white text-accent-700 shadow-sm' : 'text-accent-400'}`}>
                  {t('usernamePassword')}
                </button>
                <button type="button" onClick={() => setLoginMethod('phone')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-smooth ${loginMethod === 'phone' ? 'bg-white text-accent-700 shadow-sm' : 'text-accent-400'}`}>
                  {t('phoneDOB')}
                </button>
              </div>

              {loginMethod === 'username' ? (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-accent-700 mb-1.5">{t('username')} / {t('email')}</label>
                    <div className="relative">
                      <User className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                      <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required
                      placeholder={t('enterUsername')}
                      className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-accent-700 mb-1.5">{t('password')}</label>
                    <div className="relative">
                      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                      <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required
                      placeholder="••••••"
                      className="w-full pr-10 pl-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-accent-400 hover:text-accent-600">
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex gap-2">
                    <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}
                      className="px-2 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500">
                      {COUNTRY_CODES.map((c) => (
                        <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                      ))}
                    </select>
                    <div className="flex-1 relative">
                      <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                      <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required
                      placeholder={t('enterPhone')}
                      className="w-full pr-10 pl-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-accent-700 mb-1.5">{t('birthDate')}</label>
                    <div className="relative">
                      <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                      <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required
                      className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                    </div>
                  </div>
                </>
              )}

              {error && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 text-center">{error}</div>}

              <button type="submit" disabled={loading}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-md transition-smooth disabled:opacity-50">
                {loading ? '...' : t('login')}
              </button>

              <button type="button" onClick={() => setMode('recover')}
                className="w-full text-xs text-accent-500 hover:text-accent-700 py-1">
                {t('forgotPassword')}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="space-y-3">
              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5">{t('username')}</label>
                <div className="relative">
                  <User className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                  <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required
                  placeholder={t('enterUsername')}
                  className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5">{t('email')}</label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@example.com (اختياري)"
                  className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                </div>
              </div>

              {/* Email confirmation */}
              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5">تأكيد {t('email')}</label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                  <input type="email" value={emailConfirm} onChange={(e) => setEmailConfirm(e.target.value)}
                  placeholder="email@example.com"
                  className={`w-full pr-10 pl-4 py-2.5 bg-gray-50 border rounded-xl text-sm focus:outline-none transition-smooth ${
                    emailConfirm && email !== emailConfirm ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-emerald-500'
                  }`} />
                </div>
                {emailConfirm && email !== emailConfirm && (
                  <p className="text-xs text-red-500 mt-1">البريد الإلكتروني غير متطابق</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5">{t('password')}</label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                  <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required
                  placeholder="••••••"
                  className="w-full pr-10 pl-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-accent-400 hover:text-accent-600">
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* Gender */}
              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5">{t('gender')}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setGender('male')}
                    className={`flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-xl border transition-smooth ${
                      gender === 'male' ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-gray-50 text-accent-500 border-gray-200'
                    }`}>
                    <Shield className="w-4 h-4" />
                    {t('male')}
                  </button>
                  <button type="button" onClick={() => setGender('female')}
                    className={`flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-xl border transition-smooth ${
                      gender === 'female' ? 'bg-pink-50 text-pink-700 border-pink-300' : 'bg-gray-50 text-accent-500 border-gray-200'
                    }`}>
                    <Heart className="w-4 h-4" />
                    {t('female')}
                  </button>
                </div>
              </div>

              {/* Birth date */}
              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5">{t('birthDate')} ({t('age')})</label>
                <div className="relative">
                  <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                  <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required
                  className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                </div>
                {birthDate && (
                  <p className="text-xs text-accent-400 mt-1">{t('age')}: {calculateAge(birthDate)} {lang === 'ar' ? 'سنة' : ''}</p>
                )}
              </div>

              {/* Country + Phone */}
              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5">{t('country')} / {t('phone')}</label>
                <div className="flex gap-2">
                  <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}
                    className="px-2 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500">
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                    ))}
                  </select>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                    placeholder={t('phone')}
                    className="flex-1 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                </div>
              </div>

              {error && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 text-center">{error}</div>}
              {success && <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-600 text-center">{success}</div>}

              <button type="submit" disabled={loading}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-md transition-smooth disabled:opacity-50">
                {loading ? '...' : t('signup')}
              </button>
            </form>
          )}

          <button onClick={() => onNavigate('home')}
            className="flex items-center gap-1.5 mt-5 text-sm text-accent-500 hover:text-accent-700 transition-smooth mx-auto">
            <ArrowRight className="w-4 h-4" />
            {t('backToHome')}
          </button>
        </div>

        {/* Admin link */}
        <button onClick={() => onNavigate('admin')}
          className="w-full mt-3 text-xs text-accent-400 hover:text-accent-600 py-2 text-center">
          {t('adminPanel')}
        </button>
      </div>
    </div>
  );
}
