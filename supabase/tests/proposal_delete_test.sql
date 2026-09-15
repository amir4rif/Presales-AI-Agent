begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

insert into auth.users (id, email)
values
  ('12000000-0000-0000-0000-000000000001', 'draft-owner@example.test'),
  ('12000000-0000-0000-0000-000000000002', 'other-draft-owner@example.test');

insert into public.proposals (
  id,
  case_id,
  version,
  company,
  deal,
  value,
  submitted_by_id,
  submitted_by,
  owner_id,
  owner,
  status,
  rejection_reason,
  sections
)
values
  ('PROP-DELETE-OWN-DRAFT', 'CASE-DELETE-OWN-DRAFT', 1, 'Own Draft Co', 'Own Draft Deal', 100,
    '12000000-0000-0000-0000-000000000001', 'Draft Owner',
    '12000000-0000-0000-0000-000000000001', 'Draft Owner', 'Draft', '', '{}'::jsonb),
  ('PROP-DELETE-OTHER-DRAFT', 'CASE-DELETE-OTHER-DRAFT', 1, 'Other Draft Co', 'Other Draft Deal', 100,
    '12000000-0000-0000-0000-000000000002', 'Other Owner',
    '12000000-0000-0000-0000-000000000002', 'Other Owner', 'Draft', '', '{}'::jsonb),
  ('PROP-DELETE-PENDING', 'CASE-DELETE-PENDING', 1, 'Pending Co', 'Pending Deal', 100,
    '12000000-0000-0000-0000-000000000001', 'Draft Owner',
    '12000000-0000-0000-0000-000000000001', 'Draft Owner', 'Pending Review', '', '{}'::jsonb),
  ('PROP-DELETE-APPROVED', 'CASE-DELETE-APPROVED', 1, 'Approved Co', 'Approved Deal', 100,
    '12000000-0000-0000-0000-000000000001', 'Draft Owner',
    '12000000-0000-0000-0000-000000000001', 'Draft Owner', 'Approved', '', '{}'::jsonb),
  ('PROP-DELETE-REVISE', 'CASE-DELETE-REVISE', 1, 'Revise Co', 'Revise Deal', 100,
    '12000000-0000-0000-0000-000000000001', 'Draft Owner',
    '12000000-0000-0000-0000-000000000001', 'Draft Owner', 'Reject & Revise', 'Missing information', '{}'::jsonb),
  ('PROP-DELETE-CLOSE', 'CASE-DELETE-CLOSE', 1, 'Close Co', 'Close Deal', 100,
    '12000000-0000-0000-0000-000000000001', 'Draft Owner',
    '12000000-0000-0000-0000-000000000001', 'Draft Owner', 'Reject & Close', 'Out of scope', '{}'::jsonb),
  ('PROP-DELETE-SUPERSEDED', 'CASE-DELETE-SUPERSEDED', 1, 'Superseded Co', 'Superseded Deal', 100,
    '12000000-0000-0000-0000-000000000001', 'Draft Owner',
    '12000000-0000-0000-0000-000000000001', 'Draft Owner', 'Superseded', '', '{}'::jsonb),
  ('PROP-DELETE-HISTORY-V1', 'CASE-DELETE-HISTORY', 1, 'History Co', 'History Deal', 100,
    '12000000-0000-0000-0000-000000000001', 'Draft Owner',
    '12000000-0000-0000-0000-000000000001', 'Draft Owner', 'Approved', '', '{}'::jsonb),
  ('PROP-DELETE-HISTORY-V2', 'CASE-DELETE-REUSABLE', 1, 'Reusable Draft Co', 'Reusable Draft Deal', 100,
    '12000000-0000-0000-0000-000000000001', 'Draft Owner',
    '12000000-0000-0000-0000-000000000001', 'Draft Owner', 'Draft', '', '{}'::jsonb);

set local role authenticated;
set local "request.jwt.claim.sub" = '12000000-0000-0000-0000-000000000001';
set local "request.jwt.claims" = '{"sub":"12000000-0000-0000-0000-000000000001","role":"authenticated"}';

select results_eq(
  $$delete from public.proposals where id = 'PROP-DELETE-OWN-DRAFT' returning id$$,
  array['PROP-DELETE-OWN-DRAFT'],
  'A rep can delete their own Draft'
);

select results_eq(
  $$delete from public.proposals where id = 'PROP-DELETE-OTHER-DRAFT' returning id$$,
  array[]::text[],
  'A rep cannot delete another rep''s Draft'
);

select results_eq(
  $$delete from public.proposals where id = 'PROP-DELETE-PENDING' returning id$$,
  array[]::text[],
  'Pending Review cannot be deleted'
);

select results_eq(
  $$delete from public.proposals where id = 'PROP-DELETE-APPROVED' returning id$$,
  array[]::text[],
  'Approved cannot be deleted'
);

select results_eq(
  $$delete from public.proposals where id = 'PROP-DELETE-REVISE' returning id$$,
  array[]::text[],
  'Reject & Revise cannot be deleted'
);

select results_eq(
  $$delete from public.proposals where id = 'PROP-DELETE-CLOSE' returning id$$,
  array[]::text[],
  'Reject & Close cannot be deleted'
);

select results_eq(
  $$delete from public.proposals where id = 'PROP-DELETE-SUPERSEDED' returning id$$,
  array[]::text[],
  'Superseded cannot be deleted'
);

select results_eq(
  $$delete from public.proposals where id = 'PROP-DELETE-HISTORY-V2' returning id$$,
  array['PROP-DELETE-HISTORY-V2'],
  'The owner can delete another valid first-version Draft'
);

select is(
  (select count(*) from public.proposals where id = 'PROP-DELETE-HISTORY-V1'),
  1::bigint,
  'Deleting an independent Draft leaves approved history intact'
);

select is(
  (select count(*) from public.proposal_version_history where case_id = 'CASE-DELETE-HISTORY'),
  1::bigint,
  'Deleting an independent Draft leaves the approved case in the history view'
);

select lives_ok(
  $$insert into public.proposals (
      id, case_id, version, company, deal, value,
      submitted_by_id, submitted_by, owner_id, owner, status, sections
    ) values (
      'PROP-DELETE-HISTORY-V2-RECREATED', 'CASE-DELETE-REUSABLE', 1,
      'Reusable Draft Co', 'Reusable Draft Deal', 100,
      '12000000-0000-0000-0000-000000000001', 'Draft Owner',
      '12000000-0000-0000-0000-000000000001', 'Draft Owner',
      'Draft', '{}'::jsonb
    )$$,
  'A first-version Draft identity can be reused after its row is deleted'
);

select results_eq(
  $$select version from public.proposals where case_id = 'CASE-DELETE-REUSABLE' order by version$$,
  array[1],
  'The recreated Draft remains a valid first proposal version'
);

select * from finish();
rollback;
