create or replace function private.enforce_proposal_identity_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.case_id is distinct from old.case_id
     or new.version is distinct from old.version then
    raise exception 'Proposal ID, case, and version identity cannot be changed.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_proposal_identity_immutable()
  from public, anon, authenticated;

drop trigger if exists proposals_enforce_identity_immutable on public.proposals;
create trigger proposals_enforce_identity_immutable
before update of id, case_id, version on public.proposals
for each row
execute function private.enforce_proposal_identity_immutable();
