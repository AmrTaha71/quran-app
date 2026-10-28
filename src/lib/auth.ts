import { supabase } from './supabase';
import { EXPLICIT_SIGNOUT_KEY } from './sessionExpiry';
import type { Session } from '@supabase/supabase-js';

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signOut() {
  // S1 auth stream: mark this as a CHOSEN logout before signing out, so
  // the App shell's SIGNED_OUT handler does not mistake it for a session
  // expiry (only expiry routes to #/auth with a "session expired" message).
  // The handler consumes (removes) the flag; a stale flag from a crashed
  // sign-out is therefore harmless — it is only read on SIGNED_OUT.
  try {
    sessionStorage.setItem(EXPLICIT_SIGNOUT_KEY, '1');
  } catch {
    // ignore
  }
  await supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(callback: (session: Session | null) => void) {
  const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return subscription;
}
