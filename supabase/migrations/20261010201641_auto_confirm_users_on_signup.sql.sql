/*
# Auto-confirm user emails on signup

## Problem
Email confirmation is enabled on the Supabase project, which blocks new signups
from logging in until they click a verification link. This app uses pseudo-emails
(username@quran-app.user) so email verification is not meaningful.

## Solution
Create a trigger on auth.users that automatically sets email_confirmed_at = now()
whenever a new user row is inserted, effectively auto-confirming every new signup.

## Security
- The trigger function is SECURITY DEFINER, owned by the postgres role, so it can
  modify auth.users internal columns.
- No RLS changes needed — this is a system-level trigger on the auth schema.
*/

CREATE OR REPLACE FUNCTION auto_confirm_user_email()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email_confirmed_at := now();
  NEW.email_verified := true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_auto_confirm_email ON auth.users;
CREATE TRIGGER trigger_auto_confirm_email
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION auto_confirm_user_email();
