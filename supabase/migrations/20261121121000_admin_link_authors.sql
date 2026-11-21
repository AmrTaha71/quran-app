-- Admin-only: usernames for the authors of suggested links (user_profiles is own-row RLS only).
CREATE OR REPLACE FUNCTION public.admin_link_authors(ids uuid[])
RETURNS TABLE(user_id uuid, username text, display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not admin';
  END IF;
  RETURN QUERY
    SELECT p.user_id, p.username, COALESCE(p.preferred_name, p.full_name)
    FROM public.user_profiles p WHERE p.user_id = ANY(ids);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_link_authors(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_link_authors(uuid[]) TO authenticated;
