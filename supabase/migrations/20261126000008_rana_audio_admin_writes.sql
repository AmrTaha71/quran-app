/*
  Item 1.8 (phase 1, 2026-11-26) — rana-audio storage writes are admin-only.
  LIVE CHANGE: needs the owner's explicit approval before it is applied live.

  Live storage policies (pg_policies 2026-11-26): auth_upload_rana_audio and
  auth_delete_rana_audio allow ANY signed-in user (bucket_id check only), so
  anyone could delete Rana's original clips or the shared corr/ and tafsir/
  caches, or use the public bucket as free hosting.

  Upload sites checked: LinkModal.tsx (3 uploads) — rendered only from
  AdminPage. generate-voice writes corr/ and tafsir/ with the service role
  (bypasses RLS), so it is unaffected. Public read stays as is.
*/

DROP POLICY IF EXISTS auth_upload_rana_audio ON storage.objects;
CREATE POLICY auth_upload_rana_audio ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rana-audio' AND public.is_admin());

DROP POLICY IF EXISTS auth_delete_rana_audio ON storage.objects;
CREATE POLICY auth_delete_rana_audio ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'rana-audio' AND public.is_admin());
