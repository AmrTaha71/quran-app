import { createClient } from '@supabase/supabase-js';
import { sessionAwareFetch } from './sessionExpiry';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  // S1 auth stream: a data-plane 401 (stored JWT rejected) dispatches a
  // session-expired event so the App shell can route to #/auth with a
  // message instead of pages rendering misleading empty states. The
  // wrapper returns responses untouched; auth-plane 401s (bad login
  // password, refresh failures) are excluded inside the wrapper.
  global: {
    fetch: sessionAwareFetch,
  },
});
