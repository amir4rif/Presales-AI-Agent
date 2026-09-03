-- A Level 2 reviewer may review another owner's proposal only after the owner
-- submits it. The previous workflow guard allowed any Level 2 account to edit
-- another rep's Draft (including its content and value), move that Draft to
-- Pending Review, and then approve it. Keep the broader RLS visibility needed
-- by the approvals queue, but reject every non-admin mutation of somebody
-- else's Draft inside the transition-aware trigger.
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

  if old.status = 'Draft' and
     old.owner_id is distinct from (select auth.uid()) then
    raise exception 'Only the proposal owner can edit or submit a draft.'
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
    (old.status = 'Draft' and
     old.owner_id = (select auth.uid()) and
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

comment on function private.enforce_proposal_workflow() is
  'Enforces owner-only Draft editing/submission, immutable submitted content, and scoped Level 2 review decisions.';
