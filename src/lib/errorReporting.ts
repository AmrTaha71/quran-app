// 10.3 (2026-11-26): app errors are kept in a small LOCAL ring (30
// entries, localStorage), shown in Settings > diagnostics. Nothing is
// sent anywhere: an outside reporting service needs the owner's OK on
// the service and its cost first. Content-free by design: scope, error
// name/message (cut to 200 chars), route and build only, never user data.
const KEY = 'quran-error-log-v1';
const CAP = 30;

export interface ErrorLogEntry { t: number; scope: string; msg: string; route: string; build: string }

declare const __BUILD_SHA__: string;
function build(): string { try { return typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev'; } catch { return 'dev'; } }

export function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 200);
  if (typeof e === 'string') return e.slice(0, 200);
  try { return JSON.stringify(e).slice(0, 200); } catch { return String(e).slice(0, 200); }
}

export function logError(scope: string, e: unknown): void {
  try {
    const raw = localStorage.getItem(KEY);
    const arr: ErrorLogEntry[] = raw ? (JSON.parse(raw) as ErrorLogEntry[]) : [];
    const list = Array.isArray(arr) ? arr : [];
    const route = typeof location !== 'undefined' ? (location.hash.split('?')[0] || '#/') : '';
    list.push({ t: Date.now(), scope, msg: errorText(e), route, build: build() });
    while (list.length > CAP) list.shift();
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* the error log must never throw */ }
}

export function readErrorLog(): ErrorLogEntry[] {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a as ErrorLogEntry[] : []; } catch { return []; }
}

let installed = false;
/** window.onerror + unhandledrejection -> the local log. Call once at start. */
export function installGlobalErrorLog(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (ev) => logError('window', ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => logError('promise', ev.reason));
}
