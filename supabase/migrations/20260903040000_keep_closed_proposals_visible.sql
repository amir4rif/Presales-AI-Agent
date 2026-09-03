-- My Proposals is one row per live case. Reject & Close is a terminal outcome,
-- not an audit-only version, so the owner must still be able to read its reason
-- and reviewer note. Only Superseded versions stay out of this convenience view.
create or replace view public.my_proposals
with (security_invoker = true)
as
select *
from public.proposals
where status <> 'Superseded'
  and owner_id = (select auth.uid());

comment on view public.my_proposals is
  'Current user proposal versions excluding only Superseded audit history.';
