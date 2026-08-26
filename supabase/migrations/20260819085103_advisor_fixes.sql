-- Complete foreign-key coverage reported by the database advisor.
create index proposals_reviewer_id_idx on public.proposals(reviewer_id);
create index proposals_submitted_by_id_idx on public.proposals(submitted_by_id);

-- Supabase's documented auto-RLS event trigger remains active as postgres,
-- but it must not be callable through the public Data API.
--
-- public.rls_auto_enable() is created by a Supabase platform feature, not by
-- this schema, so it is present on some projects and absent on others
-- depending on when the project was created and which options were enabled.
-- An unguarded revoke against a missing function aborts the migration *after*
-- 20260819084855 has already created every table, leaving a half-migrated
-- database. Guard on to_regprocedure, which returns null rather than raising
-- when the function does not exist.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$$;
