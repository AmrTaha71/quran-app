// Admin preview (wave 2, W2-4). A real admin can flip «شوف كمستخدم» to see
// the app exactly as a normal user does: admin-only features (the
// «متقن» level, diagnostics, the admin door) hide. It changes ONLY what is
// shown. The account's real permissions are untouched: the server-side
// checks (admin_users, RLS) never read this value, and Settings/Admin
// pages still verify the admin row themselves.
//
// Usage in a feature: `const isAdmin = useIsAdminView();` and render the
// admin-only UI when it is true. `useAdminView()` gives the raw state.
//
// State: `realAdmin` is set by App after the admin_users lookup;
// `viewAsUser` lives in sessionStorage (new key) so a fresh launch always
// starts in the admin view. A non-admin can never be "effective admin".
import { useSyncExternalStore } from 'react';

const KEY = 'quran-admin-view-as-user';

function readStored(): boolean {
  try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}

export type AdminView = {
  /** The account really is in admin_users. */
  realAdmin: boolean;
  /** The admin chose to preview the user experience. */
  viewAsUser: boolean;
  /** Show admin-only features: realAdmin && !viewAsUser. */
  effectiveAdmin: boolean;
};

let realAdmin = false;
let viewAsUser = readStored();
let snapshot: AdminView = build();
const subscribers = new Set<() => void>();

function build(): AdminView {
  return { realAdmin, viewAsUser, effectiveAdmin: realAdmin && !viewAsUser };
}

// Settings/SelfTest hide their diagnostic lines through this existing
// localStorage flag; keep it in step with the effective view.
function syncDiagFlag(): void {
  if (!realAdmin) return;
  try { localStorage.setItem('quran-show-diag', viewAsUser ? '0' : '1'); } catch { /* storage off */ }
}

function emit(): void {
  snapshot = build();
  syncDiagFlag();
  for (const cb of [...subscribers]) {
    try { cb(); } catch { /* a throwing subscriber must never break the app */ }
  }
}

/** Called by App after the admin_users lookup (and on sign-out with false). */
export function setRealAdmin(v: boolean): void {
  if (realAdmin === v) return;
  realAdmin = v;
  emit();
}

/** Flip the preview. Ignored for non-admins. */
export function setViewAsUser(v: boolean): void {
  if (!realAdmin || viewAsUser === v) return;
  viewAsUser = v;
  try { if (v) sessionStorage.setItem(KEY, '1'); else sessionStorage.removeItem(KEY); } catch { /* storage off */ }
  emit();
}

/** Sign-out: forget the admin state and any preview choice. */
export function resetAdminView(): void {
  realAdmin = false;
  viewAsUser = false;
  try { sessionStorage.removeItem(KEY); } catch { /* storage off */ }
  emit();
}

export function getAdminView(): AdminView {
  return snapshot;
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

export function useAdminView(): AdminView {
  return useSyncExternalStore(subscribe, getAdminView, getAdminView);
}

/** True only for a real admin who is NOT previewing as a user. */
export function useIsAdminView(): boolean {
  return useAdminView().effectiveAdmin;
}
