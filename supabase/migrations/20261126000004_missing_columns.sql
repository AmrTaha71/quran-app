/*
  Item 1.5 (phase 1, 2026-11-26) — columns that exist live but were never
  declared in a migration. NO-OP on the live project (all already exist with
  these exact types/defaults — checked in information_schema 2026-11-26).
  On a fresh database it stops signup (preferred_name), LinkModal saves
  (synthetic_audio_url_female/male) and AI-draft queries (is_ai_draft) from
  failing with "column does not exist".
*/
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS preferred_name text;
ALTER TABLE public.ayah_links ADD COLUMN IF NOT EXISTS synthetic_audio_url_female text;
ALTER TABLE public.ayah_links ADD COLUMN IF NOT EXISTS synthetic_audio_url_male text;
ALTER TABLE public.ayah_links ADD COLUMN IF NOT EXISTS is_ai_draft boolean NOT NULL DEFAULT false;
