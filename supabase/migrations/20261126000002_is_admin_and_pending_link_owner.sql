/*
  Item 1.1 (phase 1, 2026-11-26) — is_admin() + tighter link suggestions.
  LIVE CHANGE: needs the owner's explicit approval before it is applied live.

  1. public.is_admin(): one SECURITY DEFINER helper (search_path = '') so
     policies stop repeating the admin_users sub-select. Used by 000008
     (rana-audio storage) and available for later policies.
  2. admin_users: admins may read every admin id (badge / review screens);
     everyone else still reads only their own row. No write policies:
     admins are granted from the Supabase dashboard only.
  3. ayah_links INSERT for non-admins: still "suggestion only"
     (status = 'pending') AND now created_by must be the caller. Today a
     signed-in user can insert a pending row that claims any created_by.
     Callers already comply: QuranMushafPage submitSuggestion sends
     created_by = session.user.id; LinkModal (admin) sends the session uid.
*/

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid());
$function$;
REVOKE ALL ON FUNCTION public.is_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

DROP POLICY IF EXISTS admin_select_all_admins ON public.admin_users;
CREATE POLICY admin_select_all_admins ON public.admin_users FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS admin_or_pending_insert_links ON public.ayah_links;
CREATE POLICY admin_or_pending_insert_links ON public.ayah_links FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (status = 'pending' AND created_by = auth.uid())
  );
