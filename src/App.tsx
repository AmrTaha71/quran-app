import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { supabase } from './lib/supabase';
import {
  EXPLICIT_SIGNOUT_KEY,
  SESSION_EXPIRED_EVENT,
  dropRecoveryMarker,
  parseRecoveryTokens,
  urlIndicatesRecovery,
} from './lib/sessionExpiry';
import { retryPendingProfile } from './lib/profileRepair';
import {
  clearInterruptionMarker,
  consumeMarker,
  evaluateRestore,
  getTabId,
  recLog,
} from './lib/listenRecovery';
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
import SharedRoomPage from './pages/SharedRoomPage';
import AdhanScheduler from './components/AdhanScheduler';
import AdhanPushManager from './components/AdhanPushManager';
import SplashScreen from './components/SplashScreen';
import Onboarding, { ONBOARDING_DONE_KEY, ONBOARDING_REOPEN_EVENT, markOnboardingDone } from './components/Onboarding';
import DevicePicker from './components/DevicePicker';
import VoiceSearchMic from './components/VoiceSearchMic';
import { getLocalDeviceKind } from './lib/deviceProfile';
import OfflineBanner from './components/OfflineBanner';
import { BackButton, useBackTarget } from './components/BackButton';
import { setBackTarget } from './lib/backTarget';
import { parseHash } from './lib/shareLinks';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test' | 'listen' | 'adhkar' | 'room';

// Routes where a dead session must send the user to #/auth with a
// "session expired" message. Logged-out routes (home/landing/auth) are
// excluded: a SIGNED_OUT there is normal, not an expiry.
const PROTECTED_ROUTES: Route[] = ['admin', 'app', 'mushaf', 'settings', 'follow', 'test', 'listen', 'adhkar', 'room'];

// Routes that show the shell back button (2026-11-06, back-button
// part 1): every tab route goes back to الرئيسية unless the page
// registered an internal target (open Settings door, Listen detail
// view, SelfTest sub-view). Home, landing, auth, admin and splash
// never show it.
const BACK_BUTTON_ROUTES: Route[] = ['settings', 'test', 'app', 'listen', 'adhkar', 'mushaf', 'follow', 'room'];

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

// Route cross-fade (approved 2026-11-04). Plain functions on purpose
// (TDZ rule). Skipped for mushaf/follow on either side, reduced motion,
// and browsers without startViewTransition: apply() then runs directly.
function isMushafRoute(r: Route): boolean {
  return r === 'mushaf' || r === 'follow';
}
function switchRoute(prev: Route, next: Route, apply: () => void): void {
  try {
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<unknown> };
    };
    if (
      prev === next ||
      isMushafRoute(prev) ||
      isMushafRoute(next) ||
      typeof doc.startViewTransition !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      apply();
      return;
    }
    const root = document.documentElement;
    root.classList.add('vt-active');
    const clear = () => {
      root.classList.remove('vt-active');
      // The mount-only enter animations (.route-enter-strong on the
      // route wrapper, .nav-enter on the nav) were suppressed by
      // .vt-active during the transition; without this they would
      // start now and rise a second time. Strip them from VISIBLE
      // elements only (getClientRects skips display:none wrappers,
      // and avoids the offsetParent trap on the fixed nav).
      try {
        document.querySelectorAll('.route-enter-strong, .nav-enter').forEach((el) => {
          if ((el as HTMLElement).getClientRects().length === 0) return;
          el.classList.remove('route-enter-strong', 'nav-enter');
        });
      } catch {
        // decorative: never break navigation
      }
    };
    const t = doc.startViewTransition(() => {
      flushSync(apply);
    });
    t.finished.then(clear, clear);
  } catch {
    // startViewTransition threw: never leave .vt-active set, or every
    // later mount animation would stay suppressed.
    document.documentElement.classList.remove('vt-active');
    apply();
  }
}

function AppContent() {
  const [route, setRoute] = useState<Route>(getRouteFromHash());
  const [session, setSession] = useState<Session | null>(null);
  // Bumped after the device picker is answered, so it unmounts.
  const [, setDeviceTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [authJustSucceeded, setAuthJustSucceeded] = useState(false);
  // First-run onboarding (2026-11-06, feature #7): shows once, on the
  // home route, until the user finishes or skips (either sets the
  // flag). Settings re-opens it via ONBOARDING_REOPEN_EVENT.
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ONBOARDING_DONE_KEY) !== '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const reopen = () => setShowOnboarding(true);
    window.addEventListener(ONBOARDING_REOPEN_EVENT, reopen);
    return () => window.removeEventListener(ONBOARDING_REOPEN_EVENT, reopen);
  }, []);
  const closeOnboarding = () => {
    markOnboardingDone();
    setShowOnboarding(false);
  };
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
  // Shared back button (2026-11-06): the page-registered internal
  // target, if any — otherwise the shell button falls back to the
  // route-level parent (home).
  const backTarget = useBackTarget();
  // Fix 1 (2026-10-30): identity of the last SIGNED_IN/INITIAL_SESSION
  // user. A refocus SIGNED_IN with the SAME user must never route —
  // only a real transition (first sign-in, or a different user) may.
  const authUidRef = useRef<string | null>(null);
  const pendingRouteRef = useRef<Route | null>(null);

  const setRecovery = (value: boolean) => {
    recoveryRef.current = value;
    setRecoveryMode(value);
  };

  // Keep the ref in step with route state for use inside the
  // subscription callbacks (which close over the mount render).
  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  // Mirror the signed-in user id for the interruption marker (pages
  // read it synchronously on document-hide, where an async getSession
  // would be too late). Removed on sign-out.
  useEffect(() => {
    try {
      if (session?.user.id) localStorage.setItem('quran-uid', session.user.id);
      else localStorage.removeItem('quran-uid');
    } catch {
      // ignore
    }
  }, [session]);

  // [LISTEN_RECOVERY] diagnostics: every route change, with the hash
  // that produced it (state/hash divergence is the bug's signature).
  const prevRouteRef = useRef<Route>(route);
  useEffect(() => {
    const prev = prevRouteRef.current;
    prevRouteRef.current = route;
    if (prev !== route) {
      recLog('ROUTE_CHANGE', { from: prev, to: route, hash: window.location.hash });
    }
  }, [route]);

  const exitRecovery = () => {
    setRecovery(false);
    dropRecoveryMarker();
  };

  useEffect(() => {
    let cancelled = false;

    // [LISTEN_RECOVERY] diagnostics: boot identity (tab id is
    // sessionStorage-scoped, so a fresh tab gets a NEW id and can
    // never match another tab's interruption marker).
    try {
      const tab = getTabId();
      let navType = 'unknown';
      try {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        if (nav?.type) navType = nav.type;
      } catch {
        // ignore
      }
      recLog('TAB_ID', { existing: tab.existing });
      recLog('APP_BOOT', { navType, hash: window.location.hash, route: getRouteFromHash() });
    } catch {
      // diagnostics must never break boot
    }

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
      // EXCEPTION (Fix 2, 2026-10-30): a fresh same-tab interruption
      // marker restores the interrupted listening page instead — hash
      // AND route, via replaceState so no competing hashchange fires.
      // No autoplay: the page's existing resume card is the gesture.
      if (data.session && !window.location.hash && !recoveryRef.current) {
        const evald = evaluateRestore(data.session.user.id);
        recLog('RESTORE_CHECK', {
          ageMs: evald.ageMs,
          tabMatch: evald.tabMatch,
          uidMatch: evald.uidMatch,
          page: evald.page,
          reason: evald.reason,
        });
        if (evald.restore) {
          consumeMarker();
          try {
            window.history.replaceState(null, '', `#/${evald.restore}`);
          } catch {
            // ignore: route state still carries the restore
          }
          setRoute(evald.restore);
          recLog('RESTORE_SUCCESS', { page: evald.restore, hash: `#/${evald.restore}` });
        } else {
          recLog('RESTORE_REJECTED', { reason: evald.reason });
          setRoute('home');
        }
      }
    };
    void boot();

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      recLog('AUTH_EVENT', { event, route: routeRef.current, hash: window.location.hash });
      if (event === 'INITIAL_SESSION') {
        // Startup only: record identity, never route.
        authUidRef.current = session?.user.id ?? null;
        return;
      }
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
        // Fix 1 (2026-10-30): auth-js 2.71.1 emits SIGNED_IN on EVERY
        // return-to-visible with a valid session (_onVisibilityChanged
        // -> _recoverAndRefresh -> SIGNED_IN), not only on login. The
        // old handler unconditionally setRoute('home') here, which is
        // what yanked #/listen to Home on every screen lock / tab
        // switch. Only a REAL transition (first sign-in, or a
        // different user) may route at all — and hash-first: a valid
        // explicit route in the hash is preserved, never overridden.
        const prevUid = authUidRef.current;
        authUidRef.current = session.user.id;
        setAuthNotice(null);
        // Deferred, never awaited inside the callback (deadlock
        // warning): the profile repair runs on the next tick.
        setTimeout(() => {
          void retryPendingProfile(supabase, session.user.id).catch(() => {});
        }, 0);
        if (prevUid !== null && prevUid === session.user.id) return;
        // Only a REAL sign-in flashes the splash: auth-js emits
        // SIGNED_IN on every return-to-visible, and flashing +
        // remounting the whole app on every foregrounding paused adhan
        // audio, lost the banner, and dropped Mushaf state.
        setAuthJustSucceeded(true);
        setTimeout(() => setAuthJustSucceeded(false), 2500);
        // Real transition: the app opens on الرئيسية after login
        // (not the Mushaf page): it is lighter to load, and the
        // Mushaf opens from there. EXCEPTION: a share deep link in
        // the hash survives login — a recipient who logs in from a
        // shared ayah link must still land on that ayah, not be
        // diverted to الرئيسية. GENERALIZED: any valid explicit
        // route in the hash is healed into state, never replaced
        // by home (this also heals a stale state/hash divergence).
        const parsed = parseHash(window.location.hash);
        if (parsed.route === 'mushaf' && (parsed.page || parsed.surah)) return;
        if (parsed.route === 'auth' || parsed.route === 'home') {
          setRoute('home');
        } else {
          setRoute(parsed.route);
        }
        return;
      }
      if (event === 'SIGNED_OUT') {
        authUidRef.current = null;
        // A signed-out user has no interrupted session to restore.
        clearInterruptionMarker('sign-out');
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
      const next = getRouteFromHash();
      if (pendingRouteRef.current === next) return;
      // Shared back button: same pre-commit clear as navigate() —
      // a browser-back / deep-link route change also retires the
      // previous route's internal target.
      setBackTarget(null);
      switchRoute(routeRef.current, next, () => setRoute(next));
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
    // Shared back button: a route change retires any internal target
    // the previous route registered — cleared HERE, pre-commit, not
    // in a [route] effect, because a parent effect runs AFTER the
    // child pages' effects and would wipe a target the newly-mounted
    // (or newly-visible) page legitimately registers on this commit
    // (e.g. returning to an open Listen detail view).
    setBackTarget(null);
    // Leaving #/auth abandons any recovery in progress and clears the
    // expiry notice, so neither can resurface on the next visit.
    if (r !== 'auth') {
      setRecovery(false);
      dropRecoveryMarker();
      setAuthNotice(null);
    }
    // Fix 2 (2026-10-30): deliberate navigation AWAY from a listening
    // page clears the interruption marker — a user who chose to leave
    // must never be hijacked back on the next fresh launch. Existing
    // listening progress is untouched (the marker is not a store).
    if (
      (routeRef.current === 'listen' || routeRef.current === 'adhkar') &&
      r !== routeRef.current
    ) {
      clearInterruptionMarker(r === 'home' ? 'explicit-home' : 'explicit-nav');
      if (r === 'home') {
        recLog('EXPLICIT_HOME', { from: routeRef.current, to: r });
      }
    }
    const prevRoute = routeRef.current;
    pendingRouteRef.current = r;
    window.location.hash = r === 'home' ? '' : `/${r}`;
    switchRoute(prevRoute, r, () => {
      setRoute(r);
      pendingRouteRef.current = null;
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-emerald-50 to-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-hairline-emerald border-t-emerald-600 rounded-full animate-spin" />
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
  // Visual batch (2026-11-04): visible route entrance — the wrapper
  // remounts (and re-animates) on every route change EXCEPT
  // mushaf<->follow, which share one stable key so the SAME Mushaf
  // instance survives (a live follow session must never remount and
  // lose its lock) and so the Mushaf page image never animates at
  // all. The listen/adhkar wrappers below stay mounted regardless.
  const routeKey = route === 'mushaf' || route === 'follow' ? 'mushaf-follow' : route;
  const routeEnterClass = route === 'mushaf' || route === 'follow' ? undefined : 'route-enter-strong';
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
  } else if (route === 'room') {
    page = <SharedRoomPage session={session} onNavigate={navigate} />;
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
      {/* Shared back button (2026-11-06): in flow BEFORE the
          always-mounted Listen/Adhkar wrappers — never fixed/absolute,
          so it can never overlap the Mushaf image, the Mushaf header,
          or the BottomNav. It used to render inside the route wrapper
          below, which sits AFTER those wrappers in DOM order, so on
          listen/adhkar routes it appeared at the BOTTOM of the page.
          Up here it is visually at the top on ALL routes. The
          registered internal target wins when present; otherwise
          every tab route goes back to الرئيسية. */}
      {BACK_BUTTON_ROUTES.includes(route) && (
        <div className="max-w-5xl mx-auto px-4 sm:px-5 md:px-6 lg:px-8 pt-4 md:pt-5">
          {/* 2026-11-12 (agreed UI rule): a sub-page shows TWO back
              buttons on top — its parent (the internal target) and
              الرئيسية. Without an internal target there is one button. */}
          {backTarget ? (
            <div className="flex flex-wrap gap-2">
              <BackButton label={backTarget.label} onBack={backTarget.onBack} />
              <BackButton label="الرئيسية" onBack={() => navigate('home')} />
            </div>
          ) : (
            <BackButton label="الرئيسية" onBack={() => navigate('home')} />
          )}
        </div>
      )}
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
      <div key={routeKey} className={routeEnterClass}>
        {page}
      </div>
      {/* Foreground adhan alerts on every route, logged in or not —
          settings live in localStorage, so this mounts unconditionally. */}
      <AdhanScheduler />
      {/* Silent keeper for the adhan push subscription (closed-app
          notifications); renders nothing, never prompts. */}
      <AdhanPushManager />
      {/* Mic beside any focused search field (voice or typing). */}
      <VoiceSearchMic />
      {/* First-run onboarding overlay (home route only; the app works
          normally behind it once finished or skipped). */}
      {showOnboarding && route === 'home' && (
        <Onboarding onDone={closeOnboarding} />
      )}
      {/* Device picker: once per browser after sign-in. */}
      {session && !getLocalDeviceKind() && !showOnboarding && (
        <DevicePicker userId={session.user.id} onDone={() => setDeviceTick((n) => n + 1)} />
      )}
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
