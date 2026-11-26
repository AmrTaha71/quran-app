-- SECURITY NOTE (item 1.14, 2026-11-26): auto-confirm is deliberate — the app
-- uses pseudo-emails (username@quran-app.user), so there is NO identity check
-- at signup. This is acceptable ONLY because every content write (verses,
-- links, rephrased, settings, rana-audio storage) is admin-only in RLS
-- (see 20261126000001/2/8). Never loosen those policies while this trigger
-- exists, or anonymous throwaway accounts could edit content.

-- Ensure auto-confirm trigger exists (re-apply in case it was dropped)
CREATE OR REPLACE FUNCTION auto_confirm_user_email()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email_confirmed_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_auto_confirm_email ON auth.users;
CREATE TRIGGER trigger_auto_confirm_email
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION auto_confirm_user_email();

-- Also confirm any existing unconfirmed users
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email_confirmed_at IS NULL;
