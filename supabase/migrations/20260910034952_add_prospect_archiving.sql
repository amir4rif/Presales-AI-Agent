-- Persist the lifecycle state used when a prospect has linked pipeline history.
alter table public.prospects
  add column status text not null default 'Active'
  constraint prospects_status_valid check (status in ('Active', 'Inactive'));

-- Managers may deliberately tidy any unlinked prospect. The application still
-- checks dependencies before issuing DELETE; RLS owns the cross-owner boundary.
drop policy if exists "prospects_delete_by_level" on public.prospects;
create policy "prospects_delete_by_level"
on public.prospects for delete
to authenticated
using (
  owner_id = (select auth.uid())
  or (select private.current_access_level()) >= 2
);

comment on column public.prospects.status is
  'Active prospects can accept work; linked prospects are archived as Inactive instead of deleted.';
comment on policy "prospects_delete_by_level" on public.prospects is
  'Owners may delete their own unlinked prospects; Level 2 and 3 may delete any unlinked prospect.';

-- The UI chooses Delete or Archive from the same dependency rule. Enforce it
-- here as well so stale clients and direct API calls cannot orphan history.
create or replace function private.prevent_linked_prospect_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if old.opportunities > 0
    or exists (
      select 1 from public.deals d
      where d.prospect_id = old.id
        or (d.prospect_id is null and lower(btrim(d.account)) = lower(btrim(old.name)))
    )
    or exists (
      select 1 from public.closed_deals d
      where lower(btrim(d.account)) = lower(btrim(old.name))
    )
    or exists (
      select 1 from public.proposals p
      where lower(btrim(p.company)) = lower(btrim(old.name))
    )
  then
    raise exception using
      errcode = '23503',
      message = format('Prospect "%s" has linked work and must be archived instead.', old.name);
  end if;

  return old;
end;
$$;

revoke all on function private.prevent_linked_prospect_delete() from public;

drop trigger if exists prevent_linked_prospect_delete on public.prospects;
create trigger prevent_linked_prospect_delete
before delete on public.prospects
for each row execute function private.prevent_linked_prospect_delete();

comment on function private.prevent_linked_prospect_delete() is
  'Blocks prospect deletion whenever opportunity, deal, closed-deal, or proposal history depends on it.';
