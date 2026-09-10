-- Workflow invariants apply to every signed-in application level. Level 3 is
-- an application role, not an infrastructure escape hatch, so it must use the
-- same atomic version transition as every other user.
create or replace function private.enforce_atomic_proposal_version_chain()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
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
     new.status = 'Superseded' and old.status is distinct from new.status and
     pg_catalog.current_setting('app.proposal_resubmit_predecessor_id', true)
       is distinct from old.id then
    raise exception 'A proposal can only be superseded by the atomic resubmit operation.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_atomic_proposal_version_chain()
from public, anon, authenticated;

-- Level 2/3 review decisions get their audit identity and timestamp from the
-- authenticated session. Submitted content and completed audit records remain
-- immutable for application admins as well as ordinary users.
create or replace function private.enforce_proposal_workflow()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  access_level smallint := private.current_access_level();
  actor_id uuid := (select auth.uid());
  actor_name text;
  decision_transition boolean;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.owner_id is distinct from actor_id or
       new.submitted_by_id is distinct from actor_id or
       new.status not in ('Draft', 'Pending Review') or
       new.reviewer_id is not null or new.reviewer <> '' or
       new.reviewed_at is not null or new.rejection_reason <> '' or
       new.review_note <> '' or new.outcome is not null then
      raise exception 'A proposal can only be created as your own draft or pending version.'
        using errcode = '42501';
    end if;

    select profile.full_name
    into actor_name
    from public.profiles as profile
    where profile.id = actor_id
      and profile.status = 'active';
    if actor_name is null then
      raise exception 'The signed-in proposal owner has no active application profile.'
        using errcode = '42501';
    end if;

    new.submitted_by := actor_name;
    new.owner := actor_name;
    new.generated_on := current_date;
    new.created_at := pg_catalog.now();
    new.updated_at := pg_catalog.now();
    if new.status = 'Pending Review' then
      new.submitted_at := pg_catalog.now();
    else
      new.submitted_at := null;
    end if;
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id or
     new.submitted_by_id is distinct from old.submitted_by_id or
     new.owner is distinct from old.owner or
     new.submitted_by is distinct from old.submitted_by then
    raise exception 'Proposal ownership cannot be changed.'
      using errcode = '42501';
  end if;

  if new.created_at is distinct from old.created_at or
     new.generated_on is distinct from old.generated_on then
    raise exception 'Proposal audit metadata cannot be changed.'
      using errcode = '42501';
  end if;

  if old.status = 'Draft' and old.owner_id is distinct from actor_id then
    raise exception 'Only the proposal owner can edit or submit a draft.'
      using errcode = '42501';
  end if;

  if old.status = 'Draft' and new.status = 'Pending Review' then
    new.submitted_at := pg_catalog.now();
  elsif new.submitted_at is distinct from old.submitted_at then
    raise exception 'Proposal submission time can only be set by submitting a draft.'
      using errcode = '42501';
  end if;

  if old.status <> 'Draft' and
     (new.case_id, new.opportunity_id, new.version, new.company, new.deal,
      new.value, new.submitted_by, new.owner, new.generated_on,
      new.submitted_at, new.sections)
     is distinct from
     (old.case_id, old.opportunity_id, old.version, old.company, old.deal,
      old.value, old.submitted_by, old.owner, old.generated_on,
      old.submitted_at, old.sections) then
    raise exception 'Submitted proposal versions are immutable. Create a new version instead.'
      using errcode = '42501';
  end if;

  decision_transition := old.status = 'Pending Review' and
    new.status in ('Approved', 'Reject & Revise', 'Reject & Close') and
    new.status is distinct from old.status;

  if access_level < 2 and (
     decision_transition or
     new.reviewer_id is distinct from old.reviewer_id or
     new.reviewer is distinct from old.reviewer or
     new.reviewed_at is distinct from old.reviewed_at or
     new.rejection_reason is distinct from old.rejection_reason or
     new.review_note is distinct from old.review_note or
     new.outcome is distinct from old.outcome
  ) then
    raise exception 'Level 1 users cannot change reviewer-controlled proposal fields.'
      using errcode = '42501';
  end if;

  if decision_transition then
    select profile.full_name
    into actor_name
    from public.profiles as profile
    where profile.id = actor_id
      and profile.status = 'active';

    if actor_name is null then
      raise exception 'The signed-in reviewer has no active application profile.'
        using errcode = '42501';
    end if;

    new.reviewer_id := actor_id;
    new.reviewer := actor_name;
    new.reviewed_at := pg_catalog.now();
  elsif new.reviewer_id is distinct from old.reviewer_id or
        new.reviewer is distinct from old.reviewer or
        new.reviewed_at is distinct from old.reviewed_at or
        new.rejection_reason is distinct from old.rejection_reason or
        new.review_note is distinct from old.review_note then
    raise exception 'Reviewer audit fields can only be set when a pending proposal is decided.'
      using errcode = '42501';
  end if;

  if new.status <> 'Approved' and new.outcome is not null then
    raise exception 'Proposal outcomes can only be tracked on approved versions.'
      using errcode = '42501';
  end if;

  if not (
    (old.status = 'Draft' and old.owner_id = actor_id and
     new.status in ('Draft', 'Pending Review')) or
    (old.status = 'Pending Review' and new.status = 'Pending Review') or
    (old.status = 'Reject & Revise' and new.status in ('Reject & Revise', 'Superseded')) or
    (old.status = new.status) or
    (access_level >= 2 and old.status = 'Pending Review' and
     new.status in ('Approved', 'Reject & Revise', 'Reject & Close'))
  ) then
    raise exception 'This proposal status transition is not permitted.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_proposal_workflow()
from public, anon, authenticated;

comment on function private.enforce_proposal_workflow() is
  'Enforces owner-only drafts, immutable submitted content, session-owned review audit fields, and scoped decisions for all app levels.';

-- Replace the original overload so every resubmit compares the exact browser
-- revision after acquiring the predecessor row lock.
drop function if exists public.resubmit_proposal(text, text, jsonb);

create or replace function public.resubmit_proposal(
  p_predecessor_id text,
  p_new_id text,
  p_sections jsonb,
  p_expected_updated_at timestamptz
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

  if nullif(pg_catalog.btrim(p_new_id), '') is null then
    raise exception 'A new proposal version needs an id.'
      using errcode = '22023';
  end if;

  if p_sections is null or pg_catalog.jsonb_typeof(p_sections) <> 'object' then
    raise exception 'Proposal sections must be a JSON object.'
      using errcode = '22023';
  end if;

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

  if p_expected_updated_at is null or
     predecessor.updated_at is distinct from p_expected_updated_at then
    raise exception 'This proposal changed elsewhere. Refresh the latest data and try again.'
      using errcode = '42501';
  end if;

  perform pg_catalog.set_config(
    'app.proposal_resubmit_predecessor_id', predecessor.id, true
  );
  perform pg_catalog.set_config('app.proposal_resubmit_new_id', p_new_id, true);
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
    pg_catalog.now(),
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

revoke all on function public.resubmit_proposal(text, text, jsonb, timestamptz)
from public, anon;
grant execute on function public.resubmit_proposal(text, text, jsonb, timestamptz)
to authenticated;

comment on function public.resubmit_proposal(text, text, jsonb, timestamptz) is
  'Atomically supersedes the owner''s exact rejected revision and creates its pending replacement.';
