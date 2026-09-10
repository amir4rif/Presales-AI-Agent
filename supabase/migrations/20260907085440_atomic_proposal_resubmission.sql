-- Resubmission is one lifecycle transition, not an insert followed by a
-- best-effort update. Repair any split writes created by the old flow before
-- enforcing one live version per case.
with live_versions as (
  select
    id,
    row_number() over (
      partition by case_id
      order by version desc, created_at desc, id desc
    ) as live_rank
  from public.proposals
  where status <> 'Superseded'
)
update public.proposals as proposal
set status = 'Superseded'
from live_versions
where proposal.id = live_versions.id
  and live_versions.live_rank > 1;

create unique index proposals_one_live_version_per_case_idx
on public.proposals (case_id)
where status <> 'Superseded';

-- Keep every write path honest. A generic insert/update must not be able to
-- create half of a version transition; only resubmit_proposal may create v2+
-- or retire the current rejected version.
create or replace function private.enforce_atomic_proposal_version_chain()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if private.current_access_level() >= 3 or
     current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' and new.version > 1 and (
    pg_catalog.current_setting('app.proposal_resubmit_new_id', true)
      is distinct from new.id or
    pg_catalog.current_setting('app.proposal_resubmit_case_id', true)
      is distinct from new.case_id
  ) then
    raise exception 'New proposal versions must be created by resubmitting the current rejected version.'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and
     old.status = 'Reject & Revise' and new.status = 'Superseded' and
     pg_catalog.current_setting('app.proposal_resubmit_predecessor_id', true)
       is distinct from old.id then
    raise exception 'A rejected proposal can only be superseded by the atomic resubmit operation.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger proposals_enforce_atomic_version_chain
before insert or update of status on public.proposals
for each row execute function private.enforce_atomic_proposal_version_chain();

revoke all on function private.enforce_atomic_proposal_version_chain()
from public, anon, authenticated;

create or replace function public.resubmit_proposal(
  p_predecessor_id text,
  p_new_id text,
  p_sections jsonb
)
returns public.proposals
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  predecessor public.proposals%rowtype;
  replacement public.proposals%rowtype;
begin
  if actor_id is null then
    raise exception 'You must be signed in to resubmit a proposal.'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_new_id), '') is null then
    raise exception 'A new proposal version needs an id.'
      using errcode = '22023';
  end if;

  if p_sections is null or jsonb_typeof(p_sections) <> 'object' then
    raise exception 'Proposal sections must be a JSON object.'
      using errcode = '22023';
  end if;

  -- Serialize competing resubmits from different tabs. Under READ COMMITTED,
  -- a waiter sees the predecessor's new status after it acquires this lock.
  select proposal.*
  into predecessor
  from public.proposals as proposal
  where proposal.id = p_predecessor_id
  for update;

  if not found or predecessor.owner_id is distinct from actor_id then
    raise exception 'Only the proposal owner can resubmit this version.'
      using errcode = '42501';
  end if;

  if predecessor.status <> 'Reject & Revise' then
    raise exception 'Only the current Reject & Revise version can be resubmitted. Refresh My Proposals and try again.'
      using errcode = '42501';
  end if;

  perform pg_catalog.set_config(
    'app.proposal_resubmit_predecessor_id', predecessor.id, true
  );
  perform pg_catalog.set_config(
    'app.proposal_resubmit_new_id', p_new_id, true
  );
  perform pg_catalog.set_config(
    'app.proposal_resubmit_case_id', predecessor.case_id, true
  );

  update public.proposals
  set status = 'Superseded'
  where id = predecessor.id;

  insert into public.proposals (
    id,
    case_id,
    opportunity_id,
    version,
    company,
    deal,
    value,
    submitted_by_id,
    submitted_by,
    owner_id,
    owner,
    generated_on,
    submitted_at,
    status,
    reviewer_id,
    reviewer,
    reviewed_at,
    rejection_reason,
    review_note,
    sections,
    outcome
  ) values (
    p_new_id,
    predecessor.case_id,
    predecessor.opportunity_id,
    predecessor.version + 1,
    predecessor.company,
    predecessor.deal,
    predecessor.value,
    predecessor.submitted_by_id,
    predecessor.submitted_by,
    predecessor.owner_id,
    predecessor.owner,
    current_date,
    now(),
    'Pending Review',
    null,
    '',
    null,
    '',
    '',
    p_sections,
    null
  )
  returning * into replacement;

  perform pg_catalog.set_config('app.proposal_resubmit_predecessor_id', '', true);
  perform pg_catalog.set_config('app.proposal_resubmit_new_id', '', true);
  perform pg_catalog.set_config('app.proposal_resubmit_case_id', '', true);

  return replacement;
end;
$$;

revoke all on function public.resubmit_proposal(text, text, jsonb)
from public, anon;
grant execute on function public.resubmit_proposal(text, text, jsonb)
to authenticated;

comment on function public.resubmit_proposal(text, text, jsonb) is
  'Atomically supersedes the owner''s current rejected version and creates its pending replacement.';
