/*
  Item 1.2 (phase 1, 2026-11-26) — content under review is not public.
  LIVE CHANGE: needs the owner's explicit approval before it is applied live.

  Before: public_select_links / public_select_rephrased were USING (true) for
  anon + authenticated, so anyone with the anon key could read pending and
  rejected rows (with original_transcript and unreviewed text). The client
  already filters .eq('status','approved') for normal users, so their
  experience does not change.

  After:
    - everyone sees approved rows;
    - a signed-in author also sees their own pending/rejected rows;
    - admins see everything (review queue in AdminPage).
*/

DROP POLICY IF EXISTS public_select_links ON public.ayah_links;
CREATE POLICY public_select_links ON public.ayah_links FOR SELECT
  TO anon, authenticated
  USING (
    status = 'approved'
    OR (auth.uid() IS NOT NULL AND created_by = auth.uid())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS public_select_rephrased ON public.rephrased_contents;
CREATE POLICY public_select_rephrased ON public.rephrased_contents FOR SELECT
  TO anon, authenticated
  USING (
    status = 'approved'
    OR (auth.uid() IS NOT NULL AND created_by = auth.uid())
    OR public.is_admin()
  );
