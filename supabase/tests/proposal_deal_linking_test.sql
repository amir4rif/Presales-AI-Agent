begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);

insert into auth.users (id, email)
values
  ('31000000-0000-0000-0000-000000000001', 't13-owner@example.test'),
  ('31000000-0000-0000-0000-000000000002', 't13-other@example.test'),
  ('31000000-0000-0000-0000-000000000003', 't13-manager@example.test');

update public.profiles
set role = case id
      when '31000000-0000-0000-0000-000000000003' then 'Sales Manager'
      else 'Sales Representative'
    end,
    level = case id
      when '31000000-0000-0000-0000-000000000003' then 2
      else 1
    end,
    full_name = case id
      when '31000000-0000-0000-0000-000000000001' then 'T13 Owner'
      when '31000000-0000-0000-0000-000000000002' then 'T13 Other Rep'
      else 'T13 Manager'
    end,
    status = 'active'
where id in (
  '31000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000002',
  '31000000-0000-0000-0000-000000000003'
);

insert into public.deals (
  id, owner_id, rep, account, opportunity_id, stage, days_in_stage,
  days_to_close, value, movement, status, notes
)
values
  (
    '32000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    'T13 Owner', 'Fresh Prospect Deal', null, 3, 2, 45, 456789,
    'Advanced', 'On Track', 'Must remain unchanged'
  ),
  (
    '32000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000001',
    'T13 Owner', 'Concurrency Deal', 'OPP-T13-CONCURRENT', 4, 3, 30, 200000,
    'No Change', 'On Track', ''
  ),
  (
    '32000000-0000-0000-0000-000000000003',
    '31000000-0000-0000-0000-000000000001',
    'T13 Owner', 'Reusable Draft Deal', null, 2, 1, 60, 175000,
    'Advanced', 'On Track', ''
  ),
  (
    '32000000-0000-0000-0000-000000000004',
    '31000000-0000-0000-0000-000000000002',
    'T13 Other Rep', 'Team Visible Deal', null, 5, 7, 20, 975000,
    'Advanced', 'At Risk', ''
  );

set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000001';
set local "request.jwt.claims" = '{"sub":"31000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (
    select (public.create_proposal_for_deal(
      '32000000-0000-0000-0000-000000000001',
      'PROP-T13-APPROVE',
      '{"executive":"Starter","solution":"Solution","commercials":"RM 456,789"}'::jsonb
    )).deal_id
  ),
  '32000000-0000-0000-0000-000000000001'::uuid,
  'An owner creates a Draft against a real visible deal'
);

select is(
  (
    select company = 'Fresh Prospect Deal'
      and deal = 'Fresh Prospect Deal'
      and value = 456789
      and owner_id = '31000000-0000-0000-0000-000000000001'
      and prospect_id is null
    from public.proposals
    where id = 'PROP-T13-APPROVE'
  ),
  true,
  'Proposal display fields and value are derived from the selected deal'
);

select is(
  (
    select proposal.case_id = live.case_id
      and proposal.deal_id = live.id
      and proposal.deal_link_action = 'attached'
      and proposal.deal_linked_at is not null
    from public.proposals as proposal
    join public.deals as live on live.id = proposal.deal_id
    where proposal.id = 'PROP-T13-APPROVE'
  ),
  true,
  'Proposal and deal receive reciprocal IDs in the same transaction'
);

select lives_ok(
  $$select public.create_proposal_for_deal(
      '32000000-0000-0000-0000-000000000002',
      'PROP-T13-FIRST',
      '{}'::jsonb
    )$$,
  'The first live case reserves its deal'
);

select throws_ok(
  $$select public.create_proposal_for_deal(
      '32000000-0000-0000-0000-000000000002',
      'PROP-T13-SECOND',
      '{}'::jsonb
    )$$,
  '23505',
  'This deal already has a live proposal case. Close or supersede it before attaching another.',
  'A second live case is rejected clearly'
);

select is(
  (
    select count(*)
    from public.proposals
    where deal_id = '32000000-0000-0000-0000-000000000002'
  ),
  1::bigint,
  'A rejected second creation leaves no duplicate proposal row'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000002';
set local "request.jwt.claims" = '{"sub":"31000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$select public.create_proposal_for_deal(
      '32000000-0000-0000-0000-000000000003',
      'PROP-T13-NOT-MINE',
      '{}'::jsonb
    )$$,
  '42501',
  'The selected deal is no longer open or is outside your pipeline.',
  'A Level 1 rep cannot create a proposal for another rep deal'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000001';
set local "request.jwt.claims" = '{"sub":"31000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.create_proposal_for_deal(
      '32000000-0000-0000-0000-000000000003',
      'PROP-T13-DELETE',
      '{}'::jsonb
    )$$,
  'A Draft can be created for the reusable deal'
);

delete from public.proposals where id = 'PROP-T13-DELETE';

select is(
  (
    select case_id is null
    from public.deals
    where id = '32000000-0000-0000-0000-000000000003'
  ),
  true,
  'Deleting a linked Draft releases the deal case pointer atomically'
);

select lives_ok(
  $$select public.create_proposal_for_deal(
      '32000000-0000-0000-0000-000000000003',
      'PROP-T13-REUSED',
      '{}'::jsonb
    )$$,
  'A deal with no live case becomes selectable again'
);

update public.proposals
set status = 'Pending Review', sections = '{"executive":"Ready for review"}'::jsonb
where id in ('PROP-T13-APPROVE', 'PROP-T13-REUSED');

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
set local "request.jwt.claims" = '{"sub":"31000000-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$select public.create_proposal_for_deal(
      '32000000-0000-0000-0000-000000000004',
      'PROP-T13-MANAGER',
      '{"executive":"Manager draft"}'::jsonb
    )$$,
  'A Level 2 manager can pick a team-visible deal'
);

select is(
  (
    select company = 'Team Visible Deal'
      and value = 975000
      and owner_id = '31000000-0000-0000-0000-000000000003'
      and deal_id = '32000000-0000-0000-0000-000000000004'
    from public.proposals
    where id = 'PROP-T13-MANAGER'
  ),
  true,
  'A manager-created proposal still derives fields from the team deal'
);

delete from public.proposals where id = 'PROP-T13-MANAGER';

select is(
  (
    select case_id is null
    from public.deals
    where id = '32000000-0000-0000-0000-000000000004'
  ),
  true,
  'Deleting the manager-owned Draft releases the team deal pointer'
);

select results_eq(
  $$update public.proposals
      set status = 'Approved', outcome = 'Pending'
      where id = 'PROP-T13-APPROVE'
      returning status, deal_id$$,
  $$values (
      'Approved'::text,
      '32000000-0000-0000-0000-000000000001'::uuid
    )$$,
  'A linked proposal approves through deal_id even without an opportunity ID'
);

select is(
  (
    select count(*)
    from public.deals
    where id = '32000000-0000-0000-0000-000000000001'
      and account = 'Fresh Prospect Deal'
      and stage = 3
      and value = 456789
      and notes = 'Must remain unchanged'
  ),
  1::bigint,
  'Approval keeps the original live deal instead of creating or rewriting one'
);

select is(
  (
    select deal_link_action = 'attached'
      and opportunity_id = ''
    from public.proposals
    where id = 'PROP-T13-APPROVE'
  ),
  true,
  'The canonical deal ID works while a legacy opportunity ID remains empty'
);

select results_eq(
  $$update public.proposals
      set status = 'Reject & Revise',
          rejection_reason = 'Missing information',
          review_note = 'Add detail and resubmit.'
      where id = 'PROP-T13-REUSED'
      returning status, deal_id$$,
  $$values (
      'Reject & Revise'::text,
      '32000000-0000-0000-0000-000000000003'::uuid
    )$$,
  'Reject & Revise keeps the existing live case linked'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000001';
set local "request.jwt.claims" = '{"sub":"31000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.create_proposal_for_deal(
      '32000000-0000-0000-0000-000000000003',
      'PROP-T13-AFTER-REVISE',
      '{}'::jsonb
    )$$,
  '23505',
  'This deal already has a live proposal case. Close or supersede it before attaching another.',
  'Reject & Revise keeps the deal out of the new-proposal picker'
);

select is(
  (
    select live.case_id = proposal.case_id
      and live.stage = 2
      and live.value = 175000
    from public.deals as live
    join public.proposals as proposal on proposal.deal_id = live.id
    where live.id = '32000000-0000-0000-0000-000000000003'
      and proposal.id = 'PROP-T13-REUSED'
  ),
  true,
  'Reject & Revise leaves the linked deal and reciprocal IDs untouched'
);

select * from finish();
rollback;
