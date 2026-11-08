-- Device-specific settings per account («روابط الذكر الحكيم»).
-- Run once in Supabase Dashboard > SQL Editor.
create table if not exists public.user_device_settings (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  device_kind text        not null check (device_kind in ('phone', 'ipad', 'tv', 'desktop')),
  settings    jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, device_kind)
);

alter table public.user_device_settings enable row level security;

drop policy if exists "own device settings select" on public.user_device_settings;
create policy "own device settings select" on public.user_device_settings
  for select using (auth.uid() = user_id);

drop policy if exists "own device settings insert" on public.user_device_settings;
create policy "own device settings insert" on public.user_device_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists "own device settings update" on public.user_device_settings;
create policy "own device settings update" on public.user_device_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
