// 10.5 (2026-11-26): deleting the account clears the ACCOUNT's data on
// this device (identity, progress, history, personal choices), not the
// device's own setup (device model, adhan, downloads, Mushaf look,
// battery options, language), which localStorage.clear() used to wipe.
// Supabase's own session keys go with signOut().
const ACCOUNT_EXACT = new Set([
  'quran-uid', 'quran-profile-pending', 'quran-user-gender', 'quran-explicit-signout',
  'quran-wird-v1', 'quran-recent-activity-v1', 'quran-listening-wird', 'quran-interrupted-listening',
  'quran-three-mode-resume', 'quran-riwayat-resume', 'quran-hadr-resume', 'quran-adhkar-position',
  'quran-mushaf-page', 'quran-mushaf-page-lists', 'quran-word-mistakes-v1', 'quran-tajwid-skills-v1',
  'quran-lisp-letters', 'quran-comprehensive-results', 'quran-daily-stats-v1', 'quran-daily-report-v1',
  'quran-day-recap', 'quran-last-active-v1', 'quran-worship-seconds', 'quran-referral-done',
  'quran-onboarding-done', 'quran-admin-view-as-user', 'quran-show-diag', 'quran-link-of-day-v1',
]);
const ACCOUNT_PREFIX = ['quran-srs', 'quran-test-', 'quran-tasbih-', 'rawabit.'];

export function isAccountKey(k: string): boolean {
  return ACCOUNT_EXACT.has(k) || ACCOUNT_PREFIX.some((p) => k.startsWith(p));
}

/** Removes the account's keys from `store`; returns how many went. */
export function clearAccountData(store: Pick<Storage, 'length' | 'key' | 'removeItem'>): number {
  const doomed: string[] = [];
  for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && isAccountKey(k)) doomed.push(k); }
  doomed.forEach((k) => store.removeItem(k));
  return doomed.length;
}
