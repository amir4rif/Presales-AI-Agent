-- Preserve the exact reviewed content of every non-draft Level 1 version.
create or replace function private.enforce_proposal_workflow()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  access_level smallint := private.current_access_level();
begin
  if access_level >= 2 or current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.owner_id is distinct from (select auth.uid()) or
       new.submitted_by_id is distinct from (select auth.uid()) or
       new.status not in ('Draft', 'Pending Review') or
       new.reviewer_id is not null or new.reviewer <> '' or
       new.reviewed_at is not null or new.rejection_reason <> '' or
       new.review_note <> '' or new.outcome is not null then
      raise exception 'Level 1 users can only create their own draft or pending proposals.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id or
     new.submitted_by_id is distinct from old.submitted_by_id or
     new.reviewer_id is distinct from old.reviewer_id or
     new.reviewer is distinct from old.reviewer or
     new.reviewed_at is distinct from old.reviewed_at or
     new.rejection_reason is distinct from old.rejection_reason or
     new.review_note is distinct from old.review_note or
     new.outcome is distinct from old.outcome then
    raise exception 'Level 1 users cannot change reviewer-controlled proposal fields.'
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

  if not (
    (old.status = 'Draft' and new.status in ('Draft', 'Pending Review')) or
    (old.status = 'Pending Review' and new.status = 'Pending Review') or
    (old.status = 'Reject & Revise' and new.status in ('Reject & Revise', 'Superseded')) or
    (old.status = new.status)
  ) then
    raise exception 'This proposal status transition requires a reviewer.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
