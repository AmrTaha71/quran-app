// Interrupted Listening Recovery (2026-10-30, Claude-approved design).
//
// PROBLEM (root cause, verified against installed auth-js 2.71.1):
// every return-to-visible with a valid, non-expired session makes
// auth-js emit SIGNED_IN (_onVisibilityChanged -> _recoverAndRefresh ->
// _notifyAllSubscribers('SIGNED_IN')), and App's old SIGNED_IN handler
// unconditionally setRoute('home'). So a screen lock (or a plain tab
// switch) yanked the listening page to Home while the URL still said
// #/listen. Fix 1 (App.tsx) stops the yank; this module is Fix 2: a
// small, tab-scoped interruption marker that lets a genuine
// tab-restore (empty hash, same tab) return to the interrupted page.
//
// DESIGN RULES (do not widen without a new decision):
// - Marker = navigation recovery ONLY. It never stores listening
//   progress; each page's existing resume store still owns that.
// - Fresh launch stays Home: restore requires a valid session, an
//   empty hash, no recovery flow, a fresh (<=12h) marker, the same
//   tab id, and (when present) the same user id.
// - No autoplay ever: restore shows the PAGE; the existing resume
//   card tap is the gesture that resumes playback.
// - Deliberate navigation away from listening clears the marker, so
//   nobody is hijacked back into listening they left on purpose.

export type InterruptedPage = 'listen' | 'adhkar';

export interface InterruptedMarker {
  version: 1;
  page: InterruptedPage;
  tabId: string;
  interruptedAt: number;
  wasPlaying: true;
  uid: string | null;
}

const MARKER_KEY = 'quran-interrupted-listening';
const TAB_KEY = 'quran_tab_id';
const UID_KEY = 'quran-uid';
const LOG_KEY = 'quran-listen-recovery-log';

export const INTERRUPTION_TTL_MS = 12 * 60 * 60 * 1000; // 12h, matches the existing auto-resume intent lifetime
const LOG_CAP = 30;

// ---------------------------------------------------------------- tab id

export function getTabId(): { id: string; existing: boolean } {
  try {
    const prev = sessionStorage.getItem(TAB_KEY);
    if (prev) return { id: prev, existing: true };
    let id = '';
    try {
      id = crypto.randomUUID();
    } catch {
      id = `tab-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    }
    try {
      sessionStorage.setItem(TAB_KEY, id);
    } catch {
      // storage unavailable: still return the id (restore will simply
      // never match on a later boot, which is the safe direction)
    }
    return { id, existing: false };
  } catch {
    return { id: 'unavailable', existing: false };
  }
}

// ------------------------------------------------------------------- log
// Temporary [LISTEN_RECOVERY] diagnostics: a 30-entry ring buffer in
// localStorage, shown in Settings so the user can screenshot it.
// NEVER log tokens, passwords, or personal account information.

export interface RecoveryLogEntry {
  t: number;
  event: string;
  [key: string]: unknown;
}

export function recLog(event: string, data: Record<string, unknown> = {}): void {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const entries: RecoveryLogEntry[] = raw ? (JSON.parse(raw) as RecoveryLogEntry[]) : [];
    entries.push({ t: Date.now(), event, ...data });
    while (entries.length > LOG_CAP) entries.shift();
    localStorage.setItem(LOG_KEY, JSON.stringify(entries));
  } catch {
    // diagnostics must never break playback or navigation
  }
}

export function readRecoveryLog(): RecoveryLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const entries = JSON.parse(raw) as RecoveryLogEntry[];
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- marker

function readUid(): string | null {
  try {
    return localStorage.getItem(UID_KEY) || null;
  } catch {
    return null;
  }
}

export function readMarker(): InterruptedMarker | null {
  try {
    const raw = localStorage.getItem(MARKER_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<InterruptedMarker>;
    if (
      m.version !== 1 ||
      (m.page !== 'listen' && m.page !== 'adhkar') ||
      typeof m.tabId !== 'string' ||
      typeof m.interruptedAt !== 'number'
    ) {
      // Malformed or unsupported version: delete, never restore.
      try {
        localStorage.removeItem(MARKER_KEY);
      } catch {
        // ignore
      }
      return null;
    }
    return {
      version: 1,
      page: m.page,
      tabId: m.tabId,
      interruptedAt: m.interruptedAt,
      wasPlaying: true,
      uid: typeof m.uid === 'string' ? m.uid : null,
    };
  } catch {
    try {
      localStorage.removeItem(MARKER_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

function writeMarker(page: InterruptedPage): void {
  try {
    const marker: InterruptedMarker = {
      version: 1,
      page,
      tabId: getTabId().id,
      interruptedAt: Date.now(),
      wasPlaying: true,
      uid: readUid(),
    };
    localStorage.setItem(MARKER_KEY, JSON.stringify(marker));
  } catch {
    // ignore: no marker means boot falls back to Home, the safe default
  }
}

export function clearInterruptionMarker(reason: string): void {
  try {
    if (localStorage.getItem(MARKER_KEY)) {
      localStorage.removeItem(MARKER_KEY);
      recLog('INTERRUPTION_CLEARED', { reason });
    }
  } catch {
    // ignore
  }
}

/** Shared hide handler for both listening pages. Idempotent: a
 * visibilitychange-hidden followed by pagehide writes twice at most,
 * with the same shape (only the timestamp refreshes). */
export function handleInterruptionHidden(
  page: InterruptedPage,
  playing: boolean,
  overlayOpen: boolean,
  pageVisible: boolean,
  kind: 'visibilitychange' | 'pagehide',
): void {
  const event = kind === 'pagehide' ? 'PAGE_HIDE' : 'VISIBILITY_HIDDEN';
  recLog(event, { page, playing, overlayOpen, pageVisible });
  if (pageVisible && playing) {
    writeMarker(page);
    recLog('INTERRUPTION_WRITE', { page });
  } else {
    clearInterruptionMarker(playing ? 'not-visible' : 'not-playing');
  }
}

// --------------------------------------------------------------- restore

export interface RestoreEvaluation {
  restore: InterruptedPage | null;
  reason: string;
  ageMs: number | null;
  tabMatch: boolean | null;
  uidMatch: boolean | null;
  page: InterruptedPage | null;
}

/** Boot-time decision. Does NOT mutate except deleting malformed or
 * expired markers (per design); a tab-mismatched marker is left for
 * its original tab. Call consumeMarker() after a successful restore. */
export function evaluateRestore(uid: string): RestoreEvaluation {
  const marker = readMarker();
  if (!marker) {
    return { restore: null, reason: 'no-marker', ageMs: null, tabMatch: null, uidMatch: null, page: null };
  }
  const ageMs = Date.now() - marker.interruptedAt;
  if (ageMs > INTERRUPTION_TTL_MS) {
    try {
      localStorage.removeItem(MARKER_KEY);
    } catch {
      // ignore
    }
    return { restore: null, reason: 'expired', ageMs, tabMatch: null, uidMatch: null, page: marker.page };
  }
  const tabMatch = marker.tabId === getTabId().id;
  if (!tabMatch) {
    return { restore: null, reason: 'tab-mismatch', ageMs, tabMatch, uidMatch: null, page: marker.page };
  }
  const uidMatch = marker.uid === null || marker.uid === uid;
  if (!uidMatch) {
    try {
      localStorage.removeItem(MARKER_KEY);
    } catch {
      // ignore
    }
    return { restore: null, reason: 'uid-mismatch', ageMs, tabMatch, uidMatch, page: marker.page };
  }
  return { restore: marker.page, reason: 'ok', ageMs, tabMatch, uidMatch, page: marker.page };
}

export function consumeMarker(): void {
  clearInterruptionMarker('consumed');
}
