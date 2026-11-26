/*
  Item 1.1 (phase 1, 2026-11-26) — repo/live parity.

  These objects already exist on the LIVE project (xfhjlukkvjzlmrggvowm) but no
  repo migration created them, so a database built from migrations alone was
  broken (no admin, generate-voice 500 on every call, no usage monitor).
  Every definition below was copied from the live catalog on 2026-11-26
  (information_schema.columns, pg_constraint, pg_indexes, pg_policies,
  pg_get_functiondef, supabase_migrations.schema_migrations) — not invented.

  On the live project this file is a NO-OP (everything is IF NOT EXISTS /
  CREATE OR REPLACE with the identical body / DROP POLICY IF EXISTS + same
  policy). It does not need to be applied live.

  Live migrations folded in here (they were applied through the dashboard /
  connector and never committed):
    20261114083400 referral_sources
    20261119212026 security_restrict_verse_and_rephrase_writes_to_admin
    20261121032047 verse_link_stats_count_merged_and_far_links

  admin_users keeps ONLY its two live columns (owner decision 2026-11-26,
  §11.12: no granted_by / note for now).
*/

-- ── admin_users ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_own_admin ON public.admin_users;
CREATE POLICY select_own_admin ON public.admin_users FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE policies: admins are granted from the Supabase
-- dashboard (service role) only.

-- ── ai_usage_events ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  function_name text NOT NULL,
  model text NOT NULL,
  cost_usd numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  provider text,
  chars integer
);
CREATE INDEX IF NOT EXISTS ai_usage_events_user_time
  ON public.ai_usage_events (function_name, user_id, created_at DESC);
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_select_usage ON public.ai_usage_events;
CREATE POLICY admin_select_usage ON public.ai_usage_events FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()));
-- Writes come only from Edge Functions with the service role (bypasses RLS).

-- ── app_settings ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_select_settings ON public.app_settings;
CREATE POLICY admin_select_settings ON public.app_settings FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()));
DROP POLICY IF EXISTS admin_insert_settings ON public.app_settings;
CREATE POLICY admin_insert_settings ON public.app_settings FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()));
DROP POLICY IF EXISTS admin_update_settings ON public.app_settings;
CREATE POLICY admin_update_settings ON public.app_settings FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()));

-- ── referral_sources (live 20261114083400) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sources text[] NOT NULL DEFAULT '{}',
  other_text text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.referral_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone can submit a referral answer" ON public.referral_sources;
CREATE POLICY "anyone can submit a referral answer" ON public.referral_sources
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ── Admin-only writes on verses / rephrased (live 20261119212026) ──
DROP POLICY IF EXISTS auth_delete_verses ON public.quran_verses;
DROP POLICY IF EXISTS auth_insert_verses ON public.quran_verses;
DROP POLICY IF EXISTS auth_update_verses ON public.quran_verses;
DROP POLICY IF EXISTS admin_delete_verses ON public.quran_verses;
DROP POLICY IF EXISTS admin_insert_verses ON public.quran_verses;
DROP POLICY IF EXISTS admin_update_verses ON public.quran_verses;
CREATE POLICY admin_delete_verses ON public.quran_verses FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = (SELECT auth.uid())));
CREATE POLICY admin_insert_verses ON public.quran_verses FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = (SELECT auth.uid())));
CREATE POLICY admin_update_verses ON public.quran_verses FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS auth_delete_rephrased ON public.rephrased_contents;
DROP POLICY IF EXISTS auth_insert_rephrased ON public.rephrased_contents;
DROP POLICY IF EXISTS auth_update_rephrased ON public.rephrased_contents;
DROP POLICY IF EXISTS admin_delete_rephrased ON public.rephrased_contents;
DROP POLICY IF EXISTS admin_insert_rephrased ON public.rephrased_contents;
DROP POLICY IF EXISTS admin_update_rephrased ON public.rephrased_contents;
CREATE POLICY admin_delete_rephrased ON public.rephrased_contents FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = (SELECT auth.uid())));
CREATE POLICY admin_insert_rephrased ON public.rephrased_contents FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = (SELECT auth.uid())));
CREATE POLICY admin_update_rephrased ON public.rephrased_contents FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = (SELECT auth.uid())));

-- ── Admin-only writes on ayah_links (as live) ───────────────────────
-- 20261126000002 then narrows the non-admin INSERT to created_by = auth.uid().
DROP POLICY IF EXISTS auth_insert_links ON public.ayah_links;
DROP POLICY IF EXISTS auth_update_links ON public.ayah_links;
DROP POLICY IF EXISTS auth_delete_links ON public.ayah_links;
DROP POLICY IF EXISTS admin_or_pending_insert_links ON public.ayah_links;
DROP POLICY IF EXISTS admin_update_links ON public.ayah_links;
DROP POLICY IF EXISTS admin_delete_links ON public.ayah_links;
CREATE POLICY admin_or_pending_insert_links ON public.ayah_links FOR INSERT TO authenticated
  WITH CHECK ((EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid())) OR (status = 'pending'));
CREATE POLICY admin_update_links ON public.ayah_links FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()));
CREATE POLICY admin_delete_links ON public.ayah_links FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()));

-- ── Functions (bodies copied from live pg_get_functiondef) ──────────
CREATE OR REPLACE FUNCTION public.get_user_stats()
 RETURNS TABLE(total bigint, confirmed bigint, signed_in bigint, new_30d bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not admin';
  END IF;
  RETURN QUERY
    SELECT
      count(*)::bigint,
      count(*) FILTER (WHERE email_confirmed_at IS NOT NULL)::bigint,
      count(*) FILTER (WHERE last_sign_in_at IS NOT NULL)::bigint,
      count(*) FILTER (WHERE created_at >= now() - interval '30 days')::bigint
    FROM auth.users;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_user_stats() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_user_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated, public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
      WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      EXECUTE FUNCTION public.rls_auto_enable();
  END IF;
END $$;

-- Live 20261121032047: a link touches a verse via verse_id, group_verse_ids
-- (merged link) or related_verse_id (far link); only approved links count.
CREATE OR REPLACE FUNCTION public.update_verse_link_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id integer;
BEGIN
  FOR v_id IN
    SELECT DISTINCT vid FROM (
      SELECT OLD.verse_id::integer AS vid WHERE TG_OP IN ('UPDATE', 'DELETE') AND OLD.verse_id IS NOT NULL
      UNION
      SELECT NEW.verse_id::integer AS vid WHERE TG_OP IN ('INSERT', 'UPDATE') AND NEW.verse_id IS NOT NULL
      UNION
      SELECT unnest(g)::integer AS vid FROM (SELECT OLD.group_verse_ids AS g WHERE TG_OP IN ('UPDATE', 'DELETE') AND OLD.group_verse_ids IS NOT NULL) o
      UNION
      SELECT unnest(g)::integer AS vid FROM (SELECT NEW.group_verse_ids AS g WHERE TG_OP IN ('INSERT', 'UPDATE') AND NEW.group_verse_ids IS NOT NULL) n
      UNION
      SELECT OLD.related_verse_id::integer AS vid WHERE TG_OP IN ('UPDATE', 'DELETE') AND OLD.related_verse_id IS NOT NULL
      UNION
      SELECT NEW.related_verse_id::integer AS vid WHERE TG_OP IN ('INSERT', 'UPDATE') AND NEW.related_verse_id IS NOT NULL
    ) s
  LOOP
    UPDATE public.quran_verses v
    SET links_count = (
          SELECT COUNT(*) FROM public.ayah_links a
          WHERE a.status = 'approved'
            AND (a.verse_id = v_id OR a.related_verse_id = v_id OR a.group_verse_ids @> ARRAY[v_id::bigint])
        ),
        has_links = EXISTS (
          SELECT 1 FROM public.ayah_links a
          WHERE a.status = 'approved'
            AND (a.verse_id = v_id OR a.related_verse_id = v_id OR a.group_verse_ids @> ARRAY[v_id::bigint])
        )
    WHERE v.id = v_id;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
