/*
  Items 1.7 + 9.3 (phase 1, 2026-11-26) — adhan Web Push subscriptions.
  LIVE CHANGE: needs the owner's explicit approval before it is applied live.

  Live policies read from pg_policies 2026-11-26: the hole IS live —
  adhan_push_delete_own allows (auth.uid() IS NULL AND user_id IS NULL),
  evaluated per ROW, so one anonymous DELETE with no filter wipes every
  logged-out device's subscription.

  1.7: drop the anonymous branch of the DELETE policy; logged-out devices
       unsubscribe through unsubscribe_adhan_push(endpoint), which deletes
       exactly one endpoint (the caller must know the full secret-ish push
       URL, which only the device itself has). Signed-in users keep deleting
       their own rows directly.
  9.3: last_sent_at + last_sent_prayer so the cron function can use a
       2-minute window without sending the same prayer twice.
*/

DROP POLICY IF EXISTS adhan_push_delete_own ON public.adhan_push_subscriptions;
CREATE POLICY adhan_push_delete_own ON public.adhan_push_subscriptions
  FOR DELETE
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.unsubscribe_adhan_push(p_endpoint text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_endpoint IS NULL OR length(p_endpoint) < 20 THEN
    RETURN;
  END IF;
  DELETE FROM public.adhan_push_subscriptions s
   WHERE s.endpoint = p_endpoint
     AND (s.user_id IS NULL OR s.user_id = auth.uid());
END;
$function$;
REVOKE ALL ON FUNCTION public.unsubscribe_adhan_push(text) FROM public;
GRANT EXECUTE ON FUNCTION public.unsubscribe_adhan_push(text) TO anon, authenticated;

ALTER TABLE public.adhan_push_subscriptions ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;
ALTER TABLE public.adhan_push_subscriptions ADD COLUMN IF NOT EXISTS last_sent_prayer text;
