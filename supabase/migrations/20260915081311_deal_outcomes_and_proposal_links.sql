-- T11/T12: make deal completion a database-owned transition and link proposal
-- cases to the deal they create or advance. Existing records deliberately keep
-- nullable links; no account-name backfill is attempted.

alter table public.proposals
  add column deal_id uuid,
  add column deal_link_action text,
  add column deal_linked_at timestamptz,
  add column prospect_id bigint references public.prospects(id) on delete restrict;

alter table public.deals
  add column case_id text,
  add column opportunity_id text,
  add column expected_close_date date,
  add column pending_disqualification_reason text,
  add column pending_close_source text,
  add column pending_close_date date,
  add column close_requested_by_id uuid references public.profiles(id) on delete restrict,
  add column close_requested_by text,
  add column close_requested_at timestamptz;

update public.deals
set expected_close_date = (created_at at time zone 'UTC')::date + days_to_close
where expected_close_date is null;

alter table public.deals
  alter column expected_close_date set default (current_date + 90),
  alter column expected_close_date set not null;

alter table public.closed_deals
  add column case_id text,
  add column opportunity_id text,
  add column prospect_id bigint references public.prospects(id) on delete restrict,
  add column disqualification_reason text not null default '',
  add column closed_by_id uuid references public.profiles(id) on delete restrict,
  add column closed_by text not null default '',
  add column closed_at timestamptz,
  add column disqualification_requested_by_id uuid references public.profiles(id) on delete restrict,
  add column disqualification_requested_by text,
  add column disqualification_requested_at timestamptz,
  add column disqualification_approved_by_id uuid references public.profiles(id) on delete restrict,
  add column disqualification_approved_by text,
  add column disqualification_approved_at timestamptz;

update public.closed_deals
set closed_by_id = owner_id,
    closed_by = rep,
    closed_at = created_at
where closed_at is null;

alter table public.closed_deals
  alter column closed_at set default pg_catalog.now(),
  alter column closed_at set not null;

-- The deal outcome really is a fourth value. Disqualification reasons have a
-- separate column so they cannot be mistaken for an ordinary Lost subtype.
alter table public.proposals
  drop constraint if exists proposals_outcome_check;

alter table public.proposals
  add constraint proposals_outcome_check
  check (outcome is null or outcome in ('Pending', 'Won', 'Lost', 'Disqualified'));

update public.proposals
set rejection_reason = 'Compliance'
where status = 'Reject & Close'
  and rejection_reason = 'Compliance issue';

alter table public.proposals
  drop constraint if exists proposals_close_reason_check;

alter table public.proposals
  add constraint proposals_close_reason_check
  check (
    status <> 'Reject & Close'
    or rejection_reason in (
      'Compliance',
      'Blacklisted account',
      'Out of scope',
      'Wrong product fit'
    )
  );

alter table public.closed_deals
  drop constraint if exists closed_deals_outcome_check;

alter table public.closed_deals
  add constraint closed_deals_outcome_check
  check (outcome in ('Won', 'Lost', 'Disqualified')),
  add constraint closed_deals_reason_pairing_check
  check (
    (outcome in ('Won', 'Lost') and disqualification_reason = '')
    or
    (outcome = 'Disqualified' and loss_reason = '' and disqualification_reason in (
      'Compliance',
      'Blacklisted account',
      'Out of scope',
      'Wrong product fit'
    ))
  );

alter table public.deals
  add constraint deals_pending_disqualification_check
  check (
    (pending_disqualification_reason is null
      and pending_close_source is null
      and pending_close_date is null
      and close_requested_by_id is null
      and close_requested_by is null
      and close_requested_at is null)
    or
    (pending_disqualification_reason in (
        'Compliance',
        'Blacklisted account',
        'Out of scope',
        'Wrong product fit'
      )
      and pending_close_source is not null
      and pending_close_date is not null
      and close_requested_by_id is not null
      and nullif(pg_catalog.btrim(close_requested_by), '') is not null
      and close_requested_at is not null)
  );

alter table public.proposals
  add constraint proposals_deal_link_action_check
  check (
    (deal_id is null and deal_link_action is null and deal_linked_at is null)
    or
    (deal_id is not null
      and deal_link_action in ('attached', 'created')
      and deal_linked_at is not null)
  );

create index proposals_deal_id_idx on public.proposals(deal_id)
where deal_id is not null;
create index proposals_prospect_id_idx on public.proposals(prospect_id)
where prospect_id is not null;
create index deals_case_id_idx on public.deals(case_id)
where case_id is not null;
create index deals_close_requested_by_id_idx on public.deals(close_requested_by_id)
where close_requested_by_id is not null;
create unique index deals_one_open_opportunity_idx on public.deals(opportunity_id)
where opportunity_id is not null and opportunity_id <> '';
create index closed_deals_case_id_idx on public.closed_deals(case_id)
where case_id is not null;
create index closed_deals_prospect_id_idx on public.closed_deals(prospect_id)
where prospect_id is not null;
create index closed_deals_closed_by_id_idx on public.closed_deals(closed_by_id)
where closed_by_id is not null;
create index closed_deals_dq_requested_by_id_idx
on public.closed_deals(disqualification_requested_by_id)
where disqualification_requested_by_id is not null;
create index closed_deals_dq_approved_by_id_idx
on public.closed_deals(disqualification_approved_by_id)
where disqualification_approved_by_id is not null;

-- One current proposal version per deal. Terminal proposal/deal outcomes no
-- longer occupy the live-case slot, so a deal can retain older case history.
create unique index proposals_one_live_case_per_deal_idx
on public.proposals(deal_id)
where deal_id is not null and (
  status in ('Draft', 'Pending Review', 'Reject & Revise')
  or (status = 'Approved' and coalesce(outcome, 'Pending') = 'Pending')
);

-- Only the proposal/deal workflow may write the reciprocal link. A proposal
-- may still carry a prospect_id supplied explicitly while it is a Draft.
create or replace function private.protect_proposal_deal_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.deal_id is not null and
       pg_catalog.current_setting('app.proposal_resubmit_new_id', true)
         is distinct from new.id then
      raise exception 'A proposal can only be linked to a deal by the proposal workflow.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.deal_id, new.deal_link_action, new.deal_linked_at)
       is distinct from
     (old.deal_id, old.deal_link_action, old.deal_linked_at) then
    raise exception 'A proposal deal link can only be changed by the proposal workflow.'
      using errcode = '42501';
  end if;

  if old.status <> 'Draft' and new.prospect_id is distinct from old.prospect_id then
    raise exception 'Submitted proposal versions are immutable. Create a new version instead.'
      using errcode = '42501';
  end if;

  if old.status = 'Approved' and new.outcome is distinct from old.outcome then
    raise exception 'Deal outcomes must be recorded by closing the linked deal.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_proposal_deal_link()
from public, anon, authenticated;

drop trigger if exists proposals_protect_deal_link on public.proposals;
create trigger proposals_protect_deal_link
before insert or update
on public.proposals
for each row execute function private.protect_proposal_deal_link();

-- A manually entered open deal can carry an explicit opportunity ID, but its
-- proposal case pointer is database-owned once linked.
create or replace function private.protect_deal_case_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' and new.case_id is not null then
    raise exception 'A deal can only be linked to a case by the proposal workflow.'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.case_id is distinct from old.case_id then
    raise exception 'A deal case link can only be changed by the proposal workflow.'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old.case_id is not null and
     new.opportunity_id is distinct from old.opportunity_id then
    raise exception 'A linked deal cannot be moved to another opportunity.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_deal_case_link()
from public, anon, authenticated;

drop trigger if exists deals_protect_case_link on public.deals;
create trigger deals_protect_case_link
before insert or update on public.deals
for each row execute function private.protect_deal_case_link();

-- A Level 1 request is immutable while it awaits a Level 2 decision. On a new
-- row, audit identity and time come from the session rather than the browser.
create or replace function private.enforce_deal_disqualification_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_name text;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.pending_disqualification_reason is null then
      if new.pending_close_source is not null or new.pending_close_date is not null or
         new.close_requested_by_id is not null or new.close_requested_by is not null or
         new.close_requested_at is not null then
        raise exception 'Incomplete disqualification request metadata.'
          using errcode = '22023';
      end if;
      return new;
    end if;

    if actor_id is null or new.owner_id is distinct from actor_id or
       (select private.current_access_level()) <> 1 then
      raise exception 'Only a Level 1 deal owner may create a pending disqualification request.'
        using errcode = '42501';
    end if;

    select profile.full_name
    into actor_name
    from public.profiles as profile
    where profile.id = actor_id and profile.status = 'active';

    if actor_name is null then
      raise exception 'The signed-in deal owner has no active application profile.'
        using errcode = '42501';
    end if;

    new.close_requested_by_id := actor_id;
    new.close_requested_by := actor_name;
    new.close_requested_at := pg_catalog.now();
    return new;
  end if;

  if (new.pending_disqualification_reason, new.pending_close_source,
      new.pending_close_date, new.close_requested_by_id,
      new.close_requested_by, new.close_requested_at)
       is distinct from
     (old.pending_disqualification_reason, old.pending_close_source,
      old.pending_close_date, old.close_requested_by_id,
      old.close_requested_by, old.close_requested_at) then
    raise exception 'A pending disqualification request can only be changed by the review workflow.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_deal_disqualification_request()
from public, anon, authenticated;

drop trigger if exists deals_enforce_disqualification_request on public.deals;
create trigger deals_enforce_disqualification_request
before insert or update on public.deals
for each row execute function private.enforce_deal_disqualification_request();

create or replace function private.protect_pending_disqualification_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') and
     old.pending_disqualification_reason is not null then
    raise exception 'A pending disqualification must be approved or declined before the deal can be deleted.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function private.protect_pending_disqualification_delete()
from public, anon, authenticated;

drop trigger if exists deals_protect_pending_disqualification_delete on public.deals;
create trigger deals_protect_pending_disqualification_delete
before delete on public.deals
for each row execute function private.protect_pending_disqualification_delete();

-- Direct historical inserts still receive trustworthy close audit fields. A
-- Level 1 user cannot bypass the Disqualified approval gate by inserting the
-- closed row directly through the Data API.
create or replace function private.enforce_closed_deal_audit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_name text;
  access_level smallint := private.current_access_level();
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (new.id, new.case_id, new.opportunity_id, new.prospect_id,
        new.outcome, new.loss_reason, new.disqualification_reason,
        new.closed_by_id, new.closed_by, new.closed_at,
        new.disqualification_requested_by_id,
        new.disqualification_requested_by,
        new.disqualification_requested_at,
        new.disqualification_approved_by_id,
        new.disqualification_approved_by,
        new.disqualification_approved_at)
         is distinct from
       (old.id, old.case_id, old.opportunity_id, old.prospect_id,
        old.outcome, old.loss_reason, old.disqualification_reason,
        old.closed_by_id, old.closed_by, old.closed_at,
        old.disqualification_requested_by_id,
        old.disqualification_requested_by,
        old.disqualification_requested_at,
        old.disqualification_approved_by_id,
        old.disqualification_approved_by,
        old.disqualification_approved_at) then
      raise exception 'Closed deal outcome and audit fields are immutable.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if actor_id is null then
    raise exception 'You must be signed in to record a closed deal.'
      using errcode = '42501';
  end if;

  select profile.full_name
  into actor_name
  from public.profiles as profile
  where profile.id = actor_id and profile.status = 'active';

  if actor_name is null then
    raise exception 'The signed-in closer has no active application profile.'
      using errcode = '42501';
  end if;

  if new.outcome = 'Disqualified' and access_level < 2 then
    raise exception 'Disqualified deals require Level 2 approval.'
      using errcode = '42501';
  end if;

  new.closed_by_id := actor_id;
  new.closed_by := actor_name;
  new.closed_at := pg_catalog.now();
  if new.outcome = 'Disqualified' then
    new.disqualification_approved_by_id := actor_id;
    new.disqualification_approved_by := actor_name;
    new.disqualification_approved_at := new.closed_at;
  else
    new.disqualification_requested_by_id := null;
    new.disqualification_requested_by := null;
    new.disqualification_requested_at := null;
    new.disqualification_approved_by_id := null;
    new.disqualification_approved_by := null;
    new.disqualification_approved_at := null;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_closed_deal_audit()
from public, anon, authenticated;

drop trigger if exists closed_deals_enforce_audit on public.closed_deals;
create trigger closed_deals_enforce_audit
before insert or update on public.closed_deals
for each row execute function private.enforce_closed_deal_audit();

-- Move one row between the live and historical tables. The insert, linked
-- proposal outcome update, and delete all participate in the caller's single
-- PostgreSQL transaction, and the live UUID becomes the historical UUID.
create or replace function private.archive_deal(
  p_deal_id uuid,
  p_outcome text,
  p_reason text,
  p_source text,
  p_close_date date,
  p_actor_id uuid,
  p_actor_name text,
  p_requested_by_id uuid default null,
  p_requested_by text default null,
  p_requested_at timestamptz default null,
  p_approved_by_id uuid default null,
  p_approved_by text default null,
  p_approved_at timestamptz default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  live public.deals%rowtype;
begin
  select deal.*
  into live
  from public.deals as deal
  where deal.id = p_deal_id
  for update;

  if not found then
    raise exception 'This deal is no longer open. Refresh the pipeline and try again.'
      using errcode = 'P0002';
  end if;

  insert into public.closed_deals (
    id, owner_id, prospect_id, case_id, opportunity_id, rep, account, value,
    close_date, source, outcome, loss_reason, disqualification_reason,
    closed_by_id, closed_by, closed_at,
    disqualification_requested_by_id, disqualification_requested_by,
    disqualification_requested_at, disqualification_approved_by_id,
    disqualification_approved_by, disqualification_approved_at,
    created_at, updated_at
  ) values (
    live.id, live.owner_id, live.prospect_id, live.case_id,
    live.opportunity_id, live.rep, live.account, live.value,
    p_close_date, coalesce(nullif(pg_catalog.btrim(p_source), ''), 'Manual'),
    p_outcome,
    case when p_outcome = 'Lost' then p_reason else '' end,
    case when p_outcome = 'Disqualified' then p_reason else '' end,
    p_actor_id, p_actor_name, pg_catalog.now(),
    p_requested_by_id, p_requested_by, p_requested_at,
    p_approved_by_id, p_approved_by, p_approved_at,
    live.created_at, pg_catalog.now()
  );

  update public.proposals
  set outcome = p_outcome
  where deal_id = live.id
    and status = 'Approved'
    and coalesce(outcome, 'Pending') = 'Pending';

  delete from public.deals where id = live.id;
end;
$$;

revoke all on function private.archive_deal(
  uuid, text, text, text, date, uuid, text, uuid, text, timestamptz,
  uuid, text, timestamptz
) from public, anon, authenticated;

-- Approval attaches by opportunity_id only. It never inspects company/account
-- text. If no open deal has that explicit ID, the proposal creates one.
create or replace function private.sync_proposal_deal_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  linked public.deals%rowtype;
begin
  if old.status <> 'Pending Review' or
     new.status not in ('Approved', 'Reject & Close') or
     new.status is not distinct from old.status then
    return new;
  end if;

  if actor_id is null or private.current_access_level() < 2 then
    raise exception 'A Level 2 reviewer is required for this proposal decision.'
      using errcode = '42501';
  end if;

  if nullif(pg_catalog.btrim(new.opportunity_id), '') is null then
    raise exception 'An approved or closed proposal must have a non-empty opportunity ID before it can link a deal.'
      using errcode = '42501';
  end if;

  -- Serialise decisions for the same explicit opportunity. Without this
  -- lock, two simultaneous approvals could both observe "no deal" before
  -- racing to create one; the loser would receive a raw index error instead
  -- of the invariant's clear one-live-case explanation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.opportunity_id, 0)
  );

  select deal.*
  into linked
  from public.deals as deal
  where deal.opportunity_id = new.opportunity_id
  limit 1
  for update;

  if linked.id is not null then
    if exists (
      select 1
      from public.proposals as proposal
      where proposal.deal_id = linked.id
        and proposal.case_id <> new.case_id
        and (
          proposal.status in ('Draft', 'Pending Review', 'Reject & Revise')
          or (proposal.status = 'Approved' and
              coalesce(proposal.outcome, 'Pending') = 'Pending')
        )
    ) then
      raise exception 'This deal already has a live proposal case. Close or supersede it before attaching another.'
        using errcode = '23505';
    end if;

    update public.deals
    set case_id = new.case_id,
        opportunity_id = coalesce(nullif(new.opportunity_id, ''), opportunity_id)
    where id = linked.id
    returning * into linked;

    new.deal_link_action := 'attached';
    new.prospect_id := coalesce(new.prospect_id, linked.prospect_id);
  else
    insert into public.deals (
      owner_id, prospect_id, case_id, opportunity_id, rep, account, value,
      stage, days_in_stage, days_to_close, expected_close_date,
      movement, status, notes
    ) values (
      new.owner_id, new.prospect_id, new.case_id,
      nullif(pg_catalog.btrim(new.opportunity_id), ''),
      new.owner, new.company, new.value,
      1, 0, 90, current_date + 90,
      'Advanced', 'On Track', ''
    )
    returning * into linked;

    new.deal_link_action := 'created';
  end if;

  new.deal_id := linked.id;
  new.deal_linked_at := pg_catalog.now();

  if new.status = 'Reject & Close' then
    new.outcome := 'Disqualified';
    perform private.archive_deal(
      linked.id,
      'Disqualified',
      new.rejection_reason,
      'Proposal',
      current_date,
      actor_id,
      new.reviewer,
      new.owner_id,
      new.owner,
      coalesce(new.submitted_at, pg_catalog.now()),
      actor_id,
      new.reviewer,
      coalesce(new.reviewed_at, pg_catalog.now())
    );
  end if;

  return new;
end;
$$;

revoke all on function private.sync_proposal_deal_decision()
from public, anon, authenticated;

drop trigger if exists zz_proposals_sync_deal_decision on public.proposals;
create trigger zz_proposals_sync_deal_decision
before update of status on public.proposals
for each row execute function private.sync_proposal_deal_decision();

-- Closing an existing live deal is the only supported Open -> terminal path.
-- Level 1 Disqualified choices become a pending request; Level 2/3 choices
-- complete immediately. Won/Lost remain owner-or-manager actions.
create or replace function public.close_deal(
  p_deal_id uuid,
  p_outcome text,
  p_reason text,
  p_source text,
  p_close_date date,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_name text;
  access_level smallint;
  live public.deals%rowtype;
begin
  if actor_id is null then
    raise exception 'You must be signed in to close a deal.' using errcode = '42501';
  end if;

  select profile.full_name, profile.level
  into actor_name, access_level
  from public.profiles as profile
  where profile.id = actor_id and profile.status = 'active';

  if actor_name is null then
    raise exception 'The signed-in closer has no active application profile.'
      using errcode = '42501';
  end if;

  select deal.*
  into live
  from public.deals as deal
  where deal.id = p_deal_id
  for update;

  if not found then
    raise exception 'This deal is no longer open. Refresh the pipeline and try again.'
      using errcode = 'P0002';
  end if;

  if live.owner_id is distinct from actor_id and access_level < 2 then
    raise exception 'You do not have permission to close this deal.'
      using errcode = '42501';
  end if;

  if p_expected_updated_at is null or
     live.updated_at is distinct from p_expected_updated_at then
    raise exception 'This deal changed elsewhere. Refresh the pipeline and try again.'
      using errcode = '40001';
  end if;

  if p_outcome not in ('Won', 'Lost', 'Disqualified') then
    raise exception 'Choose Won, Lost, or Disqualified.' using errcode = '22023';
  end if;

  if p_outcome = 'Lost' and coalesce(p_reason, '') not in (
    'Chose competitor', 'Budget cut', 'No decision',
    'Pricing too high', 'Timing', 'Other'
  ) then
    raise exception 'Choose a valid loss reason.' using errcode = '22023';
  end if;

  if p_outcome = 'Disqualified' and coalesce(p_reason, '') not in (
    'Compliance', 'Blacklisted account', 'Out of scope', 'Wrong product fit'
  ) then
    raise exception 'Choose a valid disqualification reason.' using errcode = '22023';
  end if;

  if p_outcome = 'Won' and nullif(pg_catalog.btrim(coalesce(p_reason, '')), '') is not null then
    raise exception 'Won deals do not take a loss or disqualification reason.'
      using errcode = '22023';
  end if;

  if live.pending_disqualification_reason is not null then
    raise exception 'This deal already has a disqualification request awaiting Level 2 review.'
      using errcode = '55000';
  end if;

  if p_outcome = 'Disqualified' and access_level < 2 then
    update public.deals
    set pending_disqualification_reason = p_reason,
        pending_close_source = coalesce(nullif(pg_catalog.btrim(p_source), ''), 'Manual'),
        pending_close_date = coalesce(p_close_date, current_date),
        close_requested_by_id = actor_id,
        close_requested_by = actor_name,
        close_requested_at = pg_catalog.now()
    where id = live.id;

    return pg_catalog.jsonb_build_object(
      'status', 'pending_approval',
      'dealId', live.id,
      'outcome', 'Open'
    );
  end if;

  perform private.archive_deal(
    live.id,
    p_outcome,
    coalesce(p_reason, ''),
    p_source,
    coalesce(p_close_date, current_date),
    actor_id,
    actor_name,
    null,
    null,
    null,
    case when p_outcome = 'Disqualified' then actor_id else null end,
    case when p_outcome = 'Disqualified' then actor_name else null end,
    case when p_outcome = 'Disqualified' then pg_catalog.now() else null end
  );

  return pg_catalog.jsonb_build_object(
    'status', 'closed',
    'dealId', live.id,
    'outcome', p_outcome
  );
end;
$$;

revoke all on function public.close_deal(uuid, text, text, text, date, timestamptz)
from public, anon;
grant execute on function public.close_deal(uuid, text, text, text, date, timestamptz)
to authenticated;

create or replace function public.review_deal_disqualification(
  p_deal_id uuid,
  p_approve boolean,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_name text;
  access_level smallint;
  live public.deals%rowtype;
begin
  if actor_id is null then
    raise exception 'You must be signed in to review a disqualification request.'
      using errcode = '42501';
  end if;

  select profile.full_name, profile.level
  into actor_name, access_level
  from public.profiles as profile
  where profile.id = actor_id and profile.status = 'active';

  if actor_name is null or access_level < 2 then
    raise exception 'A Level 2 reviewer is required for this disqualification decision.'
      using errcode = '42501';
  end if;

  select deal.*
  into live
  from public.deals as deal
  where deal.id = p_deal_id
  for update;

  if not found then
    raise exception 'This deal is no longer open. Refresh the pipeline and try again.'
      using errcode = 'P0002';
  end if;

  if p_expected_updated_at is null or
     live.updated_at is distinct from p_expected_updated_at then
    raise exception 'This deal changed elsewhere. Refresh the pipeline and try again.'
      using errcode = '40001';
  end if;

  if live.pending_disqualification_reason is null then
    raise exception 'This deal has no disqualification request awaiting review.'
      using errcode = '55000';
  end if;

  if not p_approve then
    update public.deals
    set pending_disqualification_reason = null,
        pending_close_source = null,
        pending_close_date = null,
        close_requested_by_id = null,
        close_requested_by = null,
        close_requested_at = null
    where id = live.id;

    return pg_catalog.jsonb_build_object(
      'status', 'declined',
      'dealId', live.id,
      'outcome', 'Open'
    );
  end if;

  perform private.archive_deal(
    live.id,
    'Disqualified',
    live.pending_disqualification_reason,
    live.pending_close_source,
    live.pending_close_date,
    actor_id,
    actor_name,
    live.close_requested_by_id,
    live.close_requested_by,
    live.close_requested_at,
    actor_id,
    actor_name,
    pg_catalog.now()
  );

  return pg_catalog.jsonb_build_object(
    'status', 'closed',
    'dealId', live.id,
    'outcome', 'Disqualified'
  );
end;
$$;

revoke all on function public.review_deal_disqualification(uuid, boolean, timestamptz)
from public, anon;
grant execute on function public.review_deal_disqualification(uuid, boolean, timestamptz)
to authenticated;

comment on function public.close_deal(uuid, text, text, text, date, timestamptz) is
  'Atomically closes an open deal, or records a Level 1 Disqualified request for Level 2 review.';
comment on function public.review_deal_disqualification(uuid, boolean, timestamptz) is
  'Allows Level 2+ to approve and atomically close, or decline, a pending Disqualified request.';
comment on column public.proposals.deal_id is
  'Stable deal UUID retained after the row moves from deals to closed_deals.';
comment on column public.proposals.deal_link_action is
  'Records whether approval attached an existing open deal or created one.';
comment on column public.deals.case_id is
  'Current live proposal case. Older cases retain this deal ID on proposal rows.';
comment on column public.deals.expected_close_date is
  'Human-entered target date. Passing it flags Needs Outcome but never closes the deal.';
comment on column public.closed_deals.disqualification_reason is
  'Required fixed-list reason for the separate Disqualified outcome; never a Lost subtype.';

-- Keep exact prospect dependencies after removing every historical
-- account/company-name fallback. Nullable old links remain unknown by design.
create or replace function private.prevent_linked_prospect_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.opportunities > 0
    or exists (
      select 1 from public.deals as deal where deal.prospect_id = old.id
    )
    or exists (
      select 1 from public.closed_deals as deal where deal.prospect_id = old.id
    )
    or exists (
      select 1 from public.proposals as proposal where proposal.prospect_id = old.id
    )
  then
    raise exception using
      errcode = '23503',
      message = pg_catalog.format(
        'Prospect "%s" has linked work and must be archived instead.', old.name
      );
  end if;

  return old;
end;
$$;

revoke all on function private.prevent_linked_prospect_delete()
from public, anon, authenticated;

-- Carry reciprocal deal/prospect links across Reject & Revise versions.
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
    id, case_id, opportunity_id, version, company, deal, value,
    submitted_by_id, submitted_by, owner_id, owner, generated_on,
    submitted_at, status, reviewer_id, reviewer, reviewed_at,
    rejection_reason, review_note, sections, outcome,
    deal_id, deal_link_action, deal_linked_at, prospect_id
  ) values (
    p_new_id, predecessor.case_id, predecessor.opportunity_id,
    predecessor.version + 1, predecessor.company, predecessor.deal,
    predecessor.value, predecessor.submitted_by_id,
    predecessor.submitted_by, predecessor.owner_id, predecessor.owner,
    current_date, pg_catalog.now(), 'Pending Review', null, '', null,
    '', '', p_sections, null,
    predecessor.deal_id, predecessor.deal_link_action,
    predecessor.deal_linked_at, predecessor.prospect_id
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
