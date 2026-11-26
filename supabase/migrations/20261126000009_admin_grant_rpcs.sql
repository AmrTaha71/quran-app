-- 16.12(b) (approved by the owner in words, 2026-11-26): grant / revoke admin
-- from the admin page. No write policy on admin_users: the table stays
-- read-only through the API, and these SECURITY DEFINER functions are the
-- only way in. Each one checks is_admin() first; an admin cannot revoke
-- himself, and the last admin cannot be removed.
create or replace function public.admin_list_admins()
returns table(user_id uuid, email text, display_name text, granted_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  return query
    select a.user_id, u.email::text, coalesce(p.preferred_name, p.full_name, p.username), a.granted_at
    from public.admin_users a
    left join auth.users u on u.id = a.user_id
    left join public.user_profiles p on p.user_id = a.user_id
    order by a.granted_at;
end;
$$;

-- who: an e-mail address, or a username from user_profiles.
create or replace function public.admin_grant(who text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v uuid;
  w text := lower(trim(coalesce(who, '')));
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  if w = '' then raise exception 'empty' using errcode = '22023'; end if;
  if position('@' in w) > 0 then
    select u.id into v from auth.users u where lower(u.email) = w limit 1;
  else
    select p.user_id into v from public.user_profiles p where lower(p.username) = w limit 1;
  end if;
  if v is null then raise exception 'no such user' using errcode = 'P0002'; end if;
  insert into public.admin_users (user_id) values (v) on conflict (user_id) do nothing;
  return v;
end;
$$;

create or replace function public.admin_revoke(target uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  if target = auth.uid() then raise exception 'cannot revoke self' using errcode = '22023'; end if;
  if (select count(*) from public.admin_users) <= 1 then raise exception 'last admin' using errcode = '22023'; end if;
  delete from public.admin_users where user_id = target;
end;
$$;

revoke all on function public.admin_list_admins() from public, anon;
revoke all on function public.admin_grant(text) from public, anon;
revoke all on function public.admin_revoke(uuid) from public, anon;
grant execute on function public.admin_list_admins() to authenticated;
grant execute on function public.admin_grant(text) to authenticated;
grant execute on function public.admin_revoke(uuid) to authenticated;
