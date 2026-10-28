// Session-expiry + password-recovery URL helpers (S1 auth stream,
// device-review fix batch).
//
// Two separate mechanisms live here:
// 1. SESSION EXPIRY: a fetch wrapper for the Supabase client that watches
//    for data-plane 401s (PostgREST/Storage/Functions — a stored JWT the
//    server now rejects) and dispatches a window event the App shell
//    turns into a route to #/auth with a "session expired" message,
//    instead of pages rendering misleading empty states. Auth-plane 401s
//    (bad login password, refresh-token failures) are EXCLUDED on
//    purpose: login errors already show in place, and refresh failures
//    surface through supabase's SIGNED_OUT event, which App handles.
// 2. RECOVERY LINKS: parsing helpers for the recovery redirect. Supabase
//    appends `#access_token=...&type=recovery` to the redirect URL, so a
//    redirect of `/#/auth` produces a DOUBLE hash
//    (`#/auth#access_token=...`) that supabase's own URL parser cannot
//    read (its URLSearchParams sees the key `/auth#access_token`, not
//    `access_token`). The App therefore parses hash segments itself.

/** Window event dispatched when a data-plane request proves the session dead. */
export const SESSION_EXPIRED_EVENT = 'quran:session-expired';

/** sessionStorage flag set by explicit sign-out so App can tell a chosen
 *  logout apart from an expiry (only expiry routes to #/auth with a message). */
export const EXPLICIT_SIGNOUT_KEY = 'quran-explicit-signout';

export function dispatchSessionExpired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

function isDataPlane401(input: RequestInfo | URL, status: number): boolean {
  if (status !== 401) return false;
  const url = typeof input === 'string' ? input : input.toString();
  return (
    url.includes('/rest/v1/') ||
    url.includes('/storage/v1/') ||
    url.includes('/functions/v1/')
  );
}

/**
 * Drop-in fetch for the Supabase client: identical behavior, except a
 * data-plane 401 also dispatches SESSION_EXPIRED_EVENT. The response is
 * returned untouched, so callers see exactly what they would have seen.
 */
export async function sessionAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  if (isDataPlane401(input, res.status)) dispatchSessionExpired();
  return res;
}

/** Params of one `#`-separated URL segment, or null when it is not a query string. */
function segmentParams(segment: string): URLSearchParams | null {
  try {
    return new URLSearchParams(segment);
  } catch {
    return null;
  }
}

export type RecoveryTokens = { accessToken: string; refreshToken: string };

/**
 * Recovery tokens carried in the URL, if any. Checks every `#` segment
 * (covers both `#access_token=...&type=recovery` and the legacy double
 * hash `#/auth#access_token=...&type=recovery`) and the query string.
 * Returns null unless type=recovery with both tokens present.
 */
export function parseRecoveryTokens(href: string): RecoveryTokens | null {
  try {
    const url = new URL(href);
    const candidates: URLSearchParams[] = [];
    if (url.hash) {
      for (const segment of url.hash.slice(1).split('#')) {
        const params = segmentParams(segment);
        if (params) candidates.push(params);
      }
    }
    candidates.push(url.searchParams);
    for (const params of candidates) {
      if (params.get('type') === 'recovery') {
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        if (accessToken && refreshToken) return { accessToken, refreshToken };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True when this load arrived via a recovery link: either the new-style
 * `?recovery=1` marker (which survives supabase clearing the token hash)
 * or recovery tokens still present in the URL. Read once, at first
 * render, before supabase's async URL handling can clear the hash.
 */
export function urlIndicatesRecovery(href: string): boolean {
  try {
    if (new URL(href).searchParams.get('recovery') === '1') return true;
  } catch {
    // fall through to the token check
  }
  return parseRecoveryTokens(href) !== null;
}

/**
 * Drop the `?recovery=1` marker without touching the route hash, so a
 * finished or abandoned recovery cannot resurrect the reset form on the
 * next reload. Uses replaceState (no hashchange event).
 */
export function dropRecoveryMarker(): void {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('recovery') !== '1') return;
    url.searchParams.delete('recovery');
    window.history.replaceState(null, '', url.toString());
  } catch {
    // ignore
  }
}
