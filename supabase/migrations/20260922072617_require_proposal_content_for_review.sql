-- Drafts may be blank, but a reviewable or approved proposal must contain
-- text in at least one of the editor's real sections. This also protects
-- legacy empty Pending Review rows from being approved.
create function private.require_proposal_content()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status in ('Pending Review', 'Approved') and not exists (
    select 1
    from pg_catalog.jsonb_each(new.sections) as section(key, value)
    where section.key = any (array[
      'executive', 'challenges', 'solution', 'benefits',
      'implementation', 'commercials', 'casestudies', 'nextsteps'
    ])
      and pg_catalog.jsonb_typeof(section.value) = 'string'
      and (section.value #>> '{}') ~ '[^[:space:]]'
  ) then
    raise exception 'Add content to at least one proposal section before submitting or approving.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.require_proposal_content()
from public, anon, authenticated;

create trigger proposals_require_content
before insert or update of status, sections on public.proposals
for each row execute function private.require_proposal_content();
