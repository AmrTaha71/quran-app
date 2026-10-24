import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { LanguageProvider, useLang } from './lib/LanguageContext';
import type { Session } from '@supabase/supabase-js';
import AdminPage from './pages/AdminPage';
import UserAppPage from './pages/UserAppPage';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import QuranMushafPage from './pages/QuranMushafPage';
import SplashScreen from './components/SplashScreen';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf';

function getRouteFromHash(): Route {
  const hash = window.location.hash.replace('#', '').replace('/', '');
  if (hash === 'admin') return 'admin';
  if (hash === 'app') return 'app';
  if (hash === 'auth') return 'auth';
  if (hash === 'mushaf') return 'mushaf';
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
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      const wasNull = !session;
      setSession(session);
      if (session && wasNull) {
        setAuthJustSucceeded(true);
        setRoute('mushaf');
        setTimeout(() => setAuthJustSucceeded(false), 10500);
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

  // Splash after successful auth — 10 seconds
  if (authJustSucceeded) {
    return <SplashScreen onFinish={() => setAuthJustSucceeded(false)} duration={10000} message="معك في كل آية، حتى تُتمّ حفظ كتاب الله" />;
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
  if (route === 'mushaf') {
    return <QuranMushafPage session={session} onNavigate={navigate} />;
  }
  return <LandingPage onNavigate={navigate} />;
}

export default function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}
