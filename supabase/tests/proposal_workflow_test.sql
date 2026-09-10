begin;
select plan(24);

insert into auth.users (id, email)
values
  ('11000000-0000-0000-0000-000000000001', 'proposal-owner@example.test'),
  ('11000000-0000-0000-0000-000000000002', 'proposal-manager@example.test'),
  ('11000000-0000-0000-0000-000000000003', 'proposal-admin@example.test');

update public.profiles
set role = case id
    when '11000000-0000-0000-0000-000000000002' then 'Sales Manager'
    when '11000000-0000-0000-0000-000000000003' then 'Sales Operations'
    else 'Sales Representative'
  end,
  level = case id
    when '11000000-0000-0000-0000-000000000002' then 2
    when '11000000-0000-0000-0000-000000000003' then 3
    else 1
  end,
  full_name = case id
    when '11000000-0000-0000-0000-000000000002' then 'Proposal Manager'
    when '11000000-0000-0000-0000-000000000003' then 'Operations Admin'
    else 'Proposal Owner'
  end
where id in (
  '11000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000002',
  '11000000-0000-0000-0000-000000000003'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '11000000-0000-0000-0000-000000000001';
set local "request.jwt.claims" = '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.proposals (
  id,
  case_id,
  company,
  deal,
  value,
  submitted_by_id,
  submitted_by,
  owner_id,
  owner,
  generated_on,
  submitted_at,
  created_at,
  status,
  sections
)
values (
  'PROP-WORKFLOW-OWNER-DRAFT',
  'CASE-WORKFLOW-OWNER-DRAFT',
  'Owner Account',
  'Owner Opportunity',
  100000,
  '11000000-0000-0000-0000-000000000001',
  'Forged submitter',
  '11000000-0000-0000-0000-000000000001',
  'Forged owner',
  '2000-01-01'::date,
  '2000-01-01'::timestamptz,
  '2000-01-01'::timestamptz,
  'Draft',
  '{"executive":"Owner content"}'::jsonb
);

select is(
  (
    select submitted_by = 'Proposal Owner' and
           owner = 'Proposal Owner' and
           generated_on = current_date and
           submitted_at is null and
           created_at > pg_catalog.now() - interval '1 minute'
    from public.proposals
    where id = 'PROP-WORKFLOW-OWNER-DRAFT'
  ),
  true,
  'Proposal creation audit fields come from the authenticated session and database clock'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '11000000-0000-0000-0000-000000000002';
set local "request.jwt.claims" = '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$update public.proposals
      set sections = '{"executive":"Manager rewrite"}'::jsonb
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'$$,
  '42501',
  'Only the proposal owner can edit or submit a draft.',
  'Level 2 cannot edit another rep''s Draft sections'
);

select throws_ok(
  $$update public.proposals
      set value = 999999
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'$$,
  '42501',
  'Only the proposal owner can edit or submit a draft.',
  'Level 2 cannot edit another rep''s Draft value'
);

select throws_ok(
  $$update public.proposals
      set status = 'Pending Review', submitted_at = now()
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'$$,
  '42501',
  'Only the proposal owner can edit or submit a draft.',
  'Level 2 cannot submit another rep''s Draft'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '11000000-0000-0000-0000-000000000001';
set local "request.jwt.claims" = '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}';

select results_eq(
  $$update public.proposals
      set sections = '{"executive":"Updated owner content"}'::jsonb
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'
      returning sections ->> 'executive'$$,
  array['Updated owner content'],
  'The owner can save ordinary Draft content without changing its identity'
);

select throws_ok(
  $$update public.proposals
      set created_at = '2000-01-01'::timestamptz
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'$$,
  '42501',
  'Proposal audit metadata cannot be changed.',
  'A Draft cannot rewrite its creation audit timestamp'
);

select throws_ok(
  $$update public.proposals
      set id = 'PROP-WORKFLOW-RENAMED-DRAFT'
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'$$,
  '42501',
  'Proposal ID, case, and version identity cannot be changed.',
  'A Draft proposal ID cannot be changed directly'
);

select throws_ok(
  $$update public.proposals
      set version = 2
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'$$,
  '42501',
  'Proposal ID, case, and version identity cannot be changed.',
  'A Draft version cannot be changed directly'
);

select throws_ok(
  $$update public.proposals
      set case_id = 'CASE-WORKFLOW-REASSIGNED'
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'$$,
  '42501',
  'Proposal ID, case, and version identity cannot be changed.',
  'A Draft cannot be moved to another case'
);

select throws_ok(
  $$update public.proposals
      set status = 'Pending Review', version = 2, submitted_at = now()
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'$$,
  '42501',
  'Proposal ID, case, and version identity cannot be changed.',
  'Submitting a Draft cannot smuggle in a new version'
);

select throws_ok(
  $$insert into public.proposals (
      id, case_id, version, company, deal, value,
      submitted_by_id, submitted_by, owner_id, owner, status, sections
    ) values (
      'PROP-WORKFLOW-DIRECT-V2', 'CASE-WORKFLOW-OWNER-DRAFT', 2,
      'Owner Account', 'Owner Opportunity', 100000,
      '11000000-0000-0000-0000-000000000001', 'Proposal Owner',
      '11000000-0000-0000-0000-000000000001', 'Proposal Owner',
      'Pending Review', '{"executive":"Unpaired version"}'::jsonb
    )$$,
  '42501',
  'New proposal versions must be created by resubmitting the current rejected version.',
  'A standalone insert cannot create a later proposal version'
);

select results_eq(
  $$update public.proposals
      set status = 'Pending Review', submitted_at = '2000-01-01'::timestamptz
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'
      returning status || '|' ||
        (submitted_at > pg_catalog.now() - interval '1 minute')::text$$,
  array['Pending Review|true'],
  'The owner can submit their Draft and the database owns the submission time'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '11000000-0000-0000-0000-000000000002';
set local "request.jwt.claims" = '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated"}';

select results_eq(
  $$update public.proposals
      set status = 'Reject & Revise',
          reviewer_id = '11000000-0000-0000-0000-000000000003',
          reviewer = 'Forged reviewer',
          reviewed_at = '2000-01-01'::timestamptz,
          rejection_reason = 'Missing information',
          review_note = 'Please add the missing detail.'
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'
      returning status || '|' || reviewer_id::text || '|' || reviewer$$,
  array['Reject & Revise|11000000-0000-0000-0000-000000000002|Proposal Manager'],
  'Level 2 can review and the database records the authenticated reviewer'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '11000000-0000-0000-0000-000000000003';
set local "request.jwt.claims" = '{"sub":"11000000-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$update public.proposals
      set status = 'Superseded'
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'$$,
  '42501',
  'A proposal can only be superseded by the atomic resubmit operation.',
  'Level 3 cannot bypass the atomic predecessor transition'
);

select throws_ok(
  $$insert into public.proposals (
      id, case_id, version, company, deal, value,
      submitted_by_id, submitted_by, owner_id, owner, status, sections
    ) values (
      'PROP-WORKFLOW-ADMIN-V2', 'CASE-WORKFLOW-OWNER-DRAFT', 2,
      'Owner Account', 'Owner Opportunity', 100000,
      '11000000-0000-0000-0000-000000000003', 'Operations Admin',
      '11000000-0000-0000-0000-000000000003', 'Operations Admin',
      'Pending Review', '{"executive":"Unpaired admin version"}'::jsonb
    )$$,
  '42501',
  'New proposal versions must be created by resubmitting the current rejected version.',
  'Level 3 cannot insert a standalone later version'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '11000000-0000-0000-0000-000000000001';
set local "request.jwt.claims" = '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$update public.proposals
      set status = 'Superseded'
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'$$,
  '42501',
  'A proposal can only be superseded by the atomic resubmit operation.',
  'A standalone update cannot retire a rejected version'
);

select throws_ok(
  $$select *
      from public.resubmit_proposal(
        'PROP-WORKFLOW-OWNER-DRAFT',
        'PROP-WORKFLOW-STALE-REVISION',
        '{"executive":"Stale revised content"}'::jsonb,
        '2000-01-01'::timestamptz
      )$$,
  '42501',
  'This proposal changed elsewhere. Refresh the latest data and try again.',
  'Resubmit rejects a stale predecessor revision before changing either row'
);

select results_eq(
  $$select version, status
      from public.resubmit_proposal(
        'PROP-WORKFLOW-OWNER-DRAFT',
        'PROP-WORKFLOW-OWNER-RESUBMIT',
        '{"executive":"Revised owner content"}'::jsonb,
        (select updated_at from public.proposals
         where id = 'PROP-WORKFLOW-OWNER-DRAFT')
      )$$,
  $$values (2, 'Pending Review')$$,
  'Resubmit creates the next pending version'
);

select results_eq(
  $$select status, sections ->> 'executive'
      from public.proposals
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'$$,
  $$values ('Superseded', 'Updated owner content')$$,
  'Resubmit supersedes v1 without changing its reviewed content'
);

select results_eq(
  $$select status, sections ->> 'executive', reviewer, rejection_reason
      from public.proposals
      where id = 'PROP-WORKFLOW-OWNER-RESUBMIT'$$,
  $$values ('Pending Review', 'Revised owner content', '', '')$$,
  'The replacement carries revised content and clears review fields'
);

select is(
  (
    select count(*)
    from public.proposals
    where case_id = 'CASE-WORKFLOW-OWNER-DRAFT'
      and status <> 'Superseded'
  ),
  1::bigint,
  'Exactly one version remains live for the case'
);

select throws_ok(
  $$select *
      from public.resubmit_proposal(
        'PROP-WORKFLOW-OWNER-DRAFT',
        'PROP-WORKFLOW-STALE-RESUBMIT',
        '{"executive":"Stale branch"}'::jsonb,
        (select updated_at from public.proposals
         where id = 'PROP-WORKFLOW-OWNER-DRAFT')
      )$$,
  '42501',
  'Only the current Reject & Revise version can be resubmitted. Refresh My Proposals and try again.',
  'A stale predecessor cannot create another version'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '11000000-0000-0000-0000-000000000002';
set local "request.jwt.claims" = '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated"}';

select results_eq(
  $$update public.proposals
      set status = 'Approved',
          reviewer_id = '11000000-0000-0000-0000-000000000003',
          reviewer = 'Forged reviewer',
          reviewed_at = '2000-01-01'::timestamptz,
          outcome = 'Pending'
      where id = 'PROP-WORKFLOW-OWNER-RESUBMIT'
      returning status || '|' || reviewer_id::text || '|' || reviewer$$,
  array['Approved|11000000-0000-0000-0000-000000000002|Proposal Manager'],
  'The RPC-created replacement remains reviewable with session-owned audit identity'
);

select throws_ok(
  $$update public.proposals
      set reviewer = 'Changed after decision'
      where id = 'PROP-WORKFLOW-OWNER-RESUBMIT'$$,
  '42501',
  'Reviewer audit fields can only be set when a pending proposal is decided.',
  'Reviewer audit identity is immutable after the decision'
);

select * from finish();
rollback;
