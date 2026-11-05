-- Adhan Web Push subscriptions (NOT YET APPLIED — apply in the
-- Supabase SQL editor / dashboard as part of the adhan-push rollout;
-- do not apply to the live database from a worktree).
--
-- One row per device/browser: the push endpoint + encryption keys
-- the server needs to address that device, plus the location and
-- timezone the server uses to compute that device's prayer times.
-- user_id is nullable because adhan alerts work logged-out too
-- (settings live in localStorage); when logged in, the row is tied
-- to the user so they can manage it.
--
-- Privacy: a row holds only a push endpoint, two opaque keys, a
-- city/GPS location the user already chose for prayer times, and a
-- timezone. No prayer history, no listening data, no audio.

create table if not exists public.adhan_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  location jsonb not null,
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists adhan_push_subscriptions_user_id_idx
  on public.adhan_push_subscriptions (user_id);

alter table public.adhan_push_subscriptions enable row level security;

-- A device may store its own subscription: logged-in users with
-- their own id, or logged-out devices with user_id NULL.
create policy "adhan_push_insert_own"
  on public.adhan_push_subscriptions
  for insert
  with check (
    (auth.uid() is not null and user_id = auth.uid())
    or (auth.uid() is null and user_id is null)
  );

-- A user may read only their own rows; the Edge Function uses the
-- service-role key and bypasses RLS.
create policy "adhan_push_select_own"
  on public.adhan_push_subscriptions
  for select
  using (auth.uid() is not null and user_id = auth.uid());

-- A user may update only their own rows (location/timezone re-sync).
create policy "adhan_push_update_own"
  on public.adhan_push_subscriptions
  for update
  using (auth.uid() is not null and user_id = auth.uid())
  with check (auth.uid() is not null and user_id = auth.uid());

-- A user may delete only their own rows (unsubscribe). Logged-out
-- rows are deleted by the client via the anon key only when the
-- endpoint matches — the Edge Function also prunes dead endpoints
-- on 404/410 with the service-role key.
create policy "adhan_push_delete_own"
  on public.adhan_push_subscriptions
  for delete
  using (
    (auth.uid() is not null and user_id = auth.uid())
    or (auth.uid() is null and user_id is null)
  );
