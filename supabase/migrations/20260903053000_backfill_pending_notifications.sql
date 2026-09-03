-- Seed durable recipient history for proposals that were already awaiting
-- review when recipient-scoped notifications went live.
insert into public.notifications (
  recipient_id,
  actor_id,
  proposal_id,
  event_type,
  title,
  body,
  created_at
)
select
  recipient.id,
  proposal.owner_id,
  proposal.id,
  'pending',
  'Proposal submitted for review',
  format(
    '%s — %s%s',
    proposal.company,
    proposal.case_id,
    case when proposal.version > 1 then format(' (v%s)', proposal.version) else '' end
  ),
  coalesce(proposal.submitted_at, proposal.updated_at)
from public.proposals as proposal
cross join public.profiles as recipient
where proposal.status = 'Pending Review'
  and recipient.status = 'active'
  and recipient.level >= 2
  and recipient.id is distinct from proposal.owner_id
on conflict (proposal_id, recipient_id, event_type) do nothing;
