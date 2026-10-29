import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/LanguageContext';
import { LANGUAGES, COUNTRY_CODES } from '../lib/translations';
import { loginEmailCandidates, signupEmailCandidates, trimUsername } from '../lib/username';
import { retryPendingProfile, savePendingProfile, type PendingProfile } from '../lib/profileRepair';
import {
  BookOpen, Lock, Mail, User, Phone, Calendar, Eye, EyeOff,
  Globe, ArrowRight, Shield, Heart, RotateCcw,
} from 'lucide-react';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'follow';
type AuthMode = 'login' | 'signup' | 'recover' | 'reset';

export default function AuthPage({
  onNavigate,
  notice,
  onDismissNotice,
  recoveryMode,
  onRecoveryExit,
}: {
  onNavigate: (r: Route) => void;
  /** One-off banner from the App shell, e.g. the session-expired message. */
  notice?: string | null;
  onDismissNotice?: () => void;
  /** True while the user arrived via a password-recovery link. */
  recoveryMode?: boolean;
  /** Called when the user leaves the reset form (done or abandoned). */
  onRecoveryExit?: () => void;
}) {
  const { t, lang, setLang } = useLang();
  const [mode, setMode] = useState<AuthMode>(recoveryMode ? 'reset' : 'login');
  const [showPassword, setShowPassword] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [countryCode, setCountryCode] = useState('+20');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  // Non-blocking profile warning: the account exists but its profile row
  // failed to save (see handleSignup). It never blocks login — the row
  // is retried after sign-in, and لوحتي shows the retry state if needed.
  const [profileWarning, setProfileWarning] = useState('');
  // Reset-form state (mode 'reset', reached only via a recovery link).
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetDone, setResetDone] = useState(false);
  const [resetLinkExpired, setResetLinkExpired] = useState(false);
  // Email-verification state (2026-10-30): the address awaiting its
  // confirmation click. Set after a signup with no session (dashboard
  // "Confirm email" ON) or after an "Email not confirmed" login, and
  // shown as a card above the forms until the user confirms.
  const [checkEmail, setCheckEmail] = useState<string | null>(null);

  // If the App shell flags a recovery after this page already mounted
  // (supabase's PASSWORD_RECOVERY event), switch to the reset form.
  useEffect(() => {
    if (recoveryMode) setMode('reset');
  }, [recoveryMode]);

  // On entering the reset form, confirm the recovery session actually
  // exists: an expired or already-used link has no session, and the
  // form would otherwise fail with a cryptic error on submit.
  useEffect(() => {
    if (mode !== 'reset') return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setResetLinkExpired(!data.session);
    });
    return () => { cancelled = true; };
  }, [mode]);

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

    // S1 auth stream: the dead phone+DOB tab is gone (it derived an
    // address signup never creates, so it could never succeed — see the
    // removal note below the login form). Username login normalizes
    // (trim + lowercase derivation) and retries the raw-case derivation
    // for accounts created before normalization existed.
    const candidates = loginEmailCandidates(username);
    let signedIn = false;
    let lastLoginError = '';
    for (const loginEmail of candidates) {
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (!error) {
        signedIn = true;
        break;
      }
      lastLoginError = error.message || '';
    }
    if (!signedIn) {
      // Unconfirmed account (post-verification signups): show the
      // check-email card instead of a generic wrong-password error.
      // Resend only works when we know the real email (input contains
      // '@'); a bare username cannot receive a link.
      if (lastLoginError.toLowerCase().includes('confirm')) {
        if (username.includes('@')) {
          setCheckEmail(username.trim());
        } else {
          setError('حسابك لسه متأكدش — افتح إيميل التأكيد واضغط الرابط، أو سجل دخول بالإيميل نفسه عشان نعيد إرسال الرابط.');
        }
      } else {
        setError(t('invalidCredentials'));
      }
      // A stored pending profile (signup insert failed earlier) is
      // retried now that a session exists; if it still fails, لوحتي
      // shows the retry state — the login itself is not blocked.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        void retryPendingProfile(supabase, data.session.user.id).catch(() => {});
      }
    }
    setLoading(false);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setProfileWarning('');

    if (password.length < 6) {
      setError(t('passwordTooShort'));
      return;
    }
    if (!gender) {
      setError(t('selectGender'));
      return;
    }
    if (!trimUsername(username)) {
      setError(t('enterUsername'));
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('الإيميل مطلوب وصحيح — هنبعت لك رابط تأكيد عليه، ولازم تضغطه قبل ما تقدر تدخل.');
      return;
    }
    setLoading(true);
    // The real email field, when filled, is the account email: the old
    // username-derived address (username@quran-app.user) is not a real
    // mailbox, so Supabase rejected it and signup could never succeed
    // for a plain username. Login already accepts a real email typed
    // in the username field, so the two now match.
    // S1: the derived address is lowercased (see lib/username), and the
    // already-registered fallback tries every candidate, so a legacy
    // mixed-case account still signs in.
    const candidates = signupEmailCandidates(email, username);
    const signupEmail = candidates[0];

    const { data, error } = await supabase.auth.signUp({ email: signupEmail, password });
    if (error) {
      if (error.message.includes('already') || error.message.includes('registered')) {
        let signedIn = false;
        let lastSignInError = '';
        for (const candidate of candidates) {
          const { error: signInError } = await supabase.auth.signInWithPassword({ email: candidate, password });
          if (!signInError) {
            signedIn = true;
            break;
          }
          lastSignInError = signInError.message || '';
        }
        if (!signedIn) {
          // Already registered but unconfirmed: show the check-email
          // card (with resend) instead of a wrong-password error.
          if (lastSignInError.toLowerCase().includes('confirm')) {
            setCheckEmail(signupEmail);
          } else {
            setError(t('invalidCredentials'));
          }
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
      // Email verification (2026-10-30): email is REQUIRED, and once
      // the dashboard "Confirm email" switch is ON, a new account
      // cannot sign in until the link is clicked — so the no-session
      // path below shows the check-email card instead of signing in.
      // Until the switch is flipped (autoconfirm still ON), signup
      // still signs in immediately via the session path below.
      // S1: the insert error is NO LONGER swallowed. On failure the
      // payload is kept for a retry after sign-in (below, plus the App
      // shell and لوحتي), and the user is told — in a non-blocking
      // warning, not a login-blocking error — instead of silently
      // ending up with no profile row (no username, no gender).
      const profilePayload: PendingProfile = {
        user_id: data.user.id,
        username: trimUsername(username),
        gender,
        birth_date: birthDate || null,
        country_code: countryCode,
        phone: phone || null,
        preferred_language: lang,
        preferred_name: preferredName.trim() || null,
      };
      const { error: insertError } = await supabase.from('user_profiles').insert(profilePayload);

      if (!data.session) {
        // Confirmation required (dashboard "Confirm email" ON): do NOT
        // attempt sign-in — it would fail with "Email not confirmed".
        // The profile row retries automatically after sign-in (App
        // shell + لوحتي), so save it silently here.
        if (insertError) savePendingProfile(profilePayload);
        setCheckEmail(signupEmail);
        setLoading(false);
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email: signupEmail, password });
      if (signInError) {
        if (insertError) {
          savePendingProfile(profilePayload);
          setProfileWarning('تم إنشاء الحساب، لكن حفظ بيانات الملف (اسم المستخدم والنوع) لم يكتمل — سنعيد المحاولة تلقائيًا بعد الدخول، ولو استمرت المشكلة ستظهر لك رسالة في لوحتك.');
        }
        setSuccess(t('signUpSuccess'));
        setLoading(false);
      } else if (insertError) {
        // Signed in now, so RLS sees an authenticated user: one
        // immediate retry. If it still fails, keep the payload for the
        // App-shell/لوحتي retries and warn non-blockingly (the App
        // shell routes to لوحتي on sign-in, where the retry state shows).
        const { error: retryError } = await supabase.from('user_profiles').insert(profilePayload);
        if (retryError) {
          savePendingProfile(profilePayload);
        }
      }
    } else {
      // No user and no error (should not happen): never leave the
      // spinner stuck — the confirmation flow varies the shape.
      setError('حدث خطأ غير متوقع — حاول مرة أخرى.');
      setLoading(false);
    }
  };

  // Resend the signup confirmation link for the check-email card.
  const handleResendConfirmation = async () => {
    if (!checkEmail) return;
    setError('');
    setSuccess('');
    setLoading(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: checkEmail });
    setLoading(false);
    if (error) {
      if (error.message.includes('rate') || error.message.includes('limit')) {
        setError('تم تجاوز عدد المحاولات. انتظر دقيقة ثم حاول مرة أخرى.');
      } else {
        setError(error.message);
      }
    } else {
      setSuccess('تم إعادة إرسال رابط التأكيد — افتح إيميلك (وتأكد من مجلد السبام).');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword.length < 6) {
      setError(t('passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('كلمتا السر غير متطابقتين.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) {
      // Most commonly: the link expired or was already used, so there
      // is no recovery session to update the password for.
      if (error.message.includes('session') || error.message.includes('Auth session')) {
        setResetLinkExpired(true);
      } else {
        setError(error.message);
      }
      return;
    }
    setResetDone(true);
    setSuccess('تم تغيير كلمة السر بنجاح.');
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // EASY RECOVERY (2026-10-27): recovery works ONLY with a real
    // email the user gave at signup — a username-only account has no
    // mailbox to send a link to, so the old phone-derived fake email
    // path (which could never deliver) is removed and said plainly
    // in the UI instead of silently failing.
    const recoverEmail = email.trim();
    if (!recoverEmail) {
      setError('اكتب الإيميل الحقيقي اللي سجلت بيه. لو حسابك باسم مستخدم بس من غير إيميل، استرجاع كلمة السر من هنا مش ممكن — سجل دخول من جهاز لسه فاتح فيه وغيّر كلمة السر من الإعدادات.');
      setLoading(false);
      return;
    }

    // S1: redirect WITHOUT a hash fragment. The old `/#/auth` redirect
    // produced a double hash (`#/auth#access_token=...&type=recovery`)
    // that supabase's URL parser cannot read, so the link landed
    // nowhere. `?recovery=1` survives supabase clearing the token hash,
    // and the App shell also handles the bare-origin fallback and the
    // PASSWORD_RECOVERY event, so the reset form opens either way.
    // NOTE for the coordinator: if Supabase's redirect allow-list does
    // not include this URL, add `<origin>/?recovery=1` there; the
    // fallback (Site URL) still reaches the reset form via the event.
    const { error } = await supabase.auth.resetPasswordForEmail(recoverEmail, {
      redirectTo: `${window.location.origin}/?recovery=1`,
    });
    if (error) {
      setError(error.message);
    } else {
      setSuccess('تم إرسال رابط استرجاع كلمة المرور لإيميلك — افتحه واختر كلمة سر جديدة.');
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
            <p className="text-xs text-accent-600 mt-1">{t('appTagline')}</p>
          </div>

          {/* One-off App-shell notice (e.g. session expired routing). */}
          {notice && (
            <div className="flex items-start gap-2 p-3 mb-5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 leading-relaxed">
              <span className="flex-1">{notice}</span>
              {onDismissNotice && (
                <button type="button" onClick={onDismissNotice} aria-label="إغلاق"
                  className="text-amber-500 hover:text-amber-700 font-bold shrink-0">✕</button>
              )}
            </div>
          )}

          {/* Mode tabs (hidden on the request and reset forms) */}
          {mode !== 'recover' && mode !== 'reset' && (
            <div className="flex bg-gray-50 rounded-xl p-1 mb-5 border border-gray-100">
              <button
                onClick={() => { setMode('login'); setCheckEmail(null); }}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-smooth ${
                  mode === 'login' ? 'bg-emerald-600 text-white shadow-md' : 'text-accent-500 hover:text-accent-700'
                }`}
              >
                {t('login')}
              </button>
              <button
                onClick={() => { setMode('signup'); setCheckEmail(null); }}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-smooth ${
                  mode === 'signup' ? 'bg-emerald-600 text-white shadow-md' : 'text-accent-500 hover:text-accent-700'
                }`}
              >
                {t('signup')}
              </button>
            </div>
          )}

          {checkEmail ? (
            <div className="space-y-3">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800 text-center leading-relaxed">
                تم إنشاء الحساب — افتح إيميلك <span className="font-bold" dir="ltr">{checkEmail}</span> واضغط رابط التأكيد، وبعدين سجل دخول. لو مش لاقي الرسالة، تأكد من مجلد السبام.
              </div>
              {error && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 text-center">{error}</div>}
              {success && <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 text-center">{success}</div>}
              <button type="button" onClick={handleResendConfirmation} disabled={loading}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-md transition-smooth disabled:opacity-50">
                {loading ? '...' : 'إعادة إرسال رابط التأكيد'}
              </button>
              <button type="button" onClick={() => { setCheckEmail(null); setSuccess(''); setError(''); setMode('login'); }}
                className="w-full text-sm text-accent-600 hover:text-accent-700 py-2">
                العودة لتسجيل الدخول
              </button>
            </div>
          ) : mode === 'reset' ? (
            <form onSubmit={handleResetPassword} className="space-y-3">
              <p className="text-sm text-accent-600 text-center mb-4">اختر كلمة سر جديدة لحسابك</p>
              {resetLinkExpired ? (
                <>
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 text-center leading-relaxed">
                    انتهت صلاحية رابط استرجاع كلمة السر أو تم استخدامه من قبل. اطلب رابطًا جديدًا من صفحة استرجاع كلمة السر.
                  </div>
                  <button type="button" onClick={() => { onRecoveryExit?.(); setMode('recover'); }}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-smooth">
                    طلب رابط جديد
                  </button>
                </>
              ) : resetDone ? (
                <>
                  {success && <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-600 text-center">{success}</div>}
                  <button type="button" onClick={() => { onRecoveryExit?.(); onNavigate('app'); }}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-smooth">
                    الذهاب إلى لوحتي
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-accent-700 mb-1.5">كلمة السر الجديدة</label>
                    <div className="relative">
                      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                      <input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required
                      placeholder="••••••"
                      className="w-full pr-10 pl-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-accent-400 hover:text-accent-600">
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-accent-700 mb-1.5">تأكيد كلمة السر الجديدة</label>
                    <div className="relative">
                      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                      <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required
                      placeholder="••••••"
                      className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                    </div>
                  </div>
                  {error && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 text-center">{error}</div>}
                  <button type="submit" disabled={loading}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-md transition-smooth disabled:opacity-50">
                    {loading ? '...' : 'حفظ كلمة السر الجديدة'}
                  </button>
                  <button type="button" onClick={() => { onRecoveryExit?.(); setMode('login'); }}
                    className="w-full text-sm text-accent-500 hover:text-accent-700 py-2">
                    إلغاء والعودة لتسجيل الدخول
                  </button>
                </>
              )}
            </form>
          ) : mode === 'recover' ? (
            <form onSubmit={handleRecover} className="space-y-3">
              <p className="text-sm text-accent-600 text-center mb-4">{t('recoverPassword')}</p>
              <p className="text-xs text-accent-600 text-center">اكتب الإيميل الحقيقي اللي سجلت بيه، وهنبعت لك رابط تختار بيه كلمة سر جديدة. من غير إيميل حقيقي، الرابط مالوش مكان يروح له.</p>
              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5">{t('email')}</label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@example.com"
                    className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                </div>
              </div>
              {error && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 text-center">{error}</div>}
              {success && <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 text-center">{success}</div>}
              <button type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-smooth disabled:opacity-50">
                <RotateCcw className="w-4 h-4" />
                {loading ? '...' : t('recoverPassword')}
              </button>
              <button onClick={() => setMode('login')}
                className="w-full text-sm text-accent-600 hover:text-accent-700 py-2">
                {t('backToHome')}
              </button>
            </form>
          ) : mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-3">
              {/* REMOVED (S1, device-review item 1): the phone+DOB login
                  tab. It derived `<digits>@quran-app.user` with the
                  birth-date digits as password, but signup NEVER creates
                  that credential (signup stores a user-chosen password
                  against the username-derived or real email) — so the
                  tab could never succeed for any account created by this
                  app, and no phone-derived identity is invented here to
                  prop it up. Phone/country/birth-date fields still
                  exist on the SIGNUP form, where they feed the profile
                  row. If a real user ever depended on this tab, that
                  would be visible as failed logins against phone-derived
                  addresses — none can exist from app signups. */}
              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5">{t('username')} / {t('email')}</label>
                <div className="relative">
                  <User className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                  <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required
                  placeholder={t('enterUsername')}
                  autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username"
                  className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                </div>
                <p className="text-xs text-accent-600 mt-1">لو حسابك جديد (بعد تفعيل التحقق بالإيميل)، سجل دخول بالإيميل مش باسم المستخدم — الحسابات الجديدة ملهاش عنوان مشتق.</p>
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

              {error && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 text-center">{error}</div>}

              <button type="submit" disabled={loading}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-md transition-smooth disabled:opacity-50">
                {loading ? '...' : t('login')}
              </button>

              <button type="button" onClick={() => setMode('recover')}
                className="w-full text-xs text-accent-600 hover:text-accent-700 py-1">
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
                  autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username"
                  className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5">تحب أناديك بإيه؟ <span className="font-normal text-accent-600">(الكنية — اختياري)</span></label>
                <div className="relative">
                  <Heart className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                  <input type="text" value={preferredName} onChange={(e) => setPreferredName(e.target.value)}
                  placeholder="مثال: أبو آية، أبو عمر، أم مريم، أم يوسف"
                  className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                </div>
                <p className="text-xs text-accent-600 mt-1">الكنية اللي هناديك بيها في التطبيق — مثال: أبو آية، أبو عمر، أم مريم، أم يوسف. وتقدر تغيرها بعد كده من لوحتك.</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5">{t('email')} <span className="font-normal text-accent-600">(مطلوب)</span></label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-accent-400" />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                  placeholder="email@example.com"
                  className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                </div>
                <p className="text-xs text-accent-600 mt-1">هنبعت لك رابط تأكيد على الإيميل ده — لازم تفتحه وتضغطه قبل ما تقدر تدخل. والإيميل ده هو اللي هترجع بيه كلمة السر بعد كده.</p>
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
                  <p className="text-xs text-accent-600 mt-1">{t('age')}: {calculateAge(birthDate)} {(lang === 'ar' || lang === 'ar-EG') ? 'سنة' : ''}</p>
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
              {success && <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 text-center">{success}</div>}
              {profileWarning && <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 text-center leading-relaxed">{profileWarning}</div>}

              <button type="submit" disabled={loading}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-md transition-smooth disabled:opacity-50">
                {loading ? '...' : t('signup')}
              </button>
            </form>
          )}

          <button onClick={() => onNavigate('home')}
            className="flex items-center gap-1.5 mt-5 text-sm text-accent-600 hover:text-accent-700 transition-smooth mx-auto">
            <ArrowRight className="w-4 h-4" />
            {t('backToHome')}
          </button>
        </div>

        {/* No admin link here on purpose (2026-10-27): normal users
            never see an admin entry. Admins log in with their normal
            account and reach الإدارة from Settings only. */}
      </div>
    </div>
  );
}
