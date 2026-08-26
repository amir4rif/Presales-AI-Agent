-- An authenticated JWT remains valid after an administrator disables a profile.
-- Make profile status part of database authorization so an inactive user cannot
-- bypass the application and call the Data API directly.

create or replace function private.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.status = 'active'
  )
$$;

create or replace function private.current_access_level()
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.level
      from public.profiles as p
      where p.id = (select auth.uid())
        and p.status = 'active'
    ),
    0
  )::smallint
$$;

create or replace function private.protect_profile_access()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') and
     private.current_access_level() < 3 and
     (new.id, new.email, new.role, new.level, new.status) is distinct from
     (old.id, old.email, old.role, old.level, old.status) then
    raise exception 'Only Level 3 administrators can change profile access.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.current_user_is_active() from public, anon;
grant execute on function private.current_user_is_active() to authenticated;

create policy "active_profiles_only"
on public.profiles as restrictive
for all to authenticated
using (private.current_user_is_active())
with check (private.current_user_is_active());

create policy "active_profiles_only"
on public.proposals as restrictive
for all to authenticated
using (private.current_user_is_active())
with check (private.current_user_is_active());

create policy "active_profiles_only"
on public.deals as restrictive
for all to authenticated
using (private.current_user_is_active())
with check (private.current_user_is_active());

create policy "active_profiles_only"
on public.closed_deals as restrictive
for all to authenticated
using (private.current_user_is_active())
with check (private.current_user_is_active());

create policy "active_profiles_only"
on public.prospects as restrictive
for all to authenticated
using (private.current_user_is_active())
with check (private.current_user_is_active());

comment on function private.current_user_is_active() is
  'Authorization predicate used by restrictive RLS policies to disable inactive accounts.';
