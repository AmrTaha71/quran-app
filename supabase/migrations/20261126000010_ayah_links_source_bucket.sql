-- 6.19 (approved by the owner in words, 2026-11-26): the admin review queue
-- loads 50 rows at a time from the server instead of all ~6,237. For that the
-- server must know each row's bucket, so ayah_links.source (added 2026-11-21,
-- 'books' or NULL until now) is filled for every row:
--   'ai'    AI draft
--   'admin' written by an admin (or a legacy row with no author)
--   'user'  a user's suggestion
--   'books' taken from athar/tafsir books (unchanged)
-- A BEFORE INSERT trigger sets it for new rows; only an admin may choose the
-- value himself (a user cannot move his suggestion into another bucket).

alter table public.ayah_links disable trigger trigger_update_verse_link_stats; -- source does not change the link stats
update public.ayah_links l set source = case
    when coalesce(l.is_ai_draft, false) then 'ai'
    when l.created_by is not null and exists (select 1 from public.admin_users a where a.user_id = l.created_by) then 'admin'
    when l.created_by is not null then 'user'
    else 'admin' end
  where l.source is distinct from 'books';
alter table public.ayah_links enable trigger trigger_update_verse_link_stats;

alter table public.ayah_links drop constraint if exists ayah_links_source_check;
alter table public.ayah_links add constraint ayah_links_source_check
  check (source is null or source in ('ai', 'admin', 'user', 'books'));

create or replace function public.ayah_links_set_source()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- A value given by an admin, or by the server itself (no end user:
  -- service role / migrations), is kept. Anyone else gets the computed one.
  if new.source is not null
     and (auth.uid() is null or exists (select 1 from public.admin_users a where a.user_id = auth.uid())) then
    return new;
  end if;
  new.source := case
    when coalesce(new.is_ai_draft, false) then 'ai'
    when new.created_by is not null and exists (select 1 from public.admin_users a where a.user_id = new.created_by) then 'admin'
    when new.created_by is not null then 'user'
    else 'admin' end;
  return new;
end;
$$;
revoke all on function public.ayah_links_set_source() from public, anon, authenticated;

drop trigger if exists ayah_links_set_source on public.ayah_links;
create trigger ayah_links_set_source before insert on public.ayah_links
  for each row execute function public.ayah_links_set_source();

create index if not exists ayah_links_status_source_created_idx
  on public.ayah_links (status, source, created_at desc);
