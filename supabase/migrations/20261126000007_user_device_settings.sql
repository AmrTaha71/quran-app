/*
  Item 1.12 (phase 1, 2026-11-26) — user_device_settings moves into
  migrations (it lived only in supabase/device_settings.sql, run by hand).
  Definition matches live (columns, CHECK, PK, FK, 3 policies — checked
  2026-11-26).
  LIVE CHANGE (only the last policy): the missing DELETE policy so a user
  can delete their own device settings (delete-account also clears them).
*/
CREATE TABLE IF NOT EXISTS public.user_device_settings (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_kind text        NOT NULL CHECK (device_kind IN ('phone', 'ipad', 'tv', 'desktop')),
  settings    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_kind)
);

ALTER TABLE public.user_device_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own device settings select" ON public.user_device_settings;
CREATE POLICY "own device settings select" ON public.user_device_settings
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own device settings insert" ON public.user_device_settings;
CREATE POLICY "own device settings insert" ON public.user_device_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own device settings update" ON public.user_device_settings;
CREATE POLICY "own device settings update" ON public.user_device_settings
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own device settings delete" ON public.user_device_settings;
CREATE POLICY "own device settings delete" ON public.user_device_settings
  FOR DELETE USING (auth.uid() = user_id);
