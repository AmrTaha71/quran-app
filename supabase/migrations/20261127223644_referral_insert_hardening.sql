-- Muse P0 item 89 (rest): referral_sources write hardening.
-- Applied to live as referral_insert_hardening (apply_migration returned success).
-- Verified on live after apply: new policy, trigger and function present; old policy gone.

-- user_id must match the caller: anon rows have NULL user_id, signed-in rows have their own uid.
-- Closes the spoofing gap (anyone could attribute a row to any user id).
DROP POLICY "anyone can submit a referral answer" ON public.referral_sources;

CREATE POLICY referral_insert_identity_checked ON public.referral_sources FOR INSERT TO anon, authenticated
  WITH CHECK ((auth.uid() IS NULL AND user_id IS NULL) OR (auth.uid() IS NOT NULL AND user_id = auth.uid()));

-- Global cap on anonymous rows: 200 per rolling 24 h.
-- SECURITY DEFINER: anon has no SELECT policy, so a plain count would always return 0.
-- Blunt but bounded: real traffic is far below this. Per-IP limiting still needs an edge function.
CREATE FUNCTION public.referral_anon_daily_cap() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NULL AND (SELECT count(*) FROM public.referral_sources WHERE user_id IS NULL AND created_at > now() - interval '1 day') >= 200 THEN
    RAISE EXCEPTION 'referral daily cap reached';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER referral_anon_daily_cap BEFORE INSERT ON public.referral_sources
  FOR EACH ROW EXECUTE FUNCTION public.referral_anon_daily_cap();
