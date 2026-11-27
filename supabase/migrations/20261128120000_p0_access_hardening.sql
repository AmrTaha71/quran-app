-- Muse P0 items 89 (partial) and 406: limit abuse and safe defaults.
-- Applied to live 2026-11-28 as p0_access_hardening (after rollback dry run and Opus review).
-- Pre-check on live: 0 rows violate either constraint, 0 null ayah_links.status.

-- 406: new links default to pending. Both app insert sites already set status explicitly.
ALTER TABLE public.ayah_links ALTER COLUMN status SET DEFAULT 'pending';

-- 89 (partial): size bounds on anonymous referral writes.
-- Anonymous inserts stay allowed because the survey runs for logged-out users.
-- A per-IP/per-day rate limit still needs an edge function (open decision).
ALTER TABLE public.referral_sources
  ADD CONSTRAINT referral_sources_sources_size CHECK (cardinality(sources) <= 20),
  ADD CONSTRAINT referral_sources_other_len CHECK (other_text IS NULL OR char_length(other_text) <= 500);
