begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(43);

insert into auth.users (id, email)
values
  ('21000000-0000-0000-0000-000000000001', 'deal-owner@example.test'),
  ('21000000-0000-0000-0000-000000000002', 'deal-manager@example.test');

update public.profiles
set role = case id
    when '21000000-0000-0000-0000-000000000002' then 'Sales Manager'
    else 'Sales Representative'
  end,
  level = case id
    when '21000000-0000-0000-0000-000000000002' then 2
    else 1
  end,
  full_name = case id
    when '21000000-0000-0000-0000-000000000002' then 'Deal Manager'
    else 'Deal Owner'
  end,
  status = 'active'
where id in (
  '21000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000002'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '21000000-0000-0000-0000-000000000001';
set local "request.jwt.claims" = '{"sub":"21000000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.deals (
  id, owner_id, rep, account, opportunity_id, stage, days_in_stage,
  days_to_close, value, movement, status, notes
)
values
  (
    '22000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    'Deal Owner', 'Won Account', 'OPP-DEAL-WON', 6, 3, 15, 125000,
    'Advanced', 'On Track', ''
  ),
  (
    '22000000-0000-0000-0000-000000000002',
    '21000000-0000-0000-0000-000000000001',
    'Deal Owner', 'DQ Account', 'OPP-DEAL-DQ', 4, 7, 20, 80000,
    'No Change', 'At Risk', ''
  ),
  (
    '22000000-0000-0000-0000-000000000003',
    '21000000-0000-0000-0000-000000000001',
    'Deal Owner', 'Decline Account', 'OPP-DEAL-DECLINE', 3, 2, 30, 60000,
    'Advanced', 'On Track', ''
  ),
  (
    '22000000-0000-0000-0000-000000000004',
    '21000000-0000-0000-0000-000000000001',
    'Deal Owner', 'Attach Account', 'OPP-DEAL-ATTACH', 5, 6, 40, 225000,
    'Advanced', 'On Track', ''
  ),
  (
    '22000000-0000-0000-0000-000000000005',
    '21000000-0000-0000-0000-000000000001',
    'Deal Owner', 'Revise Account', 'OPP-DEAL-REVISE', 2, 1, 50, 95000,
    'Advanced', 'On Track', ''
  ),
  (
    '22000000-0000-0000-0000-000000000006',
    '21000000-0000-0000-0000-000000000001',
    'Deal Owner', 'Reject Close Account', 'OPP-DEAL-REJECT-CLOSE',
    4, 3, 25, 110000, 'No Change', 'At Risk', ''
  ),
  (
    '22000000-0000-0000-0000-000000000007',
    '21000000-0000-0000-0000-000000000001',
    'Deal Owner', 'Atomic Lost Account', 'OPP-DEAL-ATOMIC-LOST',
    7, 2, 10, 175000, 'Advanced', 'On Track', ''
  ),
  (
    '22000000-0000-0000-0000-000000000008',
    '21000000-0000-0000-0000-000000000001',
    'Deal Owner', 'Invalid Close Account', 'OPP-DEAL-INVALID-CLOSE',
    3, 4, 35, 70000, 'No Change', 'On Track', ''
  );

-- An artificial same-ID history row makes archive insertion fail. It lets the
-- test prove that the live-row deletion is rolled back rather than half-done.
insert into public.closed_deals (
  id, owner_id, rep, account, value, close_date, source, outcome
)
values (
  '22000000-0000-0000-0000-000000000007',
  '21000000-0000-0000-0000-000000000001',
  'Deal Owner', 'Pre-existing history row', 1, current_date, 'Test', 'Won'
);

insert into public.proposals (
  id, case_id, opportunity_id, company, deal, value,
  submitted_by_id, submitted_by, owner_id, owner,
  submitted_at, status, sections
)
values
  (
    'PROP-DEAL-ATTACH', 'CASE-DEAL-ATTACH', 'OPP-DEAL-ATTACH',
    'Attach Account', 'Attach proposal', 225000,
    '21000000-0000-0000-0000-000000000001', 'Deal Owner',
    '21000000-0000-0000-0000-000000000001', 'Deal Owner',
    pg_catalog.now(), 'Pending Review', '{}'::jsonb
  ),
  (
    'PROP-DEAL-CONFLICT', 'CASE-DEAL-CONFLICT', 'OPP-DEAL-ATTACH',
    'Unrelated Account Text', 'Conflicting proposal', 230000,
    '21000000-0000-0000-0000-000000000001', 'Deal Owner',
    '21000000-0000-0000-0000-000000000001', 'Deal Owner',
    pg_catalog.now(), 'Pending Review', '{}'::jsonb
  ),
  (
    'PROP-DEAL-CREATE', 'CASE-DEAL-CREATE', 'OPP-DEAL-CREATE',
    'Attach Account', 'Create proposal', 315000,
    '21000000-0000-0000-0000-000000000001', 'Deal Owner',
    '21000000-0000-0000-0000-000000000001', 'Deal Owner',
    pg_catalog.now(), 'Pending Review', '{}'::jsonb
  ),
  (
    'PROP-DEAL-REVISE', 'CASE-DEAL-REVISE', 'OPP-DEAL-REVISE',
    'Revise Account', 'Revise proposal', 95000,
    '21000000-0000-0000-0000-000000000001', 'Deal Owner',
    '21000000-0000-0000-0000-000000000001', 'Deal Owner',
    pg_catalog.now(), 'Pending Review', '{}'::jsonb
  ),
  (
    'PROP-DEAL-REJECT-CLOSE', 'CASE-DEAL-REJECT-CLOSE',
    'OPP-DEAL-REJECT-CLOSE', 'Reject Close Account',
    'Reject and close proposal', 110000,
    '21000000-0000-0000-0000-000000000001', 'Deal Owner',
    '21000000-0000-0000-0000-000000000001', 'Deal Owner',
    pg_catalog.now(), 'Pending Review', '{}'::jsonb
  ),
  (
    'PROP-DEAL-NO-OPP', 'CASE-DEAL-NO-OPP', '',
    'No Opportunity Account', 'No opportunity proposal', 50000,
    '21000000-0000-0000-0000-000000000001', 'Deal Owner',
    '21000000-0000-0000-0000-000000000001', 'Deal Owner',
    pg_catalog.now(), 'Pending Review', '{}'::jsonb
  ),
  (
    'PROP-DEAL-INVALID-CLOSE', 'CASE-DEAL-INVALID-CLOSE',
    'OPP-DEAL-INVALID-CLOSE', 'Invalid Close Account',
    'Invalid close proposal', 70000,
    '21000000-0000-0000-0000-000000000001', 'Deal Owner',
    '21000000-0000-0000-0000-000000000001', 'Deal Owner',
    pg_catalog.now(), 'Pending Review', '{}'::jsonb
  );

select is(
  (
    select public.close_deal(
      '22000000-0000-0000-0000-000000000001', 'Won', '', 'Referral',
      current_date,
      (select updated_at from public.deals
       where id = '22000000-0000-0000-0000-000000000001')
    ) ->> 'status'
  ),
  'closed',
  'A deal owner can close an open deal as Won'
);

select is(
  (
    select count(*)
    from public.deals
    where id = '22000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'Won close removes the live row'
);

select is(
  (
    select outcome = 'Won' and id = '22000000-0000-0000-0000-000000000001'
      and closed_by_id = '21000000-0000-0000-0000-000000000001'
      and closed_by = 'Deal Owner' and closed_at is not null
    from public.closed_deals
    where id = '22000000-0000-0000-0000-000000000001'
  ),
  true,
  'Won close preserves the id and records trusted closer audit fields'
);

select is(
  (
    (select count(*) from public.deals
     where id = '22000000-0000-0000-0000-000000000001') +
    (select count(*) from public.closed_deals
     where id = '22000000-0000-0000-0000-000000000001')
  ),
  1::bigint,
  'A completed close leaves exactly one same-id record across live and history'
);

select throws_ok(
  $$select public.close_deal(
      '22000000-0000-0000-0000-000000000002',
      'Disqualified', 'Made-up reason', 'Manual', current_date,
      (select updated_at from public.deals
       where id = '22000000-0000-0000-0000-000000000002')
    )$$,
  '22023',
  'Choose a valid disqualification reason.',
  'Disqualified accepts no free-text reason'
);

select is(
  (
    select pending_disqualification_reason is null
    from public.deals
    where id = '22000000-0000-0000-0000-000000000002'
  ),
  true,
  'A rejected disqualification reason leaves the open deal unchanged'
);

select is(
  (
    select public.close_deal(
      '22000000-0000-0000-0000-000000000002',
      'Disqualified', 'Compliance', 'Manual', current_date,
      (select updated_at from public.deals
       where id = '22000000-0000-0000-0000-000000000002')
    ) ->> 'status'
  ),
  'pending_approval',
  'A Level 1 disqualification becomes a pending request'
);

select is(
  (
    select pending_disqualification_reason = 'Compliance'
      and pending_close_source = 'Manual'
      and close_requested_by_id = '21000000-0000-0000-0000-000000000001'
      and close_requested_by = 'Deal Owner'
      and close_requested_at is not null
    from public.deals
    where id = '22000000-0000-0000-0000-000000000002'
  ),
  true,
  'The pending request stores its fixed reason and requester audit'
);

select is(
  (
    select count(*) from public.closed_deals
    where id = '22000000-0000-0000-0000-000000000002'
  ),
  0::bigint,
  'A pending disqualification is not prematurely added to history'
);

select throws_ok(
  $$delete from public.deals
      where id = '22000000-0000-0000-0000-000000000002'$$,
  '42501',
  'A pending disqualification must be approved or declined before the deal can be deleted.',
  'The owner cannot delete a deal while its decision is pending'
);

select throws_ok(
  $$select public.review_deal_disqualification(
      '22000000-0000-0000-0000-000000000002', true,
      (select updated_at from public.deals
       where id = '22000000-0000-0000-0000-000000000002')
    )$$,
  '42501',
  'A Level 2 reviewer is required for this disqualification decision.',
  'A Level 1 rep cannot approve their own disqualification request'
);

select throws_ok(
  $$select public.close_deal(
      '22000000-0000-0000-0000-000000000007',
      'Lost', 'Timing', 'Outbound', current_date,
      (select updated_at from public.deals
       where id = '22000000-0000-0000-0000-000000000007')
    )$$,
  '23505',
  'duplicate key value violates unique constraint "closed_deals_pkey"',
  'A historical insert failure aborts the atomic close'
);

select is(
  (
    select count(*) from public.deals
    where id = '22000000-0000-0000-0000-000000000007'
  ),
  1::bigint,
  'A failed close leaves the original live deal in place'
);

delete from public.closed_deals
where id = '22000000-0000-0000-0000-000000000007';

select is(
  (
    select public.close_deal(
      '22000000-0000-0000-0000-000000000007',
      'Lost', 'Timing', 'Outbound', current_date,
      (select updated_at from public.deals
       where id = '22000000-0000-0000-0000-000000000007')
    ) ->> 'status'
  ),
  'closed',
  'The same live deal can be closed as Lost after the insert conflict is removed'
);

select is(
  (
    select history.outcome = 'Lost' and history.loss_reason = 'Timing'
      and history.disqualification_reason = ''
      and not exists (
        select 1 from public.deals as live where live.id = history.id
      )
    from public.closed_deals as history
    where history.id = '22000000-0000-0000-0000-000000000007'
  ),
  true,
  'Lost is stored separately with one history row and no live duplicate'
);

select throws_ok(
  $$insert into public.closed_deals (
      owner_id, rep, account, value, close_date, source, outcome,
      disqualification_reason
    ) values (
      '21000000-0000-0000-0000-000000000001', 'Deal Owner',
      'Bypass Attempt', 10, current_date, 'Manual', 'Disqualified',
      'Out of scope'
    )$$,
  '42501',
  'Disqualified deals require Level 2 approval.',
  'A Level 1 rep cannot bypass approval with a direct history insert'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '21000000-0000-0000-0000-000000000002';
set local "request.jwt.claims" = '{"sub":"21000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (
    select public.review_deal_disqualification(
      '22000000-0000-0000-0000-000000000002', true,
      (select updated_at from public.deals
       where id = '22000000-0000-0000-0000-000000000002')
    ) ->> 'status'
  ),
  'closed',
  'A Level 2 reviewer can approve the pending disqualification'
);

select is(
  (
    (select count(*) from public.deals
     where id = '22000000-0000-0000-0000-000000000002') +
    (select count(*) from public.closed_deals
     where id = '22000000-0000-0000-0000-000000000002')
  ),
  1::bigint,
  'Approved disqualification atomically replaces open with history'
);

select is(
  (
    select outcome = 'Disqualified'
      and loss_reason = ''
      and disqualification_reason = 'Compliance'
    from public.closed_deals
    where id = '22000000-0000-0000-0000-000000000002'
  ),
  true,
  'Disqualified is its own outcome with its own mandatory reason column'
);

select is(
  (
    select disqualification_requested_by_id =
        '21000000-0000-0000-0000-000000000001'
      and disqualification_requested_by = 'Deal Owner'
      and disqualification_requested_at is not null
      and disqualification_approved_by_id =
        '21000000-0000-0000-0000-000000000002'
      and disqualification_approved_by = 'Deal Manager'
      and disqualification_approved_at is not null
      and closed_by_id = '21000000-0000-0000-0000-000000000002'
    from public.closed_deals
    where id = '22000000-0000-0000-0000-000000000002'
  ),
  true,
  'Disqualification history logs both requester and approver identities and times'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '21000000-0000-0000-0000-000000000001';
set local "request.jwt.claims" = '{"sub":"21000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (
    select public.close_deal(
      '22000000-0000-0000-0000-000000000003',
      'Disqualified', 'Wrong product fit', 'Manual', current_date,
      (select updated_at from public.deals
       where id = '22000000-0000-0000-0000-000000000003')
    ) ->> 'status'
  ),
  'pending_approval',
  'A second Level 1 deal can request disqualification'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '21000000-0000-0000-0000-000000000002';
set local "request.jwt.claims" = '{"sub":"21000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (
    select public.review_deal_disqualification(
      '22000000-0000-0000-0000-000000000003', false,
      (select updated_at from public.deals
       where id = '22000000-0000-0000-0000-000000000003')
    ) ->> 'status'
  ),
  'declined',
  'A Level 2 reviewer can decline a disqualification request'
);

select is(
  (
    select pending_disqualification_reason is null
      and close_requested_by_id is null
      and not exists (
        select 1 from public.closed_deals as history
        where history.id = live.id
      )
    from public.deals as live
    where live.id = '22000000-0000-0000-0000-000000000003'
  ),
  true,
  'Declining clears the request and leaves the deal Open'
);

select results_eq(
  $$update public.proposals
      set status = 'Approved', outcome = 'Pending'
      where id = 'PROP-DEAL-ATTACH'
      returning deal_link_action, deal_id$$,
  $$values (
      'attached'::text,
      '22000000-0000-0000-0000-000000000004'::uuid
    )$$,
  'Approval attaches a proposal to the open deal with the same opportunity ID'
);

select is(
  (
    select proposal.deal_id = live.id
      and proposal.case_id = live.case_id
    from public.proposals as proposal
    join public.deals as live on live.id = proposal.deal_id
    where proposal.id = 'PROP-DEAL-ATTACH'
  ),
  true,
  'Proposal and deal store the reciprocal explicit link'
);

select throws_ok(
  $$update public.proposals
      set status = 'Approved', outcome = 'Pending'
      where id = 'PROP-DEAL-CONFLICT'$$,
  '23505',
  'This deal already has a live proposal case. Close or supersede it before attaching another.',
  'A second live proposal case cannot attach to the same deal'
);

select is(
  (
    select status = 'Pending Review' and deal_id is null
    from public.proposals
    where id = 'PROP-DEAL-CONFLICT'
  ),
  true,
  'A rejected second attachment rolls back without overwriting the first link'
);

select results_eq(
  $$update public.proposals
      set status = 'Approved', outcome = 'Pending'
      where id = 'PROP-DEAL-CREATE'
      returning deal_link_action, status$$,
  $$values ('created'::text, 'Approved'::text)$$,
  'Approval creates a deal when its explicit opportunity ID has no live deal'
);

select is(
  (
    select live.owner_id = proposal.owner_id
      and live.rep = proposal.owner
      and live.account = proposal.company
      and live.value = proposal.value
      and live.opportunity_id = proposal.opportunity_id
      and live.case_id = proposal.case_id
      and live.id = proposal.deal_id
      and live.id <> '22000000-0000-0000-0000-000000000004'
    from public.proposals as proposal
    join public.deals as live on live.id = proposal.deal_id
    where proposal.id = 'PROP-DEAL-CREATE'
  ),
  true,
  'Created deal copies proposal owner, account, value and IDs without account-name matching'
);

select results_eq(
  $$update public.proposals
      set status = 'Reject & Revise',
          rejection_reason = 'Missing information',
          review_note = 'Revise the draft.'
      where id = 'PROP-DEAL-REVISE'
      returning status, deal_id$$,
  $$values ('Reject & Revise'::text, null::uuid)$$,
  'Reject & Revise does not attach a deal'
);

select is(
  (
    select case_id is null and opportunity_id = 'OPP-DEAL-REVISE'
    from public.deals
    where id = '22000000-0000-0000-0000-000000000005'
  ),
  true,
  'Reject & Revise leaves the live deal untouched'
);

select results_eq(
  $$update public.proposals
      set status = 'Reject & Close',
          rejection_reason = 'Blacklisted account',
          review_note = 'Account is on the blacklist.'
      where id = 'PROP-DEAL-REJECT-CLOSE'
      returning status, outcome, deal_link_action$$,
  $$values (
      'Reject & Close'::text, 'Disqualified'::text, 'attached'::text
    )$$,
  'Reject & Close attaches and records Disqualified in one decision'
);

select is(
  (
    select count(*) from public.deals
    where id = '22000000-0000-0000-0000-000000000006'
  ),
  0::bigint,
  'Reject & Close removes the linked live deal'
);

select is(
  (
    select outcome = 'Disqualified'
      and disqualification_reason = 'Blacklisted account'
      and loss_reason = ''
      and case_id = 'CASE-DEAL-REJECT-CLOSE'
      and closed_by_id = '21000000-0000-0000-0000-000000000002'
    from public.closed_deals
    where id = '22000000-0000-0000-0000-000000000006'
  ),
  true,
  'Reject & Close carries the exact proposal reason and case into deal history'
);

select is(
  (
    select proposal.deal_id = history.id
      and proposal.case_id = history.case_id
      and proposal.rejection_reason = history.disqualification_reason
    from public.proposals as proposal
    join public.closed_deals as history on history.id = proposal.deal_id
    where proposal.id = 'PROP-DEAL-REJECT-CLOSE'
  ),
  true,
  'The closed deal and proposal retain a matching explicit ID and reason'
);

select is(
  (
    select public.close_deal(
      deal_id, 'Won', '', 'Proposal', current_date,
      (select updated_at from public.deals where id = proposal.deal_id)
    ) ->> 'status'
    from public.proposals as proposal
    where proposal.id = 'PROP-DEAL-CREATE'
  ),
  'closed',
  'A proposal-created deal can later close through the atomic deal transition'
);

select is(
  (
    select outcome from public.proposals where id = 'PROP-DEAL-CREATE'
  ),
  'Won',
  'Closing a linked deal updates its approved proposal outcome'
);

select throws_ok(
  $$update public.proposals
      set outcome = 'Lost'
      where id = 'PROP-DEAL-CREATE'$$,
  '42501',
  'Deal outcomes must be recorded by closing the linked deal.',
  'An approved proposal outcome cannot be changed directly'
);

select throws_ok(
  $$update public.proposals
      set status = 'Approved', outcome = 'Pending'
      where id = 'PROP-DEAL-NO-OPP'$$,
  '42501',
  'An approved or closed proposal must have a non-empty opportunity ID before it can link a deal.',
  'Approval refuses to guess a relationship without an opportunity ID'
);

select is(
  (
    select status = 'Pending Review' and deal_id is null
    from public.proposals
    where id = 'PROP-DEAL-NO-OPP'
  ),
  true,
  'Missing-link approval failure leaves the proposal unchanged'
);

select throws_ok(
  $$update public.proposals
      set status = 'Reject & Close',
          rejection_reason = 'Pricing too high',
          review_note = 'Invalid structural close reason.'
      where id = 'PROP-DEAL-INVALID-CLOSE'$$,
  '23514',
  'new row for relation "closed_deals" violates check constraint "closed_deals_reason_pairing_check"',
  'Reject & Close accepts only the four structural disqualification reasons'
);

select is(
  (
    select proposal.status = 'Pending Review'
      and proposal.deal_id is null
      and live.case_id is null
    from public.proposals as proposal
    join public.deals as live
      on live.id = '22000000-0000-0000-0000-000000000008'
    where proposal.id = 'PROP-DEAL-INVALID-CLOSE'
  ),
  true,
  'An invalid Reject & Close rolls back both the proposal link and deal transition'
);

insert into public.closed_deals (
  id, owner_id, rep, account, value, close_date, source, outcome,
  disqualification_reason
)
values (
  '22000000-0000-0000-0000-000000000009',
  '21000000-0000-0000-0000-000000000001', 'Deal Owner',
  'Manager-entered DQ', 25, current_date, 'Manual', 'Disqualified',
  'Out of scope'
);

select is(
  (
    select outcome = 'Disqualified'
      and disqualification_approved_by_id =
        '21000000-0000-0000-0000-000000000002'
      and disqualification_approved_by = 'Deal Manager'
      and disqualification_approved_at is not null
    from public.closed_deals
    where id = '22000000-0000-0000-0000-000000000009'
  ),
  true,
  'A Level 2 direct Disqualified history entry receives approval audit fields'
);

select * from finish();
rollback;
