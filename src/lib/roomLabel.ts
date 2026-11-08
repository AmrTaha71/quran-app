// Gender-aware label for the shared room door (2026-11-08).
// Gender comes from the same localStorage key Settings uses
// ('quran-user-gender', set from user_profiles.gender). Unknown gender
// falls back to the neutral label.
export function roomLabel(): string {
  let g: string | null = null;
  try {
    g = localStorage.getItem('quran-user-gender');
  } catch {
    g = null;
  }
  if (g === 'male') return 'راجع مع رفيقك';
  if (g === 'female') return 'راجعي مع رفيقتك';
  return 'راجع مع الرفيق';
}
