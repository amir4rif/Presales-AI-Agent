-- private.enforce_proposal_workflow() let any Level 2 (reviewer) or higher
-- bypass the trigger entirely: rewrite a submitted version's content, steal
-- ownership of someone else's proposal, jump straight to Approved, or edit a
-- Superseded row. A reviewer is a trusted role, but "trusted" should mean
-- specific, not unlimited. This defines what that trust actually covers,
-- as an ADDITION to what a Level 1 owner can already do to their own
-- proposal (a reviewer is not prevented from also being a submitter):
--
--   A Level 2 reviewer MAY, additionally:
--     - set the reviewer-controlled fields (reviewer_id, reviewer,
--       reviewed_at, rejection_reason, review_note, outcome) at any time —
--       that's the job, and it isn't limited to a single status.
--     - move a Pending Review proposal to Approved, Reject & Revise, or
--       Reject & Close.
--
--   Nobody below Level 3 may, regardless of role:
--     - change owner_id or submitted_by_id on any proposal.
--     - rewrite the submitted content of a non-Draft version (immutability
--       is a data-integrity guarantee, not an access-control restriction —
--       it applies regardless of who's asking).
--     - move a proposal through any transition outside the ones listed
--       above and the ones Level 1 already had (Approved / Reject & Close /
--       Superseded stay locked for everyone once reached).
--
-- True infra/admin roles (service_role, supabase_admin, postgres) and
-- Level 3 accounts remain fully trusted and keep the unconditional bypass —
-- this migration only narrows the Level 2 case.
create or replace function private.enforce_proposal_workflow()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  access_level smallint := private.current_access_level();
begin
  if access_level >= 3 or current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.owner_id is distinct from (select auth.uid()) or
       new.submitted_by_id is distinct from (select auth.uid()) or
       new.status not in ('Draft', 'Pending Review') or
       new.reviewer_id is not null or new.reviewer <> '' or
       new.reviewed_at is not null or new.rejection_reason <> '' or
       new.review_note <> '' or new.outcome is not null then
      raise exception 'A proposal can only be created as your own draft or pending version.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id or
     new.submitted_by_id is distinct from old.submitted_by_id then
    raise exception 'Proposal ownership cannot be changed.'
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

  if access_level < 2 and (
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

  if not (
    (old.status = 'Draft' and new.status in ('Draft', 'Pending Review')) or
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
