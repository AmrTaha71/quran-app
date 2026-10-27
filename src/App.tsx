import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { LanguageProvider, useLang } from './lib/LanguageContext';
import type { Session } from '@supabase/supabase-js';
import AdminPage from './pages/AdminPage';
import UserAppPage from './pages/UserAppPage';
import HomeStartPage from './pages/HomeStartPage';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import QuranMushafPage from './pages/QuranMushafPage';
import SettingsPage from './pages/SettingsPage';
import SelfTestPage from './pages/SelfTestPage';
import SplashScreen from './components/SplashScreen';
import OfflineBanner from './components/OfflineBanner';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test';

function getRouteFromHash(): Route {
  const hash = window.location.hash.replace('#', '').replace('/', '');
  if (hash === 'admin') return 'admin';
  if (hash === 'app') return 'app';
  if (hash === 'auth') return 'auth';
  if (hash === 'mushaf') return 'mushaf';
  if (hash === 'follow') return 'follow';
  if (hash === 'test') return 'test';
  if (hash === 'settings') return 'settings';
  return 'home';
}

function AppContent() {
  const [route, setRoute] = useState<Route>(getRouteFromHash());
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [authJustSucceeded, setAuthJustSucceeded] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      // Returning user with a valid session and no explicit deep link
      // goes straight to لوحتي — no landing page, no login taps.
      if (data.session && !window.location.hash.replace('#', '').replace('/', '')) {
        setRoute('app');
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'SIGNED_IN' && session) {
        setAuthJustSucceeded(true);
        // The app opens on لوحتي after login (not the Mushaf page):
        // it is lighter to load, and the Mushaf opens from there.
        setRoute('app');
        setTimeout(() => setAuthJustSucceeded(false), 2500);
      }
    });

    const handleHashChange = () => setRoute(getRouteFromHash());
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      subscription.subscription.unsubscribe();
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  const navigate = (r: Route) => {
    window.location.hash = r === 'home' ? '' : `/${r}`;
    setRoute(r);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-emerald-50 to-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // Splash on first load
  if (showSplash && route === 'home') {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  // Short brand flash after successful auth (was 10 seconds of
  // forced waiting — the main cause of the slow startup feeling).
  if (authJustSucceeded) {
    return <SplashScreen onFinish={() => setAuthJustSucceeded(false)} duration={2000} message="معك في كل آية، حتى نُتمّ حفظ كتاب الله" />;
  }

  if (route === 'auth') {
    return <AuthPage onNavigate={navigate} />;
  }
  if (route === 'admin') {
    return <AdminPage session={session} onNavigate={navigate} />;
  }
  if (route === 'app') {
    return <UserAppPage session={session} onNavigate={navigate} />;
  }
  // One branch for mushaf|follow: the same instance serves both
  // routes, so a live follow session survives switching between them
  // without remounting and losing the lock.
  if (route === 'mushaf' || route === 'follow') {
    return <QuranMushafPage session={session} onNavigate={navigate} startInFollow={route === 'follow'} />;
  }
  if (route === 'settings') {
    return <SettingsPage onNavigate={navigate} />;
  }
  if (route === 'test') {
    return <SelfTestPage onNavigate={navigate} />;
  }
  // Logged-in users never see the landing page: it is a poster with a
  // login button that is meaningless once you already have a session.
  // الرئيسية is now its own light start page (resume + quick buttons),
  // distinct from لوحتي, which keeps the full dashboard. Login and
  // returning sessions still open on لوحتي (see above) — the start
  // page is reached from the الرئيسية tab. The landing stays only as
  // the logged-out entry point — and for admin sessions
  // (@quran-app.user), which enter الإدارة from it.
  if (route === 'home' && session && !session.user.email?.endsWith('@quran-app.user')) {
    return <HomeStartPage session={session} onNavigate={navigate} />;
  }
  return <LandingPage session={session} onNavigate={navigate} />;
}

export default function App() {
  return (
    <LanguageProvider>
      <OfflineBanner />
      <AppContent />
    </LanguageProvider>
  );
}
