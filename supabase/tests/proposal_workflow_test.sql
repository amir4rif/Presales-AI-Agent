begin;
select plan(5);

insert into auth.users (id, email)
values
  ('11000000-0000-0000-0000-000000000001', 'proposal-owner@example.test'),
  ('11000000-0000-0000-0000-000000000002', 'proposal-manager@example.test');

update public.profiles
set role = case id
    when '11000000-0000-0000-0000-000000000002' then 'Sales Manager'
    else 'Sales Representative'
  end,
  level = case id
    when '11000000-0000-0000-0000-000000000002' then 2
    else 1
  end
where id in (
  '11000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000002'
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
  'Proposal Owner',
  '11000000-0000-0000-0000-000000000001',
  'Proposal Owner',
  'Draft',
  '{"executive":"Owner content"}'::jsonb
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
      set status = 'Pending Review', submitted_at = now()
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'
      returning status$$,
  array['Pending Review'],
  'The owner can submit their own Draft'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '11000000-0000-0000-0000-000000000002';
set local "request.jwt.claims" = '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated"}';

select results_eq(
  $$update public.proposals
      set status = 'Reject & Revise',
          reviewer_id = '11000000-0000-0000-0000-000000000002',
          reviewer = 'Proposal Manager',
          reviewed_at = now(),
          rejection_reason = 'Missing information',
          review_note = 'Please add the missing detail.'
      where id = 'PROP-WORKFLOW-OWNER-DRAFT'
      returning status$$,
  array['Reject & Revise'],
  'Level 2 can review the proposal after its owner submits it'
);

select * from finish();
rollback;
