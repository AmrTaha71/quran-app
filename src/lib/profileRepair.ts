// Profile-row repair (S1 auth stream, device-review fix batch).
//
// The bug this fixes: AuthPage signup swallowed the user_profiles insert
// error (`.then(() => {})`), so a failed insert left the user with NO
// profile row — no username, no gender — and only preferred_name was
// ever repaired later. A lost row must now be (a) kept, (b) retried
// after sign-in, and (c) shown as a non-blocking retry state instead of
// silently rendering as "no data".
//
// Mechanism: when the signup insert fails, the full payload is saved to
// localStorage. After every sign-in (and on لوحتي mount) the row is
// re-checked: if it exists the pending payload is cleared; if not, the
// insert is retried. The pending payload is the user's own signup data,
// stored on their own device only, and is deleted on success.
// A row lost WITHOUT a pending payload (e.g. pre-fix signups) cannot be
// reconstructed from nothing — that case is deliberately not guessed at.

import type { SupabaseClient } from '@supabase/supabase-js';

export type PendingProfile = {
  user_id: string;
  username: string;
  gender: 'male' | 'female';
  birth_date: string | null;
  country_code: string;
  phone: string | null;
  preferred_language: string;
  preferred_name: string | null;
};

const PENDING_KEY = 'quran-profile-pending';

export function savePendingProfile(payload: PendingProfile): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
  } catch {
    // Private-mode storage failure: the retry still runs from the
    // in-signup attempt; only the cross-session resume is lost.
  }
}

export function readPendingProfile(): PendingProfile | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingProfile>;
    if (typeof parsed.user_id !== 'string' || !parsed.user_id) return null;
    if (typeof parsed.username !== 'string') return null;
    if (parsed.gender !== 'male' && parsed.gender !== 'female') return null;
    return parsed as PendingProfile;
  } catch {
    return null;
  }
}

export function clearPendingProfile(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

export type ProfileRepairResult = { ok: boolean; error?: string };

async function rowExists(client: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await client
    .from('user_profiles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

/**
 * Retry a pending profile insert for this user. No pending payload, or a
 * payload for another user, is a no-op success. An insert that loses a
 * race to an existing row still counts as success (the row is what
 * matters, not which attempt wrote it).
 */
export async function retryPendingProfile(
  client: SupabaseClient,
  userId: string,
): Promise<ProfileRepairResult> {
  const pending = readPendingProfile();
  if (!pending || pending.user_id !== userId) return { ok: true };
  try {
    if (await rowExists(client, userId)) {
      clearPendingProfile();
      return { ok: true };
    }
    const { error } = await client.from('user_profiles').insert(pending);
    if (!error) {
      clearPendingProfile();
      return { ok: true };
    }
    // Lost race: the row appeared between the check and the insert.
    if (await rowExists(client, userId)) {
      clearPendingProfile();
      return { ok: true };
    }
    return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' };
  }
}
