-- Access decision for deals, closed_deals and prospects:
--
--   Level 1 may create, read, edit and delete only rows they own.
--   Level 2 (Sales Manager) may create rows for the team and read/edit every
--   team row, but may not change an existing owner_id (or the denormalized
--   rep label on deal tables) and may delete only rows they own.
--   Level 3 and trusted infrastructure roles retain full control, including
--   reassignment and deletion.
--
-- RLS can decide whether a caller may update a row, but it cannot compare OLD
-- and NEW values. The trigger supplies that transition check, mirroring the
-- proposal workflow guard introduced in 20260826031425.
create or replace function private.enforce_team_row_ownership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (new.owner_id is not distinct from old.owner_id and
      (to_jsonb(new) ->> 'rep') is not distinct from (to_jsonb(old) ->> 'rep')) or
     (select private.current_access_level()) >= 3 or
     current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  raise exception 'Only Level 3 administrators can reassign existing team rows.'
    using errcode = '42501';
end;
$$;

drop trigger if exists deals_enforce_owner on public.deals;
create trigger deals_enforce_owner
before update of owner_id, rep on public.deals
for each row execute function private.enforce_team_row_ownership();

drop trigger if exists closed_deals_enforce_owner on public.closed_deals;
create trigger closed_deals_enforce_owner
before update of owner_id, rep on public.closed_deals
for each row execute function private.enforce_team_row_ownership();

drop trigger if exists prospects_enforce_owner on public.prospects;
create trigger prospects_enforce_owner
before update of owner_id on public.prospects
for each row execute function private.enforce_team_row_ownership();

-- Trigger functions do not need to be directly callable through the Data API.
revoke all on function private.enforce_team_row_ownership() from public, anon, authenticated;

drop policy if exists "deals_select_by_level" on public.deals;
drop policy if exists "deals_insert_by_level" on public.deals;
drop policy if exists "deals_update_by_level" on public.deals;
drop policy if exists "deals_delete_by_level" on public.deals;

create policy "deals_select_by_level"
on public.deals for select
to authenticated
using (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 2);

create policy "deals_insert_by_level"
on public.deals for insert
to authenticated
with check (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 2);

create policy "deals_update_by_level"
on public.deals for update
to authenticated
using (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 2)
with check (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 2);

create policy "deals_delete_by_level"
on public.deals for delete
to authenticated
using (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 3);

drop policy if exists "closed_deals_select_by_level" on public.closed_deals;
drop policy if exists "closed_deals_insert_by_level" on public.closed_deals;
drop policy if exists "closed_deals_update_by_level" on public.closed_deals;
drop policy if exists "closed_deals_delete_by_level" on public.closed_deals;

create policy "closed_deals_select_by_level"
on public.closed_deals for select
to authenticated
using (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 2);

create policy "closed_deals_insert_by_level"
on public.closed_deals for insert
to authenticated
with check (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 2);

create policy "closed_deals_update_by_level"
on public.closed_deals for update
to authenticated
using (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 2)
with check (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 2);

create policy "closed_deals_delete_by_level"
on public.closed_deals for delete
to authenticated
using (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 3);

drop policy if exists "prospects_select_by_level" on public.prospects;
drop policy if exists "prospects_insert_by_level" on public.prospects;
drop policy if exists "prospects_update_by_level" on public.prospects;
drop policy if exists "prospects_delete_by_level" on public.prospects;

create policy "prospects_select_by_level"
on public.prospects for select
to authenticated
using (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 2);

create policy "prospects_insert_by_level"
on public.prospects for insert
to authenticated
with check (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 2);

create policy "prospects_update_by_level"
on public.prospects for update
to authenticated
using (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 2)
with check (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 2);

create policy "prospects_delete_by_level"
on public.prospects for delete
to authenticated
using (owner_id = (select auth.uid()) or (select private.current_access_level()) >= 3);

comment on function private.enforce_team_row_ownership() is
  'Prevents ownership-field changes on deals, closed_deals and prospects below Level 3.';
comment on policy "deals_update_by_level" on public.deals is
  'Level 2 may edit team rows; enforce_team_row_ownership prevents reassignment below Level 3.';
comment on policy "closed_deals_update_by_level" on public.closed_deals is
  'Level 2 may edit team rows; enforce_team_row_ownership prevents reassignment below Level 3.';
comment on policy "prospects_update_by_level" on public.prospects is
  'Level 2 may edit team rows; enforce_team_row_ownership prevents reassignment below Level 3.';
comment on policy "deals_delete_by_level" on public.deals is
  'Level 1 and 2 may delete only owned rows; Level 3 may delete any row.';
comment on policy "closed_deals_delete_by_level" on public.closed_deals is
  'Level 1 and 2 may delete only owned rows; Level 3 may delete any row.';
comment on policy "prospects_delete_by_level" on public.prospects is
  'Level 1 and 2 may delete only owned rows; Level 3 may delete any row.';
