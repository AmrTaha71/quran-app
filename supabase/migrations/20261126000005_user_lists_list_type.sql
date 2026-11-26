/*
  Items 1.4 + 1.13 (phase 1, 2026-11-26) — user_lists list types.
  LIVE CHANGE: needs the owner's explicit approval before it is applied live.

  1.4a: live count on 2026-11-26 = 0 rows with list_type = 'favorites'
        (read_later 2, difficult 2, memorized 0).
  1.4b: owner decision §11.11 — favorites become read_later (NEVER memorized),
        then the CHECK allows only read_later / difficult / memorized.
        The UPDATE skips a favorites row whose read_later twin already exists
        (the unique key would reject it) and deletes that duplicate instead.
        Live constraint name verified 2026-11-26: user_lists_list_type_check.
  1.13: one row per (user, verse, type) when link_id IS NULL. Postgres 17 →
        UNIQUE NULLS NOT DISTINCT replaces the old unique key (one form only,
        not both). Live has no duplicates today (checked before writing this).
*/

DELETE FROM public.user_lists f
 WHERE f.list_type = 'favorites'
   AND EXISTS (
     SELECT 1 FROM public.user_lists r
      WHERE r.user_id = f.user_id AND r.verse_id = f.verse_id
        AND r.list_type = 'read_later'
        AND r.link_id IS NOT DISTINCT FROM f.link_id);

UPDATE public.user_lists SET list_type = 'read_later' WHERE list_type = 'favorites';

ALTER TABLE public.user_lists DROP CONSTRAINT IF EXISTS user_lists_list_type_check;
ALTER TABLE public.user_lists ADD CONSTRAINT user_lists_list_type_check
  CHECK (list_type IN ('read_later', 'difficult', 'memorized'));

ALTER TABLE public.user_lists DROP CONSTRAINT IF EXISTS user_lists_user_id_verse_id_list_type_link_id_key;
ALTER TABLE public.user_lists ADD CONSTRAINT user_lists_user_id_verse_id_list_type_link_id_key
  UNIQUE NULLS NOT DISTINCT (user_id, verse_id, list_type, link_id);
