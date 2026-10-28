// Username normalization for auth (S1 auth stream, device-review fix batch).
//
// The bug this fixes: signup/login never trimmed or case-normalized the
// username, and iOS autocapitalization silently capitalized the first
// letter — so a user who signed up as "ahmed" could fail to log in as
// "Ahmed" (or vice versa), because the derived auth address
// `<username>@quran-app.user` differed by case.
//
// Rules (kept deliberately conservative):
// - Always trim. A real email typed in the field (contains '@') is only
//   trimmed, never case-changed — its mailbox owns the case.
// - A derived address (no '@' typed) is lowercased, on signup AND login
//   alike, so both sides agree.
// - Login additionally retries the raw-case derivation when it differs:
//   accounts created before this fix may hold a mixed-case derived
//   address in auth, and lowercasing alone would lock those users out.
//   The retry only ever runs after the normalized attempt failed.

export function trimUsername(raw: string): string {
  return raw.trim();
}

/** Derived auth address for a bare username, or null when the input is a real email. */
export function derivedAuthEmail(username: string): string | null {
  const trimmed = username.trim();
  if (!trimmed || trimmed.includes('@')) return null;
  return `${trimmed.toLowerCase()}@quran-app.user`;
}

/**
 * Auth-email candidates to try, in order, for a login attempt.
 * Real email: exactly one candidate (trimmed). Bare username: the
 * normalized derivation first, then the raw-case derivation if different
 * (legacy mixed-case accounts).
 */
export function loginEmailCandidates(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (trimmed.includes('@')) return [trimmed];
  const normalized = `${trimmed.toLowerCase()}@quran-app.user`;
  const raw = `${trimmed}@quran-app.user`;
  return normalized === raw ? [normalized] : [normalized, raw];
}

/**
 * Auth-email candidates for signup: the real email field wins when
 * filled; otherwise the same derivation as login.
 */
export function signupEmailCandidates(emailField: string, username: string): string[] {
  const email = emailField.trim();
  if (email) return [email];
  return loginEmailCandidates(username);
}
