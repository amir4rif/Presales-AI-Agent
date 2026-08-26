-- admin/approvals/page.tsx only lets a reviewer confirm Reject & Close for
-- genuinely unfixable reasons (CLOSE_REASONS: Compliance issue, Out of
-- scope, Wrong product fit). That rule lived only in the UI: a direct
-- PUT /api/data/proposals with status='Reject & Close' and any
-- rejection_reason (e.g. 'Pricing too high', which the UI treats as
-- fixable and routes to Reject & Revise instead) was accepted, because
-- nothing on the server or in the database validated the pairing.
--
-- A check constraint enforces the pairing for every write path, including
-- the Level 3 / service_role / postgres bypass in
-- private.enforce_proposal_workflow() (20260826031425) — that trigger
-- controls *who* may move a proposal to Reject & Close, not what reason
-- it may carry, and a table constraint can't be routed around by a role
-- check the way a trigger condition can.
alter table public.proposals
  add constraint proposals_close_reason_check
  check (
    status <> 'Reject & Close'
    or rejection_reason in ('Compliance issue', 'Out of scope', 'Wrong product fit')
  );
