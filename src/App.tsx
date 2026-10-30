import { useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from './lib/supabase';
import {
  EXPLICIT_SIGNOUT_KEY,
  SESSION_EXPIRED_EVENT,
  dropRecoveryMarker,
  parseRecoveryTokens,
  urlIndicatesRecovery,
} from './lib/sessionExpiry';
import { retryPendingProfile } from './lib/profileRepair';
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
import ListenPage from './pages/ListenPage';
import AdhkarPage from './pages/AdhkarPage';
import SplashScreen from './components/SplashScreen';
import OfflineBanner from './components/OfflineBanner';
import { parseHash } from './lib/shareLinks';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test' | 'listen' | 'adhkar';

// Routes where a dead session must send the user to #/auth with a
// "session expired" message. Logged-out routes (home/landing/auth) are
// excluded: a SIGNED_OUT there is normal, not an expiry.
const PROTECTED_ROUTES: Route[] = ['admin', 'app', 'mushaf', 'settings', 'follow', 'test', 'listen', 'adhkar'];

function getRouteFromHash(): Route {
  const rawHash = window.location.hash;
  // S1 auth stream: a recovery link carries its tokens in the hash
  // (single-hash `#access_token=...&type=recovery`, or the legacy double
  // hash `#/auth#access_token=...&type=recovery`). Either form routes to
  // #/auth — the reset form — instead of collapsing to home as before.
  // Checked FIRST: the shared parser below would not recognise a token
  // hash as a recovery destination.
  if (rawHash) {
    for (const segment of rawHash.slice(1).split('#')) {
      try {
        if (new URLSearchParams(segment).get('type') === 'recovery') return 'auth';
      } catch {
        // not a query string; keep checking the other segments
      }
    }
  }
  // S2 shared parser (src/lib/shareLinks.ts): query fragments such as
  // #/mushaf?surah=2&ayah=255 route to the Mushaf instead of collapsing
  // to home, and an unknown fragment returns route 'home' with
  // unknown=true. The query params are consumed by QuranMushafPage on
  // mount; App only needs the route here.
  return parseHash(window.location.hash).route;
}

const SESSION_EXPIRED_MESSAGE = 'انتهت جلستك — سجل دخول من جديد.';

function AppContent() {
  const [route, setRoute] = useState<Route>(getRouteFromHash());
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [authJustSucceeded, setAuthJustSucceeded] = useState(false);
  // S1 auth stream: session-expiry notice shown on #/auth, and the
  // password-recovery state. The recovery initializer reads the URL at
  // FIRST render only — supabase clears the token hash asynchronously
  // after a network call, so a first-render read still sees the link.
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [recoveryMode, setRecoveryMode] = useState<boolean>(() =>
    typeof window !== 'undefined' ? urlIndicatesRecovery(window.location.href) : false,
  );
  const routeRef = useRef<Route>(route);
  const recoveryRef = useRef<boolean>(recoveryMode);

  const setRecovery = (value: boolean) => {
    recoveryRef.current = value;
    setRecoveryMode(value);
  };

  // Keep the ref in step with route state for use inside the
  // subscription callbacks (which close over the mount render).
  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  const exitRecovery = () => {
    setRecovery(false);
    dropRecoveryMarker();
  };

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      // Legacy double-hash recovery links (`#/auth#access_token=...`)
      // are invisible to supabase's own URL parser, so consume them
      // manually: exchange the tokens for a session, then drop the
      // tokens from the URL (replaceState: no hashchange event).
      const tokens = parseRecoveryTokens(window.location.href);
      if (tokens) {
        const { error } = await supabase.auth.setSession({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        });
        if (!error && !cancelled) {
          setRecovery(true);
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/auth`);
          setRoute('auth');
        }
      } else if (recoveryRef.current) {
        // New-style link (`?recovery=1#access_token=...`) or a link
        // supabase already consumed: the session is in storage and the
        // marker (or the first-render route) already put us on #/auth.
        setRoute('auth');
      }

      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(data.session);
      setLoading(false);
      // Profile-row repair retry after sign-in (S1): if signup's insert
      // failed and a pending payload is stored, retry it now. Silent —
      // the visible retry state lives on لوحتي if this still fails.
      if (data.session) {
        void retryPendingProfile(supabase, data.session.user.id).catch(() => {});
      }
      // Returning user with a valid session and no explicit deep link
      // goes straight to الرئيسية — no landing page, no login taps.
      // A hash of any kind (including a Mushaf deep link) counts as an
      // explicit destination and is left alone. Recovery sessions never
      // take this branch either: the reset form owns them.
      if (data.session && !window.location.hash && !recoveryRef.current) {
        setRoute('home');
      }
    };
    void boot();

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY' && session) {
        // Supabase's own recovery signal (fires when it consumed a
        // single-hash link). Belts-and-braces beside the URL detection
        // above; setting the same state twice is harmless.
        setRecovery(true);
        setRoute('auth');
        return;
      }
      if (event === 'SIGNED_IN' && session) {
        // A recovery sign-in must NOT be bounced to لوحتي — the user
        // still has to choose a new password first.
        if (recoveryRef.current) return;
        setAuthNotice(null);
        void retryPendingProfile(supabase, session.user.id).catch(() => {});
        setAuthJustSucceeded(true);
        // The app opens on الرئيسية after login (not the Mushaf page):
        // it is lighter to load, and the Mushaf opens from there.
        // EXCEPTION: a share deep link in the hash survives login —
        // a recipient who logs in from a shared ayah link must still
        // land on that ayah, not be diverted to الرئيسية.
        const parsed = parseHash(window.location.hash);
        if (!(parsed.route === 'mushaf' && (parsed.page || parsed.surah))) {
          setRoute('home');
        }
        setTimeout(() => setAuthJustSucceeded(false), 2500);
        return;
      }
      if (event === 'SIGNED_OUT') {
        // A chosen logout (lib/auth signOut sets the flag) goes where
        // the page already navigated (home) — no expiry message. A
        // refresh failure or server-side invalidation on a protected
        // route routes to #/auth with the expiry message instead of
        // leaving the page to render misleading empty states.
        try {
          if (sessionStorage.getItem(EXPLICIT_SIGNOUT_KEY)) {
            sessionStorage.removeItem(EXPLICIT_SIGNOUT_KEY);
            return;
          }
        } catch {
          // storage unavailable: fall through to the expiry path only
          // on protected routes (logged-out routes stay put)
        }
        if (PROTECTED_ROUTES.includes(routeRef.current)) {
          setAuthNotice(SESSION_EXPIRED_MESSAGE);
          setRoute('auth');
        }
      }
    });

    const handleHashChange = () => {
      // While a recovery is in progress, supabase clearing the token
      // hash (hash -> '') must not yank the user off the reset form.
      if (recoveryRef.current) return;
      setRoute(getRouteFromHash());
    };
    window.addEventListener('hashchange', handleHashChange);

    // Data-plane 401s (see lib/sessionExpiry): same expiry routing as
    // SIGNED_OUT, for pages that would otherwise render empty states.
    const handleSessionExpired = () => {
      if (PROTECTED_ROUTES.includes(routeRef.current)) {
        setAuthNotice(SESSION_EXPIRED_MESSAGE);
        setRoute('auth');
      }
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, []);

  const navigate = (r: Route) => {
    // Leaving #/auth abandons any recovery in progress and clears the
    // expiry notice, so neither can resurface on the next visit.
    if (r !== 'auth') {
      setRecovery(false);
      dropRecoveryMarker();
      setAuthNotice(null);
    }
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
    return (
      <AuthPage
        onNavigate={navigate}
        notice={authNotice}
        onDismissNotice={() => setAuthNotice(null)}
        recoveryMode={recoveryMode}
        onRecoveryExit={exitRecovery}
      />
    );
  }
  if (route === 'admin') {
    return <AdminPage session={session} onNavigate={navigate} />;
  }
  // Main app area: the two audio pages stay mounted (hidden when
  // inactive) so long-form audio can pause on leaving and resume
  // when the interrupting audio closes, on any route — even with
  // the screen locked. Auth/admin/splash never mount them (audio
  // stops there, as before). Wrappers render only while logged
  // in; logout unmounts them and their cleanups stop audio.
  // (The old early returns for listen/adhkar are gone: the
  // wrapper IS the page when its route is active.)
  let page: ReactNode;
  // One branch for mushaf|follow: the same instance serves both
  // routes, so a live follow session survives switching between them
  // without remounting and losing the lock.
  if (route === 'mushaf' || route === 'follow') {
    page = <QuranMushafPage session={session} onNavigate={navigate} startInFollow={route === 'follow'} />;
  } else if (route === 'settings') {
    page = <SettingsPage onNavigate={navigate} />;
  } else if (route === 'test') {
    page = <SelfTestPage onNavigate={navigate} />;
  } else if (route === 'app') {
    page = <UserAppPage session={session} onNavigate={navigate} />;
  } else if (route === 'listen' || route === 'adhkar') {
    // The wrapper above IS the page on these routes — nothing else
    // renders beside it.
    page = null;
  } else if (route === 'home' && session) {
    // Logged-in users never see the landing page — admins included
    // (2026-10-27: admins are users too, same account, same start
    // page; الإدارة is reached from Settings, not from the landing).
    // The landing stays only as the logged-out entry point.
    page = <HomeStartPage session={session} onNavigate={navigate} />;
  } else {
    page = <LandingPage session={session} onNavigate={navigate} />;
  }
  return (
    <>
      {session ? (
        <>
          <div style={{ display: route === 'listen' ? undefined : 'none' }}>
            <ListenPage onNavigate={navigate} visible={route === 'listen'} />
          </div>
          <div style={{ display: route === 'adhkar' ? undefined : 'none' }}>
            <AdhkarPage onNavigate={navigate} visible={route === 'adhkar'} />
          </div>
        </>
      ) : null}
      {page}
    </>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <OfflineBanner />
      <AppContent />
    </LanguageProvider>
  );
}
