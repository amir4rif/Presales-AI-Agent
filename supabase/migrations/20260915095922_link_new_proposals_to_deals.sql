-- T13: a new proposal starts from one visible live deal. The database owns
-- both sides of the relationship so a draft and its deal.case_id pointer are
-- created together, and concurrent attempts cannot branch a second live case.

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
    if new.deal_id is not null and not (
      pg_catalog.current_setting('app.proposal_resubmit_new_id', true) = new.id
      or (
        pg_catalog.current_setting('app.proposal_create_new_id', true) = new.id
        and pg_catalog.current_setting('app.proposal_create_deal_id', true) = new.deal_id::text
        and pg_catalog.current_setting('app.proposal_create_case_id', true) = new.case_id
      )
    ) then
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

  if tg_op = 'UPDATE' and new.case_id is distinct from old.case_id and not (
    pg_catalog.current_setting('app.proposal_create_deal_id', true) = old.id::text
    and pg_catalog.current_setting('app.proposal_create_case_id', true)
      = coalesce(new.case_id, '')
  ) then
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

create or replace function public.create_proposal_for_deal(
  p_deal_id uuid,
  p_proposal_id text,
  p_sections jsonb
)
returns public.proposals
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_name text;
  live public.deals%rowtype;
  created public.proposals%rowtype;
  next_case_id text;
begin
  if actor_id is null then
    raise exception 'You must be signed in to create a proposal.'
      using errcode = '42501';
  end if;

  if nullif(pg_catalog.btrim(p_proposal_id), '') is null then
    raise exception 'A new proposal needs an id.' using errcode = '22023';
  end if;

  if p_sections is null or pg_catalog.jsonb_typeof(p_sections) <> 'object' then
    raise exception 'Proposal sections must be a JSON object.'
      using errcode = '22023';
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

  -- SECURITY INVOKER keeps the existing deal RLS scope authoritative. The row
  -- lock makes the read/check/write sequence safe against two browser tabs.
  select deal.*
  into live
  from public.deals as deal
  where deal.id = p_deal_id
  for update;

  if not found then
    raise exception 'The selected deal is no longer open or is outside your pipeline.'
      using errcode = '42501';
  end if;

  if live.case_id is not null or exists (
    select 1
    from public.proposals as proposal
    where proposal.deal_id = live.id
      and (
        proposal.status in ('Draft', 'Pending Review', 'Reject & Revise')
        or (proposal.status = 'Approved' and
            coalesce(proposal.outcome, 'Pending') = 'Pending')
      )
  ) then
    raise exception 'This deal already has a live proposal case. Close or supersede it before attaching another.'
      using errcode = '23505';
  end if;

  next_case_id := private.next_case_id();
  perform pg_catalog.set_config('app.proposal_create_new_id', p_proposal_id, true);
  perform pg_catalog.set_config('app.proposal_create_deal_id', live.id::text, true);
  perform pg_catalog.set_config('app.proposal_create_case_id', next_case_id, true);

  insert into public.proposals (
    id, case_id, opportunity_id, version, company, deal, value,
    submitted_by_id, submitted_by, owner_id, owner, generated_on,
    submitted_at, status, reviewer_id, reviewer, reviewed_at,
    rejection_reason, review_note, sections, outcome,
    deal_id, deal_link_action, deal_linked_at, prospect_id
  ) values (
    p_proposal_id, next_case_id, coalesce(live.opportunity_id, ''), 1,
    live.account, live.account, live.value,
    actor_id, actor_name, actor_id, actor_name, current_date,
    null, 'Draft', null, '', null,
    '', '', p_sections, null,
    live.id, 'attached', pg_catalog.now(), live.prospect_id
  )
  returning * into created;

  update public.deals
  set case_id = created.case_id
  where id = live.id;

  perform pg_catalog.set_config('app.proposal_create_new_id', '', true);
  perform pg_catalog.set_config('app.proposal_create_deal_id', '', true);
  perform pg_catalog.set_config('app.proposal_create_case_id', '', true);

  return created;
end;
$$;

revoke all on function public.create_proposal_for_deal(uuid, text, jsonb)
from public, anon;
grant execute on function public.create_proposal_for_deal(uuid, text, jsonb)
to authenticated;

-- Deleting an owner Draft releases the same deal's live-case slot in the same
-- transaction. Submitted versions remain non-deletable under the existing RLS.
create or replace function private.clear_deleted_draft_deal_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'Draft' and old.deal_id is not null then
    update public.deals
    set case_id = null
    where id = old.deal_id
      and case_id = old.case_id;
  end if;
  return old;
end;
$$;

revoke all on function private.clear_deleted_draft_deal_case()
from public, anon, authenticated;

drop trigger if exists proposals_clear_deleted_draft_deal_case on public.proposals;
create trigger proposals_clear_deleted_draft_deal_case
after delete on public.proposals
for each row execute function private.clear_deleted_draft_deal_case();

-- Linked proposals always resolve through proposal.deal_id. The older
-- opportunity_id branch remains only for nullable legacy rows created before
-- T13, preserving T12's approval fallback without any name matching.
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

  if new.deal_id is not null then
    select deal.*
    into linked
    from public.deals as deal
    where deal.id = new.deal_id
    for update;

    if not found then
      raise exception 'The linked deal is no longer open. Refresh the approval queue and try again.'
        using errcode = 'P0002';
    end if;

    if linked.case_id is distinct from new.case_id then
      raise exception 'This deal already has a live proposal case. Close or supersede it before attaching another.'
        using errcode = '23505';
    end if;

    new.prospect_id := coalesce(new.prospect_id, linked.prospect_id);
  else
    if nullif(pg_catalog.btrim(new.opportunity_id), '') is null then
      raise exception 'An approved or closed proposal must have a non-empty opportunity ID before it can link a deal.'
        using errcode = '42501';
    end if;

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
  end if;

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

comment on function public.create_proposal_for_deal(uuid, text, jsonb) is
  'Atomically creates an owned Draft from one RLS-visible live deal and writes its reciprocal case pointer.';
